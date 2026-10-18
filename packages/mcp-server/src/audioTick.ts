import { spawn } from "node:child_process";

/**
 * Finds a ticking-clock pattern in audio: short high-frequency bursts that repeat evenly.
 * A hat on every off-beat, a tick on every beat, or a pluck that never rests all sound like
 * a clock under a voiceover, whatever instrument plays them.
 *
 * The audio is decoded to mono, high-passed at 5 kHz, and turned into a 1 ms RMS envelope.
 * The slow trend (a 100 ms moving average: decays, section changes, speech phrasing) is
 * removed so only fast bursts are left, and the envelope's autocorrelation is read at lags
 * of 150 to 800 ms, which covers a tick every beat or every eighth note from about 75 to 400
 * bpm. Measured on real files: clean beds and narrated videos score 0.03 to 0.18, a hat and
 * tick grid scores 0.4 to 0.99.
 *
 * compose-score.py runs the same measurement on its own mix (hf_periodicity), so a score is
 * checked when it is made and the final audio is checked again when the video is finalized.
 */

export const TICK_LAG_MIN_MS = 150;
export const TICK_LAG_MAX_MS = 800;
export const TICK_THRESHOLD = 0.3;
const TREND_WINDOW_MS = 100;
const MIN_SECONDS = 2;
const ANALYSIS_RATE = 32000;

export interface AudioTickResult {
  /** Strongest normalized autocorrelation of the high-frequency envelope between the two lags. */
  peak: number;
  /** The lag of that peak in milliseconds, or null when the audio was too short to measure. */
  lagMs: number | null;
  verdict: "ok" | "periodic";
  thresholdPeak: number;
  note?: string;
}

/** Pure analysis of audio that has already been high-passed at 5 kHz. */
export function analyzeTickEnvelope(samples: Float32Array, sampleRate: number): AudioTickResult {
  const base = { thresholdPeak: TICK_THRESHOLD };
  if (samples.length < sampleRate * MIN_SECONDS) {
    return { ...base, peak: 0, lagMs: null, verdict: "ok", note: "shorter than two seconds, not measured" };
  }
  const block = Math.max(1, Math.round(sampleRate / 1000));
  const n = Math.floor(samples.length / block);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const from = i * block;
    for (let j = 0; j < block; j++) {
      const v = samples[from + j]!;
      sum += v * v;
    }
    env[i] = Math.sqrt(sum / block);
  }

  // Detrend with a centered moving average, using prefix sums.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + env[i]!;
  const half = Math.floor(TREND_WINDOW_MS / 2);
  const detrended = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half);
    detrended[i] = env[i]! - (prefix[hi]! - prefix[lo]!) / (hi - lo);
  }

  let energy = 0;
  for (let i = 0; i < n; i++) energy += detrended[i]! * detrended[i]!;
  if (energy <= 1e-18) return { ...base, peak: 0, lagMs: null, verdict: "ok", note: "silent in the measured band" };

  const maxLag = Math.min(TICK_LAG_MAX_MS, n - 1);
  let best = -Infinity;
  let bestLag = TICK_LAG_MIN_MS;
  for (let lag = TICK_LAG_MIN_MS; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += detrended[i]! * detrended[i + lag]!;
    const r = acc / energy;
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  const peak = Number(best.toFixed(3));
  return { ...base, peak, lagMs: bestLag, verdict: peak >= TICK_THRESHOLD ? "periodic" : "ok" };
}

/** Decodes a media file's audio through ffmpeg and measures it. Returns null when there is no audio to read. */
export function measureAudioTick(file: string, cwd?: string): Promise<AudioTickResult | null> {
  return new Promise((resolve, reject) => {
    const args = [
      "-nostdin", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(ANALYSIS_RATE),
      "-af", "highpass=f=5000:poles=2,highpass=f=5000:poles=2",
      "-f", "f32le", "-",
    ];
    const child = spawn("ffmpeg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      // A file with no audio stream makes ffmpeg exit non-zero with "does not contain any stream".
      if (code !== 0 && /does not contain any stream|matches no streams/i.test(stderr)) return resolve(null);
      if (code !== 0) return reject(new Error(`ffmpeg could not decode the audio for the tick check:\n${stderr.slice(-600)}`));
      const buf = Buffer.concat(chunks);
      if (buf.length < 4) return resolve(null);
      // slice() copies into a fresh, 4-byte aligned ArrayBuffer; a pooled Buffer may not be aligned.
      const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4));
      resolve(analyzeTickEnvelope(new Float32Array(aligned), ANALYSIS_RATE));
    });
  });
}

/** One plain sentence for a finalize_video note, or null when nothing was found. */
export function describeTick(r: AudioTickResult | null): string | null {
  if (!r || r.verdict !== "periodic") return null;
  return (
    `Warning (audio-tick): short high-frequency hits repeat about every ${r.lagMs} ms ` +
    `(autocorrelation ${r.peak}, threshold ${r.thresholdPeak}). It will sound like a ticking clock under the voiceover. ` +
    `Use a bed without hats or ticks (compose_score defaults to none), or give the pattern rests.`
  );
}

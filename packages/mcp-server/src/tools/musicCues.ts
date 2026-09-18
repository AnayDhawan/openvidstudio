import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeRelativeOutPath, spawnCapture } from "../util";
import { runTool } from "./mcp";

/**
 * Beat and strong-cue timestamps for a music track, so a video's scene cuts can land on
 * the music instead of at an arbitrary second. See STYLE.md's "Beat-locked cuts" section
 * for the snap tolerances this is meant to feed: major reveals within ~0.15s of a
 * strongCue, sequential reveals within ~0.10s of a beat.
 *
 * Two paths, chosen by whether the track already carries a cue file:
 *
 * 1. The built-in pulse-bed.mp3 (public/sfx/pulse-bed.mp3, copied into every scaffolded
 *    project by init_project) ships with pulse-bed.cues.json sitting right next to it,
 *    written by packages/core/scripts/generate-pulse-bed.mjs at the moment the track was
 *    synthesized. Since the track is generated, not recorded, its beat grid is exact by
 *    construction: this path is a file read, not an analysis.
 *
 * 2. Any other track -- an imported one, or a video's own custom music bed -- has no such
 *    file, so this decodes it and estimates a beat grid: RMS energy envelope, peak-picked
 *    onsets as strongCues, and a BPM estimate from autocorrelating the onset envelope to
 *    build an evenly-spaced beats[] grid. This is a real but simple detector (energy-based
 *    onset picking plus one autocorrelation pass), not the equivalent of a dedicated music
 *    information retrieval library: treat the result as planning guidance, the same
 *    "optional timing hint, ignore it where it hurts readability" posture the STYLE.md
 *    section already asks for, not as ground truth.
 *
 * The result is cached next to the track as <stem>.cues.json (mirroring pulse-bed's own
 * shape), so a second call against the same file is a read, not a re-analysis.
 */

export interface MusicCuesInput {
  projectRoot?: string;
  /** Path to the audio file, relative to projectRoot. e.g. "public/audio/pulse-bed.mp3". */
  track: string;
  /** Re-run analysis even if a cues file is already cached next to the track. */
  force?: boolean;
}

export interface MusicCuesResult {
  track: string;
  bpm: number;
  durationSeconds: number;
  beats: number[];
  strongCues: number[];
  source: "generated" | "analyzed" | "cached";
  cuesPath: string;
}

const SAMPLE_RATE = 22050;

function cuesPathFor(trackAbs: string): string {
  const dir = path.dirname(trackAbs);
  const stem = path.basename(trackAbs).replace(/\.[^.]+$/, "");
  return path.join(dir, `${stem}.cues.json`);
}

/**
 * Decodes to a temp raw-PCM file rather than piping through stdout: spawnCapture buffers
 * stdout as a JS string (`chunk.toString()`), which is the right contract for every other
 * caller (ffmpeg/ffprobe text output) but would corrupt raw s16le sample bytes. Writing to
 * disk and reading the file back with fs (binary-safe) sidesteps that without changing a
 * shared primitive several other tools depend on.
 */
async function decodeMonoPcm16(trackAbs: string, projectRoot: string): Promise<Int16Array> {
  const tmpPath = path.join(
    path.dirname(trackAbs),
    `.${path.basename(trackAbs)}.${process.pid}.analyze.raw`,
  );
  try {
    const res = await spawnCapture(
      "ffmpeg",
      ["-v", "error", "-y", "-i", trackAbs, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", tmpPath],
      projectRoot,
    );
    if (res.code !== 0) {
      throw new Error(`ffmpeg could not decode "${trackAbs}" for analysis:\n${res.stderr.slice(-800)}`);
    }
    const buf = fs.readFileSync(tmpPath);
    if (buf.length < SAMPLE_RATE) {
      throw new Error(`"${trackAbs}" decoded to less than one second of audio. Is the file real audio?`);
    }
    // Copy out of the file-backed buffer before the temp file is removed underneath it.
    const copy = Buffer.from(buf);
    return new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 2));
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

/** Short-window RMS envelope. Hop and window chosen for ~10-15ms resolution at 22050hz. */
function rmsEnvelope(samples: Int16Array): { hopSeconds: number; values: Float64Array } {
  const windowSize = 512;
  const hopSize = 256;
  const frames = Math.max(0, Math.floor((samples.length - windowSize) / hopSize) + 1);
  const values = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * hopSize;
    let sum = 0;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[start + i] / 32768;
      sum += s * s;
    }
    values[f] = Math.sqrt(sum / windowSize);
  }
  return { hopSeconds: hopSize / SAMPLE_RATE, values };
}

/** Positive first difference of the envelope: energy rising, not just energy present. */
function onsetFlux(env: Float64Array): Float64Array {
  const flux = new Float64Array(env.length);
  for (let i = 1; i < env.length; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
  return flux;
}

function mean(xs: Float64Array): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : 0;
}

function stddev(xs: Float64Array, m: number): number {
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return xs.length ? Math.sqrt(s / xs.length) : 0;
}

/** Local maxima above threshold, with a refractory gap so one transient isn't double-picked. */
function pickPeaks(flux: Float64Array, hopSeconds: number, minGapSeconds: number): { index: number; strength: number }[] {
  const m = mean(flux);
  const sd = stddev(flux, m);
  const threshold = m + 1.3 * sd;
  const minGapFrames = Math.max(1, Math.round(minGapSeconds / hopSeconds));
  const peaks: { index: number; strength: number }[] = [];
  let lastPeak = -Infinity;
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] < threshold) continue;
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    if (i - lastPeak < minGapFrames) {
      if (peaks.length > 0 && flux[i] > peaks[peaks.length - 1].strength) {
        peaks[peaks.length - 1] = { index: i, strength: flux[i] };
        lastPeak = i;
      }
      continue;
    }
    peaks.push({ index: i, strength: flux[i] });
    lastPeak = i;
  }
  return peaks;
}

/**
 * Autocorrelate the onset envelope over a plausible tempo range to estimate BPM, then
 * build an evenly-spaced beat grid at that tempo anchored to the first strong peak.
 */
function estimateTempoAndGrid(
  flux: Float64Array,
  hopSeconds: number,
  peaks: { index: number; strength: number }[],
  durationSeconds: number,
): { bpm: number; beats: number[] } {
  const minBpm = 70;
  const maxBpm = 180;
  const minLag = Math.round(60 / maxBpm / hopSeconds);
  const maxLag = Math.round(60 / minBpm / hopSeconds);
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= Math.min(maxLag, flux.length - 1); lag++) {
    let score = 0;
    for (let i = 0; i + lag < flux.length; i++) score += flux[i] * flux[i + lag];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  const beatSeconds = bestLag * hopSeconds;
  const bpm = Math.round((60 / beatSeconds) * 10) / 10;

  const anchor = peaks.length > 0 ? peaks[0].index * hopSeconds : 0;
  const beats: number[] = [];
  // Walk backward from the anchor to cover the track from t=0, then forward to the end.
  let t = anchor;
  while (t > 0) t -= beatSeconds;
  for (; t <= durationSeconds; t += beatSeconds) {
    if (t >= 0) beats.push(Number(t.toFixed(3)));
  }
  return { bpm, beats };
}

export async function runMusicCues(input: MusicCuesInput): Promise<MusicCuesResult> {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  sanitizeRelativeOutPath(projectRoot, input.track, "track");
  const trackAbs = path.join(projectRoot, input.track);
  if (!fs.existsSync(trackAbs)) {
    throw new Error(`"${input.track}" does not exist under ${projectRoot}.`);
  }

  const cuesAbs = cuesPathFor(trackAbs);
  const existing = fs.existsSync(cuesAbs)
    ? (JSON.parse(fs.readFileSync(cuesAbs, "utf8")) as Omit<MusicCuesResult, "source" | "cuesPath"> & {
        source?: string;
      })
    : null;

  // A "generated" cues file (pulse-bed.mp3's own, written at synth time by
  // generate-pulse-bed.mjs) is exact by construction. force is for re-running the
  // estimator against a track that was itself only ever estimated; it must never let a
  // noisier re-analysis silently replace ground truth.
  if (existing?.source === "generated") {
    if (input.force) {
      throw new Error(
        `${cuesAbs} is a generated cue file (exact by construction), not an estimated one. ` +
          `force is for re-analyzing a track whose cues were themselves only ever estimated; ` +
          `it refuses to overwrite generated ground truth.`,
      );
    }
    return {
      ...(existing as Omit<MusicCuesResult, "source" | "cuesPath">),
      source: "cached",
      cuesPath: path.relative(projectRoot, cuesAbs).replace(/\\/g, "/"),
    };
  }

  if (!input.force && existing) {
    return {
      ...(existing as Omit<MusicCuesResult, "source" | "cuesPath">),
      source: "cached",
      cuesPath: path.relative(projectRoot, cuesAbs).replace(/\\/g, "/"),
    };
  }

  const samples = await decodeMonoPcm16(trackAbs, projectRoot);
  const durationSeconds = samples.length / SAMPLE_RATE;
  const { hopSeconds, values: env } = rmsEnvelope(samples);
  const flux = onsetFlux(env);
  const peaks = pickPeaks(flux, hopSeconds, 0.15);
  const { bpm, beats } = estimateTempoAndGrid(flux, hopSeconds, peaks, durationSeconds);

  // strongCues: the loudest quarter of picked onsets, sorted back into time order. This is
  // deliberately sparser than beats[], matching pulse-bed's own strongCues-are-bar-downbeats
  // shape: a handful of moments worth cutting on, not every detected transient.
  const sortedByStrength = [...peaks].sort((a, b) => b.strength - a.strength);
  const strongCount = Math.max(1, Math.round(peaks.length * 0.25));
  const strongCues = sortedByStrength
    .slice(0, strongCount)
    .map((p) => Number((p.index * hopSeconds).toFixed(3)))
    .sort((a, b) => a - b);

  const result: Omit<MusicCuesResult, "cuesPath"> = {
    track: input.track.replace(/\\/g, "/"),
    bpm,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    beats,
    strongCues,
    source: "analyzed",
  };
  fs.writeFileSync(cuesAbs, JSON.stringify(result, null, 2) + "\n", "utf8");

  return { ...result, cuesPath: path.relative(projectRoot, cuesAbs).replace(/\\/g, "/") };
}

export function registerMusicCues(server: McpServer): void {
  server.registerTool(
    "plan_music_cues",
    {
      title: "Detect or read beat and strong-cue timestamps for a music track",
      description:
        "Returns beats (the full beat grid) and strongCues (bar downbeats or the loudest onsets, a sparser " +
        "set) for a music track, in seconds, so scene cuts can be beat-locked instead of landing at an " +
        "arbitrary second. For the built-in public/sfx/pulse-bed.mp3 (112bpm, generated, ships in every " +
        "scaffolded project) this is a file read of the exact cue grid computed when the track was " +
        "synthesized. For any other track it decodes the audio and estimates a grid from an RMS onset " +
        "envelope and one autocorrelation pass: a real but simple detector, good enough to plan cuts against, " +
        "not a substitute for listening to the track. Results are cached next to the track as " +
        "<stem>.cues.json, so call again with force to re-analyze. force refuses to run against a generated " +
        "cues file (pulse-bed.mp3's own): that grid is exact by construction, so force exists to redo an " +
        "estimate, never to overwrite ground truth with a noisier one. See STYLE.md's \"Beat-locked cuts\" " +
        "section for how to use the result: snap at most a handful of major reveals to strongCues within " +
        "about 0.15s, snap sequential reveals (cards, stats arriving one by one) to consecutive beats within " +
        "about 0.10s, and ignore a cue outright when honoring it would hurt readability or pacing.",
      inputSchema: {
        projectRoot: z.string().optional(),
        track: z.string().min(1).describe('Path relative to projectRoot, e.g. "public/audio/pulse-bed.mp3".'),
        force: z.boolean().optional(),
      },
    },
    async (input) => runTool("plan_music_cues", () => runMusicCues(input)),
  );
}

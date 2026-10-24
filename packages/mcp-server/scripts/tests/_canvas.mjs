// Shared helpers for the canvas explainer tests: tiny explainer files written to a temp folder, ffprobe and
// ffmpeg wrappers to read the videos back, and a Goertzel detector to look at audio frequencies. Not a test
// file (the runner only picks up *.test.mjs).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

export const haveMedia = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

export function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** The sound kit every fixture carries: SOUND.renderOffline builds an offline context and runs the score on it. */
export const SOUND_KIT = `
window.SOUND = {
  renderOffline: function (score, seconds, sampleRate, opts) {
    var ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    score({ ctx: ctx, voiceover: !!(opts && opts.voiceover), duration: seconds });
    return ctx.startRendering();
  }
};`;

/** A score of one steady tone. A voiceover render is quieter (the kit lowers effects), so the two modes are told apart. */
export const TONE_SCORE = (hz = 440) => `
window.scoreSound = function (kit) {
  var osc = kit.ctx.createOscillator();
  var gain = kit.ctx.createGain();
  osc.frequency.value = ${hz};
  gain.gain.value = kit.voiceover ? 0.2 : 0.4;
  osc.connect(gain); gain.connect(kit.ctx.destination);
  osc.start(0); osc.stop(kit.duration);
};`;

/**
 * An explainer file. `draw` is the body of seek's drawing, with ctx, t, W, H in scope; `extra` is more script
 * (a score, BEATS handling, a different DURATION). The default draws a moving block on a changing background with a
 * 64px headline and a 30px label, which is clean under validate_canvas_explainer on a 1280x720 canvas.
 */
export function explainer({ duration = 2, draw, score = TONE_SCORE(), sound = SOUND_KIT, extra = "", size } = {}) {
  const body =
    draw ??
    `
    ctx.fillStyle = "hsl(" + Math.round(t * 90) + ", 60%, 20%)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#5CC8FF"; ctx.fillRect(40 + (t / ${duration}) * (W - 400), H * 0.45, 200, 120);
    ctx.fillStyle = "#F3EFE6"; ctx.font = "700 64px sans-serif"; ctx.fillText("Slope", 60, H * 0.3);
    ctx.font = "30px sans-serif"; ctx.fillText("rise over run", 60, H * 0.3 + 50);`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<canvas id="c"></canvas>
<script>
var W = ${size ? size[0] : "(window.OVS ? window.OVS.width : 1280)"}, H = ${size ? size[1] : "(window.OVS ? window.OVS.height : 720)"};
var canvas = document.getElementById("c"); canvas.width = W; canvas.height = H;
var ctx = canvas.getContext("2d");
window.DURATION = ${duration};
${extra}
window.seek = function (t) {${body}
};
${sound}
${score}
</script></body></html>`;
}

export function writeExplainer(dir, name, html) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, html);
  return file;
}

export function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const video = j.streams.find((s) => s.codec_type === "video");
  const audio = j.streams.find((s) => s.codec_type === "audio");
  return { video, audio, duration: Number(j.format.duration), frames: video ? Number(video.nb_read_frames) : 0 };
}

/** A frame of a video at `t` seconds as raw RGB. */
export function frameAt(file, t, width, height) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0 || r.stdout.length < width * height * 3) throw new Error(`could not read a frame at ${t}s: ${String(r.stderr)}`);
  return { data: r.stdout, width, height };
}

/** The audio of a file as mono float samples at 48 kHz. */
export function audioSamples(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-af", "pan=mono|c0=0.5*c0+0.5*c1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(`could not decode audio: ${String(r.stderr)}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength));
}

/** Amplitude of `hz` in samples[from, to) (Goertzel), as the amplitude of a sine that would give it. */
export function amplitudeAt(samples, from, to, hz, rate = 48000) {
  const a = Math.max(0, Math.round(from * rate));
  const b = Math.min(samples.length, Math.round(to * rate));
  const n = b - a;
  if (n <= 0) return 0;
  const w = (2 * Math.PI * hz) / rate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = a; i < b; i++) {
    const s = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / n;
}

/** A sine clip written with ffmpeg: the stand-in for a narration clip, with a peak of `volume` (lavfi's sine source peaks at 0.125). */
export function sineClip(file, hz, seconds, volume = 0.5) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${seconds}:sample_rate=48000`, "-af", `volume=${volume * 8}`, "-c:a", "libmp3lame", "-q:a", "2", file]);
  if (r.status !== 0) throw new Error(`could not write a clip: ${String(r.stderr)}`);
}

export const sha = (buf) => buf.toString("hex");

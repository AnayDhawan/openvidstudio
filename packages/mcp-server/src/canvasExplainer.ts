import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { once } from "node:events";
import type { Browser, Page } from "playwright";
import { launchChromium } from "@openvidstudio/capture";
import { resolveProjectRoot, sanitizeRelativeOutPath, sanitizeSegment } from "./util";
import { probeDuration } from "./tools/generateNarration";
import type { SceneFinding } from "./tools/validateScenes";

/**
 * Turns a canvas explainer into a video. A canvas explainer is one self-contained HTML file with a canvas
 * and three promises: `window.seek(t)` draws the frame at time `t` (seconds) as a pure function of `t`,
 * `window.DURATION` is its length in seconds, and `window.scoreSound(kit)` is its Web Audio score, rendered
 * offline through `window.SOUND.renderOffline(scoreSound, seconds, sampleRate, { voiceover })`.
 *
 * The renderer loads the file in headless Chromium, walks the frames, pipes the canvas PNGs into ffmpeg,
 * renders the score, optionally mixes the narration clips of a project over it, and muxes the two. It can run
 * from the MCP tool (tools/renderCanvasExplainer.ts) or standalone:
 *
 *   node dist/canvasExplainer.js --html explainer.html --out out.mp4 [--width 1280 --height 720 --fps 30 --video name]
 */

export const DEFAULT_CANVAS_WIDTH = 1280;
export const DEFAULT_CANVAS_HEIGHT = 720;
export const DEFAULT_CANVAS_FPS = 30;
export const AUDIO_SAMPLE_RATE = 48000;
/** How far the score sits under a narration clip while it plays, in dB. At least 6 is promised. */
export const DEFAULT_DUCK_DB = 9;
/** Seconds a caption stays after its last word is said, if the next one has not started. */
export const CAPTION_HOLD_SECONDS = 0.3;

/** One beat as the explainer sees it in `window.BEATS`: seconds, and the line spoken in it. */
export interface CanvasBeat {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface CanvasAudioOptions {
  /** Drop beds and music and lower effects in the sound kit. Default: on when a project's beats are used with narration. */
  voiceover?: boolean;
  sampleRate?: number;
  /** dB the score ducks under a narration clip. Default 9. */
  duckDb?: number;
}

export interface CanvasExplainerInput {
  projectRoot?: string;
  /** The explainer, absolute or relative to the project root. */
  htmlPath: string;
  /** The mp4 to write, relative to the project root (or absolute). */
  outPath: string;
  width?: number;
  height?: number;
  fps?: number;
  /** false for a silent video, or the sound options. */
  audio?: false | CanvasAudioOptions;
  /** A video of the project: its beats.json becomes `window.BEATS`, and its narration clips are mixed in. */
  videoName?: string;
  /** Burn the beats' text in as captions. Default true when there is narration. */
  captions?: boolean;
  /** Run validate_canvas_explainer first and refuse to render on an error. Default true. */
  validate?: boolean;
}

export interface CanvasRenderProgress {
  framesRendered: number;
  totalFrames: number;
}

export interface CanvasExplainerResult {
  success: true;
  outPath: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  frames: number;
  /** SHA-256 of the PNG the page produced for the first, middle and last frame: the purity promise, as numbers. */
  frameHashes: { first: string; middle: string; last: string };
  audio: {
    included: boolean;
    sampleRate: number | null;
    voiceover: boolean;
    /** The narration clips mixed in, with the sample the voice starts at. */
    voiceClips: { beatId: string; startSeconds: number; startSample: number; durationSeconds: number }[];
    duckDb: number | null;
  };
  captions: { burned: boolean; chunks: number };
  warnings: string[];
  /** The pre-flight's findings (warnings and notes; an error would have stopped the render). */
  findings: SceneFinding[];
}

/** The caption chunks of a project, with the seconds each one is on screen. */
export interface CaptionChunk {
  beatId: string;
  from: number;
  to: number;
  text: string;
}

// ---------------------------------------------------------------------------------------------
// Beats, narration clips and captions

interface BeatsFileLike {
  fps?: number;
  narration?: string;
  beats?: { id: string; start: number; duration: number; vo?: string }[];
}

export interface CanvasProject {
  beats: CanvasBeat[];
  /** "none" for a silent lesson: no clips, no captions. */
  narration: "voice" | "none";
  clips: { beatId: string; start: number; file: string }[];
  chunks: CaptionChunk[];
}

/** Sentence-end and comma rules of LessonCaptions (packages/stem), so a canvas lesson captions the same way. */
export function captionChunks(words: string[], maxWords = 6): [number, number][] {
  const limit = Math.max(1, Math.floor(maxWords));
  const chunks: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const size = i - from + 1;
    const last = i === words.length - 1;
    if (last || /[.?!:…]["')\]]*$/.test(words[i]) || (/[,;]["')\]]*$/.test(words[i]) && size >= 3) || size >= limit) {
      chunks.push([from, i + 1]);
      from = i + 1;
    }
  }
  return chunks;
}

/** Pure: the caption chunks of one beat, timed from word times when they are known and evenly by length when not. */
export function chunksForBeat(beat: CanvasBeat, spokenSeconds: number, words?: { startMs: number; endMs: number }[]): CaptionChunk[] {
  const tokens = beat.text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const exact = words !== undefined && words.length === tokens.length;
  const spoken = Math.min(Math.max(0.1, spokenSeconds), Math.max(0.1, beat.end - beat.start));
  let startAt: number[];
  let endAt: number[];
  if (exact) {
    startAt = words!.map((w) => beat.start + w.startMs / 1000);
    endAt = words!.map((w) => beat.start + w.endMs / 1000);
  } else {
    const weight = tokens.map((t) => t.length + 1);
    const total = weight.reduce((a, b) => a + b, 0);
    let acc = 0;
    startAt = [];
    endAt = [];
    tokens.forEach((_, i) => {
      startAt.push(beat.start + (acc / total) * spoken);
      acc += weight[i];
      endAt.push(beat.start + (acc / total) * spoken);
    });
  }
  const ranges = captionChunks(tokens);
  return ranges.map(([from, to], k) => {
    const lastEnd = endAt[to - 1];
    const nextStart = k + 1 < ranges.length ? startAt[ranges[k + 1][0]] : Infinity;
    return { beatId: beat.id, from: startAt[from], to: Math.min(lastEnd + CAPTION_HOLD_SECONDS, nextStart, beat.end), text: tokens.slice(from, to).join(" ") };
  });
}

/** Reads a project's beats.json into what a canvas explainer needs. */
export function readCanvasProject(projectRoot: string, videoName: string): CanvasProject {
  const name = sanitizeSegment(videoName, "videoName");
  const file = path.join(projectRoot, "src", "videos", name, "beats.json");
  if (!fs.existsSync(file)) throw new Error(`No beats.json at ${file}. Write the beats (and run fit_beats after generate_narration) first.`);
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as BeatsFileLike;
  const fps = doc.fps && doc.fps > 0 ? doc.fps : 30;
  const narration = doc.narration === "none" ? "none" : "voice";
  const beats: CanvasBeat[] = (doc.beats ?? []).map((b) => ({ id: b.id, start: b.start / fps, end: (b.start + b.duration) / fps, text: typeof b.vo === "string" ? b.vo : "" }));
  const clips: CanvasProject["clips"] = [];
  const chunks: CaptionChunk[] = [];
  if (narration === "voice") {
    const voDir = path.join(projectRoot, "public", "audio", "vo");
    for (const beat of beats) {
      const clip = path.join(voDir, `${beat.id}.mp3`);
      const hasClip = fs.existsSync(clip);
      if (hasClip) clips.push({ beatId: beat.id, start: beat.start, file: clip });
      if (beat.text.trim() === "") continue;
      const spoken = hasClip ? probeDuration(clip) : beat.end - beat.start;
      let words: { startMs: number; endMs: number }[] | undefined;
      const wordsFile = path.join(voDir, `${beat.id}.words.json`);
      if (fs.existsSync(wordsFile)) {
        try {
          words = JSON.parse(fs.readFileSync(wordsFile, "utf8")) as { startMs: number; endMs: number }[];
        } catch {
          words = undefined;
        }
      }
      chunks.push(...chunksForBeat(beat, spoken > 0 ? spoken : beat.end - beat.start, words));
    }
  }
  return { beats, narration, clips, chunks };
}

// ---------------------------------------------------------------------------------------------
// The page: boot script, captions helper, probes

/** Runs before the explainer's own scripts: the size, the beats, the captions helper. */
export function bootScript(cfg: { width: number; height: number; fps: number; voiceover: boolean; beats: CanvasBeat[] | null; chunks: CaptionChunk[]; probes: boolean }): string {
  const lines: string[] = [];
  lines.push(`window.OVS = ${JSON.stringify({ width: cfg.width, height: cfg.height, fps: cfg.fps, voiceover: cfg.voiceover })};`);
  if (cfg.beats) lines.push(`window.BEATS = ${JSON.stringify(cfg.beats)};`);
  lines.push(`window.__ovsCaptionBoxes = [];`);
  lines.push(`(function () {
  var chunks = ${JSON.stringify(cfg.chunks)};
  var W = ${cfg.width}, H = ${cfg.height};
  function at(t) {
    for (var i = 0; i < chunks.length; i++) if (t >= chunks[i].from && t < chunks[i].to) return chunks[i];
    return null;
  }
  function wrap(ctx, words, maxWidth) {
    var lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + " " + words[i] : words[i];
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = words[i]; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  // Draws the caption for time t inside the safe area: above the bottom 22% (14% at the top) of a tall
  // canvas, 8% either way on a wide one. An explainer calls it at the end of seek(t) to caption in its own
  // font and colours (opts.font, opts.color, opts.background, opts.position); the renderer calls it itself
  // for an explainer that did not. Returns the box it drew, or null when no caption is on screen at t.
  function draw(ctx, t, opts) {
    window.CAPTIONS.__drawn = true;
    var chunk = at(t);
    if (!chunk) return null;
    opts = opts || {};
    var portrait = H > W;
    var bottomInset = Math.round(H * (portrait ? 0.22 : 0.08)), topInset = Math.round(H * (portrait ? 0.14 : 0.08));
    var size = opts.size || Math.round(Math.min(W, H) * 0.048);
    var family = opts.font || "sans-serif";
    var maxWidth = W * 0.8, lines;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (;;) {
      ctx.font = "600 " + size + "px " + family;
      lines = wrap(ctx, chunk.text.split(/\\s+/), maxWidth);
      if (lines.length <= 2 || size <= 12) break;
      size -= 2;
    }
    var padX = Math.round(size * 0.5), padY = Math.round(size * 0.3), lineH = Math.round(size * 1.25);
    var w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, ctx.measureText(lines[i]).width);
    var boxW = Math.round(w + 2 * padX), boxH = lines.length * lineH + 2 * padY;
    var x = Math.round((W - boxW) / 2);
    var y = opts.position === "top" ? topInset : H - bottomInset - boxH;
    ctx.fillStyle = opts.background || "rgba(7,6,11,0.72)";
    var r = Math.round(size * 0.4);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r); ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
    ctx.arcTo(x, y + boxH, x, y, r); ctx.arcTo(x, y, x + boxW, y, r); ctx.closePath(); ctx.fill();
    ctx.fillStyle = opts.color || "#F3EFE6";
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    window.__ovsCaptionDrawing = true;
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], W / 2, y + padY + j * lineH + Math.round(size * 0.95));
    window.__ovsCaptionDrawing = false;
    ctx.restore();
    var box = { x: x, y: y, width: boxW, height: boxH };
    window.__ovsCaptionBoxes.push(box);
    return box;
  }
  window.CAPTIONS = { chunks: chunks, at: at, draw: draw, __drawn: false };
})();`);
  if (cfg.probes) {
    lines.push(`(function () {
  var P = (window.__ovsTexts = []);
  ["fillText", "strokeText"].forEach(function (name) {
    var orig = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function (text, x, y) {
      try {
        var m = this.getTransform();
        var match = /(\\d+(?:\\.\\d+)?)px/.exec(this.font);
        var size = (match ? parseFloat(match[1]) : 10) * Math.hypot(m.a, m.b);
        P.push({ text: String(text), size: size, x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, caption: !!window.__ovsCaptionDrawing });
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  });
  var S = (window.__ovsSources = []);
  function hook(proto) {
    var start = proto.start, stop = proto.stop;
    proto.start = function (when, offset, duration) {
      var rec = { start: when || 0, stop: null, duration: duration === undefined ? null : duration, bufferSeconds: null, loop: false };
      try {
        if (this.buffer) { rec.bufferSeconds = this.buffer.duration / Math.max(0.001, this.playbackRate ? this.playbackRate.value : 1); rec.loop = !!this.loop; }
      } catch (e) {}
      this.__ovs = rec;
      S.push(rec);
      return start.apply(this, arguments);
    };
    proto.stop = function (when) {
      if (this.__ovs) this.__ovs.stop = when || 0;
      return stop.apply(this, arguments);
    };
  }
  hook(AudioScheduledSourceNode.prototype);
  if (typeof AudioBufferSourceNode !== "undefined" && AudioBufferSourceNode.prototype.hasOwnProperty("start")) hook(AudioBufferSourceNode.prototype);
})();`);
  }
  return lines.join("\n");
}

export interface OpenedExplainer {
  page: Page;
  durationSeconds: number;
  width: number;
  height: number;
  /** Set when the canvas was not the size asked for and was resized. */
  resized: boolean;
  /** The DURATION the file itself declared, before a beats file's last end replaced it. */
  ownDuration: number;
  errors: string[];
}

/** Loads the file and checks it keeps its three promises. */
export async function openExplainer(
  browser: Browser,
  htmlPath: string,
  cfg: { width: number; height: number; fps: number; voiceover: boolean; project: CanvasProject | null; probes: boolean; requireScore: boolean },
): Promise<OpenedExplainer> {
  const page = await browser.newPage({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err && err.message ? err.message : err)));
  try {
    await page.addInitScript({
      content: bootScript({ width: cfg.width, height: cfg.height, fps: cfg.fps, voiceover: cfg.voiceover, beats: cfg.project ? cfg.project.beats : null, chunks: cfg.project ? cfg.project.chunks : [], probes: cfg.probes }),
    });
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const present = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return { seek: typeof w.seek, duration: typeof w.DURATION, score: typeof w.scoreSound, canvas: document.querySelector("canvas") !== null };
    });
    const missing: string[] = [];
    if (present.seek !== "function") missing.push("window.seek(t) (a function that draws the frame at time t)");
    if (present.duration !== "number") missing.push("window.DURATION (the length in seconds, a number)");
    if (cfg.requireScore && present.score !== "function") missing.push("window.scoreSound(kit) (a function that scores the sound)");
    if (!present.canvas) missing.push("a <canvas> element");
    if (missing.length > 0) {
      throw new Error(
        `${path.basename(htmlPath)} is not a canvas explainer: it does not expose ${missing.join(", ")}. ` +
          `An explainer is one HTML file with a canvas, window.seek(t), window.DURATION and window.scoreSound(kit)` +
          (errors.length > 0 ? ` (the page reported: ${errors[0]})` : "") +
          `.`,
      );
    }
    const ownDuration = await page.evaluate(() => (window as unknown as { DURATION: number }).DURATION);
    // A beats file decides the length: DURATION is the last beat's end.
    if (cfg.project && cfg.project.beats.length > 0) {
      const lastEnd = Math.max(...cfg.project.beats.map((b) => b.end));
      await page.evaluate((d) => ((window as unknown as { DURATION: number }).DURATION = d), lastEnd);
    }
    const durationSeconds = await page.evaluate(() => (window as unknown as { DURATION: number }).DURATION);
    if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) throw new Error(`window.DURATION is ${durationSeconds}; it must be a positive number of seconds.`);
    const resized = await page.evaluate(
      ([w, h]) => {
        const c = document.querySelector("canvas") as HTMLCanvasElement;
        if (c.width === w && c.height === h) return false;
        c.width = w;
        c.height = h;
        return true;
      },
      [cfg.width, cfg.height],
    );
    return { page, durationSeconds, width: cfg.width, height: cfg.height, resized, ownDuration, errors };
  } catch (err) {
    await page.close().catch(() => undefined);
    throw err;
  }
}

/** Seeks to `t` and returns the canvas as PNG bytes. An explainer that did not draw captions gets them from the renderer. */
export async function captureFrame(page: Page, t: number): Promise<Buffer> {
  const b64 = await page.evaluate(async (time) => {
    const w = window as unknown as { seek: (t: number) => unknown; CAPTIONS?: { __drawn: boolean; chunks: unknown[]; draw: (ctx: CanvasRenderingContext2D, t: number) => unknown } };
    if (w.CAPTIONS) w.CAPTIONS.__drawn = false;
    await w.seek(time);
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    if (w.CAPTIONS && w.CAPTIONS.chunks.length > 0 && !w.CAPTIONS.__drawn) {
      const ctx = canvas.getContext("2d");
      if (ctx) w.CAPTIONS.draw(ctx, time);
    }
    return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
  }, t);
  return Buffer.from(b64, "base64");
}

// ---------------------------------------------------------------------------------------------
// Audio

export interface PcmAudio {
  sampleRate: number;
  channels: number;
  /** Interleaved. */
  data: Float32Array;
}

/** Renders the explainer's score through its sound kit. */
export async function renderScore(page: Page, durationSeconds: number, sampleRate: number, voiceover: boolean): Promise<PcmAudio> {
  const out = await page.evaluate(
    async ([duration, rate, vo]) => {
      const w = window as unknown as { SOUND?: { renderOffline?: (...args: unknown[]) => Promise<unknown> }; scoreSound: unknown };
      if (!w.SOUND || typeof w.SOUND.renderOffline !== "function") {
        throw new Error("window.SOUND.renderOffline is missing, so the score cannot be rendered. Include the sound kit in the explainer, or render with audio: false.");
      }
      const r = (await w.SOUND.renderOffline(w.scoreSound, duration, rate, { voiceover: vo })) as unknown;
      let sampleRate = rate as number;
      let channels = 2;
      let data: Float32Array;
      const any = r as { getChannelData?: (c: number) => Float32Array; numberOfChannels?: number; sampleRate?: number; samples?: Float32Array; data?: Float32Array; channels?: number | Float32Array[] };
      if (any && typeof any.getChannelData === "function") {
        channels = any.numberOfChannels ?? 1;
        sampleRate = any.sampleRate ?? sampleRate;
        const chans = Array.from({ length: channels }, (_, c) => any.getChannelData!(c));
        data = new Float32Array(chans[0].length * channels);
        for (let i = 0; i < chans[0].length; i++) for (let c = 0; c < channels; c++) data[i * channels + c] = chans[c][i];
      } else if (Array.isArray(r) && r[0] instanceof Float32Array) {
        channels = r.length;
        data = new Float32Array(r[0].length * channels);
        for (let i = 0; i < r[0].length; i++) for (let c = 0; c < channels; c++) data[i * channels + c] = (r[c] as Float32Array)[i];
      } else if (r instanceof Float32Array) {
        data = r;
      } else if (any && (any.samples instanceof Float32Array || any.data instanceof Float32Array)) {
        data = (any.samples ?? any.data) as Float32Array;
        if (typeof any.channels === "number") channels = any.channels;
        if (typeof any.sampleRate === "number") sampleRate = any.sampleRate;
      } else {
        throw new Error("SOUND.renderOffline returned something that is not audio: expected an AudioBuffer, an array of channel Float32Arrays, an interleaved Float32Array, or { samples, sampleRate, channels }.");
      }
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { sampleRate, channels, b64: btoa(bin) };
    },
    [durationSeconds, sampleRate, voiceover] as [number, number, boolean],
  );
  const buf = Buffer.from(out.b64, "base64");
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return { sampleRate: out.sampleRate, channels: out.channels, data };
}

/** Pure: `audio` as stereo, so mixing and writing deal with one shape. */
export function toStereo(audio: PcmAudio): PcmAudio {
  if (audio.channels === 2) return audio;
  const frames = Math.floor(audio.data.length / audio.channels);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = audio.data[i * audio.channels];
    out[i * 2 + 1] = audio.data[i * audio.channels + (audio.channels > 1 ? 1 : 0)];
  }
  return { sampleRate: audio.sampleRate, channels: 2, data: out };
}

/** Decodes a clip to interleaved stereo float at `sampleRate`. */
function decodeClip(file: string, sampleRate: number): Float32Array {
  // ffmpeg's own mono to stereo upmix takes 3 dB off, so a mono narration clip (what a speech engine writes) would
  // sit quieter in the mix than it was recorded. Copy the channel to both sides instead.
  const channels = Number.parseInt(spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" }).stdout.trim(), 10);
  const layout = channels === 1 ? ["-af", "pan=stereo|c0=c0|c1=c0"] : ["-ac", "2"];
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, ...layout, "-f", "f32le", "-ar", String(sampleRate), "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0 || !r.stdout) throw new Error(`ffmpeg could not decode the narration clip ${file}: ${String(r.stderr ?? "").slice(0, 300)}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength));
}

export interface MixResult {
  audio: PcmAudio;
  clips: { beatId: string; startSeconds: number; startSample: number; durationSeconds: number }[];
}

/**
 * Mixes narration clips over a score. Each clip starts at its beat's start (to the sample), and the score is
 * ducked by `duckDb` while any clip plays: eased down over 40 ms and back up over 250 ms, so it does not pump.
 */
export function mixVoice(score: PcmAudio, clips: { beatId: string; start: number; file: string }[], duckDb: number): MixResult {
  const stereo = toStereo(score);
  const rate = stereo.sampleRate;
  const frames = stereo.data.length / 2;
  const voice = new Float32Array(stereo.data.length);
  const spans: [number, number][] = [];
  const report: MixResult["clips"] = [];
  for (const clip of clips) {
    const pcm = decodeClip(clip.file, rate);
    const startSample = Math.round(clip.start * rate);
    const clipFrames = pcm.length / 2;
    const n = Math.max(0, Math.min(clipFrames, frames - startSample));
    for (let i = 0; i < n; i++) {
      voice[(startSample + i) * 2] += pcm[i * 2];
      voice[(startSample + i) * 2 + 1] += pcm[i * 2 + 1];
    }
    spans.push([startSample, startSample + n]);
    report.push({ beatId: clip.beatId, startSeconds: clip.start, startSample, durationSeconds: clipFrames / rate });
  }
  const target = new Float32Array(frames).fill(1);
  const duck = 10 ** (-duckDb / 20);
  for (const [a, b] of spans) target.fill(duck, a, b);
  const attack = Math.exp(-1 / (0.04 * rate));
  const release = Math.exp(-1 / (0.25 * rate));
  const out = new Float32Array(stereo.data.length);
  let gain = 1;
  for (let i = 0; i < frames; i++) {
    const k = target[i] < gain ? attack : release;
    gain = target[i] + (gain - target[i]) * k;
    out[i * 2] = stereo.data[i * 2] * gain + voice[i * 2];
    out[i * 2 + 1] = stereo.data[i * 2 + 1] * gain + voice[i * 2 + 1];
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.98) for (let i = 0; i < out.length; i++) out[i] = (out[i] * 0.98) / peak;
  return { audio: { sampleRate: rate, channels: 2, data: out }, clips: report };
}

/** A 32-bit float WAV, which ffmpeg reads directly. */
export function wavBytes(audio: PcmAudio): Buffer {
  const dataBytes = audio.data.length * 4;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(audio.channels, 22);
  header.writeUInt32LE(audio.sampleRate, 24);
  header.writeUInt32LE(audio.sampleRate * audio.channels * 4, 28);
  header.writeUInt16LE(audio.channels * 4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.from(audio.data.buffer, audio.data.byteOffset, dataBytes)]);
}

// ---------------------------------------------------------------------------------------------
// Rendering

const MATH_RANDOM = /Math\s*\.\s*random\b/;

/** The warnings that need only the source. */
export function sourceWarnings(html: string, file: string): string[] {
  const warnings: string[] = [];
  if (MATH_RANDOM.test(html)) {
    warnings.push(
      `${path.basename(file)} calls Math.random. A frame must be a pure function of t, so a drawing that draws a random number ` +
        `will not look the same twice. Use a seeded generator keyed by t or by an index.`,
    );
  }
  return warnings;
}

interface Resolved {
  projectRoot: string;
  htmlPath: string;
  outPath: string;
  width: number;
  height: number;
  fps: number;
}

export function resolveCanvasInput(input: CanvasExplainerInput): Resolved {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const htmlPath = path.resolve(projectRoot, input.htmlPath);
  if (!fs.existsSync(htmlPath)) throw new Error(`No explainer at ${htmlPath}.`);
  if (path.isAbsolute(input.outPath)) {
    if (/[;&|`$<>\n\r%^"]/.test(input.outPath)) throw new Error(`outPath "${input.outPath}" contains disallowed characters.`);
  } else {
    sanitizeRelativeOutPath(projectRoot, input.outPath, "outPath");
  }
  const outPath = path.resolve(projectRoot, input.outPath);
  const width = input.width ?? DEFAULT_CANVAS_WIDTH;
  const height = input.height ?? DEFAULT_CANVAS_HEIGHT;
  const fps = input.fps ?? DEFAULT_CANVAS_FPS;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) throw new Error(`width and height must be whole numbers of at least 16, got ${width}x${height}.`);
  if (width % 2 !== 0 || height % 2 !== 0) throw new Error(`width and height must be even for H.264, got ${width}x${height}.`);
  if (!(fps > 0) || fps > 120) throw new Error(`fps must be between 1 and 120, got ${fps}.`);
  return { projectRoot, htmlPath, outPath, width, height, fps };
}

async function encodeFrames(page: Page, r: Resolved, frames: number, tmpVideo: string, onProgress?: (p: CanvasRenderProgress) => void): Promise<CanvasExplainerResult["frameHashes"]> {
  const ff = spawn(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(r.fps), "-c:v", "png", "-i", "-", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "18", "-movflags", "+faststart", tmpVideo],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ff.stderr.on("data", (c) => (stderr += c));
  let ffError: Error | null = null;
  ff.stdin.on("error", (err) => (ffError = err));
  const closed = new Promise<number | null>((resolve) => ff.on("close", resolve));
  const hashes: Record<string, string> = {};
  const hash = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
  const middle = Math.floor((frames - 1) / 2);
  try {
    for (let i = 0; i < frames; i++) {
      const png = await captureFrame(page, i / r.fps);
      if (i === 0) hashes.first = hash(png);
      if (i === middle) hashes.middle = hash(png);
      if (i === frames - 1) hashes.last = hash(png);
      if (ffError) break;
      if (!ff.stdin.write(png)) await once(ff.stdin, "drain");
      if (i % 5 === 0 || i === frames - 1) onProgress?.({ framesRendered: i + 1, totalFrames: frames });
    }
  } finally {
    ff.stdin.end();
  }
  const code = await closed;
  if (code !== 0 || ffError) throw new Error(`ffmpeg failed encoding the frames (exit ${code}): ${stderr.slice(-400) || String(ffError)}`);
  return { first: hashes.first, middle: hashes.middle, last: hashes.last };
}

export async function runCanvasExplainer(input: CanvasExplainerInput, opts: { onProgress?: (p: CanvasRenderProgress) => void } = {}): Promise<CanvasExplainerResult> {
  const r = resolveCanvasInput(input);
  const project = input.videoName !== undefined ? readCanvasProject(r.projectRoot, input.videoName) : null;
  const audioOn = input.audio !== false;
  const audioOpts: CanvasAudioOptions = input.audio === false || input.audio === undefined ? {} : input.audio;
  const withNarration = project !== null && project.narration === "voice";
  const voiceover = audioOpts.voiceover ?? withNarration;
  const sampleRate = audioOpts.sampleRate ?? AUDIO_SAMPLE_RATE;
  const duckDb = audioOpts.duckDb ?? DEFAULT_DUCK_DB;
  if (voiceover && duckDb < 6) throw new Error(`duckDb is ${duckDb}; the score has to sit at least 6 dB under the voice.`);
  const captionsOn = (input.captions ?? true) && withNarration && project!.chunks.length > 0;
  const renderProject = project && { ...project, chunks: captionsOn ? project.chunks : [] };

  const warnings = sourceWarnings(fs.readFileSync(r.htmlPath, "utf8"), r.htmlPath);
  let findings: SceneFinding[] = [];
  if (input.validate !== false) {
    const { validateCanvasExplainer } = await import("./canvasValidate");
    const verdict = await validateCanvasExplainer({ projectRoot: r.projectRoot, htmlPath: r.htmlPath, width: r.width, height: r.height, fps: r.fps, videoName: input.videoName, audio: audioOn });
    const errors = verdict.findings.filter((f) => f.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `Pre-flight refused to render ${path.basename(r.htmlPath)}: ${errors.map((f) => `[${f.check}] ${f.message}`).join(" | ")} ` +
          `Fix these, or pass validate: false to render anyway.`,
      );
    }
    findings = verdict.findings;
  }

  const browser = await launchChromium();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-canvas-"));
  try {
    const opened = await openExplainer(browser, r.htmlPath, { width: r.width, height: r.height, fps: r.fps, voiceover, project: renderProject, probes: false, requireScore: audioOn });
    if (opened.resized) warnings.push(`The canvas was not ${r.width}x${r.height}, so it was resized to that before the first frame. Size the canvas from window.OVS.width and window.OVS.height.`);
    if (project && project.beats.length > 0 && Math.abs(opened.ownDuration - opened.durationSeconds) > 1 / r.fps) {
      warnings.push(`The explainer's own DURATION is ${opened.ownDuration}s but the beats end at ${opened.durationSeconds}s, which is what was rendered. Read window.BEATS and set DURATION from the last beat's end.`);
    }
    const frames = Math.max(1, Math.round(opened.durationSeconds * r.fps));
    opts.onProgress?.({ framesRendered: 0, totalFrames: frames });
    fs.mkdirSync(path.dirname(r.outPath), { recursive: true });
    const tmpVideo = path.join(scratch, "video.mp4");
    const frameHashes = await encodeFrames(opened.page, r, frames, tmpVideo, opts.onProgress);

    let audioInfo: CanvasExplainerResult["audio"] = { included: false, sampleRate: null, voiceover: false, voiceClips: [], duckDb: null };
    if (audioOn) {
      const score = await renderScore(opened.page, opened.durationSeconds, sampleRate, voiceover);
      let finalAudio = toStereo(score);
      let clips: MixResult["clips"] = [];
      if (voiceover && project && project.clips.length > 0) {
        const mixed = mixVoice(score, project.clips, duckDb);
        finalAudio = mixed.audio;
        clips = mixed.clips;
      }
      const wav = path.join(scratch, "audio.wav");
      fs.writeFileSync(wav, wavBytes(finalAudio));
      const mux = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", tmpVideo, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(frames / r.fps), r.outPath], { encoding: "utf8" });
      if (mux.status !== 0) throw new Error(`ffmpeg failed muxing the audio: ${(mux.stderr ?? "").slice(-400)}`);
      audioInfo = { included: true, sampleRate: finalAudio.sampleRate, voiceover, voiceClips: clips, duckDb: clips.length > 0 ? duckDb : null };
      if (voiceover && project && project.clips.length === 0 && withNarration) warnings.push("The beats have narration but no clips were found under public/audio/vo/, so the video has the score alone. Run generate_narration first.");
    } else {
      fs.copyFileSync(tmpVideo, r.outPath);
    }
    await opened.page.close().catch(() => undefined);
    return {
      success: true,
      outPath: r.outPath,
      width: r.width,
      height: r.height,
      fps: r.fps,
      durationSeconds: opened.durationSeconds,
      frames,
      frameHashes,
      audio: audioInfo,
      captions: { burned: captionsOn, chunks: captionsOn ? project!.chunks.length : 0 },
      warnings,
      findings,
    };
  } finally {
    await browser.close().catch(() => undefined);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Standalone

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const html = argValue(args, "html");
  const out = argValue(args, "out");
  if (!html || !out) {
    process.stderr.write("usage: node canvasExplainer.js --html explainer.html --out out.mp4 [--width 1280] [--height 720] [--fps 30] [--video name] [--project dir] [--silent] [--no-validate]\n");
    process.exit(2);
  }
  const num = (n: string) => (argValue(args, n) !== undefined ? Number(argValue(args, n)) : undefined);
  runCanvasExplainer({
    projectRoot: argValue(args, "project"),
    htmlPath: html,
    outPath: out,
    width: num("width"),
    height: num("height"),
    fps: num("fps"),
    videoName: argValue(args, "video"),
    audio: args.includes("--silent") ? false : undefined,
    validate: !args.includes("--no-validate"),
  }).then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}

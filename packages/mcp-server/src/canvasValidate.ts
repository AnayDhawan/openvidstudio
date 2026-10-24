import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchChromium } from "@openvidstudio/capture";
import {
  AUDIO_SAMPLE_RATE,
  DEFAULT_CANVAS_FPS,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  captureFrame,
  openExplainer,
  readCanvasProject,
  renderScore,
  sourceWarnings,
  type CanvasProject,
} from "./canvasExplainer";
import { DEFAULT_ARC_THRESHOLDS, judgeLessonArc, measureArcFrame, type ArcSample, type ArcSignature, type ArcThresholds, type Rect } from "./lessonArc";
import { resolveProjectRoot } from "./util";
import type { SceneFinding } from "./tools/validateScenes";

/**
 * validate_canvas_explainer: what validate_scenes does for a Remotion composition, for a canvas explainer. There is
 * no composition to inspect, so the file is loaded in headless Chromium and driven through window.seek(t). The
 * checks are the rules that make phone viewing work: a frame is a pure function of t, text is big enough, nothing
 * sits under the platform's interface, the picture is not blank or still for long, the sound is not a pile-up, and
 * nothing calls Math.random. Findings have the shape validate_scenes returns (beatId, scene, severity, check, message).
 */

/** The text minimums at the reference canvas (720 on the shorter side), in px. Headlines 44, labels 28, key numbers 64. */
export const TEXT_MINIMUMS = { headline: 44, label: 28, number: 64 } as const;
/** Text this much bigger than the label minimum was meant to be a headline or a number, and is held to its minimum. */
const DISPLAY_FACTOR = 1.2;
/** The safe areas of a tall canvas: the top share and the bottom share kept clear. */
export const SAFE_TOP = 0.14;
export const SAFE_BOTTOM = 0.22;
/** More sources than this playing at once is a pile-up. */
export const MAX_SIMULTANEOUS_SOUNDS = 3;
/** The shortest gap between frames sampled for the arc checks, and the most frames sampled. */
const MIN_SAMPLE_GAP_SECONDS = 0.5;
const MAX_SAMPLES = 120;

export interface CanvasValidateInput {
  projectRoot?: string;
  htmlPath: string;
  width?: number;
  height?: number;
  fps?: number;
  /** A project video: its beats become window.BEATS and its captions are drawn, as in the render. */
  videoName?: string;
  /** Also render the score and judge the sound. Default true. */
  audio?: boolean;
  /** Pixels at the reference size are scaled by min(width, height) / 720 unless this says otherwise. */
  textScale?: number;
  diagramWarnSeconds?: number;
  diagramErrorSeconds?: number;
  staticSeconds?: number;
}

export interface CanvasValidateResult {
  /** False when any finding is an error. */
  ok: boolean;
  findings: SceneFinding[];
  durationSeconds: number;
  width: number;
  height: number;
  /** The scale the text minimums were multiplied by. */
  textScale: number;
  framesSampled: number;
  /** Smallest non-caption text drawn, in px at the canvas size, or null when no text was drawn. */
  minTextSize: number | null;
  sound: { maxSimultaneous: number; peakDb: number | null; sources: number } | null;
  elapsedMs: number;
}

interface TextRecord {
  text: string;
  size: number;
  x: number;
  y: number;
  caption: boolean;
}

interface SourceRecord {
  start: number;
  stop: number | null;
  duration: number | null;
  bufferSeconds: number | null;
  loop: boolean;
}

const NUMERIC = /^\s*[-+−~]?\s*[$₹€£]?\s*\d[\d.,\s]*\s*(%|[a-zA-Zµ°/²³^]{0,6})\s*$/;

/** Pure: is this text a figure (a number with at most a unit), which is held to the key number minimum when it is drawn big. */
export function isKeyNumber(text: string): boolean {
  return NUMERIC.test(text);
}

/** Pure: the most sources playing at once. A source with no stop and no length plays to `end`. */
export function maxSimultaneous(sources: SourceRecord[], end: number): number {
  const events: [number, number][] = [];
  for (const s of sources) {
    let stop: number;
    if (s.stop !== null) stop = s.duration !== null ? Math.min(s.stop, s.start + s.duration) : s.stop;
    else if (s.duration !== null) stop = s.start + s.duration;
    else if (s.bufferSeconds !== null && !s.loop) stop = s.start + s.bufferSeconds;
    else stop = end;
    if (stop > s.start) {
      events.push([s.start, 1]);
      events.push([stop, -1]);
    }
  }
  // At the same instant, what ends counts before what begins.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let max = 0;
  for (const [, delta] of events) {
    now += delta;
    max = Math.max(max, now);
  }
  return max;
}

/** Pure: the text findings for the texts drawn in the sampled frames. */
export function judgeText(texts: TextRecord[], width: number, height: number, scale: number, scene: string): SceneFinding[] {
  // One finding per distinct text and rule, the worst one kept.
  const found = new Map<string, SceneFinding>();
  const add = (key: string, severity: "error" | "warning", check: string, message: string) => {
    const have = found.get(key);
    if (have && (have.severity === "error" || severity === "warning")) return;
    found.set(key, { beatId: "*", scene, severity, message, source: "render", check });
  };
  const label = TEXT_MINIMUMS.label * scale;
  const headline = TEXT_MINIMUMS.headline * scale;
  const number = TEXT_MINIMUMS.number * scale;
  const portrait = height > width;
  const shown = (t: string) => `"${t.length > 36 ? `${t.slice(0, 36)}...` : t}"`;
  for (const t of texts) {
    if (t.caption || t.text.trim() === "") continue;
    const size = Math.round(t.size * 10) / 10;
    const display = t.size >= label * DISPLAY_FACTOR;
    const figure = isKeyNumber(t.text);
    if (display && figure && t.size < number) {
      add(`size:${t.text}`, t.size < number / 2 ? "error" : "warning", "text-size", `The figure ${shown(t.text)} is drawn at ${size}px, under the ${Math.round(number)}px a key number needs at this canvas size (${width}x${height}).`);
    } else if (display && !figure && t.size < headline) {
      add(`size:${t.text}`, t.size < headline / 2 ? "error" : "warning", "text-size", `The headline ${shown(t.text)} is drawn at ${size}px, under the ${Math.round(headline)}px a headline needs at this canvas size (${width}x${height}).`);
    } else if (!display && t.size < label) {
      add(`size:${t.text}`, t.size < label / 2 ? "error" : "warning", "text-size", `The label ${shown(t.text)} is drawn at ${size}px, under the ${Math.round(label)}px a label needs at this canvas size (${width}x${height}). On a phone it will not be readable.`);
    }
    if (portrait) {
      const top = t.y - t.size * 0.8;
      const bottom = t.y + t.size * 0.2;
      if (top < height * SAFE_TOP) {
        add(`safe:${t.text}`, "warning", "safe-area", `The text ${shown(t.text)} is drawn at y=${Math.round(t.y)}, inside the top ${Math.round(SAFE_TOP * 100)}% of the canvas that the platform's interface covers. Only captions belong there.`);
      } else if (bottom > height * (1 - SAFE_BOTTOM)) {
        add(`safe:${t.text}`, "warning", "safe-area", `The text ${shown(t.text)} is drawn at y=${Math.round(t.y)}, inside the bottom ${Math.round(SAFE_BOTTOM * 100)}% of the canvas that captions and the platform's interface use. Only captions belong there.`);
      }
    }
  }
  return Array.from(found.values());
}

const hash = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

export async function validateCanvasExplainer(input: CanvasValidateInput): Promise<CanvasValidateResult> {
  const started = Date.now();
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const htmlPath = path.resolve(projectRoot, input.htmlPath);
  if (!fs.existsSync(htmlPath)) throw new Error(`No explainer at ${htmlPath}.`);
  const width = input.width ?? DEFAULT_CANVAS_WIDTH;
  const height = input.height ?? DEFAULT_CANVAS_HEIGHT;
  const fps = input.fps ?? DEFAULT_CANVAS_FPS;
  const scale = input.textScale ?? Math.min(width, height) / 720;
  const scene = path.basename(htmlPath);
  const audioOn = input.audio !== false;
  const project: CanvasProject | null = input.videoName !== undefined ? readCanvasProject(projectRoot, input.videoName) : null;
  const voiceover = project !== null && project.narration === "voice";
  const thresholds: ArcThresholds = {
    diagramWarnSeconds: input.diagramWarnSeconds ?? DEFAULT_ARC_THRESHOLDS.diagramWarnSeconds,
    diagramErrorSeconds: input.diagramErrorSeconds ?? DEFAULT_ARC_THRESHOLDS.diagramErrorSeconds,
    staticSeconds: input.staticSeconds ?? DEFAULT_ARC_THRESHOLDS.staticSeconds,
  };

  const findings: SceneFinding[] = [];
  const add = (severity: "error" | "warning", check: string, message: string) => findings.push({ beatId: "*", scene, severity, message, source: "render", check });
  for (const w of sourceWarnings(fs.readFileSync(htmlPath, "utf8"), htmlPath)) add("warning", "randomness", w);

  const browser = await launchChromium();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-canvas-validate-"));
  try {
    const opened = await openExplainer(browser, htmlPath, { width, height, fps, voiceover, project, probes: true, requireScore: audioOn });
    const { page, durationSeconds } = opened;
    const texts: TextRecord[] = [];
    const takeTexts = async () => {
      const got = await page.evaluate(() => {
        const w = window as unknown as { __ovsTexts: unknown[] };
        const copy = w.__ovsTexts.slice();
        w.__ovsTexts.length = 0;
        return copy;
      });
      texts.push(...(got as TextRecord[]));
    };
    if (opened.resized) add("warning", "canvas-size", `The canvas was not ${width}x${height}. Size it from window.OVS.width and window.OVS.height.`);

    // A frame is a pure function of t: three times, each drawn twice with another time drawn in between.
    const probeTimes = [0.2, 0.5, 0.8].map((f) => f * durationSeconds);
    for (const t of probeTimes) {
      const first = hash(await captureFrame(page, t));
      await captureFrame(page, (t + durationSeconds * 0.37) % durationSeconds);
      const second = hash(await captureFrame(page, t));
      if (first !== second) {
        add("error", "purity", `Drawing t=${t.toFixed(2)}s twice gives two different frames. A frame must be a pure function of t: nothing may depend on how many frames were drawn before it, on the clock, or on a random number.`);
      }
    }
    await takeTexts();

    // Frames across the whole length, for the arc and the text.
    const gap = Math.max(MIN_SAMPLE_GAP_SECONDS, durationSeconds / MAX_SAMPLES);
    const times: number[] = [];
    for (let t = 0; t < durationSeconds; t += gap) times.push(t);
    const samples: ArcSample[] = [];
    let previous: ArcSignature | null = null;
    const beatAt = (t: number) => project?.beats.find((b) => t >= b.start && t < b.end)?.id ?? "*";
    for (const [i, t] of times.entries()) {
      await page.evaluate(() => ((window as unknown as { __ovsCaptionBoxes: unknown[] }).__ovsCaptionBoxes = []));
      const png = await captureFrame(page, t);
      const boxes = (await page.evaluate(() => (window as unknown as { __ovsCaptionBoxes: Rect[] }).__ovsCaptionBoxes)) as Rect[];
      const file = path.join(scratch, `f${i}.png`);
      fs.writeFileSync(file, png);
      const m = await measureArcFrame(file, boxes, previous);
      previous = m.signature;
      samples.push({ time: t, beatId: beatAt(t), drawn: m.drawn, changedFromPrevious: m.changedFromPrevious });
      fs.rmSync(file, { force: true });
    }
    await takeTexts();
    findings.push(...judgeText(texts, width, height, scale, scene));
    for (const f of judgeLessonArc(samples, durationSeconds, thresholds)) {
      findings.push({ beatId: f.beatId, scene, severity: f.severity, message: f.message, source: "render", check: f.check });
    }

    let sound: CanvasValidateResult["sound"] = null;
    if (audioOn) {
      await page.evaluate(() => ((window as unknown as { __ovsSources: unknown[] }).__ovsSources.length = 0));
      try {
        const score = await renderScore(page, durationSeconds, AUDIO_SAMPLE_RATE, voiceover);
        const sources = (await page.evaluate(() => (window as unknown as { __ovsSources: SourceRecord[] }).__ovsSources)) as SourceRecord[];
        let peak = 0;
        for (let i = 0; i < score.data.length; i++) peak = Math.max(peak, Math.abs(score.data[i]));
        const peakDb = peak > 0 ? 20 * Math.log10(peak) : null;
        const most = maxSimultaneous(sources, durationSeconds);
        sound = { maxSimultaneous: most, peakDb: peakDb === null ? null : Math.round(peakDb * 10) / 10, sources: sources.length };
        if (most > MAX_SIMULTANEOUS_SOUNDS) {
          add("warning", "sound-polyphony", `Up to ${most} sounds play at once (a source node each), over ${MAX_SIMULTANEOUS_SOUNDS}. A pile-up of effects is mush under a voice; thin the score.`);
        }
        if (peak >= 1) add("warning", "sound-peak", `The score peaks at ${peakDb!.toFixed(1)} dBFS, which clips. Lower the master level.`);
        if (peak === 0) add("warning", "sound-silent", "The score renders as silence.");
      } catch (err) {
        add("error", "sound-kit", err instanceof Error ? err.message : String(err));
      }
    }

    await page.close().catch(() => undefined);
    const own = texts.filter((t) => !t.caption && t.text.trim() !== "");
    return {
      ok: !findings.some((f) => f.severity === "error"),
      findings,
      durationSeconds,
      width,
      height,
      textScale: scale,
      framesSampled: times.length,
      minTextSize: own.length === 0 ? null : Math.round(Math.min(...own.map((t) => t.size)) * 10) / 10,
      sound,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await browser.close().catch(() => undefined);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

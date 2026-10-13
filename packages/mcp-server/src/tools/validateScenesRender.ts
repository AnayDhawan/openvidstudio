import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Browser, Page } from "playwright";
import { launchChromium } from "@openvidstudio/capture";
import {
  bundleProject,
  openRenderBrowser,
  openSeekablePage,
  RemotionBridgeProtocolError,
  resolveComposition,
  seekToFrame,
  serveBundleDirectory,
} from "../remotionBridge";
import { compareFrames } from "../frameDiff";
import type { SceneFinding } from "./validateScenes";
import { pascalCase } from "../util";

/**
 * validate_scenes's render mode: the four checks a static read of scene source cannot make,
 * because each one depends on what the camera and the layout actually produce.
 *
 *  - crop:        text inside the camera-transformed stage that lands outside the frame
 *  - text size:   text that ends up below the design system's minimum on-screen size
 *  - reading:     a beat that is on screen for less time than its text takes to read
 *  - dead frames: a beat whose rendered pixels never change
 *
 * Measurement is DOM-based, not pixel-based. The scene is mounted in a real browser through
 * the remotionBridge, seeked to a handful of frames inside each beat, and measured with
 * getBoundingClientRect. That gives exact coordinates with no anti-aliasing or colour
 * threshold to tune. Dead frames are the one pixel check, since "nothing moved" has no DOM
 * equivalent (a canvas or a video can change without a node changing).
 *
 * Stage content is told apart from screen-space overlay content through the two data
 * attributes core writes (`data-ovs-camera-stage`, `data-ovs-overlay`). Overlay content
 * (captions, HUD) is not transformed by the camera, so it cannot be cropped by it and is
 * exempt from the crop check. It is still held to the size and reading checks.
 */

/**
 * Silent reading speed a viewer can sustain while also watching a moving picture. Roughly
 * 180 wpm, below ordinary reading speed (about 240 wpm) because the eye is also following
 * the scene. This is the budget for text read silently on screen; validateBeats's
 * MIN_PACE/MAX_PACE is the pace of spoken narration and is a different number.
 */
export const MAX_READING_WORDS_PER_SEC = 3;

/** Frames of a beat that get measured, as fractions of its duration. */
const SAMPLE_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

/** A crop counts only when it shows in at least this many samples, so a slide-in is not one. */
const MIN_CROPPED_SAMPLES = 3;

/** Share of a text's box that is outside the frame before it counts as cropped. */
const CROP_RATIO = 0.02;
/** And the least overhang, in output pixels, so sub-pixel antialiasing never counts. */
const CROP_MIN_PX = 4;

/**
 * Two sampled frames of a dead beat are compared at this changed-pixel ratio. Real motion,
 * even a slow camera push, moves far more than this; film grain and encoder noise are
 * averaged out by frameDiff's downscale before it is measured.
 */
const DEAD_CHANGED_RATIO = 0.002;

/** Seek and mount timeout per beat. Short on purpose: a beat that cannot mount is skipped. */
const BEAT_TIMEOUT_MS = 12000;

export interface TypeScaleMinimums {
  body: number;
  mono: number;
  /** Small UI chips (Pill, ToolChip): never held to body's minimum, which they are not
   * trying to meet, nor to mono's, which is about a different font role entirely. */
  label: number;
}

/**
 * Minimums used when a video has no design.ts. body/mono mirror DEFAULT_TYPE_SCALE in
 * packages/core/src/designSystem.ts (body 26-34, mono 15-22); the values are copied rather
 * than imported because this package does not depend on core, which is a template dependency.
 * label has no DesignSystem.typeScale counterpart (that type has no label field) and is not
 * read from design.ts below: it is a fixed floor, picked below Pill/ToolChip's own 18/20px
 * defaults so a deliberately smaller label still passes, but a near-illegible one is flagged.
 */
export const DEFAULT_TYPE_MINIMUMS: TypeScaleMinimums = { body: 26, mono: 15, label: 16 };

/**
 * Reads the lower bound of `body` and `mono` from src/videos/<name>/design.ts when one
 * exists. Regex rather than evaluating the file, since design.ts is TypeScript that imports
 * core and cannot be loaded from here. Anything it cannot read falls back to the default.
 */
export function readTypeMinimums(videoDir: string): TypeScaleMinimums {
  const out = { ...DEFAULT_TYPE_MINIMUMS };
  const file = path.join(videoDir, "design.ts");
  if (!fs.existsSync(file)) return out;
  const src = fs.readFileSync(file, "utf8");
  for (const key of ["body", "mono"] as const) {
    const m = src.match(new RegExp(`\\b${key}\\s*:\\s*\\[\\s*(\\d+(?:\\.\\d+)?)\\s*,`));
    if (m) out[key] = Number.parseFloat(m[1]);
  }
  return out;
}

export interface RenderBeat {
  id: string;
  start: number;
  duration: number;
}

export interface RenderCheckInput {
  projectRoot: string;
  videoName: string;
  compositionId: string;
  beats: RenderBeat[];
  fps: number;
  minimums: TypeScaleMinimums;
}

export interface RenderCheckResult {
  findings: SceneFinding[];
  beatsMeasured: number;
  beatsSkipped: { beatId: string; reason: string }[];
  bundleMs: number;
  totalMs: number;
}

interface TextProbe {
  text: string;
  /** Font size as it appears in the output frame, camera scale included. */
  fontPx: number;
  mono: boolean;
  /** Inside a data-ovs-label element (Pill, ToolChip): held to its own, lower minimum. */
  label: boolean;
  inStage: boolean;
  opacity: number;
  /** Fraction of the text box outside the frame, 0 to 1. */
  croppedRatio: number;
  /** Furthest overhang past any frame edge, in output pixels. */
  overhangPx: number;
}

/**
 * Runs in the page. Written as a self-contained function because page.evaluate serializes
 * it: nothing from this module's scope exists on the other side.
 */
function probePage(): TextProbe[] {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const stage = document.querySelector("[data-ovs-camera-stage]") as HTMLElement | null;
  let stageScale = 1;
  if (stage) {
    const m = new DOMMatrixReadOnly(getComputedStyle(stage).transform);
    stageScale = Math.hypot(m.m11, m.m12) || 1;
  }

  type Box = { l: number; t: number; r: number; b: number };
  const area = (b: Box) => Math.max(0, b.r - b.l) * Math.max(0, b.b - b.t);
  const intersect = (a: Box, b: Box): Box => ({
    l: Math.max(a.l, b.l),
    t: Math.max(a.t, b.t),
    r: Math.min(a.r, b.r),
    b: Math.min(a.b, b.b),
  });

  const out: TextProbe[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    const el = node.parentElement;
    if (!text || !el) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;

    const inStage = !!stage && stage.contains(el);
    let opacity = 1;
    let hidden = false;
    let label = false;
    const clips: Box[] = [];
    for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden") hidden = true;
      if (a.hasAttribute("data-ovs-label")) label = true;
      opacity *= Number.parseFloat(cs.opacity);
      // An overflow clip inside the stage hides text on purpose (a scrolling terminal, a
      // masked reveal). The stage's own parent is the camera viewport and is the crop this
      // check exists to find, so the walk stops being a clip source at the stage itself.
      if (inStage && a !== stage && stage!.contains(a) && cs.overflow !== "visible") {
        const r = a.getBoundingClientRect();
        clips.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
      }
      if (a === stage) break;
    }
    if (hidden || opacity < 0.15) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rr = range.getBoundingClientRect();
    let box: Box = { l: rr.left, t: rr.top, r: rr.right, b: rr.bottom };
    if (area(box) === 0) continue;
    for (const c of clips) box = intersect(box, c);
    if (area(box) === 0) continue; // clipped away entirely by an internal container

    const inFrame = intersect(box, { l: 0, t: 0, r: W, b: H });
    const croppedRatio = 1 - area(inFrame) / area(box);
    const overhangPx = Math.max(-box.l, -box.t, box.r - W, box.b - H, 0);

    const cs = getComputedStyle(el);
    out.push({
      text,
      fontPx: Number.parseFloat(cs.fontSize) * (inStage ? stageScale : 1),
      mono: /mono|courier|consolas|menlo|code/i.test(cs.fontFamily),
      label,
      inStage,
      opacity,
      croppedRatio,
      overhangPx,
    });
  }
  return out;
}

function wordsIn(text: string): number {
  return /[\p{L}]/u.test(text) ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

function examples(items: string[]): string {
  const shown = items.slice(0, 3).map((t) => `"${t.length > 40 ? `${t.slice(0, 40)}...` : t}"`);
  return shown.join(", ") + (items.length > 3 ? `, and ${items.length - 3} more` : "");
}

/**
 * Pure: turns what was measured in one beat's sampled frames into findings. Split out of the
 * browser loop so the judgement is testable without a browser.
 */
export function judgeBeat(opts: {
  beat: RenderBeat;
  fps: number;
  minimums: TypeScaleMinimums;
  samples: TextProbe[][];
  /** Largest changed-pixel ratio between any two sampled frames, or null if not measured. */
  maxChangedRatio: number | null;
}): SceneFinding[] {
  const { beat, fps, minimums, samples, maxChangedRatio } = opts;
  const scene = `${pascalCase(beat.id)}.tsx`;
  const base = { beatId: beat.id, scene, source: "render" as const };
  const findings: SceneFinding[] = [];

  // Crop: stage text outside the frame in most of the samples.
  const croppedIn = new Map<string, number>();
  for (const probes of samples) {
    const seen = new Set<string>();
    for (const p of probes) {
      if (p.inStage && p.opacity >= 0.5 && p.croppedRatio > CROP_RATIO && p.overhangPx > CROP_MIN_PX) {
        seen.add(p.text);
      }
    }
    for (const t of seen) croppedIn.set(t, (croppedIn.get(t) ?? 0) + 1);
  }
  const cropped = [...croppedIn].filter(([, n]) => n >= Math.min(MIN_CROPPED_SAMPLES, samples.length)).map(([t]) => t);
  if (cropped.length > 0) {
    findings.push({
      ...base,
      check: "crop",
      severity: "error",
      message:
        `Rendered text is cut off at the frame edge in ${cropped.length} place(s): ${examples(cropped)}. ` +
        `Measured on the real rendered DOM, not the source. Narrow the content, move it inward, or lower the camera scale.`,
    });
  }

  // Text size: the smallest on-screen size, against the design system's minimum.
  const small = new Map<string, number>();
  for (const probes of samples) {
    for (const p of probes) {
      const min = p.mono ? minimums.mono : p.label ? minimums.label : minimums.body;
      if (p.fontPx < min - 0.5) small.set(p.text, Math.min(small.get(p.text) ?? Infinity, p.fontPx));
    }
  }
  if (small.size > 0) {
    const worst = Math.min(...small.values());
    findings.push({
      ...base,
      check: "text-size",
      severity: "warning",
      message:
        `${small.size} text run(s) render below the minimum size (body ${minimums.body}px, mono ${minimums.mono}px, ` +
        `label ${minimums.label}px for a Pill/ToolChip, body/mono taken from this video's design.ts or the ` +
        `default type scale): ${examples([...small.keys()])}. The smallest is ${worst.toFixed(1)}px on screen, ` +
        `camera scale included. Raise the font size or the minimum.`,
    });
  }

  // Reading time: unique non-code text seen in the beat, against how long the beat is up.
  const unique = new Set<string>();
  for (const probes of samples) for (const p of probes) if (!p.mono) unique.add(p.text);
  const words = [...unique].reduce((n, t) => n + wordsIn(t), 0);
  const seconds = beat.duration / fps;
  const needed = words / MAX_READING_WORDS_PER_SEC;
  if (words > 0 && needed > seconds) {
    findings.push({
      ...base,
      check: "reading-time",
      severity: "warning",
      message:
        `${words} words of on-screen text need about ${needed.toFixed(1)}s to read at ` +
        `${MAX_READING_WORDS_PER_SEC} words/sec, but the beat is on screen for ${seconds.toFixed(1)}s. ` +
        `Cut the copy or lengthen the beat.`,
    });
  }

  // Dead frames.
  if (maxChangedRatio !== null && maxChangedRatio < DEAD_CHANGED_RATIO) {
    findings.push({
      ...base,
      check: "dead-frames",
      severity: "warning",
      message:
        `Frames sampled across this beat are identical (largest change ${(maxChangedRatio * 100).toFixed(3)}% ` +
        `of pixels). Nothing moves for ${seconds.toFixed(1)}s. STYLE.md fails a static frame.`,
    });
  }

  return findings;
}

function sampleFrames(beat: RenderBeat): number[] {
  const last = Math.max(0, beat.duration - 1);
  const frames = SAMPLE_FRACTIONS.map((f) => beat.start + Math.min(last, Math.round(beat.duration * f)));
  return [...new Set(frames)];
}

export async function runRenderChecks(input: RenderCheckInput): Promise<RenderCheckResult> {
  const started = Date.now();
  const bundleStarted = Date.now();
  const bundleDir = await bundleProject(input.projectRoot);
  const bundleMs = Date.now() - bundleStarted;

  const server = await serveBundleDirectory(bundleDir);
  const remotionBrowser = await openRenderBrowser();
  let browser: Browser | null = null;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-validate-scenes-"));
  const findings: SceneFinding[] = [];
  const skipped: { beatId: string; reason: string }[] = [];
  let measured = 0;

  try {
    const composition = await resolveComposition(bundleDir, input.compositionId, remotionBrowser);
    browser = await launchChromium();

    const openPage = async (): Promise<Page> => {
      const page = await browser!.newPage({
        viewport: { width: composition.width, height: composition.height },
        deviceScaleFactor: 1,
      });
      await openSeekablePage({ page, bundleUrl: server.url, composition, timeoutMs: BEAT_TIMEOUT_MS });
      return page;
    };

    let page: Page | null = await openPage();

    for (const beat of input.beats) {
      try {
        if (!page) page = await openPage();
        const samples: TextProbe[][] = [];
        const shots: string[] = [];
        const frames = sampleFrames(beat);
        for (const [i, frame] of frames.entries()) {
          await seekToFrame(page, composition.id, frame, BEAT_TIMEOUT_MS);
          samples.push(await page.evaluate(probePage));
          const shot = path.join(scratch, `${beat.id}-${i}.png`);
          await page.screenshot({ path: shot });
          shots.push(shot);
        }

        let maxChangedRatio: number | null = null;
        if (shots.length >= 2) {
          maxChangedRatio = 0;
          for (let i = 1; i < shots.length; i++) {
            const cmp = await compareFrames(shots[0], shots[i]);
            maxChangedRatio = Math.max(maxChangedRatio, cmp.changedRatio);
          }
        }

        findings.push(
          ...judgeBeat({ beat, fps: input.fps, minimums: input.minimums, samples, maxChangedRatio }),
        );
        measured++;
      } catch (err) {
        // A beat that cannot mount (a recording through OffthreadVideo is the known case, see
        // openSeekablePage) is reported as skipped. It is never treated as "no findings".
        const reason = err instanceof Error ? err.message : String(err);
        skipped.push({ beatId: beat.id, reason: err instanceof RemotionBridgeProtocolError ? reason.split(" Original:")[0] : reason });
        findings.push({
          beatId: beat.id,
          scene: `${pascalCase(beat.id)}.tsx`,
          source: "render",
          check: "render-skipped",
          severity: "warning",
          message:
            `Render-based checks could not run for this beat, so it was NOT measured: ${skipped[skipped.length - 1].reason}`,
        });
        // The page may be wedged mid-mount; the next beat gets a fresh one.
        await page?.close().catch(() => undefined);
        page = null;
      }
    }
    await page?.close().catch(() => undefined);
  } finally {
    await browser?.close().catch(() => undefined);
    await remotionBrowser.close({ silent: true });
    await server.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  return { findings, beatsMeasured: measured, beatsSkipped: skipped, bundleMs, totalMs: Date.now() - started };
}

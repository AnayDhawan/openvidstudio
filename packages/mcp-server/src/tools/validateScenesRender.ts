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
import sharp from "sharp";
import { compareFrames } from "../frameDiff";
import type { SceneFinding } from "./validateScenes";
import { pascalCase } from "../util";
import { MAX_READING_WORDS_PER_SEC, READING_OVERHEAD_SEC } from "./validateBeats";

/**
 * validate_scenes's render mode: the checks a static read of scene source cannot make,
 * because each one depends on what the camera and the layout actually produce.
 *
 *  - crop:        text inside the camera-transformed stage that lands outside the frame
 *  - text size:   text that ends up below the design system's minimum on-screen size
 *  - reading:     a beat that is on screen for less time than its text takes to read
 *  - dead frames: a beat whose rendered pixels never change
 *  - em dash:     an em dash anywhere in on-screen copy
 *  - contrast:    text colour against the pixels actually rendered behind it
 *  - safe area:   text inside the frame but outside the title-safe inset
 *  - HUD overlap: scene text drawn over the chapter HUD
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
 * Silent reading budget for on-screen text: about 3.5 words a second plus 0.8 s to land on it,
 * the same numbers validate_beats applies to onScreenText on a narration:"none" beat, imported
 * so the two gates can never disagree about how long a card has to stay up. This is a different
 * number from validateBeats's MIN_PACE/MAX_PACE, which is the pace of spoken narration.
 */
export { MAX_READING_WORDS_PER_SEC, READING_OVERHEAD_SEC };

/** WCAG 2.x contrast minimums: ordinary text, and large text (24px and up on screen). */
const MIN_CONTRAST = 4.5;
const MIN_CONTRAST_LARGE = 3;
const LARGE_TEXT_PX = 24;
/** Below this ratio the text is close to unreadable rather than merely weak: an error. */
const ILLEGIBLE_CONTRAST = 3;

/**
 * The title-safe inset: text closer than this to a frame edge risks being clipped by a
 * player, a crop to another aspect ratio, or a platform's own UI. Fractions of width/height.
 * Not the layout grid's margins (those are a design choice), but a floor under them.
 */
const SAFE_INSET_X = 0.04;
const SAFE_INSET_Y = 0.05;
/** Sub-pixel and antialiasing slop before overhang past the safe area counts. */
const SAFE_SLOP_PX = 2;

/** Share of a text box covered by a HUD element before it counts as an overlap. */
const HUD_OVERLAP_RATIO = 0.08;

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
  /** An already-built bundle directory to measure against, instead of bundling the project again. */
  bundleDir?: string;
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
  /** Inside a data-ovs-hud element (ChapterHud): chrome, exempt from size and reading checks. */
  hud?: boolean;
  /** Furthest the text box reaches past the title-safe inset, in output pixels (0 if inside). */
  safeOverhangPx?: number;
  /** Largest share of the text box covered by a HUD element it is not part of, 0 to 1. */
  hudOverlap?: number;
  /** The CSS text colour, r/g/b 0-255 and alpha 0-1 (alpha 0 for gradient or clipped text). */
  rgba?: [number, number, number, number];
  /** The text box in the output frame, used to read the background out of the screenshot. */
  box?: { l: number; t: number; r: number; b: number };
  /** Background colour behind the text, read from the screenshot after the probe. */
  bg?: [number, number, number] | null;
}

/**
 * Runs in the page. Written as a self-contained function because page.evaluate serializes
 * it: nothing from this module's scope exists on the other side.
 */
function probePage(args: { safeX: number; safeY: number }): TextProbe[] {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const safe = { l: W * args.safeX, t: H * args.safeY, r: W * (1 - args.safeX), b: H * (1 - args.safeY) };
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

  // HUD elements (ChapterHud) are chrome that other text must stay clear of.
  const huds: Box[] = [];
  document.querySelectorAll("[data-ovs-hud]").forEach((h) => {
    const r = h.getBoundingClientRect();
    let o = 1;
    for (let a = h as HTMLElement | null; a && a !== document.body; a = a.parentElement) {
      o *= Number.parseFloat(getComputedStyle(a).opacity);
    }
    if (r.width > 0 && r.height > 0 && o >= 0.3) huds.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
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
    let hud = false;
    const clips: Box[] = [];
    for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden") hidden = true;
      if (a.hasAttribute("data-ovs-label")) label = true;
      if (a.hasAttribute("data-ovs-hud")) hud = true;
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
    const safeOverhangPx = Math.max(safe.l - box.l, safe.t - box.t, box.r - safe.r, box.b - safe.b, 0);
    let hudOverlap = 0;
    if (!hud) {
      for (const h of huds) hudOverlap = Math.max(hudOverlap, area(intersect(box, h)) / area(box));
    }
    const nums = (cs.color.match(/[\d.]+/g) ?? []).map(Number);
    const rgba: [number, number, number, number] | undefined =
      nums.length >= 3 ? [nums[0], nums[1], nums[2], nums.length >= 4 ? nums[3] : 1] : undefined;
    out.push({
      text,
      fontPx: Number.parseFloat(cs.fontSize) * (inStage ? stageScale : 1),
      mono: /mono|courier|consolas|menlo|code/i.test(cs.fontFamily),
      label,
      inStage,
      opacity,
      croppedRatio,
      overhangPx,
      hud,
      safeOverhangPx,
      hudOverlap,
      rgba,
      box,
    });
  }
  return out;
}

/** A weak-contrast text must show it in this many sampled frames, so a fade-in is not one. */
const MIN_CONTRAST_SAMPLES = 2;

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2]);
}

/**
 * WCAG contrast ratio of text against an opaque background. The text colour is first
 * composited over that background with its own alpha times its ancestors' opacity, which is
 * what actually reaches the screen.
 */
export function contrastAgainst(
  rgba: [number, number, number, number],
  opacity: number,
  bg: [number, number, number],
): number {
  const a = Math.min(1, Math.max(0, rgba[3] * opacity));
  const fg: [number, number, number] = [
    rgba[0] * a + bg[0] * (1 - a),
    rgba[1] * a + bg[1] * (1 - a),
    rgba[2] * a + bg[2] * (1 - a),
  ];
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * The colour behind a text box, read from the rendered frame. Taken from a ring just outside
 * the box rather than from inside it, because inside it a large or bold string can cover more
 * than half the pixels and the median would be the glyph colour, not the surface. The median of
 * each channel keeps a gradient or a soft shadow from skewing it. Falls back to the box
 * interior when there is no ring (a box that fills the frame).
 */
export function backgroundBehind(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  box: { l: number; t: number; r: number; b: number },
  ringPx: number,
): [number, number, number] | null {
  const outer = {
    l: Math.max(0, Math.floor(box.l - ringPx)),
    t: Math.max(0, Math.floor(box.t - ringPx)),
    r: Math.min(width, Math.ceil(box.r + ringPx)),
    b: Math.min(height, Math.ceil(box.b + ringPx)),
  };
  const collect = (wantInside: boolean): [number[], number[], number[]] => {
    const reg = wantInside
      ? { l: Math.max(0, Math.floor(box.l)), t: Math.max(0, Math.floor(box.t)), r: Math.min(width, Math.ceil(box.r)), b: Math.min(height, Math.ceil(box.b)) }
      : outer;
    const step = Math.max(1, Math.floor(Math.sqrt(((reg.r - reg.l) * (reg.b - reg.t)) / 4000)));
    const ch: [number[], number[], number[]] = [[], [], []];
    for (let y = reg.t; y < reg.b; y += step) {
      for (let x = reg.l; x < reg.r; x += step) {
        const inside = x >= box.l && x < box.r && y >= box.t && y < box.b;
        if (!wantInside && inside) continue;
        const i = (y * width + x) * channels;
        ch[0].push(pixels[i]!);
        ch[1].push(pixels[i + 1]!);
        ch[2].push(pixels[i + 2]!);
      }
    }
    return ch;
  };
  let ch = collect(false);
  if (ch[0].length < 8) ch = collect(true);
  if (ch[0].length === 0) return null;
  const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
  return [median(ch[0]), median(ch[1]), median(ch[2])];
}

/**
 * The #rrggbb colours src/brand.ts sets, minus pure black and white (which nearly any frame
 * contains, so they could not tell a branded render from an unbranded one). Empty when there is
 * no brand file or it carries no hex colours.
 */
export function brandHexColors(projectRoot: string): string[] {
  const file = path.join(projectRoot, "src", "brand.ts");
  if (!fs.existsSync(file)) return [];
  const found = fs.readFileSync(file, "utf8").match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const unique = [...new Set(found.map((h) => h.toLowerCase()))];
  return unique.filter((h) => {
    const [r, g, b] = hexToRgb(h);
    const nearBlack = r < 12 && g < 12 && b < 12;
    const nearWhite = r > 243 && g > 243 && b > 243;
    return !nearBlack && !nearWhite;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour distance, per channel, within which a rendered pixel counts as "that brand colour". */
const BRAND_TOLERANCE = 22;
/** A brand colour is present in a frame when at least this share of its pixels match. */
const BRAND_MIN_SHARE = 0.0002;

/**
 * Pure: for each colour, the share of sampled pixels in a frame that match it. A stride keeps
 * this cheap on a 1920x1080 frame; a flat brand surface is far larger than any stride skips.
 */
export function colorShares(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  colors: string[],
): Map<string, number> {
  const rgb = colors.map(hexToRgb);
  const hits = new Array(colors.length).fill(0) as number[];
  const step = 3;
  let total = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      total++;
      for (let c = 0; c < rgb.length; c++) {
        const [cr, cg, cb] = rgb[c]!;
        if (Math.abs(r - cr) <= BRAND_TOLERANCE && Math.abs(g - cg) <= BRAND_TOLERANCE && Math.abs(b - cb) <= BRAND_TOLERANCE) hits[c]!++;
      }
    }
  }
  return new Map(colors.map((c, i) => [c, total === 0 ? 0 : hits[i]! / total]));
}

/**
 * Reads the frame once and does both per-frame measurements: the background behind each text
 * box (for contrast) and how much of each brand colour is on screen (for the palette check).
 */
async function measureFrame(
  shot: string,
  probes: TextProbe[],
  brandColors: string[],
): Promise<Map<string, number>> {
  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const p of probes) {
    if (!p.box || p.hud) continue;
    p.bg = backgroundBehind(data, info.width, info.height, info.channels, p.box, Math.max(4, Math.round(p.fontPx * 0.25)));
  }
  return brandColors.length > 0 ? colorShares(data, info.width, info.height, info.channels, brandColors) : new Map();
}

/** Pure: the palette finding, given the largest share each brand colour reached in any sampled frame. */
export function judgeBrandPalette(maxShare: Map<string, number>): SceneFinding[] {
  if (maxShare.size === 0) return [];
  const present = [...maxShare].filter(([, share]) => share >= BRAND_MIN_SHARE);
  if (present.length > 0) return [];
  return [
    {
      beatId: "*",
      scene: "brand.ts",
      source: "render",
      check: "brand-palette",
      severity: "warning",
      message:
        `src/brand.ts sets ${[...maxShare.keys()].join(", ")}, but none of those colours appears in any rendered ` +
        `frame, so the palette never reached the picture and the video is still in the default colours. Usual ` +
        `causes: brand.ts is not the FIRST import in Root.tsx, so scenes evaluated before applyBrand ran, or a ` +
        `bundler dropped the import as side-effect free (package.json "sideEffects" must list ./src/brand.ts).`,
    },
  ];
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
      if (p.hud) continue; // HUD chrome is deliberately small
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
  for (const probes of samples) for (const p of probes) if (!p.mono && !p.hud) unique.add(p.text);
  const words = [...unique].reduce((n, t) => n + wordsIn(t), 0);
  const seconds = beat.duration / fps;
  const needed = words / MAX_READING_WORDS_PER_SEC + READING_OVERHEAD_SEC;
  if (words > 0 && needed > seconds) {
    findings.push({
      ...base,
      check: "reading-time",
      severity: "warning",
      message:
        `${words} words of on-screen text need about ${needed.toFixed(1)}s to read ` +
        `(${MAX_READING_WORDS_PER_SEC} words/sec plus ${READING_OVERHEAD_SEC}s to land on it), but the beat is on ` +
        `screen for ${seconds.toFixed(1)}s. Cut the copy or lengthen the beat.`,
    });
  }

  // Em dashes in on-screen copy. The house rule is absolute, and a render is the one place the
  // source cannot give it away: copy assembled from variables or facts only exists here.
  const withEmDash = new Set<string>();
  for (const probes of samples) for (const p of probes) if (p.text.includes("\u2014")) withEmDash.add(p.text);
  if (withEmDash.size > 0) {
    findings.push({
      ...base,
      check: "em-dash",
      severity: "error",
      message:
        `${withEmDash.size} on-screen text run(s) contain an em dash: ${examples([...withEmDash])}. ` +
        `Rewrite with a comma, colon, period or parentheses.`,
    });
  }

  // Safe area: text that fits the frame but sits closer to its edge than a player or platform
  // reliably shows. Separate from crop, which is text actually cut off.
  const unsafe = new Map<string, number>();
  for (const probes of samples) {
    const seen = new Set<string>();
    for (const p of probes) {
      if (!p.hud && p.opacity >= 0.5 && (p.safeOverhangPx ?? 0) > SAFE_SLOP_PX && p.overhangPx <= CROP_MIN_PX) seen.add(p.text);
    }
    for (const t of seen) unsafe.set(t, (unsafe.get(t) ?? 0) + 1);
  }
  const outsideSafe = [...unsafe].filter(([, n]) => n >= Math.min(MIN_CROPPED_SAMPLES, samples.length)).map(([t]) => t);
  if (outsideSafe.length > 0) {
    findings.push({
      ...base,
      check: "safe-area",
      severity: "warning",
      message:
        `${outsideSafe.length} text run(s) sit outside the title-safe area (${SAFE_INSET_X * 100}% in from the sides, ` +
        `${SAFE_INSET_Y * 100}% from top and bottom): ${examples(outsideSafe)}. They are inside the frame, but a ` +
        `player, a crop to another aspect ratio or a platform's own UI can clip them. Move them inward.`,
    });
  }

  // HUD overlap: text drawn over the chapter HUD, which is chrome the viewer reads as a fixed layer.
  const hudHits = new Map<string, number>();
  for (const probes of samples) {
    const seen = new Set<string>();
    for (const p of probes) if (!p.hud && p.opacity >= 0.5 && (p.hudOverlap ?? 0) > HUD_OVERLAP_RATIO) seen.add(p.text);
    for (const t of seen) hudHits.set(t, (hudHits.get(t) ?? 0) + 1);
  }
  const overHud = [...hudHits].filter(([, n]) => n >= Math.min(MIN_CROPPED_SAMPLES, samples.length)).map(([t]) => t);
  if (overHud.length > 0) {
    findings.push({
      ...base,
      check: "hud-overlap",
      severity: "warning",
      message:
        `${overHud.length} text run(s) overlap the chapter HUD: ${examples(overHud)}. Keep scene copy clear of the ` +
        `HUD's top-left label and bottom rail, or move the HUD.`,
    });
  }

  // Contrast: the text colour against the background actually rendered behind it.
  const weak = new Map<string, { ratio: number; n: number }>();
  for (const probes of samples) {
    const seen = new Map<string, number>();
    for (const p of probes) {
      if (p.hud || p.opacity < 0.5 || !p.rgba || !p.bg || p.rgba[3] < 0.2) continue;
      const ratio = contrastAgainst(p.rgba, p.opacity, p.bg);
      const min = p.fontPx >= LARGE_TEXT_PX ? MIN_CONTRAST_LARGE : MIN_CONTRAST;
      if (ratio < min) seen.set(p.text, Math.min(seen.get(p.text) ?? Infinity, ratio));
    }
    for (const [t, r] of seen) {
      const prev = weak.get(t);
      weak.set(t, { ratio: Math.min(prev?.ratio ?? Infinity, r), n: (prev?.n ?? 0) + 1 });
    }
  }
  const lowContrast = [...weak].filter(([, v]) => v.n >= Math.min(MIN_CONTRAST_SAMPLES, samples.length));
  if (lowContrast.length > 0) {
    const worst = Math.min(...lowContrast.map(([, v]) => v.ratio));
    findings.push({
      ...base,
      check: "contrast",
      severity: worst < ILLEGIBLE_CONTRAST ? "error" : "warning",
      message:
        `${lowContrast.length} text run(s) fall below the contrast minimum (${MIN_CONTRAST}:1 for text under ` +
        `${LARGE_TEXT_PX}px, ${MIN_CONTRAST_LARGE}:1 above): ${examples(lowContrast.map(([t]) => t))}. The weakest is ` +
        `${worst.toFixed(2)}:1, measured against the pixels rendered behind the text. Change the text colour or the ` +
        `surface behind it.`,
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
  // A caller that already bundled (render_stills) passes its bundle in, so the project is not
  // run through webpack twice in one call.
  const bundleDir = input.bundleDir ?? (await bundleProject(input.projectRoot));
  const bundleMs = input.bundleDir ? 0 : Date.now() - bundleStarted;

  const server = await serveBundleDirectory(bundleDir);
  const remotionBrowser = await openRenderBrowser();
  let browser: Browser | null = null;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-validate-scenes-"));
  const findings: SceneFinding[] = [];
  const skipped: { beatId: string; reason: string }[] = [];
  let measured = 0;
  // Largest share of each brand colour seen in any sampled frame, for the palette check.
  const brandColors = brandHexColors(input.projectRoot);
  const brandSeen = new Map<string, number>(brandColors.map((c) => [c, 0]));

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
          const probes = await page.evaluate(probePage, { safeX: SAFE_INSET_X, safeY: SAFE_INSET_Y });
          const shot = path.join(scratch, `${beat.id}-${i}.png`);
          await page.screenshot({ path: shot });
          shots.push(shot);
          const shares = await measureFrame(shot, probes, brandColors);
          for (const [hex, share] of shares) brandSeen.set(hex, Math.max(brandSeen.get(hex) ?? 0, share));
          samples.push(probes);
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
    // Only judged when at least one beat was actually measured: with nothing rendered there is
    // no frame to find the palette in, and saying it is missing would be a false alarm.
    if (measured > 0) findings.push(...judgeBrandPalette(brandSeen));
  } finally {
    await browser?.close().catch(() => undefined);
    await remotionBrowser.close({ silent: true });
    await server.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  return { findings, beatsMeasured: measured, beatsSkipped: skipped, bundleMs, totalMs: Date.now() - started };
}

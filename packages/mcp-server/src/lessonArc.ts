import sharp from "sharp";

/**
 * The two rules of a lesson's shape (SCRIPT.md, "The arc") that are about the picture, not the words:
 * the diagram is on screen early, and the viewer never waits long with nothing changing.
 *
 * Both are judged from the frames validate_scenes already samples in render mode, so there is no extra
 * render pass. Each sampled frame is reduced to two numbers, taken with the caption region masked:
 * how much of it is drawn beyond the background, and how much of it moved since the previous sample.
 */

/** Frame width the "has anything been drawn" measure runs at: wide enough that a thin axis line survives. */
const CONTENT_WIDTH = 540;
/** Frame width two samples are compared at; averaging away encoder noise is the point of the small size. */
const SIGNATURE_WIDTH = 270;
/** A pixel counts as drawn when it differs from the frame's background colour by more than this in any channel. The Void's 5% hairline grid is about 13, so it does not count. */
const DRAWN_DISTANCE = 40;
/** Share of the unmasked pixels that must be drawn before a frame counts as having a diagram, about 250 pixels of a 540x960 frame. */
const DRAWN_MIN_SHARE = 0.0005;
/** Per-channel change that counts as a moved pixel, and the share of moved pixels below which two samples are identical (frameDiff's numbers). */
const MOVED_DISTANCE = 12;
const IDENTICAL_MAX_SHARE = 0.002;
/** With no caption element in the frame, the bottom of the frame is assumed to hold the captions: the Reels safe zone. */
export const DEFAULT_CAPTION_BAND = 0.22;

export interface ArcThresholds {
  /** The first drawn element after this many seconds is a warning. */
  diagramWarnSeconds: number;
  /** After this many seconds it is an error. */
  diagramErrorSeconds: number;
  /** A run of identical sampled frames longer than this is a warning. */
  staticSeconds: number;
}

export const DEFAULT_ARC_THRESHOLDS: ArcThresholds = { diagramWarnSeconds: 15, diagramErrorSeconds: 25, staticSeconds: 8 };

/** A rectangle in frame pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What one sampled frame contributes to the arc checks. */
export interface ArcSample {
  /** Seconds from the start of the lesson. */
  time: number;
  beatId: string;
  /** Share of the unmasked pixels drawn beyond the background, 0 to 1. */
  drawn: number;
  /** Share of the unmasked pixels that moved since the previous sample, or null for the first one. */
  changedFromPrevious: number | null;
}

/** What is kept of a frame so the next one can be compared with it. */
export interface ArcSignature {
  data: Buffer;
  mask: Uint8Array;
  width: number;
  height: number;
}

export interface ArcFinding {
  beatId: string;
  check: "diagram-late" | "static-stretch";
  severity: "warning" | "error";
  message: string;
}

/** Rectangles to ignore in a frame: the captions' own boxes when the page has them, otherwise the bottom band. */
export function captionMaskRects(found: Rect[], frame: { width: number; height: number }): Rect[] {
  if (found.length > 0) return found;
  const band = Math.round(frame.height * DEFAULT_CAPTION_BAND);
  return [{ x: 0, y: frame.height - band, width: frame.width, height: band }];
}

function maskFor(rects: Rect[], scale: number, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x * scale));
    const y0 = Math.max(0, Math.floor(r.y * scale));
    const x1 = Math.min(width, Math.ceil((r.x + r.width) * scale));
    const y1 = Math.min(height, Math.ceil((r.y + r.height) * scale));
    for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + x1);
  }
  return mask;
}

/** The background colour of a frame: the most common colour once each channel is rounded to a multiple of 8. */
function backgroundOf(data: Buffer, mask: Uint8Array, pixels: number): [number, number, number] {
  const counts = new Map<number, number>();
  let best = 0;
  let bestCount = 0;
  for (let p = 0; p < pixels; p++) {
    if (mask[p]) continue;
    const key = ((data[p * 3]! >> 3) << 10) | ((data[p * 3 + 1]! >> 3) << 5) | (data[p * 3 + 2]! >> 3);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > bestCount) {
      best = key;
      bestCount = n;
    }
  }
  return [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
}

/** Pure: the share of unmasked pixels that sit further than DRAWN_DISTANCE from the frame's background colour. */
export function drawnShare(data: Buffer, mask: Uint8Array, width: number, height: number): number {
  const pixels = width * height;
  const [br, bg, bb] = backgroundOf(data, mask, pixels);
  let considered = 0;
  let drawn = 0;
  for (let p = 0; p < pixels; p++) {
    if (mask[p]) continue;
    considered++;
    const i = p * 3;
    if (Math.max(Math.abs(data[i]! - br), Math.abs(data[i + 1]! - bg), Math.abs(data[i + 2]! - bb)) > DRAWN_DISTANCE) drawn++;
  }
  return considered === 0 ? 0 : drawn / considered;
}

/** Pure: the share of pixels, unmasked in both frames, that moved by more than MOVED_DISTANCE. */
export function movedShare(a: ArcSignature, b: ArcSignature): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const pixels = a.width * a.height;
  let considered = 0;
  let moved = 0;
  for (let p = 0; p < pixels; p++) {
    if (a.mask[p] || b.mask[p]) continue;
    considered++;
    const i = p * 3;
    if (
      Math.abs(a.data[i]! - b.data[i]!) > MOVED_DISTANCE ||
      Math.abs(a.data[i + 1]! - b.data[i + 1]!) > MOVED_DISTANCE ||
      Math.abs(a.data[i + 2]! - b.data[i + 2]!) > MOVED_DISTANCE
    ) {
      moved++;
    }
  }
  return considered === 0 ? 0 : moved / considered;
}

/**
 * Reads one screenshot into what the arc checks need. `previous` is the signature of the sample before it, so
 * the caller keeps one frame in memory, not all of them.
 */
export async function measureArcFrame(
  shot: string,
  captionRects: Rect[],
  previous: ArcSignature | null,
): Promise<{ drawn: number; changedFromPrevious: number | null; signature: ArcSignature }> {
  const meta = await sharp(shot).metadata();
  const frame = { width: meta.width ?? CONTENT_WIDTH, height: meta.height ?? CONTENT_WIDTH };
  const rects = captionMaskRects(captionRects, frame);

  const wide = await sharp(shot).removeAlpha().resize({ width: CONTENT_WIDTH }).raw().toBuffer({ resolveWithObject: true });
  const wideMask = maskFor(rects, wide.info.width / frame.width, wide.info.width, wide.info.height);
  const drawn = drawnShare(wide.data, wideMask, wide.info.width, wide.info.height);

  const small = await sharp(shot).removeAlpha().resize({ width: SIGNATURE_WIDTH }).raw().toBuffer({ resolveWithObject: true });
  const signature: ArcSignature = {
    data: small.data,
    mask: maskFor(rects, small.info.width / frame.width, small.info.width, small.info.height),
    width: small.info.width,
    height: small.info.height,
  };
  return { drawn, changedFromPrevious: previous ? movedShare(previous, signature) : null, signature };
}

const seconds = (s: number) => `${Math.round(s * 10) / 10} s`;

/**
 * Pure: the findings, given the samples in lesson order and the lesson's length.
 *
 * `diagram-late` reads the first sampled frame with anything drawn. `static-stretch` finds each run of sampled
 * frames that did not change, and estimates how long the hold really lasted: the true edges lie between a held
 * sample and its changed neighbour, so each is taken as the midpoint, and the lesson's own start and end bound a
 * run that touches them. A 6 s hold sampled twice is therefore still about 6 s, not the 4 s between its samples.
 */
export function judgeLessonArc(samples: ArcSample[], lessonSeconds: number, thresholds: ArcThresholds = DEFAULT_ARC_THRESHOLDS): ArcFinding[] {
  const findings: ArcFinding[] = [];
  if (samples.length === 0) return findings;

  const firstDrawn = samples.find((s) => s.drawn >= DRAWN_MIN_SHARE);
  if (!firstDrawn) {
    findings.push({
      beatId: "*",
      check: "diagram-late",
      severity: "error",
      message:
        `No sampled frame has anything drawn beyond the background and the captions, so the diagram never ` +
        `appears. The arc wants its first element on screen inside ${thresholds.diagramWarnSeconds} s.`,
    });
  } else if (firstDrawn.time > thresholds.diagramWarnSeconds) {
    const error = firstDrawn.time > thresholds.diagramErrorSeconds;
    findings.push({
      beatId: firstDrawn.beatId,
      check: "diagram-late",
      severity: error ? "error" : "warning",
      message:
        `The first thing drawn beyond the background and the captions is in a frame ${seconds(firstDrawn.time)} into the ` +
        `lesson. The arc wants the diagram's first element inside ${thresholds.diagramWarnSeconds} s (an error past ` +
        `${thresholds.diagramErrorSeconds} s): a viewer facing an empty frame that long scrolls on.`,
    });
  }

  let i = 1;
  while (i < samples.length) {
    const held = (n: number) => samples[n]!.changedFromPrevious !== null && samples[n]!.changedFromPrevious! <= IDENTICAL_MAX_SHARE;
    if (!held(i)) {
      i++;
      continue;
    }
    const first = i - 1;
    let last = i;
    while (last + 1 < samples.length && held(last + 1)) last++;
    const start = first > 0 ? (samples[first - 1]!.time + samples[first]!.time) / 2 : 0;
    const end = last < samples.length - 1 ? (samples[last]!.time + samples[last + 1]!.time) / 2 : lessonSeconds;
    if (end - start > thresholds.staticSeconds) {
      findings.push({
        beatId: samples[first]!.beatId,
        check: "static-stretch",
        severity: "warning",
        message:
          `Nothing changes for about ${seconds(end - start)} (from about ${seconds(start)} to ${seconds(end)}; frames sampled ` +
          `across it match, captions aside). The arc wants something to move at least every ${thresholds.staticSeconds} s: ` +
          `bring the next element in sooner, add a Spark move, or split the beat.`,
      });
    }
    i = last + 1;
  }
  return findings;
}

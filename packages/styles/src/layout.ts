/**
 * Vertical-first layout helpers. The logical canvas for a Reel is 720x1280; the unsafe bands (the top
 * 14% and the bottom 22%) belong to the platform's own UI. A landscape layout is never cropped to
 * vertical: reframe-by-cropping is deliberately not offered, because it cuts layouts. Design
 * the vertical frame with these helpers instead.
 */
export const LOGICAL_WIDTH = 720;
export const LOGICAL_HEIGHT = 1280;
export const LOGICAL_SIZE = { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT } as const;

/** Share of the height kept clear at the top and bottom. */
export const SAFE_TOP = 0.14;
export const SAFE_BOTTOM = 0.22;
/** Share of the width kept clear on each side, so text never touches the edge. */
export const SAFE_SIDE = 0.05;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The usable rectangle for content, in whole pixels. At 720x1280: x 36, y 179, w 648, h 819. */
export function safeArea(width: number, height: number): Rect {
  const x = Math.round(width * SAFE_SIDE);
  const top = Math.round(height * SAFE_TOP);
  const bottom = height - Math.round(height * SAFE_BOTTOM);
  return { x, y: top, w: width - 2 * x, h: bottom - top };
}

/** True when a rectangle lies entirely inside the safe area. */
export function insideSafeArea(width: number, height: number, r: Rect): boolean {
  const s = safeArea(width, height);
  return r.x >= s.x && r.y >= s.y && r.x + r.w <= s.x + s.w && r.y + r.h <= s.y + s.h;
}

export type TextRole = "headline" | "label" | "number";

/** The smallest size, in logical px, each role may be drawn at. */
export const ROLE_MIN_SIZE: Record<TextRole, number> = { headline: 44, label: 28, number: 64 };

export interface FitResult {
  /** The size to draw at: the largest that fits, and never below the role minimum. */
  size: number;
  lines: string[];
  /** False when even the role minimum overflows: shorten the text or widen the box. */
  fits: boolean;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** fitText with the wrapped lines and an overflow flag. Sets ctx.font to the size it returns. */
export function fitTextLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  startSize: number,
  role: TextRole = "headline",
  family = "sans-serif",
  weight = "700",
): FitResult {
  const min = ROLE_MIN_SIZE[role];
  const start = Math.max(Math.floor(startSize), min);
  for (let size = start; size >= min; size--) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { size, lines, fits: true };
    }
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return { size: min, lines: wrap(ctx, text, maxWidth), fits: false };
}

/** The largest font size at which the text fits in maxWidth over at most maxLines lines, never below the role minimum. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  startSize: number,
  role: TextRole = "headline",
  family = "sans-serif",
  weight = "700",
): number {
  return fitTextLayout(ctx, text, maxWidth, maxLines, startSize, role, family, weight).size;
}

export const CAPTION_LINES = 2;
export const CAPTION_START_SIZE = 36;
const CAPTION_PAD = 16;

/** The caption band: full safe width, sitting on the bottom edge of the safe area, room for two lines. */
export function captionBand(width: number, height: number): Rect {
  const s = safeArea(width, height);
  const h = Math.round(CAPTION_START_SIZE * 1.25 * CAPTION_LINES + CAPTION_PAD * 2);
  return { x: s.x, y: s.y + s.h - h, w: s.w, h };
}

export interface CaptionStyle {
  color?: string;
  background?: string;
  family?: string;
}

/** Draws a caption centred in the caption band, shrinking to fit two lines (never below the label minimum). */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  style: CaptionStyle = {},
): FitResult & { rect: Rect } {
  const rect = captionBand(width, height);
  const fit = fitTextLayout(ctx, text, rect.w - CAPTION_PAD * 2, CAPTION_LINES, CAPTION_START_SIZE, "label", style.family);
  const lineH = Math.round(fit.size * 1.25);
  const blockH = lineH * fit.lines.length + CAPTION_PAD * 2;
  const top = rect.y + rect.h - blockH;
  ctx.save();
  ctx.fillStyle = style.background ?? "rgba(11,13,20,0.82)";
  ctx.fillRect(rect.x, top, rect.w, blockH);
  ctx.fillStyle = style.color ?? "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fit.lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.w / 2, top + CAPTION_PAD + lineH * i + lineH / 2));
  ctx.restore();
  return { ...fit, rect: { x: rect.x, y: top, w: rect.w, h: blockH } };
}

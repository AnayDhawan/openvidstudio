import { createRng } from "./rng";
import { ACCENTS, hexToRgb, VOID, withAlpha } from "./tokens";
import type { Sprite, DrawSpriteOptions } from "./sprites";
import { drawSprite } from "./sprites";
import type { Rect } from "./layout";

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: CanvasRenderingContext2D } {
  const canvas: AnyCanvas =
    typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: w, height: h }) : new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  return { canvas, ctx };
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- camera

export interface Camera {
  /** 1 is no zoom. */
  scale: number;
  /** Pixel offset of the view centre. */
  x: number;
  y: number;
}

export const NO_CAMERA: Camera = { scale: 1, x: 0, y: 0 };

export interface DollyOptions {
  from?: Camera;
  to: Camera;
  /** Seconds the move starts at (default 0) and how long it takes. */
  start?: number;
  duration: number;
  /** Easing of the 0..1 progress; default is a smooth ease in and out. */
  ease?: (p: number) => number;
}

export const easeInOut = (p: number): number => p * p * (3 - 2 * p);

/** The camera at time t: scale and offset move from one pose to another. A pure function of t. */
export function dolly(t: number, o: DollyOptions): Camera {
  const from = o.from ?? NO_CAMERA;
  const p = clamp01((t - (o.start ?? 0)) / o.duration);
  const e = (o.ease ?? easeInOut)(p);
  return {
    scale: from.scale + (o.to.scale - from.scale) * e,
    x: from.x + (o.to.x - from.x) * e,
    y: from.y + (o.to.y - from.y) * e,
  };
}

/** Applies a camera to the context (zoom about the canvas centre, then offset). Call inside save/restore. */
export function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera, width: number, height: number): void {
  ctx.translate(width / 2, height / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-width / 2 - cam.x, -height / 2 - cam.y);
}

// ---------------------------------------------------------------- parallax

export type LayerKind = "stars" | "hills" | "towers" | "dots";

export interface LayerSpec {
  kind: LayerKind;
  color: string;
  /** 0 is the far plane, 1 the nearest. Near layers move faster and zoom more with the camera. */
  depth: number;
  /** Blur strength for far layers, in px of the final image; 0 or omitted is sharp. */
  blur?: number;
  /** Items in one tile (stars, towers, dots). */
  count?: number;
  /** How tall the layer's shapes are, as a share of the height. */
  amplitude?: number;
}

export interface ParallaxOptions {
  width: number;
  height: number;
  seed?: number;
  /** Three to five layers, drawn far to near. Defaults to a four-layer set in the given accent. */
  layers?: LayerSpec[];
  /** Where the ground line sits, as a share of the height (default 0.62). */
  horizon?: number;
  /** Scroll speed of the nearest layer, px per second (default 40). */
  speed?: number;
  accent?: string;
}

interface Built {
  spec: LayerSpec;
  canvas: AnyCanvas;
}

export function defaultLayers(accent: string = ACCENTS.math): LayerSpec[] {
  const [r, g, b] = hexToRgb(accent);
  const tint = (k: number, a = 1): string =>
    `rgba(${Math.round(11 + (r - 11) * k)},${Math.round(13 + (g - 13) * k)},${Math.round(20 + (b - 20) * k)},${a})`;
  return [
    { kind: "stars", color: tint(0.55), depth: 0.08, count: 90, blur: 2 },
    { kind: "hills", color: tint(0.16), depth: 0.25, amplitude: 0.16, blur: 6 },
    { kind: "towers", color: tint(0.26), depth: 0.5, count: 12, amplitude: 0.22, blur: 2 },
    { kind: "hills", color: tint(0.38), depth: 0.8, amplitude: 0.1 },
  ];
}

/**
 * A layered background that scrolls at different rates. Layers are pre-rendered once (far ones
 * blurred) into tiles that wrap, and draw() is then a handful of drawImage calls. What a frame shows is
 * a function of (options, t, camera) only.
 */
export class Parallax {
  readonly width: number;
  readonly height: number;
  readonly horizon: number;
  readonly speed: number;
  readonly tileWidth: number;
  private layers: Built[];

  constructor(o: ParallaxOptions) {
    this.width = o.width;
    this.height = o.height;
    this.horizon = Math.round(o.height * (o.horizon ?? 0.62));
    this.speed = o.speed ?? 40;
    this.tileWidth = o.width * 2;
    const specs = (o.layers ?? defaultLayers(o.accent)).slice().sort((a, b) => a.depth - b.depth);
    if (specs.length < 3 || specs.length > 5) throw new Error(`Parallax takes three to five layers; got ${specs.length}.`);
    const rng = createRng(o.seed ?? 1);
    this.layers = specs.map((spec) => ({ spec, canvas: this.render(spec, createRng(Math.floor(rng.next() * 2 ** 31))) }));
  }

  private render(spec: LayerSpec, rng: ReturnType<typeof createRng>): AnyCanvas {
    const W = this.tileWidth;
    const H = this.height;
    const { canvas, ctx } = makeCanvas(W, H);
    ctx.fillStyle = spec.color;
    const amp = (spec.amplitude ?? 0.15) * H;
    const base = this.horizon;
    if (spec.kind === "stars") {
      for (let i = 0; i < (spec.count ?? 80); i++) {
        const size = rng.int(1, 3);
        ctx.fillRect(rng.int(0, W - size), rng.int(0, Math.max(1, base - 20)), size, size);
      }
    } else if (spec.kind === "dots") {
      for (let i = 0; i < (spec.count ?? 40); i++) {
        const r = rng.int(2, 6);
        ctx.beginPath();
        ctx.arc(rng.range(0, W), rng.range(base * 0.4, base), r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (spec.kind === "hills") {
      // Whole numbers of periods across the tile, so the right edge meets the left edge.
      const waves = [1 + rng.int(1, 2), 3 + rng.int(0, 2), 7 + rng.int(0, 3)].map((n, i) => ({
        n,
        phase: rng.range(0, Math.PI * 2),
        a: amp * [0.5, 0.3, 0.12][i],
      }));
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 4) {
        let y = base - amp * 0.5;
        for (const w of waves) y -= w.a * Math.sin((x / W) * Math.PI * 2 * w.n + w.phase);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    } else {
      const n = spec.count ?? 10;
      const slot = W / n;
      for (let i = 0; i < n; i++) {
        const w = Math.round(slot * rng.range(0.4, 0.8));
        const h = Math.round(amp * rng.range(0.35, 1));
        const x = Math.round(i * slot + (slot - w) / 2);
        ctx.fillRect(x, base - h, w, H - (base - h));
      }
    }
    const blur = spec.blur ?? 0;
    return blur > 0 ? this.blurred(canvas, blur) : canvas;
  }

  /** Blur by shrinking and enlarging with smoothing on: the same pixels everywhere, no filter support needed. */
  private blurred(src: AnyCanvas, blur: number): AnyCanvas {
    const f = 1 + blur;
    const sw = Math.max(1, Math.round(src.width / f));
    const sh = Math.max(1, Math.round(src.height / f));
    const small = makeCanvas(sw, sh);
    small.ctx.imageSmoothingEnabled = true;
    small.ctx.imageSmoothingQuality = "high";
    small.ctx.drawImage(src, 0, 0, sw, sh);
    const out = makeCanvas(src.width, src.height);
    out.ctx.imageSmoothingEnabled = true;
    out.ctx.imageSmoothingQuality = "high";
    out.ctx.drawImage(small.canvas, 0, 0, src.width, src.height);
    return out.canvas;
  }

  get layerCount(): number {
    return this.layers.length;
  }

  /** Draws every layer, far to near, at time t (seconds). The camera shifts and zooms each by its depth. */
  draw(ctx: CanvasRenderingContext2D, t: number, camera: Camera = NO_CAMERA): void {
    const W = this.width;
    ctx.save();
    for (const { spec, canvas } of this.layers) {
      const k = 0.25 + spec.depth * 0.75;
      const zoom = 1 + (camera.scale - 1) * spec.depth;
      const scroll = (((t * this.speed * k + camera.x * spec.depth) % this.tileWidth) + this.tileWidth) % this.tileWidth;
      ctx.save();
      // Zoom about the horizon line at the screen centre, so near layers rush past and far ones barely move.
      ctx.translate(W / 2, this.horizon);
      ctx.scale(zoom, zoom);
      ctx.translate(-W / 2, -this.horizon - camera.y * spec.depth);
      ctx.drawImage(canvas, -scroll, 0);
      ctx.drawImage(canvas, this.tileWidth - scroll, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- floor grid, fog, shadows

export interface FloorGridOptions {
  /** y of the horizon, px. */
  horizon: number;
  /** x the lines converge at (default: the middle of the area). */
  vanishX?: number;
  color?: string;
  /** Horizontal lines on screen at once (default 14) and radiating lines (default 16). */
  rows?: number;
  cols?: number;
  /** Rows the grid scrolls toward the viewer per second (default 0.6). */
  speed?: number;
  lineWidth?: number;
  /** 0..1: how strongly distant lines fade into the horizon (default 0.85). */
  fog?: number;
}

/** A perspective floor: lines that converge at the horizon, scrolling toward the viewer with t. */
export function drawFloorGrid(ctx: CanvasRenderingContext2D, area: Rect, t: number, o: FloorGridOptions): void {
  const color = o.color ?? ACCENTS.math;
  const rows = o.rows ?? 14;
  const cols = o.cols ?? 16;
  const bottom = area.y + area.h;
  const vx = o.vanishX ?? area.x + area.w / 2;
  const fog = o.fog ?? 0.85;
  const span = bottom - o.horizon;
  const phase = (((t * (o.speed ?? 0.6)) % 1) + 1) % 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, o.horizon, area.w, span);
  ctx.clip();
  ctx.lineWidth = o.lineWidth ?? 2;
  for (let i = 0; i < rows; i++) {
    const p = (i + phase) / rows;
    const y = o.horizon + span * p * p;
    ctx.strokeStyle = withAlpha(color, clamp01(p * 1.4) * (1 - fog) + clamp01(p) * fog);
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
    ctx.stroke();
  }
  const spread = area.w * 1.6;
  for (let i = 0; i <= cols; i++) {
    const bx = vx + (i / cols - 0.5) * spread;
    const g = ctx.createLinearGradient(0, o.horizon, 0, bottom);
    g.addColorStop(0, withAlpha(color, 1 - fog));
    g.addColorStop(1, withAlpha(color, 0.9));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(vx, o.horizon);
    ctx.lineTo(bx, bottom);
    ctx.stroke();
  }
  ctx.restore();
}

/** Depth fog: a band at the horizon that fades into the ground colour, so far things recede. */
export function drawFog(
  ctx: CanvasRenderingContext2D,
  area: Rect,
  horizon: number,
  o: { color?: string; strength?: number; reach?: number } = {},
): void {
  const color = o.color ?? VOID;
  const strength = o.strength ?? 0.9;
  const reach = (o.reach ?? 0.35) * (area.y + area.h - horizon);
  const above = reach * 0.6;
  const g = ctx.createLinearGradient(0, horizon - above, 0, horizon + reach);
  g.addColorStop(0, withAlpha(color, 0));
  g.addColorStop(above / (above + reach), withAlpha(color, strength));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(area.x, horizon - above, area.w, above + reach);
  ctx.restore();
}

/** A hard-edged pixel ellipse on the ground: stacked fillRects, so it matches the sprites. */
export function drawShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha = 0.4,
  pixel = 2,
): void {
  const p = Math.max(1, Math.round(pixel));
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${clamp01(alpha)})`;
  for (let dy = -ry; dy < ry; dy += p) {
    const k = Math.sqrt(Math.max(0, 1 - ((dy + p / 2) / ry) ** 2));
    const half = Math.round((rx * k) / p) * p;
    if (half > 0) ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2, p);
  }
  ctx.restore();
}

/** A sprite's drop shadow: its silhouette offset down and right in a translucent black. Draw it before the sprite. */
export function drawSpriteShadow(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  scale: number,
  frame = 0,
  o: { dx?: number; dy?: number; alpha?: number } & DrawSpriteOptions = {},
): void {
  const s = Math.max(1, Math.round(scale));
  drawSprite(ctx, sprite, x + (o.dx ?? s * 2), y + (o.dy ?? s * 2), scale, frame, { ...o, tint: `rgba(0,0,0,${o.alpha ?? 0.35})` });
}

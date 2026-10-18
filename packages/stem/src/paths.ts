// Spark behaviours. A path is a pure function of local time, in frames since the Spark appeared,
// returning where the Spark is in the composition's pixels. Every helper here returns one (split
// returns n), so they compose, and none keeps state between frames or draws a random number.

import { E } from "@openvidstudio/core";

export interface Point {
  x: number;
  y: number;
}
export type Path = (t: number) => Point;
export interface Keyframe extends Point {
  /** Local frame the Spark is at this point. */
  frame: number;
  easing?: (t: number) => number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const mix = (a: Point, b: Point, k: number): Point => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

/** Keyframes as a path: eased between neighbours, held at the first and last. */
export function keyframePath(keys: Keyframe[]): Path {
  if (keys.length === 0) throw new Error("A Spark path needs at least one keyframe.");
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  return (t) => {
    if (t <= sorted[0].frame) return { x: sorted[0].x, y: sorted[0].y };
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (t <= b.frame) {
        const k = b.frame === a.frame ? 1 : (t - a.frame) / (b.frame - a.frame);
        return mix(a, b, (b.easing ?? E.sine)(clamp01(k)));
      }
    }
    const last = sorted[sorted.length - 1];
    return { x: last.x, y: last.y };
  };
}

/** A path from either form a Spark accepts. */
export function resolvePath(path: Path | Keyframe[]): Path {
  return typeof path === "function" ? path : keyframePath(path);
}

/** A curve through points, walked at constant speed (by arc length) so the Spark does not bunch at corners. */
export function polyline(points: Point[]): (u: number) => Point {
  if (points.length === 0) throw new Error("polyline needs at least one point.");
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = lengths[lengths.length - 1];
  return (u) => {
    if (total === 0) return points[0];
    const d = clamp01(u) * total;
    let i = 1;
    while (i < points.length - 1 && lengths[i] < d) i++;
    const span = lengths[i] - lengths[i - 1];
    return mix(points[i - 1], points[i], span === 0 ? 1 : (d - lengths[i - 1]) / span);
  };
}

/**
 * Draws a curve: the Spark leaves its start at frame 0 and reaches the end of the curve at
 * `duration`. `curve` is a function of progress 0..1 or a list of points; `ease` shapes the pace.
 */
export function trace(curve: ((u: number) => Point) | Point[], opts: { duration: number; ease?: (t: number) => number }): Path {
  const c = typeof curve === "function" ? curve : polyline(curve);
  const ease = opts.ease ?? E.sine;
  return (t) => c(ease(clamp01(t / opts.duration)));
}

/**
 * Carries a value along a function: x runs from `from` to `to` over `duration` and the Spark sits
 * at y = fn(x). `map` turns that graph point into the composition's pixels (an Axes' world-to-screen
 * mapping); without one the point is used as pixels.
 */
export function carry(
  fn: (x: number) => number,
  from: number,
  to: number,
  opts: { duration: number; map?: (x: number, y: number) => Point; ease?: (t: number) => number },
): Path {
  const ease = opts.ease ?? E.sine;
  const map = opts.map ?? ((x: number, y: number) => ({ x, y }));
  return (t) => {
    const x = lerp(from, to, ease(clamp01(t / opts.duration)));
    return map(x, fn(x));
  };
}

/** Circles a target: `period` frames per turn, starting at `startAngle` (radians, 0 is to the right). */
export function orbit(target: Point, radius: number, opts: { period: number; startAngle?: number; clockwise?: boolean } = { period: 90 }): Path {
  const dir = opts.clockwise === false ? -1 : 1;
  return (t) => {
    const a = (opts.startAngle ?? 0) + dir * (2 * Math.PI * t) / opts.period;
    return { x: target.x + radius * Math.cos(a), y: target.y + radius * Math.sin(a) };
  };
}

/**
 * Splits into n Sparks: all n travel the parent path until `at`, then fan out evenly round a
 * circle of `spread` px, `duration` frames to get there. For probability: one Spark becomes
 * the outcomes. Returns one path per Spark.
 */
export function split(parent: Path, n: number, opts: { at: number; spread: number; duration?: number; startAngle?: number }): Path[] {
  const duration = opts.duration ?? 30;
  return Array.from({ length: n }, (_, i) => {
    const angle = (opts.startAngle ?? -Math.PI / 2) + (2 * Math.PI * i) / n;
    return (t: number) => {
      const origin = parent(Math.min(t, opts.at));
      if (t <= opts.at) return origin;
      const k = E.cinematic(clamp01((t - opts.at) / duration));
      return { x: origin.x + Math.cos(angle) * opts.spread * k, y: origin.y + Math.sin(angle) * opts.spread * k };
    };
  });
}

/**
 * Falls under gravity: starts at (x, y) with velocity (vx, vy) in px per frame, `g` px per frame
 * squared downwards. With `floorY` it stops there. This is the projectile, so a physics lesson
 * can fall the Spark with the numbers it is teaching.
 */
export function fall(g: number, start: Point & { vx?: number; vy?: number }, opts: { floorY?: number } = {}): Path {
  const vx = start.vx ?? 0;
  const vy = start.vy ?? 0;
  return (t) => {
    const y = start.y + vy * t + 0.5 * g * t * t;
    return { x: start.x + vx * t, y: opts.floorY === undefined ? y : Math.min(y, opts.floorY) };
  };
}

/**
 * Walks a pointer through places, one hop at a time: `hop` frames to move, `hold` frames resting
 * on each, so a viewer can read where it is. Pointers on an array, nodes of a graph.
 */
export function walk(points: Point[], opts: { hop: number; hold?: number; ease?: (t: number) => number }): Path {
  if (points.length === 0) throw new Error("walk needs at least one point.");
  const hold = opts.hold ?? 0;
  const ease = opts.ease ?? E.cinematic;
  const step = opts.hop + hold;
  return (t) => {
    if (t <= 0) return points[0];
    const i = Math.min(points.length - 1, Math.floor(t / step));
    if (i >= points.length - 1) return points[points.length - 1];
    const within = t - i * step;
    return mix(points[i], points[i + 1], ease(clamp01(within / opts.hop)));
  };
}

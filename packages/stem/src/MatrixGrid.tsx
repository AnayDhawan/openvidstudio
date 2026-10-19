import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, displayStack, type Subject } from "./designSystem";
import { lineWeight, type Box } from "./graph";
import type { Point } from "./paths";

export type Matrix2 = [[number, number], [number, number]];

export interface MatrixGridProps {
  /** The 2x2 matrix, rows first: `[[a, b], [c, d]]` sends (x, y) to (a x + b y, c x + d y). */
  matrix: number[][];
  /** Composition frame the picture appears and the transform starts. Default 0. */
  at?: number;
  /** Frames the plane takes to go from the identity to the matrix. Default 45. */
  duration?: number;
  /** Animate the transform. With false the plane is shown already transformed. Default true. */
  transform?: boolean;
  /** Shapes the progress 0..1. Default `E.cinematic`; pass `(t) => t` for a linear sweep. */
  ease?: (t: number) => number;
  /** The grid of points: `extent` is how far it reaches on each side of the origin and `spacing` the gap, both in graph units. Default 2 and 1. */
  grid?: { extent?: number; spacing?: number };
  /** Draw the unit square and its image, with the images of i-hat and j-hat as arrows. Default true. */
  unitSquare?: boolean;
  /** Draw the matrix in brackets above (portrait) or beside (landscape) the plane. Default true. */
  showMatrix?: boolean;
  /** Where the plane is drawn. Its centre is the origin. Default: the middle band of the frame. */
  box?: Box;
  /** Pixels per graph unit. Default: fits the grid, the unit square and their images inside the box. */
  scale?: number;
  /** Picks the accent. Default "math". */
  subject?: Subject;
}

export interface MatrixGridGeometry {
  box: Box;
  origin: Point;
  scale: number;
  /** A graph point to composition pixels (y is up in the graph). */
  toScreen: (x: number, y: number) => Point;
}

/** The identity moved `progress` of the way to `m`, entry by entry: the matrix on screen at that moment. */
export function interpolateMatrix(m: number[][], progress: number): Matrix2 {
  const id = [[1, 0], [0, 1]];
  const at = (r: number, c: number) => id[r][c] + (m[r][c] - id[r][c]) * progress;
  return [[at(0, 0), at(0, 1)], [at(1, 0), at(1, 1)]];
}

/** `m` applied to the point (x, y). */
export function applyMatrix(m: number[][], x: number, y: number): Point {
  return { x: m[0][0] * x + m[0][1] * y, y: m[1][0] * x + m[1][1] * y };
}

/** The default plane box: the middle band in portrait, the right-hand side in landscape (the matrix goes beside it). */
export function defaultMatrixBox(width: number, height: number): Box {
  return height > width
    ? { x: Math.round(width * 0.1), y: Math.round(height * 0.3), width: Math.round(width * 0.8), height: Math.round(height * 0.4) }
    : { x: Math.round(width * 0.4), y: Math.round(height * 0.14), width: Math.round(width * 0.56), height: Math.round(height * 0.7) };
}

/** The mapping the picture uses, from the same numbers the component is given, so a test can place any graph point. */
export function matrixGridGeometry(matrix: number[][], opts: { width: number; height: number; box?: Box; scale?: number; extent?: number }): MatrixGridGeometry {
  const box = opts.box ?? defaultMatrixBox(opts.width, opts.height);
  const extent = opts.extent ?? 2;
  let reach = Math.max(extent, 1);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const p = applyMatrix(matrix, sx * extent, sy * extent);
      reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y));
    }
  }
  const scale = opts.scale ?? (Math.min(box.width, box.height) / 2 / (reach * 1.12));
  const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return { box, origin, scale, toScreen: (x, y) => ({ x: origin.x + x * scale, y: origin.y - y * scale }) };
}

const fmt = (v: number) => String(Number(v.toFixed(2)));

const Arrow: React.FC<{ from: Point; to: Point; color: string; weight: number; name: string }> = ({ from, to, color, weight, name }) => {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const dx = len < 1e-6 ? 0 : (to.x - from.x) / len;
  const dy = len < 1e-6 ? 0 : (to.y - from.y) / len;
  const head = Math.min(weight * 5, len * 0.6);
  const base = { x: to.x - dx * head, y: to.y - dy * head };
  const half = head * 0.55;
  return (
    <g data-ovs-basis={name} data-ovs-tip-x={to.x} data-ovs-tip-y={to.y}>
      <line x1={from.x} y1={from.y} x2={base.x} y2={base.y} stroke={color} strokeWidth={weight * 1.6} />
      <polygon points={`${to.x},${to.y} ${base.x - dy * half},${base.y + dx * half} ${base.x + dy * half},${base.y - dx * half}`} fill={color} />
    </g>
  );
};

/**
 * A matrix acting on the plane. A grid of points (and the lines through them), the unit square and
 * the images of i-hat and j-hat move from the identity to the matrix: every entry is interpolated
 * linearly from the identity, so each frame shows the plane under `I + p (M - I)` and the last one
 * exactly `M`. Honest: a point (x, y) is drawn at `toScreen(M * (x, y))`, `scale` px per unit, and
 * the square's orientation flips when the determinant is negative. A pure function of the frame.
 */
export const MatrixGrid: React.FC<MatrixGridProps> = ({ matrix, at = 0, duration = 45, transform = true, ease = E.cinematic, grid, unitSquare = true, showMatrix = true, box, scale, subject = "math" }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (matrix.length !== 2 || matrix.some((r) => r.length !== 2)) throw new Error("MatrixGrid: the matrix must be 2x2, like [[2, 1], [0, 1]].");
  if (frame < at) return null;
  const weight = lineWeight(width, height);
  const accent = SUBJECT_ACCENT[subject].accent;
  const extent = grid?.extent ?? 2;
  const spacing = grid?.spacing ?? 1;
  const geo = matrixGridGeometry(matrix, { width, height, box, scale, extent });
  const progress = transform ? tween(frame, [at, at + duration], [0, 1], ease) : 1;
  const m = interpolateMatrix(matrix, progress);
  const show = tween(frame, [at, at + 8], [0, 1], E.cinematic);
  const screen = (x: number, y: number) => {
    const p = applyMatrix(m, x, y);
    return geo.toScreen(p.x, p.y);
  };
  const steps: number[] = [];
  for (let v = -extent; v <= extent + 1e-9; v += spacing) steps.push(Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(10)));
  const minSide = Math.min(width, height);
  const entryPx = Math.round(minSide * 0.042);
  const colW = entryPx * 2.2;
  const rowH = entryPx * 1.5;
  const portrait = height > width;
  const mc = portrait ? { x: width / 2, y: Math.round(height * 0.22) } : { x: Math.round(width * 0.2), y: Math.round(height * 0.5) };
  const bw = colW * 2 + entryPx * 0.8;
  const bh = rowH * 2;
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => screen(x, y));
  const area = sq.reduce((s, p, i) => s + (p.x * sq[(i + 1) % 4].y - sq[(i + 1) % 4].x * p.y), 0);
  // Screen y points down, so a positive area here is a clockwise (flipped) square.
  const flipped = area > 0;
  const o = screen(0, 0);
  const ghost = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => geo.toScreen(x, y));
  const poly = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
  const bracket = (side: -1 | 1) => {
    const x = mc.x + side * bw / 2;
    const t = mc.y - bh / 2;
    const b = mc.y + bh / 2;
    const k = entryPx * 0.35;
    return `M${x - side * k},${t} L${x},${t} L${x},${b} L${x - side * k},${b}`;
  };
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: show }} data-ovs-matrixgrid="" data-ovs-progress={progress}>
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
        <g data-ovs-gridlines="">
          {steps.map((v) => {
            const a = screen(v, -extent);
            const b = screen(v, extent);
            const c = screen(-extent, v);
            const d = screen(extent, v);
            return (
              <g key={v} stroke={VOID.textDim} strokeOpacity={v === 0 ? 0.55 : 0.28} strokeWidth={weight}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                <line x1={c.x} y1={c.y} x2={d.x} y2={d.y} />
              </g>
            );
          })}
        </g>
        {steps.flatMap((x) => steps.map((y) => {
          const p = screen(x, y);
          return <circle key={`${x},${y}`} data-ovs-point={`${x},${y}`} data-ovs-sx={p.x} data-ovs-sy={p.y} cx={p.x} cy={p.y} r={weight * 1.4} fill={VOID.textDim} />;
        }))}
        {unitSquare && (
          <g>
            <polygon data-ovs-ghost="" points={poly(ghost)} fill="none" stroke={VOID.textDim} strokeWidth={weight} strokeDasharray={`${weight * 2.5} ${weight * 2}`} strokeOpacity={0.7} />
            <polygon data-ovs-unit-square="" data-ovs-orientation={flipped ? "flipped" : "preserved"} points={poly(sq)} fill={accent} fillOpacity={0.2} stroke={accent} strokeWidth={weight} strokeLinejoin="round" />
            {sq.map((p, i) => <circle key={i} data-ovs-corner={i} data-ovs-sx={p.x} data-ovs-sy={p.y} cx={p.x} cy={p.y} r={weight * 1.4} fill={accent} />)}
            <Arrow from={o} to={screen(1, 0)} color={accent} weight={weight} name="i" />
            <Arrow from={o} to={screen(0, 1)} color={VOID.text} weight={weight} name="j" />
          </g>
        )}
        <circle data-ovs-origin="" data-ovs-sx={o.x} data-ovs-sy={o.y} cx={o.x} cy={o.y} r={weight * 2} fill={VOID.text} />
        {showMatrix && (
          <g data-ovs-matrix="">
            <path d={bracket(-1)} fill="none" stroke={VOID.textDim} strokeWidth={weight} />
            <path d={bracket(1)} fill="none" stroke={VOID.textDim} strokeWidth={weight} />
            {matrix.flatMap((row, r) => row.map((v, c) => (
              <text key={`${r}${c}`} data-ovs-entry={`${r},${c}`} x={mc.x + (c - 0.5) * colW} y={mc.y + (r - 0.5) * rowH + entryPx * 0.35} textAnchor="middle" fontSize={entryPx} fill={VOID.text} fontFamily={displayStack()} fontWeight={500}>{fmt(v)}</text>
            )))}
            <text x={mc.x} y={mc.y - bh / 2 - entryPx * 0.5} textAnchor="middle" fontSize={Math.round(minSide * 0.026)} fill={VOID.textDim} fontFamily={bodyStack()}>{`det = ${fmt(matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0])}`}</text>
          </g>
        )}
      </svg>
    </div>
  );
};

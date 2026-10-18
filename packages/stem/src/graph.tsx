// Graph primitives for lessons: Axes, Plot and NumberLine. Axes owns the world-to-screen mapping and
// hands it to its children through context, so a Plot, a Spark's path or a label can be placed in
// graph coordinates. Pure functions of the frame, sizes from useVideoConfig(), strokes never thinner
// than lineWeight(). Nothing here glows: the Spark is the one thing that does.

import React, { createContext, useContext, useId } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, type Subject } from "./designSystem";
import type { Point } from "./paths";

/**
 * The thinnest line any graph primitive draws, px. 3 at 1080 on the shorter side, scaling with the
 * frame, because a one pixel hairline disappears when a phone downsizes a reel.
 */
export function lineWeight(width: number, height: number): number {
  return Math.max(3, Math.round(Math.min(width, height) / 360));
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AxesGeometry {
  box: Box;
  xRange: [number, number];
  yRange: [number, number];
  /** Graph point to composition pixels. */
  toScreen: (x: number, y: number) => Point;
  /** Composition pixels back to a graph point. */
  toWorld: (px: number, py: number) => Point;
  /** The thinnest stroke to draw, px. */
  weight: number;
  accent: string;
}

const AxesContext = createContext<AxesGeometry | null>(null);

/** The mapping of the enclosing <Axes>. Throws a clear error outside one. */
export function useAxes(): AxesGeometry {
  const axes = useContext(AxesContext);
  if (!axes) throw new Error("useAxes, Plot and anything placed in graph coordinates must be a child of <Axes>.");
  return axes;
}

function makeGeometry(box: Box, xRange: [number, number], yRange: [number, number], weight: number, accent: string): AxesGeometry {
  const xSpan = xRange[1] - xRange[0];
  const ySpan = yRange[1] - yRange[0];
  return {
    box,
    xRange,
    yRange,
    weight,
    accent,
    toScreen: (x, y) => ({ x: box.x + ((x - xRange[0]) / xSpan) * box.width, y: box.y + box.height - ((y - yRange[0]) / ySpan) * box.height }),
    toWorld: (px, py) => ({ x: xRange[0] + ((px - box.x) / box.width) * xSpan, y: yRange[0] + ((box.y + box.height - py) / box.height) * ySpan }),
  };
}

/** Round ticks across a range: `step` apart, starting from the first multiple of it inside the range. */
function ticksOf(range: [number, number], step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(range[0] / step - 1e-9) * step;
  for (let v = first; v <= range[1] + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(10)));
  return out;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3))));

/** A plot box that suits the frame: wide margins, the middle band of the height. */
function defaultBox(width: number, height: number): Box {
  const portrait = height > width;
  const x = Math.round(width * 0.14);
  return portrait
    ? { x, y: Math.round(height * 0.3), width: width - 2 * x, height: Math.round(width * 0.78) }
    : { x, y: Math.round(height * 0.14), width: width - 2 * x, height: Math.round(height * 0.66) };
}

export interface AxesProps {
  /** Where the plot area sits, composition px. Default: a box sized to the frame. */
  box?: Box;
  xRange: [number, number];
  yRange: [number, number];
  /** Distance between ticks in graph units. Default: a round step giving about five. */
  xStep?: number;
  yStep?: number;
  xLabel?: string;
  yLabel?: string;
  /** Draw gridlines at the ticks, in the dim token. Default true. */
  grid?: boolean;
  /** Picks the accent children use. Default "math". */
  subject?: Subject;
  children?: React.ReactNode;
}

function niceStep(span: number): number {
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

export const Axes: React.FC<AxesProps> = ({ box, xRange, yRange, xStep, yStep, xLabel, yLabel, grid = true, subject = "math", children }) => {
  const { width, height } = useVideoConfig();
  const weight = lineWeight(width, height);
  const accent = SUBJECT_ACCENT[subject].accent;
  const g = makeGeometry(box ?? defaultBox(width, height), xRange, yRange, weight, accent);
  const xs = ticksOf(xRange, xStep ?? niceStep(xRange[1] - xRange[0]));
  const ys = ticksOf(yRange, yStep ?? niceStep(yRange[1] - yRange[0]));
  const origin = g.toScreen(xRange[0] <= 0 && xRange[1] >= 0 ? 0 : xRange[0], yRange[0] <= 0 && yRange[1] >= 0 ? 0 : yRange[0]);
  const label = Math.round(Math.min(width, height) * 0.024);
  const tick = weight * 3;
  const { box: b } = g;
  return (
    <AxesContext.Provider value={g}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-axes="">
        <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
          {grid &&
            xs.map((v) => <line key={`gx${v}`} x1={g.toScreen(v, 0).x} x2={g.toScreen(v, 0).x} y1={b.y} y2={b.y + b.height} stroke={VOID.textDim} strokeWidth={weight} opacity={0.22} />)}
          {grid &&
            ys.map((v) => <line key={`gy${v}`} y1={g.toScreen(0, v).y} y2={g.toScreen(0, v).y} x1={b.x} x2={b.x + b.width} stroke={VOID.textDim} strokeWidth={weight} opacity={0.22} />)}
          <line data-ovs-axis="x" x1={b.x} x2={b.x + b.width} y1={origin.y} y2={origin.y} stroke={VOID.textDim} strokeWidth={weight} />
          <line data-ovs-axis="y" x1={origin.x} x2={origin.x} y1={b.y} y2={b.y + b.height} stroke={VOID.textDim} strokeWidth={weight} />
          {xs.map((v) => {
            const p = g.toScreen(v, 0);
            return (
              <g key={`tx${v}`}>
                <line x1={p.x} x2={p.x} y1={origin.y - tick / 2} y2={origin.y + tick / 2} stroke={VOID.textDim} strokeWidth={weight} />
                <text x={p.x} y={origin.y + tick / 2 + label * 1.15} textAnchor="middle" fontSize={label} fill={VOID.textDim} fontFamily={bodyStack()}>{fmt(v)}</text>
              </g>
            );
          })}
          {ys.map((v) => {
            const p = g.toScreen(0, v);
            return (
              <g key={`ty${v}`}>
                <line x1={origin.x - tick / 2} x2={origin.x + tick / 2} y1={p.y} y2={p.y} stroke={VOID.textDim} strokeWidth={weight} />
                <text x={origin.x - tick / 2 - label * 0.4} y={p.y + label * 0.35} textAnchor="end" fontSize={label} fill={VOID.textDim} fontFamily={bodyStack()}>{fmt(v)}</text>
              </g>
            );
          })}
          {xLabel && <text x={b.x + b.width} y={origin.y + tick / 2 + label * 2.7} textAnchor="end" fontSize={label * 1.1} fill={VOID.text} fontFamily={bodyStack()}>{xLabel}</text>}
          {yLabel && <text x={origin.x + tick} y={b.y + label} textAnchor="start" fontSize={label * 1.1} fill={VOID.text} fontFamily={bodyStack()}>{yLabel}</text>}
        </svg>
        {children}
      </div>
    </AxesContext.Provider>
  );
};

export interface PlotPoint {
  x: number;
  label?: string;
}

export interface PlotProps {
  /** y = f(x). Values that are not finite break the line. */
  fn: (x: number) => number;
  /** The x-values to draw over. Default: the axes' whole x range. */
  domain?: [number, number];
  /** How many samples across the domain. Default 240, enough to look smooth at a phone's size. */
  samples?: number;
  /** 0 to 1, how much of the curve is drawn. Overrides at/duration. Default 1. */
  progress?: number;
  /** Draw-on starts at this composition frame, taking `duration` frames. */
  at?: number;
  duration?: number;
  /** Defaults to the subject accent of the enclosing Axes. */
  color?: string;
  /** A tangent line at x, once the curve has reached it. */
  tangent?: { at: number; /** half-length in x units, default a sixth of the range */ span?: number; color?: string };
  /** Shade between the curve and the x axis from one x to another, as far as the curve has been drawn. */
  area?: { from: number; to: number; color?: string };
  /** Dots on the curve, appearing as it reaches them. */
  points?: PlotPoint[];
}

export const Plot: React.FC<PlotProps> = ({ fn, domain, samples = 240, progress, at = 0, duration, color, tangent, area, points = [] }) => {
  const g = useAxes();
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const clipId = `ovs-plot-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [d0, d1] = domain ?? g.xRange;
  const p = progress ?? (duration && duration > 0 ? tween(frame, [at, at + duration], [0, 1], E.sine) : 1);
  const tint = color ?? g.accent;
  const reach = d0 + (d1 - d0) * Math.max(0, Math.min(1, p));
  const n = Math.max(2, Math.round(samples * Math.max(0, Math.min(1, p))));
  const sample = (x: number) => g.toScreen(x, fn(x));
  let d = "";
  let pen = false;
  // Nothing is drawn before the draw-on starts: a zero-length path with round caps would still leave a dot.
  for (let i = 0; i <= (p > 0 ? n : -1); i++) {
    const x = d0 + ((reach - d0) * i) / n;
    const y = fn(x);
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    const s = g.toScreen(x, y);
    d += `${pen ? "L" : "M"}${s.x.toFixed(2)} ${s.y.toFixed(2)} `;
    pen = true;
  }
  const slopeAt = (x: number) => {
    const h = (d1 - d0) * 1e-4;
    return (fn(x + h) - fn(x - h)) / (2 * h);
  };
  const lw = g.weight;
  const label = Math.round(Math.min(width, height) * 0.026);
  let areaPath = "";
  if (area && p > 0) {
    const a = Math.max(area.from, d0);
    const b = Math.min(area.to, reach);
    if (b > a) {
      const m = Math.max(2, Math.round(samples * ((b - a) / (d1 - d0))));
      const top = Array.from({ length: m + 1 }, (_, i) => g.toScreen(a + ((b - a) * i) / m, fn(a + ((b - a) * i) / m)));
      areaPath = `M${g.toScreen(a, 0).x} ${g.toScreen(a, 0).y} ` + top.map((s) => `L${s.x.toFixed(2)} ${s.y.toFixed(2)}`).join(" ") + ` L${g.toScreen(b, 0).x} ${g.toScreen(b, 0).y} Z`;
    }
  }
  const tan = tangent && reach >= tangent.at ? tangent : null;
  const tanSpan = tan ? (tan.span ?? (g.xRange[1] - g.xRange[0]) / 6) : 0;
  const tanA = tan ? g.toScreen(tan.at - tanSpan, fn(tan.at) - slopeAt(tan.at) * tanSpan) : null;
  const tanB = tan ? g.toScreen(tan.at + tanSpan, fn(tan.at) + slopeAt(tan.at) * tanSpan) : null;
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
      <defs>
        <clipPath id={clipId}>
          <rect x={g.box.x} y={g.box.y} width={g.box.width} height={g.box.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {areaPath && <path data-ovs-plot="area" d={areaPath} fill={area?.color ?? tint} opacity={0.2} stroke="none" />}
        {d && <path data-ovs-plot="curve" d={d} fill="none" stroke={tint} strokeWidth={lw * 1.7} strokeLinecap="round" strokeLinejoin="round" />}
        {tanA && tanB && <line data-ovs-plot="tangent" x1={tanA.x} y1={tanA.y} x2={tanB.x} y2={tanB.y} stroke={tan?.color ?? VOID.text} strokeWidth={lw * 1.3} strokeLinecap="round" />}
      </g>
      {points.filter((pt) => reach >= pt.x).map((pt, i) => {
        const s = sample(pt.x);
        return (
          <g key={i} data-ovs-plot="point">
            <circle cx={s.x} cy={s.y} r={lw * 2.4} fill={VOID.text} stroke={tint} strokeWidth={lw} />
            {pt.label && <text x={s.x + lw * 4} y={s.y - lw * 4} fontSize={label} fill={VOID.text} fontFamily={bodyStack()}>{pt.label}</text>}
          </g>
        );
      })}
    </svg>
  );
};

export interface NumberLineGeometry {
  toScreen: (value: number) => Point;
  range: [number, number];
  weight: number;
  accent: string;
}
const NumberLineContext = createContext<NumberLineGeometry | null>(null);
/** The mapping of the enclosing <NumberLine>, so a Spark can ride it. */
export function useNumberLine(): NumberLineGeometry {
  const line = useContext(NumberLineContext);
  if (!line) throw new Error("useNumberLine must be used inside <NumberLine>.");
  return line;
}

export interface NumberLineProps {
  /** The line's left end, top edge and length, composition px. Default: across the frame, a third down. */
  box?: { x: number; y: number; width: number };
  range: [number, number];
  step?: number;
  /** Labelled points. */
  points?: { value: number; label?: string }[];
  /** Highlighted intervals; an open end is drawn as a hollow circle. */
  intervals?: { from: number; to: number; openFrom?: boolean; openTo?: boolean }[];
  /** An arrow pointing at a value from above. */
  arrow?: { value: number; label?: string };
  subject?: Subject;
  /** Anything placed on the line, such as a Spark with a path built from useNumberLine().toScreen. */
  children?: React.ReactNode;
}

export const NumberLine: React.FC<NumberLineProps> = ({ box, range, step, points = [], intervals = [], arrow, subject = "math", children }) => {
  const { width, height } = useVideoConfig();
  const weight = lineWeight(width, height);
  const accent = SUBJECT_ACCENT[subject].accent;
  const b = box ?? { x: Math.round(width * 0.1), y: Math.round(height * 0.34), width: Math.round(width * 0.8) };
  const toScreen = (v: number): Point => ({ x: b.x + ((v - range[0]) / (range[1] - range[0])) * b.width, y: b.y });
  const ticks = ticksOf(range, step ?? niceStep(range[1] - range[0]));
  const label = Math.round(Math.min(width, height) * 0.026);
  const tick = weight * 4;
  const value = { toScreen, range, weight, accent };
  return (
    <NumberLineContext.Provider value={value}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-numberline="">
        <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
          <line data-ovs-axis="line" x1={b.x} x2={b.x + b.width} y1={b.y} y2={b.y} stroke={VOID.textDim} strokeWidth={weight} />
          {ticks.map((v) => (
            <g key={v}>
              <line x1={toScreen(v).x} x2={toScreen(v).x} y1={b.y - tick / 2} y2={b.y + tick / 2} stroke={VOID.textDim} strokeWidth={weight} />
              <text x={toScreen(v).x} y={b.y + tick / 2 + label * 1.2} textAnchor="middle" fontSize={label} fill={VOID.textDim} fontFamily={bodyStack()}>{fmt(v)}</text>
            </g>
          ))}
          {intervals.map((iv, i) => (
            <g key={`iv${i}`} data-ovs-interval="">
              <line x1={toScreen(iv.from).x} x2={toScreen(iv.to).x} y1={b.y} y2={b.y} stroke={accent} strokeWidth={weight * 2.2} strokeLinecap="butt" />
              <circle cx={toScreen(iv.from).x} cy={b.y} r={weight * 2.6} fill={iv.openFrom ? VOID.base : accent} stroke={accent} strokeWidth={weight} />
              <circle cx={toScreen(iv.to).x} cy={b.y} r={weight * 2.6} fill={iv.openTo ? VOID.base : accent} stroke={accent} strokeWidth={weight} />
            </g>
          ))}
          {points.map((pt, i) => (
            <g key={`pt${i}`} data-ovs-point="">
              <circle cx={toScreen(pt.value).x} cy={b.y} r={weight * 2.6} fill={VOID.text} stroke={accent} strokeWidth={weight} />
              {pt.label && <text x={toScreen(pt.value).x} y={b.y - tick - label * 0.3} textAnchor="middle" fontSize={label * 1.1} fill={VOID.text} fontFamily={bodyStack()}>{pt.label}</text>}
            </g>
          ))}
          {arrow && (() => {
            const s = toScreen(arrow.value);
            const len = label * 2.4;
            return (
              <g data-ovs-arrow="">
                <line x1={s.x} y1={b.y - len * 1.6} x2={s.x} y2={b.y - weight * 3} stroke={VOID.text} strokeWidth={weight * 1.3} strokeLinecap="round" />
                <path d={`M${s.x - weight * 3} ${b.y - weight * 6} L${s.x} ${b.y - weight * 2} L${s.x + weight * 3} ${b.y - weight * 6}`} fill="none" stroke={VOID.text} strokeWidth={weight * 1.3} strokeLinecap="round" strokeLinejoin="round" />
                {arrow.label && <text x={s.x} y={b.y - len * 1.6 - label * 0.4} textAnchor="middle" fontSize={label * 1.1} fill={VOID.text} fontFamily={bodyStack()}>{arrow.label}</text>}
              </g>
            );
          })()}
        </svg>
        {children}
      </div>
    </NumberLineContext.Provider>
  );
};

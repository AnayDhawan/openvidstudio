import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, displayStack } from "./designSystem";
import { Axes, Plot, useAxes, type Box } from "./graph";

export type ComplexityKind = "n" | "nlogn" | "n2";

export interface ComplexityCurveProps {
  /** Which curves to draw, in this order. Default all three: "n", "nlogn", "n2". */
  curves?: ComplexityKind[];
  /** The input size to mark: a vertical rule, a dot on each curve and its value. Left out, no marker. */
  n?: number;
  /** The right end of the x axis. Default 1.5 x `n`, or 16 without a marker. */
  xMax?: number;
  /** The top of the y axis. Default 1.25 x the largest curve's value at `n` (so the marker is in view and the steep curve leaves the top), or the largest value at `xMax` without a marker. */
  yMax?: number;
  /** Composition frame the draw-on starts. Default 0. */
  at?: number;
  /** Frames the curves take to draw on. Default 60. */
  duration?: number;
  /** Where the plot sits, composition px. Default: a box sized to the frame. */
  box?: Box;
  /** Name each curve at its end and write the values at the marker. Default true. */
  labels?: boolean;
}

/** Operation counts. `log` is base 2. `n log n` is drawn as 0 for n at or below 1, where log2 n is not positive. */
export function complexityValue(kind: ComplexityKind, n: number): number {
  if (kind === "n") return n;
  if (kind === "n2") return n * n;
  return n > 1 ? n * Math.log2(n) : 0;
}

export const COMPLEXITY_NAMES: Record<ComplexityKind, string> = { n: "n", nlogn: "n log n", n2: "n²" };

/** One accent per curve: green for n, the cs violet for n log n, red for n squared. */
export const COMPLEXITY_COLORS: Record<ComplexityKind, string> = { n: SUBJECT_ACCENT.biology.accent, nlogn: SUBJECT_ACCENT.cs.accent, n2: SUBJECT_ACCENT.chemistry.accent };

const fmtValue = (v: number) => String(Number(v.toFixed(v < 10 ? 2 : 1)));

const Decorations: React.FC<{ kinds: ComplexityKind[]; n?: number; at: number; duration: number; labels: boolean }> = ({ kinds, n, at, duration, labels }) => {
  const g = useAxes();
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const p = tween(frame, [at, at + duration], [0, 1], E.sine);
  const font = Math.round(Math.min(width, height) * 0.03);
  const [x0, x1] = g.xRange;
  const [, yTop] = g.yRange;
  const lw = g.weight;
  const reach = x0 + (x1 - x0) * p;
  const done = p >= 0.999;
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
      {labels &&
        done &&
        kinds.map((k) => {
          // Where the curve ends inside the box: at the right edge, or where it leaves through the top.
          let xe = x1;
          if (complexityValue(k, x1) > yTop) {
            let lo = x0;
            let hi = x1;
            for (let i = 0; i < 40; i++) {
              const mid = (lo + hi) / 2;
              if (complexityValue(k, mid) > yTop) hi = mid;
              else lo = mid;
            }
            xe = lo;
          }
          const s = g.toScreen(xe, Math.min(complexityValue(k, xe), yTop));
          const top = s.y <= g.box.y + 1;
          return (
            <text key={k} data-ovs-curve-label={k} x={s.x - font * 0.4} y={top ? s.y + font * 1.2 : s.y - font * 0.6} textAnchor="end" fontSize={font} fontWeight={700} fill={COMPLEXITY_COLORS[k]} fontFamily={displayStack()}>
              {COMPLEXITY_NAMES[k]}
            </text>
          );
        })}
      {n !== undefined && reach >= n && (
        <g data-ovs-marker="">
          <line data-ovs-marker-rule="" x1={g.toScreen(n, 0).x} x2={g.toScreen(n, 0).x} y1={g.box.y} y2={g.toScreen(n, 0).y} stroke={VOID.text} strokeWidth={lw} strokeDasharray={`${lw * 3} ${lw * 2.5}`} />
          {labels && (
            <text x={g.toScreen(n, 0).x + font * 0.4} y={g.box.y + font} fontSize={font} fill={VOID.text} fontFamily={bodyStack()}>{`n = ${fmtValue(n)}`}</text>
          )}
        </g>
      )}
    </svg>
  );
};

/**
 * n, n log n and n squared drawn together on shared axes, with an optional marker at a chosen n: a rule, a
 * dot on each curve and the value there. Built from `Axes` and `Plot`. The log is base 2. Curves that climb
 * past `yMax` leave through the top of the plot (clipped). A pure function of the frame.
 */
export const ComplexityCurve: React.FC<ComplexityCurveProps> = ({ curves = ["n", "nlogn", "n2"], n, xMax, yMax, at = 0, duration = 60, box, labels = true }) => {
  const right = xMax ?? (n !== undefined ? n * 1.5 : 16);
  const top = yMax ?? Math.max(...curves.map((k) => complexityValue(k, n !== undefined ? n : right))) * (n !== undefined ? 1.25 : 1);
  return (
    <div data-ovs-complexity="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <Axes box={box} xRange={[0, right]} yRange={[0, top]} xLabel="n (input size)" yLabel="operations" subject="cs">
        {curves.map((k) => (
          <Plot key={k} fn={(x) => complexityValue(k, x)} at={at} duration={duration} color={COMPLEXITY_COLORS[k]} points={n !== undefined ? [{ x: n, label: labels ? fmtValue(complexityValue(k, n)) : undefined }] : []} />
        ))}
        <Decorations kinds={curves} n={n} at={at} duration={duration} labels={labels} />
      </Axes>
    </div>
  );
};

import React, { createContext, useContext } from "react";
import { useVideoConfig } from "remotion";
import { SUBJECT_ACCENT, VOID, bodyStack, displayStack } from "./designSystem";
import { lineWeight } from "./graph";
import { Spark } from "./Spark";
import { keyframePath, type Keyframe, type Path, type Point } from "./paths";
import { useCurrentFrame } from "remotion";

export interface ArrayPointer {
  /** Shown under the pointer: "low", "high", "mid". */
  name: string;
  /** The cell it points at, or keyframes `{ frame, index }` to move it (eased, fractional between cells). */
  index: number | { frame: number; index: number }[];
  color?: string;
  /** Draw this pointer's tip as the Spark, so its move leaves a trail. At most one pointer may. */
  spark?: boolean;
}

export interface ArrayVizProps {
  values: (number | string)[];
  pointers?: ArrayPointer[];
  /** Cells to fill with the accent, inclusive on both ends: the range still in play. */
  highlights?: { from: number; to: number; color?: string }[];
  /** Cells to dim, inclusive: what has been ruled out. */
  dimmed?: { from: number; to: number }[];
  /** Top-left of the row. Default: centred across the frame, 45% down. */
  origin?: Point;
  /** Side of one cell, px. Default: fits the row in 84% of the width, never more than 11% of the shorter side. */
  cellSize?: number;
  /** Picks the accent. Default "cs". */
  subject?: "math" | "physics" | "cs" | "chemistry" | "biology";
  children?: React.ReactNode;
}

export interface ArrayGeometry {
  cellSize: number;
  left: number;
  top: number;
  /** The centre of cell `i` (fractional i is between cells). */
  cellCenter: (i: number) => Point;
}

const ArrayContext = createContext<ArrayGeometry | null>(null);
/** The geometry of the enclosing <ArrayViz>, so a Spark can be walked across its cells. */
export function useArrayViz(): ArrayGeometry {
  const g = useContext(ArrayContext);
  if (!g) throw new Error("useArrayViz must be used inside <ArrayViz>.");
  return g;
}

const indexAt = (pointer: ArrayPointer, frame: number): number => {
  if (typeof pointer.index === "number") return pointer.index;
  const keys: Keyframe[] = pointer.index.map((k) => ({ frame: k.frame, x: k.index, y: 0 }));
  return keyframePath(keys)(frame).x;
};

/**
 * A row of cells holding values, with named pointers (low, high, mid), a highlighted range and a
 * dimmed one: enough to teach binary search and a sorting pass. A pointer can be the Spark, so its
 * move across the cells leaves a trail. One idea on screen: at most one thing moves.
 */
export const ArrayViz: React.FC<ArrayVizProps> = ({ values, pointers = [], highlights = [], dimmed = [], origin, cellSize, subject = "cs", children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const weight = lineWeight(width, height);
  const accent = SUBJECT_ACCENT[subject].accent;
  const n = values.length;
  const cell = cellSize ?? Math.min(Math.floor((width * 0.84) / Math.max(1, n)), Math.round(Math.min(width, height) * 0.11));
  const left = origin?.x ?? Math.round((width - n * cell) / 2);
  const top = origin?.y ?? Math.round(height * 0.45);
  const geometry: ArrayGeometry = { cellSize: cell, left, top, cellCenter: (i) => ({ x: left + (i + 0.5) * cell, y: top + cell / 2 }) };
  const sparks = pointers.filter((p) => p.spark);
  if (sparks.length > 1) throw new Error("ArrayViz: at most one pointer can be the Spark (one glowing element at a time).");
  const inAny = (ranges: { from: number; to: number }[], i: number) => ranges.some((r) => i >= r.from && i <= r.to);
  const fontPx = Math.round(cell * 0.38);
  const labelPx = Math.round(Math.min(width, height) * 0.026);
  const tri = cell * 0.2;
  const palette = [accent, "#FFB347", "#FF4D5E", "#7CFFB2"];
  const sparkPointer = sparks[0];
  const sparkPath: Path | null = sparkPointer
    ? (t: number) => {
        const p = geometry.cellCenter(indexAt(sparkPointer, t));
        return { x: p.x, y: top + cell + tri * 1.4 };
      }
    : null;
  return (
    <ArrayContext.Provider value={geometry}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-arrayviz="">
        <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
          {values.map((v, i) => {
            const hl = highlights.find((h) => i >= h.from && i <= h.to);
            const faded = inAny(dimmed, i);
            return (
              <g key={i} data-ovs-cell={i} opacity={faded ? 0.3 : 1}>
                <rect x={left + i * cell + weight / 2} y={top + weight / 2} width={cell - weight} height={cell - weight} rx={cell * 0.08} fill={hl ? (hl.color ?? accent) : VOID.panel} fillOpacity={hl ? 0.3 : 1} stroke={hl ? (hl.color ?? accent) : VOID.textDim} strokeWidth={weight} strokeOpacity={hl ? 1 : 0.6} />
                <text x={left + (i + 0.5) * cell} y={top + cell / 2 + fontPx * 0.35} textAnchor="middle" fontSize={fontPx} fill={VOID.text} fontFamily={displayStack()} fontWeight={500}>{String(v)}</text>
                <text x={left + (i + 0.5) * cell} y={top - labelPx * 0.5} textAnchor="middle" fontSize={labelPx} fill={VOID.textDim} fontFamily={bodyStack()}>{i}</text>
              </g>
            );
          })}
          {pointers.map((p, k) => {
            const c = geometry.cellCenter(indexAt(p, frame));
            const color = p.color ?? palette[k % palette.length];
            const base = top + cell + tri * 0.6;
            return (
              <g key={p.name} data-ovs-pointer={p.name}>
                {!p.spark && <polygon data-ovs-pointer-tip="" points={`${c.x},${base} ${c.x - tri},${base + tri * 1.5} ${c.x + tri},${base + tri * 1.5}`} fill={color} />}
                <text x={c.x} y={base + tri * 1.5 + labelPx * 1.25} textAnchor="middle" fontSize={labelPx * 1.1} fill={color} fontFamily={displayStack()} fontWeight={700}>{p.name}</text>
              </g>
            );
          })}
        </svg>
        {sparkPointer && sparkPath && <Spark path={sparkPath} trail={14} color={sparkPointer.color ?? palette[pointers.indexOf(sparkPointer) % palette.length]} size={Math.max(4, Math.round(tri))} />}
        {children}
      </div>
    </ArrayContext.Provider>
  );
};

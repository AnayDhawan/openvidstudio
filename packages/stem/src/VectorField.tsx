import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT } from "./designSystem";
import { lineWeight, useAxes, type AxesGeometry, type Box } from "./graph";
import type { Point } from "./paths";

export interface VectorFieldProps {
  /** The field: a graph point to the vector there, `[fx, fy]`, y up. Return `[0, 0]` where it is undefined. */
  field: (x: number, y: number) => [number, number];
  /** Where the field is drawn, graph units. Used when the field is not inside an <Axes>. Default [-1, 1]. */
  xRange?: [number, number];
  yRange?: [number, number];
  /** Where it is drawn, composition px, when not inside an <Axes> (inside one, the Axes' box is used). Default: a box sized to the frame. */
  box?: Box;
  /** Arrows per row and column. `rows` default: as many as keep the cells square. Default 7 columns. */
  grid?: { columns: number; rows?: number };
  /**
   * Pixels per unit of field magnitude. An arrow is exactly `|f| * scale` px from tail to tip (no
   * caps, no normalising, unless `normalize` or `maxLength` is given). Default: the longest arrow on the grid is 80% of a cell.
   */
  scale?: number;
  /** Draw every arrow this many px long, direction only. Arrow length then no longer says anything about |f|. */
  normalize?: number;
  /** Cap arrows at this many px. A capped arrow is shorter than `|f| * scale`. */
  maxLength?: number;
  /** Also trace field lines (streamlines) from the seeds, drawn on after the arrows. Default false. */
  fieldLines?: boolean;
  /** Where field lines start, in graph units. Each is traced both ways. Default: every other grid point. */
  seeds?: [number, number][];
  /** Colour of the arrows. Default the physics accent. */
  color?: string;
  /** Colour of the field lines. Default the physics ember. */
  lineColor?: string;
  /** Composition frame the arrows start to grow. Default 0. */
  at?: number;
  /** Frames the field lines take to draw on, after the arrows. Default 45. */
  lineDuration?: number;
}

/** Frames the arrows take to grow to full length. */
export const FIELD_ARROW_FRAMES = 20;

function defaultBox(width: number, height: number): Box {
  const x = Math.round(width * 0.14);
  return height > width
    ? { x, y: Math.round(height * 0.3), width: width - 2 * x, height: Math.round(width * 0.78) }
    : { x, y: Math.round(height * 0.14), width: width - 2 * x, height: Math.round(height * 0.66) };
}

function ownGeometry(box: Box, xRange: [number, number], yRange: [number, number], weight: number, accent: string): AxesGeometry {
  const xs = xRange[1] - xRange[0];
  const ys = yRange[1] - yRange[0];
  return {
    box,
    xRange,
    yRange,
    weight,
    accent,
    toScreen: (x, y) => ({ x: box.x + ((x - xRange[0]) / xs) * box.width, y: box.y + box.height - ((y - yRange[0]) / ys) * box.height }),
    toWorld: (px, py) => ({ x: xRange[0] + ((px - box.x) / box.width) * xs, y: yRange[0] + ((box.y + box.height - py) / box.height) * ys }),
  };
}

export interface VectorFieldGrid {
  /** Graph coordinates of the grid point. */
  world: Point;
  /** Where the arrow's tail is, composition px. */
  screen: Point;
  /** Arrow length at full growth, px. */
  length: number;
  /** Unit direction on screen (x right, y down). */
  dir: Point;
}

/** The grid points, and the arrow drawn at each. Cell centres, so the grid never sits on an axis edge. */
export function vectorFieldGrid(g: AxesGeometry, props: Pick<VectorFieldProps, "field" | "grid" | "scale" | "normalize" | "maxLength">): { cells: VectorFieldGrid[]; scale: number } {
  const columns = Math.max(1, Math.round(props.grid?.columns ?? 7));
  const cellW = g.box.width / columns;
  const rows = Math.max(1, Math.round(props.grid?.rows ?? g.box.height / cellW));
  const cellH = g.box.height / rows;
  const raw: { world: Point; screen: Point; mag: number; dir: Point }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const screen = { x: g.box.x + (c + 0.5) * cellW, y: g.box.y + (r + 0.5) * cellH };
      const world = g.toWorld(screen.x, screen.y);
      const [fx, fy] = props.field(world.x, world.y);
      const mag = Math.hypot(fx, fy);
      raw.push({ world, screen, mag: Number.isFinite(mag) ? mag : 0, dir: mag > 0 && Number.isFinite(mag) ? { x: fx / mag, y: -fy / mag } : { x: 0, y: 0 } });
    }
  }
  const biggest = Math.max(1e-12, ...raw.map((a) => a.mag));
  const scale = props.scale ?? (0.8 * Math.min(cellW, cellH)) / biggest;
  const cells = raw.map((a) => {
    let length = props.normalize !== undefined ? (a.mag > 0 ? props.normalize : 0) : a.mag * scale;
    if (props.maxLength !== undefined) length = Math.min(length, props.maxLength);
    return { world: a.world, screen: a.screen, length, dir: a.dir };
  });
  return { cells, scale };
}

/** One streamline through a seed (graph coordinates), as composition px points that run along the field. */
export function traceFieldLine(g: AxesGeometry, field: VectorFieldProps["field"], seed: [number, number], step: number, maxSteps = 500): Point[] {
  const b = g.box;
  const inside = (p: Point) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  const dirAt = (p: Point): Point | null => {
    const w = g.toWorld(p.x, p.y);
    const [fx, fy] = field(w.x, w.y);
    const m = Math.hypot(fx, fy);
    if (!(m > 1e-12) || !Number.isFinite(m)) return null;
    return { x: fx / m, y: -fy / m };
  };
  const walk = (start: Point, sign: number): Point[] => {
    const out: Point[] = [];
    let p = start;
    let prev: Point | null = null;
    for (let i = 0; i < maxSteps; i++) {
      const k1 = dirAt(p);
      if (!k1) break;
      const at = (q: Point, k: Point, h: number): Point => ({ x: q.x + sign * k.x * h, y: q.y + sign * k.y * h });
      const k2 = dirAt(at(p, k1, step / 2));
      const k3 = k2 && dirAt(at(p, k2, step / 2));
      const k4 = k3 && dirAt(at(p, k3, step));
      if (!k2 || !k3 || !k4) break;
      const d = { x: (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6, y: (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6 };
      // A turn of more than 90 degrees in one step means the line ran into a source, sink or zero.
      if (prev && d.x * prev.x + d.y * prev.y < 0) break;
      prev = d;
      const next = { x: p.x + sign * d.x * step, y: p.y + sign * d.y * step };
      if (!inside(next)) break;
      // Stepping over a source or a sink would turn the line round: stop short of it.
      const dn = dirAt(next);
      if (dn && dn.x * d.x + dn.y * d.y < 0) break;
      out.push(next);
      p = next;
      // A closed line (an orbit) stops when it comes back to where it began.
      if (i > 10 && Math.hypot(p.x - start.x, p.y - start.y) < step * 0.75) break;
    }
    return out;
  };
  const s = g.toScreen(seed[0], seed[1]);
  if (!inside(s)) return [];
  const back = walk(s, -1).reverse();
  const fwd = walk(s, 1);
  return [...back, s, ...fwd];
}

const Arrow: React.FC<{ from: Point; dir: Point; length: number; color: string; weight: number; dataset: Record<string, string> }> = ({ from, dir, length, color, weight, dataset }) => {
  if (length <= 0) return null;
  const head = Math.min(weight * 5, length * 0.6);
  const tip = { x: from.x + dir.x * length, y: from.y + dir.y * length };
  const base = { x: from.x + dir.x * (length - head), y: from.y + dir.y * (length - head) };
  const half = head * 0.55;
  const left = { x: base.x - dir.y * half, y: base.y + dir.x * half };
  const right = { x: base.x + dir.y * half, y: base.y - dir.x * half };
  return (
    <g {...dataset}>
      <line x1={from.x} y1={from.y} x2={base.x} y2={base.y} stroke={color} strokeWidth={weight} />
      <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />
    </g>
  );
};

/**
 * Arrows on a grid for a vector field, the picture an electric or gravitational field lesson draws. Inside
 * an <Axes> it uses that mapping; on its own it takes a `box` and ranges. Each arrow starts at its grid
 * point and is exactly `|f| * scale` px long unless `normalize` or `maxLength` says otherwise. With
 * `fieldLines`, streamlines are traced from the seeds by integrating the field (deterministic) and drawn
 * on after the arrows. Arrows and lines follow the field's direction in px: (fx, -fy), whatever the axes' scales. A pure function of the frame.
 */
export const VectorField: React.FC<VectorFieldProps> = (props) => {
  const { field, xRange = [-1, 1], yRange = [-1, 1], box, fieldLines = false, seeds, color, lineColor, at = 0, lineDuration = 45 } = props;
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  let inAxes: AxesGeometry | null = null;
  try {
    inAxes = useAxes();
  } catch {
    inAxes = null;
  }
  const weight = lineWeight(width, height);
  const tone = SUBJECT_ACCENT.physics;
  const g = inAxes ?? ownGeometry(box ?? defaultBox(width, height), xRange, yRange, weight, tone.accent);
  const { cells } = vectorFieldGrid(g, props);
  const grow = tween(frame, [at, at + FIELD_ARROW_FRAMES], [0, 1], E.cinematic);
  const lineP = fieldLines ? tween(frame, [at + FIELD_ARROW_FRAMES, at + FIELD_ARROW_FRAMES + lineDuration], [0, 1], E.sine) : 0;

  const columns = Math.max(1, Math.round(props.grid?.columns ?? 7));
  const seedList: [number, number][] =
    seeds ?? cells.filter((_, i) => Math.floor(i / columns) % 2 === 0 && (i % columns) % 2 === 0).map((c) => [c.world.x, c.world.y] as [number, number]);
  const step = Math.max(2, Math.min(g.box.width, g.box.height) / 120);
  const lines = fieldLines && lineP > 0 ? seedList.map((s) => traceFieldLine(g, field, s, step)).filter((l) => l.length >= 2) : [];
  const partial = (pts: Point[]): Point[] => {
    const m = lineP * (pts.length - 1);
    const full = Math.floor(m);
    const out = pts.slice(0, full + 1);
    if (full < pts.length - 1 && m > full) {
      const a = pts[full];
      const b = pts[full + 1];
      out.push({ x: a.x + (b.x - a.x) * (m - full), y: a.y + (b.y - a.y) * (m - full) });
    }
    return out;
  };
  const arrowColor = color ?? tone.accent;
  const streamColor = lineColor ?? tone.accentAlt;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-vectorfield="">
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
        {lines.map((pts, i) => {
          const shown = partial(pts);
          return (
            <path
              key={i}
              data-ovs-fieldline=""
              d={shown.map((p, j) => `${j === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")}
              fill="none"
              stroke={streamColor}
              strokeWidth={weight * 1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {cells.map((c, i) => (
          <Arrow key={i} from={c.screen} dir={c.dir} length={c.length * grow} color={arrowColor} weight={weight * 1.6} dataset={{ "data-ovs-arrow": "", "data-ovs-gx": String(c.world.x), "data-ovs-gy": String(c.world.y) }} />
        ))}
      </svg>
    </div>
  );
};

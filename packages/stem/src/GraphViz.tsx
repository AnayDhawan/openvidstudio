import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, displayStack } from "./designSystem";
import { lineWeight } from "./graph";
import { Spark } from "./Spark";
import { walk as walkPath, type Point } from "./paths";

export type GraphRole = "unvisited" | "frontier" | "visiting" | "done" | "path";
export const GRAPH_ROLES: readonly GraphRole[] = ["unvisited", "frontier", "visiting", "done", "path"];

/** The fill of each role: dim, accent, warm white, a second accent, ember. Text on a filled node is the void colour. */
export const GRAPH_ROLE_COLOR: Record<GraphRole, string> = {
  unvisited: VOID.panel,
  frontier: SUBJECT_ACCENT.cs.accent,
  visiting: VOID.text,
  done: SUBJECT_ACCENT.math.accent,
  path: SUBJECT_ACCENT.physics.accentAlt,
};

export interface GraphNode {
  id: string;
  /** Fractions of the layout box, 0..1. Give all nodes both, or none (then they sit on a circle). */
  x?: number;
  y?: number;
  /** Text inside the node. Default: the id. */
  label?: string;
}

/** A snapshot from `frame` on: the latest step at or before the current frame says every node's role. */
export interface GraphStep {
  frame: number;
  visit?: string;
  frontier?: string[];
  done?: string[];
  path?: string[];
}

export interface GraphVizProps {
  nodes: GraphNode[];
  /** `[from, to]` pairs of node ids. */
  edges: [string, string][];
  directed?: boolean;
  steps?: GraphStep[];
  /** An ordered list of node ids a single Spark hops along. */
  walk?: string[];
  /** Frames to hop, and to rest on each node. Defaults 20 and 20. */
  hop?: number;
  hold?: number;
  /** Frame the Spark starts, default `at`. */
  walkAt?: number;
  /** Frame the graph appears. Default 0. */
  at?: number;
  /** The layout box in px. Default: 80% of the width, from 17% down, 45% of the height. */
  box?: { x: number; y: number; w: number; h: number };
  /** Node radius, px. Default 4.5% of the shorter side. */
  radius?: number;
  /** Draw the legend of roles. Default true. */
  legend?: boolean;
}

export type Adjacency = Record<string, string[]>;

/** Adjacency lists from an edge list. Undirected unless `directed`. Neighbours keep edge order. */
export function adjacencyFrom(edges: [string, string][], directed = false, ids: string[] = []): Adjacency {
  const adj: Adjacency = {};
  for (const id of ids) adj[id] = [];
  for (const [a, b] of edges) {
    (adj[a] ??= []).push(b);
    (adj[b] ??= []);
    if (!directed) adj[b].push(a);
  }
  return adj;
}

/** Breadth-first visiting order from `start`, neighbours taken in their listed order. */
export function bfsOrder(adjacency: Adjacency, start: string): string[] {
  const seen = new Set([start]);
  const order: string[] = [];
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    order.push(v);
    for (const w of adjacency[v] ?? []) if (!seen.has(w)) { seen.add(w); queue.push(w); }
  }
  return order;
}

/** A shortest path (fewest edges) from `from` to `to`, both included, or null when unreachable. */
export function shortestPath(adjacency: Adjacency, from: string, to: string): string[] | null {
  const parent = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    if (v === to) break;
    for (const w of adjacency[v] ?? []) if (!parent.has(w)) { parent.set(w, v); queue.push(w); }
  }
  if (!parent.has(to)) return null;
  const path = [to];
  while (parent.get(path[0]) != null) path.unshift(parent.get(path[0]) as string);
  return path;
}

/**
 * Steps for a real BFS: visiting the k-th node of the order at frame `first + k * every`, with
 * the nodes already visited as done and the discovered-but-unvisited as the frontier. With `goal`,
 * a last step `every` frames after shows the shortest path.
 */
export function bfsSteps(adjacency: Adjacency, start: string, opts: { first?: number; every?: number; goal?: string } = {}): GraphStep[] {
  const first = opts.first ?? 0;
  const every = opts.every ?? 30;
  const order = bfsOrder(adjacency, start);
  const steps: GraphStep[] = order.map((visit, k) => {
    const visited = new Set(order.slice(0, k + 1));
    const frontier = order.slice(k + 1).filter((v) => order.slice(0, k + 1).some((u) => (adjacency[u] ?? []).includes(v)) && !visited.has(v));
    return { frame: first + k * every, visit, done: order.slice(0, k), frontier };
  });
  if (opts.goal) {
    const path = shortestPath(adjacency, start, opts.goal);
    if (path) steps.push({ frame: first + order.length * every, path });
  }
  return steps;
}

export interface GraphLayout {
  box: { x: number; y: number; w: number; h: number };
  radius: number;
  /** Node centres in px, by id. */
  centers: Record<string, Point>;
}

/** Where the nodes sit. Fractional nodes: box.x + x * box.w. No fractions: evenly round a circle that fits the box. */
export function graphLayout(nodes: GraphNode[], width: number, height: number, opts: { box?: GraphVizProps["box"]; radius?: number } = {}): GraphLayout {
  const box = opts.box ?? { x: Math.round(width * 0.1), y: Math.round(height * 0.17), w: Math.round(width * 0.8), h: Math.round(height * 0.45) };
  const radius = opts.radius ?? Math.round(Math.min(width, height) * 0.045);
  const centers: Record<string, Point> = {};
  const placed = nodes.every((n) => n.x !== undefined && n.y !== undefined);
  nodes.forEach((n, i) => {
    if (placed) centers[n.id] = { x: box.x + (n.x as number) * box.w, y: box.y + (n.y as number) * box.h };
    else {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
      const rr = Math.min(box.w, box.h) / 2 - radius;
      centers[n.id] = { x: box.x + box.w / 2 + rr * Math.cos(a), y: box.y + box.h / 2 + rr * Math.sin(a) };
    }
  });
  return { box, radius, centers };
}

const roleAt = (steps: GraphStep[], frame: number): { roles: Map<string, GraphRole>; path: string[] } => {
  const roles = new Map<string, GraphRole>();
  let current: GraphStep | undefined;
  for (const s of steps) if (s.frame <= frame && (!current || s.frame >= current.frame)) current = s;
  if (!current) return { roles, path: [] };
  for (const id of current.frontier ?? []) roles.set(id, "frontier");
  for (const id of current.done ?? []) roles.set(id, "done");
  if (current.visit) roles.set(current.visit, "visiting");
  for (const id of current.path ?? []) roles.set(id, "path");
  return { roles, path: current.path ?? [] };
};

/**
 * Nodes and edges, with node colours that say where a search has got to: dim until reached, violet
 * on the frontier, warm white on the node being visited, blue once done, ember along the final
 * path. The legend names the roles. A `walk` hops one Spark node to node; it is the only glowing
 * thing. Pure in the frame; sizes from the composition.
 */
export const GraphViz: React.FC<GraphVizProps> = ({ nodes, edges, directed = false, steps = [], walk, hop = 20, hold = 20, walkAt, at = 0, box, radius, legend = true }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (frame < at) return null;
  const weight = lineWeight(width, height);
  const layout = graphLayout(nodes, width, height, { box, radius });
  const { centers, radius: r } = layout;
  const fontPx = Math.round(r * 0.8);
  const legendPx = Math.round(Math.min(width, height) * 0.027);
  const opacity = tween(frame, [at, at + 12], [0, 1], E.cinematic);
  const { roles, path } = roleAt(steps, frame);
  const onPath = new Set<string>();
  path.forEach((id, i) => { if (i > 0) onPath.add(`${path[i - 1]}|${id}`); });
  const isPathEdge = (a: string, b: string) => onPath.has(`${a}|${b}`) || (!directed && onPath.has(`${b}|${a}`));
  const head = Math.max(weight * 4, r * 0.35);

  // legend rows, wrapped to the box width
  const items = GRAPH_ROLES.map((role) => ({ role, w: legendPx * 0.9 + legendPx * 0.4 + role.length * legendPx * 0.62 + legendPx * 1.2 }));
  const rows: (typeof items)[] = [[]];
  let rowW = 0;
  for (const it of items) {
    if (rowW + it.w > layout.box.w && rows[rows.length - 1].length) { rows.push([]); rowW = 0; }
    rows[rows.length - 1].push(it);
    rowW += it.w;
  }
  const legendTop = layout.box.y + layout.box.h + Math.round(height * 0.05);

  // The first node is repeated so that node k is rested on during local frames [k*(hop+hold)+hop, (k+1)*(hop+hold)].
  const stops = walk?.map((id) => centers[id]).filter(Boolean) ?? [];
  const walkPoints = stops.length ? [stops[0], ...stops] : [];

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-graphviz="">
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }} opacity={opacity < 1 ? opacity : undefined}>
        {edges.map(([a, b]) => {
          const p = centers[a];
          const q = centers[b];
          if (!p || !q) return null;
          const hot = isPathEdge(a, b);
          const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
          const ux = (q.x - p.x) / d;
          const uy = (q.y - p.y) / d;
          const end = directed ? { x: q.x - ux * r, y: q.y - uy * r } : q;
          const color = hot ? GRAPH_ROLE_COLOR.path : VOID.textDim;
          return (
            <g key={`${a}-${b}`} data-ovs-edge={`${a}-${b}`} data-ovs-edge-hot={hot ? "1" : "0"}>
              <line x1={p.x} y1={p.y} x2={end.x} y2={end.y} data-ovs-edge-line="" stroke={color} strokeWidth={hot ? weight * 2 : weight} strokeLinecap="round" />
              {directed && <polygon points={`${end.x},${end.y} ${end.x - ux * head - uy * head * 0.55},${end.y - uy * head + ux * head * 0.55} ${end.x - ux * head + uy * head * 0.55},${end.y - uy * head - ux * head * 0.55}`} fill={color} />}
            </g>
          );
        })}
        {nodes.map((n) => {
          const c = centers[n.id];
          const role = roles.get(n.id) ?? "unvisited";
          const fill = GRAPH_ROLE_COLOR[role];
          const stroke = role === "unvisited" ? VOID.textDim : role === "visiting" ? SUBJECT_ACCENT.cs.accent : fill;
          return (
            <g key={n.id} data-ovs-node={n.id} data-ovs-role={role}>
              <circle data-ovs-node-circle="" cx={c.x} cy={c.y} r={r - weight / 2} fill={fill} stroke={stroke} strokeWidth={weight} />
              <text x={c.x} y={c.y + fontPx * 0.35} textAnchor="middle" fontSize={fontPx} fontWeight={700} fontFamily={displayStack()} fill={role === "unvisited" ? VOID.text : VOID.base}>{n.label ?? n.id}</text>
            </g>
          );
        })}
        {legend && rows.map((row, ri) => {
          const total = row.reduce((s, it) => s + it.w, 0);
          let x = layout.box.x + (layout.box.w - total) / 2;
          const y = legendTop + ri * legendPx * 1.9;
          return row.map((it) => {
            const sx = x + legendPx * 0.45;
            x += it.w;
            return (
              <g key={it.role} data-ovs-legend={it.role}>
                <circle cx={sx} cy={y} r={legendPx * 0.45} fill={GRAPH_ROLE_COLOR[it.role]} stroke={it.role === "unvisited" ? VOID.textDim : GRAPH_ROLE_COLOR[it.role]} strokeWidth={weight} />
                <text x={sx + legendPx * 0.8} y={y + legendPx * 0.35} fontSize={legendPx} fontFamily={bodyStack()} fill={VOID.textDim}>{it.role}</text>
              </g>
            );
          });
        })}
      </svg>
      {walkPoints.length > 0 && <Spark path={walkPath(walkPoints, { hop, hold })} at={Math.max(at, walkAt ?? at)} trail={10} size={Math.max(4, Math.round(r * 0.3))} subject="cs" />}
    </div>
  );
};

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, displayStack, type Subject } from "./designSystem";
import { lineWeight } from "./graph";
import { Spark } from "./Spark";
import { walk, type Point } from "./paths";

export type Traversal = "inorder" | "preorder" | "postorder" | "level";

export interface TreeVizProps {
  /** Inserted in this order into a binary search tree (smaller to the left, larger to the right). A repeated value is skipped. */
  values: number[];
  /** Composition frame the first insert starts. Default 0. */
  at?: number;
  /** Frames each insert takes (a walked insert takes its walk as well). Default 24. */
  insertAt?: number;
  /** A Spark walks from the root to the place of this value as it is inserted. Default: the last value. */
  walkValue?: number;
  /** Turn the walking Spark off. Default true. */
  spark?: boolean;
  /** Frames the Spark takes for one hop down the tree, and how long it rests on each node. Default 14 and 8. */
  walkHop?: number;
  walkHold?: number;
  /** Light the nodes in this order, one every `hop` frames, and list the visited values under the tree. */
  traversal?: Traversal;
  /** Composition frame the first node lights. Default: 20 frames after the last insert. */
  traverseAt?: number;
  /** Frames between one node lighting and the next. Default 18. */
  hop?: number;
  /** Mark the node with this value (a ring). */
  highlight?: number;
  /** Picks the accent. Default "cs". */
  subject?: Subject;
}

export interface TreeNodeLayout {
  value: number;
  /** Position in the insertion order, 0 is the root. */
  order: number;
  parent: number | null;
  side: "left" | "right" | null;
  depth: number;
  /** Centre in composition pixels. */
  x: number;
  y: number;
  /** Composition frame the node (and its edge) starts to appear. */
  appearFrame: number;
}

export interface TreeLayout {
  nodes: TreeNodeLayout[];
  radius: number;
  /** Values in visit order for each traversal. */
  orders: Record<Traversal, number[]>;
  /** Centres from the root to the walked value's place, or empty. */
  walkPoints: Point[];
  walkValue: number | null;
  /** Frame offset, from the walked insert's start, at which the Spark arrives and the node appears. */
  walkFrames: number;
  /** Composition frame the last node has appeared. */
  insertsEnd: number;
  traverseAt: number;
}

interface Bst {
  value: number;
  left: Bst | null;
  right: Bst | null;
}

/**
 * The tree for `values` and where it is drawn: a tidy layered layout (x is the in-order rank, y the
 * depth, so a left child is always left of its parent and a right child right of it, each one level
 * lower), sized from the frame. Also the visit order of every traversal and the timeline of inserts.
 * Pure, so a test can check the picture against numbers it works out itself.
 */
export function treeLayout(values: number[], opts: { width: number; height: number; at?: number; insertAt?: number; walkValue?: number; spark?: boolean; walkHop?: number; walkHold?: number; traverseAt?: number }): TreeLayout {
  const { width, height } = opts;
  const at = opts.at ?? 0;
  const insertAt = opts.insertAt ?? 24;
  const minSide = Math.min(width, height);
  let root: Bst | null = null;
  const meta = new Map<number, { order: number; parent: number | null; side: "left" | "right" | null; depth: number }>();
  const inserted: number[] = [];
  for (const v of values) {
    if (meta.has(v)) continue;
    const node: Bst = { value: v, left: null, right: null };
    if (!root) {
      root = node;
      meta.set(v, { order: inserted.length, parent: null, side: null, depth: 0 });
    } else {
      let cur = root;
      let depth = 0;
      for (;;) {
        depth++;
        const side = v < cur.value ? "left" : "right";
        const next: Bst | null = cur[side];
        if (next) cur = next;
        else {
          cur[side] = node;
          meta.set(v, { order: inserted.length, parent: cur.value, side, depth });
          break;
        }
      }
    }
    inserted.push(v);
  }
  const inorder: number[] = [];
  const preorder: number[] = [];
  const postorder: number[] = [];
  const level: number[] = [];
  const visit = (n: Bst | null) => {
    if (!n) return;
    preorder.push(n.value);
    visit(n.left);
    inorder.push(n.value);
    visit(n.right);
    postorder.push(n.value);
  };
  visit(root);
  const queue: Bst[] = root ? [root] : [];
  for (let i = 0; i < queue.length; i++) {
    level.push(queue[i].value);
    if (queue[i].left) queue.push(queue[i].left as Bst);
    if (queue[i].right) queue.push(queue[i].right as Bst);
  }
  const count = inserted.length;
  const maxDepth = Math.max(0, ...Array.from(meta.values()).map((m) => m.depth));
  const portrait = height > width;
  const left = width * 0.1;
  const right = width * 0.9;
  const top = height * (portrait ? 0.2 : 0.16);
  const bottom = height * (portrait ? 0.56 : 0.6);
  const gapX = count > 1 ? (right - left) / (count - 1) : 0;
  const radius = Math.max(minSide * 0.034, Math.min(minSide * 0.055, gapX * 0.42));
  const gapY = maxDepth > 0 ? Math.min(minSide * 0.16, (bottom - top) / maxDepth) : 0;
  const x0 = count > 1 ? left : width / 2;
  const centre = (v: number): Point => {
    const m = meta.get(v) as { depth: number };
    return { x: x0 + inorder.indexOf(v) * gapX, y: top + radius + m.depth * gapY };
  };
  // The Spark's walk: from the root to the parent, then on to the place the new node will sit.
  const walkValue = opts.spark === false || count === 0 ? null : inserted.includes(opts.walkValue ?? inserted[count - 1]) ? (opts.walkValue ?? inserted[count - 1]) : null;
  const walkPoints: Point[] = [];
  if (walkValue !== null) {
    const chain: number[] = [];
    for (let v: number | null = walkValue; v !== null; v = (meta.get(v) as { parent: number | null }).parent) chain.unshift(v);
    for (const v of chain) walkPoints.push(centre(v));
  }
  const step = (opts.walkHop ?? 14) + (opts.walkHold ?? 8);
  const walkFrames = walkPoints.length > 1 ? (walkPoints.length - 1) * step : 0;
  let cursor = at;
  const nodes: TreeNodeLayout[] = inserted.map((v) => {
    const m = meta.get(v) as { order: number; parent: number | null; side: "left" | "right" | null; depth: number };
    const walked = v === walkValue;
    const appearFrame = cursor + (walked ? walkFrames : 0);
    cursor = appearFrame + insertAt;
    const c = centre(v);
    return { value: v, order: m.order, parent: m.parent, side: m.side, depth: m.depth, x: c.x, y: c.y, appearFrame };
  });
  return { nodes, radius, orders: { inorder, preorder, postorder, level }, walkPoints, walkValue, walkFrames, insertsEnd: cursor, traverseAt: opts.traverseAt ?? cursor + 20 };
}

const TRAVERSAL_NAME: Record<Traversal, string> = { inorder: "in-order", preorder: "pre-order", postorder: "post-order", level: "level order" };
const APPEAR_FRAMES = 10;

/**
 * A binary search tree built one insert at a time, with its traversals. The component builds the
 * BST from `values` itself, in order, and lays it out from the frame size (`treeLayout`). Each node
 * arrives with its edge, a Spark can walk from the root to its place, and a traversal lights the
 * nodes in visit order, listing the visited values under the tree. At most one thing glows: the
 * Spark. A pure function of the frame.
 */
export const TreeViz: React.FC<TreeVizProps> = ({ values, at = 0, insertAt = 24, walkValue, spark = true, walkHop = 14, walkHold = 8, traversal, traverseAt, hop = 18, highlight, subject = "cs" }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const weight = lineWeight(width, height);
  const accent = SUBJECT_ACCENT[subject].accent;
  const layout = treeLayout(values, { width, height, at, insertAt, walkValue, spark, walkHop, walkHold, traverseAt });
  if (frame < at) return null;
  const { nodes, radius } = layout;
  const byValue = new Map(nodes.map((n) => [n.value, n]));
  const fontPx = Math.round(radius * 0.9);
  const labelPx = Math.round(Math.min(width, height) * 0.03);
  const visitOrder = traversal ? layout.orders[traversal] : [];
  const lit = (v: number): number => (traversal ? visitOrder.indexOf(v) : -1);
  const litAt = (k: number) => layout.traverseAt + k * hop;
  const visited = visitOrder.filter((_, k) => frame >= litAt(k));
  const current = visited.length - 1;
  const portrait = height > width;
  const listY = Math.round(height * (portrait ? 0.66 : 0.74));
  const itemPx = Math.round(Math.min(width, height) * 0.04);
  const itemGap = Math.min(itemPx * 2.4, (width * 0.84) / Math.max(1, visitOrder.length));
  const listLeft = width / 2 - (visitOrder.length * itemGap) / 2;
  const walked = layout.walkValue === null ? null : byValue.get(layout.walkValue);
  const walkStart = walked ? walked.appearFrame - layout.walkFrames : 0;
  const showSpark = walked !== null && layout.walkFrames > 0 && frame >= walkStart && frame < (walked?.appearFrame ?? 0) + APPEAR_FRAMES;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-treeviz="" data-ovs-traversal={traversal ?? ""}>
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
        {nodes.map((n) => {
          if (frame < n.appearFrame || n.parent === null) return null;
          const p = byValue.get(n.parent) as TreeNodeLayout;
          const k = tween(frame, [n.appearFrame, n.appearFrame + APPEAR_FRAMES], [0, 1], E.cinematic);
          const dx = n.x - p.x;
          const dy = n.y - p.y;
          const d = Math.hypot(dx, dy);
          const ux = dx / d;
          const uy = dy / d;
          const a = { x: p.x + ux * radius, y: p.y + uy * radius };
          const b = { x: n.x - ux * radius, y: n.y - uy * radius };
          return <line key={`e${n.value}`} data-ovs-edge={`${n.parent}-${n.value}`} x1={a.x} y1={a.y} x2={a.x + (b.x - a.x) * k} y2={a.y + (b.y - a.y) * k} stroke={VOID.textDim} strokeWidth={weight} />;
        })}
        {nodes.map((n) => {
          if (frame < n.appearFrame) return null;
          const k = tween(frame, [n.appearFrame, n.appearFrame + APPEAR_FRAMES], [0, 1], E.cinematic);
          const idx = lit(n.value);
          const on = idx >= 0 && frame >= litAt(idx);
          const isCurrent = on && idx === current;
          return (
            <g key={n.value} data-ovs-node={n.value} data-ovs-x={n.x} data-ovs-y={n.y} data-ovs-r={radius} data-ovs-depth={n.depth} data-ovs-lit={on ? "true" : "false"} opacity={k < 1 ? k : undefined}>
              <circle cx={n.x} cy={n.y} r={radius} fill={isCurrent ? accent : on ? accent : VOID.panel} fillOpacity={isCurrent ? 1 : on ? 0.35 : 1} stroke={on ? accent : VOID.textDim} strokeWidth={weight} />
              {highlight === n.value && <circle data-ovs-highlight={n.value} cx={n.x} cy={n.y} r={radius + weight * 2.5} fill="none" stroke={accent} strokeWidth={weight} strokeDasharray={`${weight * 2.5} ${weight * 2}`} />}
              <text x={n.x} y={n.y + fontPx * 0.35} textAnchor="middle" fontSize={fontPx} fill={isCurrent ? VOID.base : VOID.text} fontFamily={displayStack()} fontWeight={600}>{n.value}</text>
            </g>
          );
        })}
        {traversal && visited.length > 0 && (
          <g data-ovs-visited-list="">
            <text x={width / 2} y={listY - itemPx * 1.4} textAnchor="middle" fontSize={labelPx} fill={VOID.textDim} fontFamily={bodyStack()}>{TRAVERSAL_NAME[traversal]}</text>
            {visited.map((v, k) => (
              <text key={v} data-ovs-visited={v} data-ovs-visit-index={k} x={listLeft + (k + 0.5) * itemGap} y={listY} textAnchor="middle" fontSize={itemPx} fill={k === current ? accent : VOID.text} fontFamily={displayStack()} fontWeight={600}>{v}</text>
            ))}
          </g>
        )}
      </svg>
      {showSpark && <Spark path={walk(layout.walkPoints, { hop: walkHop, hold: walkHold })} at={walkStart} trail={14} color={accent} size={Math.max(4, Math.round(radius * 0.22))} />}
    </div>
  );
};

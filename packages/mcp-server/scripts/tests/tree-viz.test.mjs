#!/usr/bin/env node
// tree-viz: TreeViz from @openvidstudio/stem (#142), measured in real frames at 1920x1080 and
// 1080x1920. The binary search tree, its depths and every traversal order are worked out here
// independently from the insert order, then compared with the DOM (data-ovs-* attributes) and the
// pixels.
//
// Sample scene: insert 8, 3, 10, 1, 6, 14 and a Spark walks to the place of 6.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, meanLuma, rgb, brightCentroid, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const VALUES = [8, 3, 10, 1, 6, 14];

const scene = (name, props) => `import React from "react";
import { AbsoluteFill } from "remotion";
import "@openvidstudio/stem";
import { TreeViz } from "@openvidstudio/stem/src/TreeViz";

export const ${name}: React.FC = () => (
  <AbsoluteFill style={{ background: "#07060B" }}>
    <TreeViz values={${JSON.stringify(VALUES)}} ${props} />
  </AbsoluteFill>
);
`;

// An independent BST: parent, depth and the four traversal orders, written here, not taken from the component.
function bst(values) {
  const nodes = new Map();
  let root = null;
  for (const v of values) {
    if (nodes.has(v)) continue;
    const n = { v, l: null, r: null, parent: null, depth: 0 };
    nodes.set(v, n);
    if (!root) { root = n; continue; }
    let c = root;
    for (;;) {
      const k = v < c.v ? "l" : "r";
      if (!c[k]) { c[k] = n; n.parent = c; n.depth = c.depth + 1; break; }
      c = c[k];
    }
  }
  const pre = [], ino = [], post = [], lvl = [];
  const go = (n) => { if (!n) return; pre.push(n.v); go(n.l); ino.push(n.v); go(n.r); post.push(n.v); };
  go(root);
  for (const q = [root]; q.length;) { const n = q.shift(); lvl.push(n.v); if (n.l) q.push(n.l); if (n.r) q.push(n.r); }
  return { nodes, root, orders: { inorder: ino, preorder: pre, postorder: post, level: lvl } };
}
const T = bst(VALUES);

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  // frames of the sample scene (local to its beat): inserts every 20 from 10, the walk to 6 is 2 hops of 14+8
  const APPEAR = [10, 30, 50, 70, 134, 154];
  const TRAVERSE = 200;
  const HOP = 15;
  const project = lessonProject({
    prefix: `ovs-tree-${width}x${height}-`,
    width,
    height,
    scenes: {
      "walk-scene": { source: scene("WalkScene", `at={10} insertAt={20} walkValue={6} traversal="inorder" traverseAt={${TRAVERSE}} hop={${HOP}} highlight={3}`), duration: 320 },
      "pre-scene": { source: scene("PreScene", `at={0} insertAt={5} spark={false} traversal="preorder" traverseAt={60} hop={10}`), duration: 160 },
      "post-scene": { source: scene("PostScene", `at={0} insertAt={5} spark={false} traversal="postorder" traverseAt={60} hop={10}`), duration: 160 },
      "level-scene": { source: scene("LevelScene", `at={0} insertAt={5} spark={false} traversal="level" traverseAt={60} hop={10}`), duration: 160 },
    },
  });
  const minSide = Math.min(width, height);

  await inBrowser(project, async ({ comp, page, frame, seek, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const nodesNow = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-node]")).map((e) => ({ v: Number(e.getAttribute("data-ovs-node")), x: Number(e.getAttribute("data-ovs-x")), y: Number(e.getAttribute("data-ovs-y")), r: Number(e.getAttribute("data-ovs-r")), depth: Number(e.getAttribute("data-ovs-depth")), lit: e.getAttribute("data-ovs-lit") === "true" })));
    const visitedNow = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-visited]")).sort((a, b) => Number(a.getAttribute("data-ovs-visit-index")) - Number(b.getAttribute("data-ovs-visit-index"))).map((e) => Number(e.getAttribute("data-ovs-visited"))));
    const edgesNow = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-edge]")).map((e) => e.getAttribute("data-ovs-edge")));
    const glowing = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-glow]")).filter((e) => Number.parseFloat(e.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length);
    const sameSet = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

    // nothing before `at`
    const early = await frame("walk-scene", 5);
    check("nothing is drawn before `at`: no TreeViz in the DOM and the frame is the bare background", (await page.evaluate(() => document.querySelectorAll("[data-ovs-treeviz]").length)) === 0 && meanLuma(early) < 12);

    // nodes appear in insertion order
    const seen = [];
    for (const [f, want] of [[40, VALUES.slice(0, 2)], [60, VALUES.slice(0, 3)], [100, VALUES.slice(0, 4)], [133, VALUES.slice(0, 4)], [134, VALUES.slice(0, 5)], [170, VALUES]]) {
      await seek("walk-scene", f);
      const got = (await nodesNow()).map((n) => n.v);
      seen.push(`${f}:${got.join(",")}`);
      check(`frame ${f}: exactly the first ${want.length} inserted values are on screen`, sameSet(got, want));
      const edges = await edgesNow();
      check(`frame ${f}: and one edge for each node but the root`, edges.length === want.length - 1);
    }
    console.log(`  ${seen.join("  ")}`);

    // the shape
    await frame("walk-scene", 170);
    const ns = await nodesNow();
    const at = new Map(ns.map((n) => [n.v, n]));
    check("all six nodes are drawn", ns.length === 6);
    let shape = true;
    let why = "";
    for (const [v, n] of T.nodes) {
      const d = at.get(v);
      if (d.depth !== n.depth) { shape = false; why = `depth of ${v}`; }
      if (n.parent) {
        const p = at.get(n.parent.v);
        const leftChild = n.parent.l === n;
        if (!(leftChild ? d.x < p.x : d.x > p.x)) { shape = false; why = `side of ${v}`; }
        if (!(d.y > p.y)) { shape = false; why = `level of ${v}`; }
      }
    }
    check(`BST shape: every left child is left of its parent, every right child right of it, children one level lower (${why || "ok"})`, shape);
    const byX = [...ns].sort((a, b) => a.x - b.x).map((n) => n.v);
    check("the nodes run left to right in sorted order (a tidy in-order layout)", JSON.stringify(byX) === JSON.stringify([...VALUES].sort((a, b) => a - b)));
    const rows = new Map();
    for (const n of ns) rows.set(n.depth, [...(rows.get(n.depth) ?? []), n.y]);
    check("nodes of one depth share a y, and depth 0, 1, 2 are strictly lower each", [...rows.values()].every((ys) => ys.every((y) => near(y, ys[0], 0.01))) && rows.get(0)[0] < rows.get(1)[0] && rows.get(1)[0] < rows.get(2)[0]);
    check("the tree stays inside the safe zone (below 14%, above 78% of the height, inside the width)", ns.every((n) => n.y - n.r >= height * 0.14 && n.y + n.r <= height * 0.78 && n.x - n.r >= 0 && n.x + n.r <= width));
    check("the nodes are big enough to read (radius at least 3% of the shorter side)", ns.every((n) => n.r >= minSide * 0.03));
    const edges = await edgesNow();
    check("the edges are parent-child pairs of the independent tree", sameSet(edges.map((e) => Number(e.split("-")[1])), VALUES.slice(1)) && edges.every((e) => { const [p, c] = e.split("-").map(Number); return T.nodes.get(c).parent.v === p; }));
    // pixels: a node's ring is drawn where the DOM says
    const shot = await frame("walk-scene", 170);
    const n8 = at.get(8);
    const ringPx = rgb(shot, n8.x + n8.r, n8.y);
    const emptyPx = rgb(shot, width * 0.5, height * 0.42);
    check("the root's ring is drawn at the centre the DOM reports (a grey ring, not the void)", ringPx.reduce((a, b) => a + b, 0) > emptyPx.reduce((a, b) => a + b, 0) + 150);
    check("the highlighted node 3 carries a ring and no other does", (await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-highlight]")).map((e) => e.getAttribute("data-ovs-highlight")))).join() === "3");

    // the Spark walks to the place of 6
    const n6 = at.get(6);
    const n3 = at.get(3);
    const n8c = at.get(8);
    await frame("walk-scene", 89);
    check("the Spark is not on screen before its insert starts", (await glowing()) === 0);
    const w = await frame("walk-scene", 133);
    const spot = brightCentroid(w, 200, { x: Math.round(n6.x - n6.r * 1.2), y: Math.round(n6.y - n6.r * 1.2), w: Math.round(n6.r * 2.4), h: Math.round(n6.r * 2.4) });
    console.log(`  Spark at frame 133: ${spot ? `(${spot.x.toFixed(1)}, ${spot.y.toFixed(1)})` : "none"}, place of 6 is (${n6.x.toFixed(1)}, ${n6.y.toFixed(1)})`);
    check("the Spark has arrived at the place where 6 will sit (under 3, its right child), within a third of a node's radius... or close behind it", spot !== null && Math.hypot(spot.x - n6.x, spot.y - n6.y) < n6.r * 0.7);
    check("exactly one glowing element while the Spark walks", (await glowing()) === 1);
    const wMid = await frame("walk-scene", 90 + 7);
    const sMid = brightCentroid(wMid, 200, { x: Math.round(Math.min(n8c.x, n3.x) - n3.r), y: Math.round(n8c.y - n8c.r), w: Math.round(Math.abs(n8c.x - n3.x) + 2 * n3.r), h: Math.round(Math.abs(n8c.y - n3.y) + 2 * n3.r) });
    check("half way through its first hop the Spark is between the root 8 and the node 3", sMid !== null && sMid.x < n8c.x - n8c.r * 0.3 && sMid.x > n3.x - n3.r * 0.2 && sMid.y > n8c.y + n8c.r * 0.2);
    check("node 6 is not drawn until the Spark gets there", !(await nodesNow()).some((n) => n.v === 6));
    await frame("walk-scene", 160);
    check("once it has arrived the Spark is gone and nothing glows", (await glowing()) === 0);

    // traversal highlighting on the sample scene (in-order)
    const litOf = async (f) => { await seek("walk-scene", f); return (await nodesNow()).filter((n) => n.lit).map((n) => n.v); };
    const sorted = [...VALUES].sort((a, b) => a - b);
    check("before `traverseAt` no node is lit", (await litOf(TRAVERSE - 1)).length === 0);
    check("at `traverseAt` the first in-order node (the smallest value, 1) is lit and only that one", JSON.stringify(await litOf(TRAVERSE)) === "[1]");
    check("one hop later the second (3) lights too", sameSet(await litOf(TRAVERSE + HOP), [1, 3]));
    check("and the node lights in the frame the hop says, not a frame before", sameSet(await litOf(TRAVERSE + HOP - 1), [1]));
    const lit3 = await litOf(TRAVERSE + 3 * HOP);
    check("at frame traverseAt + 3 hops the first four in-order nodes (1, 3, 6, 8) are lit", sameSet(lit3, sorted.slice(0, 4)));
    const litShot = await frame("walk-scene", TRAVERSE + 3 * HOP);
    const nodeNow = Object.fromEntries((await nodesNow()).map((n) => [n.v, n]));
    const tint = (n) => rgb(litShot, n.x, n.y - n.r * 0.7);
    check("pixels agree: a lit node's inside is tinted violet (blue channel well above the void), an unlit node's is not", tint(nodeNow[1])[2] > 70 && tint(nodeNow[14])[2] < 40);
    check("while the traversal lights nodes nothing glows", (await glowing()) === 0);
    await seek("walk-scene", 300);
    const finalVisited = await visitedNow();
    console.log(`  in-order list: ${finalVisited.join(" ")}`);
    check("the visited list under the tree, read from the DOM in order, is the values sorted (in-order traversal of a BST)", JSON.stringify(finalVisited) === JSON.stringify(sorted));
    check("it matches the independent in-order traversal", JSON.stringify(finalVisited) === JSON.stringify(T.orders.inorder));
    check("the list is inside the safe zone", await page.evaluate(({ h }) => { const r = document.querySelector("[data-ovs-visited-list]").getBoundingClientRect(); return r.top >= h * 0.14 && r.bottom <= h * 0.78; }, { h: height }));
    check("every node is lit once the traversal is over", (await litOf(300)).length === 6);

    // the other three orders
    const finals = {};
    for (const [beat, kind] of [["pre-scene", "preorder"], ["post-scene", "postorder"], ["level-scene", "level"]]) {
      await seek(beat, 150);
      finals[kind] = await visitedNow();
      check(`${kind}: the visited list is ${T.orders[kind].join(" ")}`, JSON.stringify(finals[kind]) === JSON.stringify(T.orders[kind]));
      await seek(beat, 60 + 2 * 10);
      const two = await visitedNow();
      check(`${kind}: two hops in, the first three visited are ${T.orders[kind].slice(0, 3).join(" ")}`, JSON.stringify(two) === JSON.stringify(T.orders[kind].slice(0, 3)));
      check(`${kind}: with the Spark off nothing glows`, (await glowing()) === 0);
    }
    check("control: the pre-order list is not the sorted list (the order check can fail)", JSON.stringify(finals.preorder) !== JSON.stringify(sorted));
    check("control: the post-order and level-order lists differ from each other", JSON.stringify(finals.postorder) !== JSON.stringify(finals.level));
    check("control: sorting the in-order list wrongly (descending) fails the equality", JSON.stringify([...finalVisited].reverse()) !== JSON.stringify(sorted));

    // purity
    await frame("walk-scene", 60);
    const a = await frame("walk-scene", 250);
    await frame("walk-scene", 5);
    const b = await frame("walk-scene", 250);
    if (!sameBytes(a, b)) {
      let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let i = 0; i < a.data.length; i += a.channels) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) { const px = (i / a.channels) % a.width, py = Math.floor(i / a.channels / a.width); n++; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
      console.log(`  purity diff: ${n} px in x ${x0}..${x1}, y ${y0}..${y1}`);
      const sample = [];
      for (let i = 0; i < a.data.length && sample.length < 12; i += a.channels) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) sample.push(`(${(i / a.channels) % a.width},${Math.floor(i / a.channels / a.width)}) ${a.data[i]},${a.data[i + 1]},${a.data[i + 2]} vs ${b.data[i]},${b.data[i + 1]},${b.data[i + 2]}`);
      console.log(`  ${sample.join(" | ")}`);
    }
    check("frame purity: the same frame (nodes lit, no Spark) rendered twice, with another between, is byte-identical", sameBytes(a, b));
    check("control: different frames differ", !sameBytes(a, await frame("walk-scene", 100)));
    // With the Spark on screen the browser rasterises its bloom filter, which is not bit-exact between renders, so allow a speck of it.
    await frame("walk-scene", 60);
    const c = await frame("walk-scene", 120);
    await frame("walk-scene", 250);
    const d = await frame("walk-scene", 120);
    let differing = 0;
    for (let i = 0; i < c.data.length; i += c.channels) if (c.data[i] !== d.data[i] || c.data[i + 1] !== d.data[i + 1] || c.data[i + 2] !== d.data[i + 2]) differing++;
    console.log(`  Spark frame re-rendered: ${differing} of ${c.data.length / c.channels} px differ`);
    check("frame purity with the Spark on screen: the same frame twice differs in under 0.05% of pixels (the Spark's bloom raster)", differing < (c.data.length / c.channels) * 0.0005);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) {
  skip("tree-viz", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

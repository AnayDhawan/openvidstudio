#!/usr/bin/env node
// graph-viz: GraphViz from @openvidstudio/stem (#142), measured in real frames at 1920x1080 and
// 1080x1920. Node centres are worked out here from the layout box and the fractions the scene was
// given, colours from the design-system roles, the BFS order and the shortest path by hand.
//
// Sample scene: breadth-first search on six nodes, part-way through.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, luma, rgb, brightCentroid, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);
const BG = [7, 6, 11];
const ROLE = { unvisited: [14, 12, 22], frontier: [181, 140, 255], visiting: [243, 239, 230], done: [92, 200, 255], path: [255, 122, 61] };

// fractions of the layout box
const NODES = [
  ["A", 0.1, 0.5], ["B", 0.35, 0.15], ["C", 0.35, 0.85], ["D", 0.65, 0.15], ["E", 0.65, 0.85], ["F", 0.9, 0.5],
];
const EDGES = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "E"], ["D", "F"], ["E", "F"]];
const nodesJsx = (labels = true) => `[${NODES.map(([id, x, y]) => `{ id: "${id}", x: ${x}, y: ${y}${labels ? "" : ', label: ""'} }`).join(", ")}]`;
const edgesJsx = `[${EDGES.map(([a, b]) => `["${a}", "${b}"]`).join(", ")}]`;

const wrap = (name, body, extra = "") => `import React from "react";
import { AbsoluteFill } from "remotion";
import { GraphViz, adjacencyFrom, bfsOrder, bfsSteps, shortestPath } from "@openvidstudio/stem/src/GraphViz";

export const ${name}: React.FC = () => {
${extra}
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
${body}
    </AbsoluteFill>
  );
};
`;

const STEPS = `[
  { frame: 0, visit: "A", frontier: ["B", "C"] },
  { frame: 30, visit: "B", done: ["A"], frontier: ["C", "D"] },
  { frame: 60, visit: "D", done: ["A", "B", "C"], frontier: ["E", "F"] },
  { frame: 90, path: ["A", "C", "E", "F"] },
]`;
const COLOR = wrap("ColorScene", `      <GraphViz nodes={${nodesJsx()}} edges={${edgesJsx}} steps={${STEPS}} />`);
const PLAIN = wrap("PlainScene", `      <GraphViz nodes={${nodesJsx()}} edges={${edgesJsx}} />`);
const WALK = wrap("WalkScene", `      <GraphViz legend={false} nodes={${nodesJsx(false)}} edges={${edgesJsx}} walk={["A", "B", "D", "F"]} hop={10} hold={20} />`);
const LATE = wrap("LateScene", `      <GraphViz at={20} nodes={${nodesJsx()}} edges={${edgesJsx}} steps={${STEPS}} walk={["A", "B"]} />`);
const AUTO = wrap("AutoScene", `      <GraphViz directed nodes={[{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }, { id: "6" }]} edges={[["1", "2"], ["2", "3"], ["3", "4"], ["4", "5"], ["5", "6"], ["6", "1"]]} />`);
const HELP = wrap("HelpScene", `      <div data-test-helpers={JSON.stringify({ adj, order, path, none, viaEdges: adjacencyFrom(edges), steps, withGoal })} />`, `
  const adj = { A: ["B", "C"], B: ["A", "D"], C: ["A", "D", "F"], D: ["B", "C", "E"], E: ["D", "F"], F: ["C", "E"] };
  const edges: [string, string][] = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"], ["C", "F"], ["E", "F"]];
  const order = bfsOrder(adj, "A");
  const path = shortestPath(adj, "A", "F");
  const none = shortestPath(adj, "A", "Z");
  const steps = bfsSteps(adj, "A", { first: 10, every: 20 });
  const withGoal = bfsSteps(adj, "A", { first: 10, every: 20, goal: "F" });`);

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-graphviz-${width}x${height}-`,
    width,
    height,
    scenes: {
      "color-scene": { source: COLOR, duration: 110 },
      "plain-scene": { source: PLAIN, duration: 40 },
      "walk-scene": { source: WALK, duration: 130 },
      "late-scene": { source: LATE, duration: 60 },
      "auto-scene": { source: AUTO, duration: 40 },
      "help-scene": { source: HELP, duration: 10 },
    },
  });
  const S = Math.min(width, height);
  const box = { x: Math.round(width * 0.1), y: Math.round(height * 0.17), w: Math.round(width * 0.8), h: Math.round(height * 0.45) };
  const r = Math.round(S * 0.045);
  const weight = Math.max(3, Math.round(S / 360));
  const centre = (id) => { const n = NODES.find((q) => q[0] === id); return { x: box.x + n[1] * box.w, y: box.y + n[2] * box.h }; };

  await inBrowser(project, async ({ comp, page, seek, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowing = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-glow]")).filter((e) => Number.parseFloat(e.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length);
    const nodeDom = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll("[data-ovs-node]")).map((g) => {
      const c = g.querySelector("circle");
      return [g.getAttribute("data-ovs-node"), { cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")), r: Number(c.getAttribute("r")), role: g.getAttribute("data-ovs-role") }];
    })));
    const sampleRole = (img, id) => { const c = centre(id); return rgb(img, c.x, c.y + r * 0.6); };

    // ---- layout ----
    const f40 = await frame("color-scene", 40);
    const dom = await nodeDom();
    check("six nodes, each with its id", JSON.stringify(Object.keys(dom).sort()) === JSON.stringify(["A", "B", "C", "D", "E", "F"]));
    check("each node centre is the box origin plus its fractions times the box size, within 0.6px", NODES.every(([id]) => near(dom[id].cx, centre(id).x, 0.6) && near(dom[id].cy, centre(id).y, 0.6)));
    check("the node radius comes from the frame (4.5% of the shorter side, less half a stroke)", NODES.every(([id]) => near(dom[id].r + weight / 2, r, 0.6)));
    const edgeDom = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-edge]")).map((g) => {
      const l = g.querySelector("line");
      return { id: g.getAttribute("data-ovs-edge"), x1: Number(l.getAttribute("x1")), y1: Number(l.getAttribute("y1")), x2: Number(l.getAttribute("x2")), y2: Number(l.getAttribute("y2")), sw: Number(l.getAttribute("stroke-width")) };
    }));
    check("six edges, each running between the centres of the two nodes it names", edgeDom.length === 6 && edgeDom.every((e) => { const [a, b] = e.id.split("-"); return near(e.x1, centre(a).x, 0.6) && near(e.y1, centre(a).y, 0.6) && near(e.x2, centre(b).x, 0.6) && near(e.y2, centre(b).y, 0.6); }));
    check("no stroke is thinner than lineWeight", edgeDom.every((e) => e.sw >= weight));
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-node] text")).map((t) => ({ t: t.textContent, fs: Number(t.getAttribute("font-size")) })));
    check("labels sit inside the nodes, as text of at least 2.4% of the shorter side", labels.map((l) => l.t).join("") === "ABCDEF" && labels.every((l) => l.fs >= S * 0.024));
    const noEdgePix = rgb(f40, (centre("A").x + centre("B").x) / 2, (centre("A").y + centre("B").y) / 2);
    check("the edge A-B is drawn in the dim colour at its midpoint (pixels)", close(noEdgePix, [140, 135, 153], 25));

    // ---- legend ----
    const legend = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-legend]")).map((g) => ({ role: g.getAttribute("data-ovs-legend"), fs: Number(g.querySelector("text").getAttribute("font-size")), y: Number(g.querySelector("circle").getAttribute("cy")), x: Number(g.querySelector("circle").getAttribute("cx")) })));
    check("the legend names all five roles", JSON.stringify(legend.map((l) => l.role)) === JSON.stringify(["unvisited", "frontier", "visiting", "done", "path"]));
    check("the legend is readable (at least 2.4% of the shorter side) and on screen above the bottom reserve", legend.every((l) => l.fs >= S * 0.024 && l.y < height * 0.78 && l.x > 0 && l.x < width));

    // ---- colours by role, frame by frame ----
    const want40 = { A: "done", B: "visiting", C: "frontier", D: "frontier", E: "unvisited", F: "unvisited" };
    check("frame 40: the role attribute of every node matches the step in force", NODES.every(([id]) => dom[id].role === want40[id]));
    check("frame 40: pixels at every node match the design-system colour of its role", NODES.every(([id]) => close(sampleRole(f40, id), ROLE[want40[id]], 8)));
    check("control: B's pixels (visiting) are not the frontier colour, and E's (unvisited) are not the done colour", !close(sampleRole(f40, "B"), ROLE.frontier, 30) && !close(sampleRole(f40, "E"), ROLE.done, 30));
    const f70 = await frame("color-scene", 70);
    const want70 = { A: "done", B: "done", C: "done", D: "visiting", E: "frontier", F: "frontier" };
    check("frame 70: the next step is in force (D visiting, A B C done, E F frontier)", NODES.every(([id]) => close(sampleRole(f70, id), ROLE[want70[id]], 8)));
    const f100 = await frame("color-scene", 100);
    const want100 = { A: "path", B: "unvisited", C: "path", D: "unvisited", E: "path", F: "path" };
    check("frame 100: the final path A C E F is ember and the rest are dim again", NODES.every(([id]) => close(sampleRole(f100, id), ROLE[want100[id]], 8)));
    const mid = (a, b) => ({ x: (centre(a).x + centre(b).x) / 2, y: (centre(a).y + centre(b).y) / 2 });
    const hotMid = mid("A", "C");
    const coldMid = mid("A", "B");
    check("the edge A-C on the shortest path is emphasised in ember, and A-B is not", close(rgb(f100, hotMid.x, hotMid.y), ROLE.path, 25) && !close(rgb(f100, coldMid.x, coldMid.y), ROLE.path, 60));
    const hotCount = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-edge-hot='1']")).map((g) => g.getAttribute("data-ovs-edge")).join(","));
    check("exactly the path edges are hot: A-C, C-E, E-F", hotCount === "A-C,C-E,E-F");
    const plain = await frame("plain-scene", 30);
    check("control: with no steps nothing is coloured by a role (all unvisited)", NODES.every(([id]) => close(sampleRole(plain, id), ROLE.unvisited, 8)));
    check("the graph itself never glows", (await glowing()) === 0);

    // ---- frame purity ----
    const a1 = await frame("color-scene", 70);
    await frame("color-scene", 10);
    const a2 = await frame("color-scene", 70);
    check("frame purity: frame 70 rendered twice with another frame between is byte-identical", sameBytes(a1, a2));

    // ---- the Spark walks the nodes ----
    const stops = ["A", "B", "D", "F"];
    for (let k = 0; k < stops.length; k++) {
      const img = await frame("walk-scene", k * 30 + 20);
      const p = brightCentroid(img, 200);
      const c = centre(stops[k]);
      console.log(`  hold ${k} on ${stops[k]}: spark ${p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : "none"} node ${c.x.toFixed(1)},${c.y.toFixed(1)}`);
      check(`the Spark rests on node ${stops[k]} during hold ${k}, within 2px`, p !== null && near(p.x, c.x, 2) && near(p.y, c.y, 2));
    }
    check("exactly one glowing element while the Spark walks", (await glowing()) === 1);
    const hopImg = await frame("walk-scene", 35);
    const hp = brightCentroid(hopImg, 200);
    const A = centre("A"), B = centre("B");
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    const frac = hp ? ((hp.x - A.x) * (B.x - A.x) + (hp.y - A.y) * (B.y - A.y)) / (L * L) : -1;
    const off = hp ? Math.abs((hp.x - A.x) * (B.y - A.y) - (hp.y - A.y) * (B.x - A.x)) / L : 999;
    check("during the hop from A to B the Spark is on the segment, between the nodes", hp !== null && frac > 0.05 && frac < 0.95 && off < 3);
    check("control: at that frame the Spark is not on node A or on node B", hp !== null && Math.hypot(hp.x - A.x, hp.y - A.y) > r && Math.hypot(hp.x - B.x, hp.y - B.y) > r);
    // Anti-aliased edge pixels under a composited Spark layer vary in Chromium with the previous
    // frame (even byte for byte, same DOM), so purity here is the serialised DOM plus the pixels in
    // the Spark's neighbourhood; the edge-and-node picture is compared byte for byte in the colour scene above.
    const domOf = () => page.evaluate(() => document.querySelector("[data-ovs-graphviz]").outerHTML);
    const w1 = await frame("walk-scene", 80);
    const d1 = await domOf();
    await frame("walk-scene", 5);
    const w2 = await frame("walk-scene", 80);
    const d2 = await domOf();
    const D = centre("D");
    const patch = (img) => { const out = []; for (let y = Math.round(D.y - 40); y < D.y + 40; y++) for (let x = Math.round(D.x - 40); x < D.x + 40; x++) out.push(rgb(img, x, y).join()); return out.join(";"); };
    check("frame purity with the Spark: frame 80 twice gives the same DOM and the same pixels round the Spark", d1 === d2 && patch(w1) === patch(w2));
    await frame("walk-scene", 5);
    check("control: a different frame (5) gives a different DOM", (await domOf()) !== d1);

    // ---- nothing before `at` ----
    const early = await frame("late-scene", 10);
    const countEarly = await page.evaluate(() => document.querySelectorAll("[data-ovs-graphviz], [data-ovs-node]").length);
    let maxLuma = 0;
    for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) maxLuma = Math.max(maxLuma, luma(early, x, y));
    check("nothing before `at`: no graph in the DOM and the frame is the bare background", countEarly === 0 && maxLuma < 20);
    const later = await frame("late-scene", 50);
    check("control: after `at` the graph is on screen", (await page.evaluate(() => document.querySelectorAll("[data-ovs-node]").length)) === 6 && !close(rgb(later, centre("B").x, centre("B").y + r * 0.6), BG, 20));
    check("a Spark walk without walkAt starts at `at`, so there is still one glowing element", (await glowing()) === 1);

    // ---- auto layout on a circle, directed ----
    await frame("auto-scene", 30);
    const auto = await nodeDom();
    const cxm = box.x + box.w / 2, cym = box.y + box.h / 2, rad = Math.min(box.w, box.h) / 2 - r;
    const ids = ["1", "2", "3", "4", "5", "6"];
    check("without coordinates the nodes sit on a circle that fits the box, evenly spaced from the top", ids.every((id, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / 6;
      return near(auto[id].cx, cxm + rad * Math.cos(a), 0.6) && near(auto[id].cy, cym + rad * Math.sin(a), 0.6);
    }));
    const heads = await page.evaluate(() => document.querySelectorAll("[data-ovs-edge] polygon").length);
    check("a directed graph draws an arrowhead on every edge", heads === 6);
    await frame("plain-scene", 30);
    check("control: an undirected graph draws none", (await page.evaluate(() => document.querySelectorAll("[data-ovs-edge] polygon").length)) === 0);

    // ---- BFS and shortest path, from a real run in the page ----
    await seek("help-scene", 2);
    const h = JSON.parse(await page.evaluate(() => document.querySelector("[data-test-helpers]").getAttribute("data-test-helpers")));
    // By hand: A: B C. B: A D. C: A D F. D: B C E. E: D F. F: C E.
    // Queue: A; B C (from A); D (from B); F (from C, D already queued); E (from D).
    check("bfsOrder on the six-node graph is A B C D F E (worked out by hand)", JSON.stringify(h.order) === JSON.stringify(["A", "B", "C", "D", "F", "E"]));
    check("control: a depth-first order (A B D C F E) is not what bfsOrder returns", JSON.stringify(h.order) !== JSON.stringify(["A", "B", "D", "C", "F", "E"]));
    const adjOk = (p) => p.every((v, i) => i === 0 || h.adj[p[i - 1]].includes(v));
    check("shortestPath A to F is a valid path of two edges: A C F", JSON.stringify(h.path) === JSON.stringify(["A", "C", "F"]) && adjOk(h.path));
    check("control: the longer path A B D E F exists in the graph, is valid, and is not the one returned", adjOk(["A", "B", "D", "E", "F"]) && JSON.stringify(h.path) !== JSON.stringify(["A", "B", "D", "E", "F"]) && h.path.length < 5);
    check("shortestPath to a node that is not there is null", h.none === null);
    check("adjacencyFrom builds undirected lists from edges", h.viaEdges.A.join() === "B,C" && h.viaEdges.D.join() === "B,C,E" && h.viaEdges.F.join() === "C,E");
    const s3 = h.steps[3];
    check("bfsSteps visits the BFS order at first + k x every, with done and frontier from the real run", h.steps.map((s) => s.visit).join("") === "ABCDFE" && h.steps.map((s) => s.frame).join() === "10,30,50,70,90,110" && s3.done.join() === "A,B,C" && s3.frontier.slice().sort().join() === "E,F");
    check("bfsSteps with a goal ends on the shortest path", h.withGoal.length === 7 && h.withGoal[6].path.join("") === "ACF");

    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) {
  skip("graph-viz", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

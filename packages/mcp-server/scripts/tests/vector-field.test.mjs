#!/usr/bin/env node
// vector-field: VectorField from @openvidstudio/stem (#141), measured in real frames at 1920x1080 and
// 1080x1920. Expected arrow tips are worked out here from the props the scene was given (grid, box,
// scale, field), not read back from the component.
//
// Sample scene: the field of a point charge (radial arrows) with field lines on.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, rgb, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const AMBER = [255, 179, 71];
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);

// The scene imports straight from the source file so the test does not depend on index.ts.
const wrap = (name, body) => `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { VectorField } from "@openvidstudio/stem/src/VectorField";
import { Axes } from "@openvidstudio/stem/src/graph";

export const ${name}: React.FC = () => {
  const { width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const box = { x: Math.round(width * 0.14), y: Math.round(height * 0.2), width: Math.round(width * 0.72), height: Math.round(Math.min(width, height) * 0.6) };
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
${body}
    </AbsoluteFill>
  );
};
`;

const SWIRL = "(x: number, y: number): [number, number] => [-y + 0.3, 0.8 * x + 0.1]";
const swirl = (x, y) => [-y + 0.3, 0.8 * x + 0.1];
const GRID = "{ columns: 6, rows: 5 }";

const PLAIN = wrap("PlainScene", `      <VectorField box={box} xRange={[-1, 1]} yRange={[-1, 1]} grid={${GRID}} scale={S * 0.06} at={10} field={${SWIRL}} />`);
const LINES = wrap("LinesScene", `      <VectorField box={box} xRange={[-1, 1]} yRange={[-1, 1]} grid={${GRID}} scale={S * 0.06} fieldLines lineDuration={45} field={${SWIRL}} />`);
const NORM = wrap("NormScene", `      <VectorField box={box} xRange={[-1, 1]} yRange={[-1, 1]} grid={${GRID}} normalize={S * 0.05} field={${SWIRL}} />`);
const CAP = wrap("CapScene", `      <VectorField box={box} xRange={[-1, 1]} yRange={[-1, 1]} grid={${GRID}} scale={S * 0.06} maxLength={S * 0.04} field={${SWIRL}} />`);
const INAXES = wrap("InAxesScene", `      <Axes box={box} xRange={[0, 4]} yRange={[0, 3]}>
        <VectorField grid={{ columns: 4, rows: 3 }} scale={S * 0.05} field={(x: number, y: number): [number, number] => [1, y - 1]} />
      </Axes>`);
const CHARGE_FIELD = "(x: number, y: number): [number, number] => { const r2 = x * x + y * y; return r2 < 1e-6 ? [0, 0] : [x / r2, y / r2]; }";
const RING = "Array.from({ length: 12 }, (_, k): [number, number] => [0.3 * Math.cos((k * Math.PI) / 6 + 0.26), 0.3 * Math.sin((k * Math.PI) / 6 + 0.26)])";
const CHARGE = wrap("ChargeScene", `      <VectorField box={box} xRange={[-box.width / box.height, box.width / box.height]} yRange={[-1, 1]} grid={{ columns: 8, rows: 8 }} scale={S * 0.02} maxLength={S * 0.07} fieldLines seeds={${RING}} field={${CHARGE_FIELD}} />`);

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-vf-${width}x${height}-`,
    width,
    height,
    scenes: {
      "plain-scene": { source: PLAIN, duration: 60 },
      "lines-scene": { source: LINES, duration: 80 },
      "norm-scene": { source: NORM, duration: 40 },
      "cap-scene": { source: CAP, duration: 40 },
      "in-axes-scene": { source: INAXES, duration: 40 },
      "charge-scene": { source: CHARGE, duration: 80 },
    },
  });
  const S = Math.min(width, height);
  const box = { x: Math.round(width * 0.14), y: Math.round(height * 0.2), width: Math.round(width * 0.72), height: Math.round(S * 0.6) };
  const toWorld = (b, xr, yr) => (px, py) => ({ x: xr[0] + ((px - b.x) / b.width) * (xr[1] - xr[0]), y: yr[0] + ((b.y + b.height - py) / b.height) * (yr[1] - yr[0]) });
  const toScreen = (b, xr, yr) => (x, y) => ({ x: b.x + ((x - xr[0]) / (xr[1] - xr[0])) * b.width, y: b.y + b.height - ((y - yr[0]) / (yr[1] - yr[0])) * b.height });

  /** The expected arrows for a grid on a box: tail, and tip = tail + scale * (fx, -fy). */
  const expectedArrows = (b, xr, yr, cols, rows, field, arrowLength) => {
    const tw = toWorld(b, xr, yr);
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tail = { x: b.x + ((c + 0.5) * b.width) / cols, y: b.y + ((r + 0.5) * b.height) / rows };
        const w = tw(tail.x, tail.y);
        const [fx, fy] = field(w.x, w.y);
        const m = Math.hypot(fx, fy);
        const len = arrowLength(m);
        out.push({ tail, len, dir: m > 0 ? { x: fx / m, y: -fy / m } : { x: 0, y: 0 } });
      }
    }
    return out;
  };

  await inBrowser(project, async ({ comp, page, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowing = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-glow]")).filter((e) => Number.parseFloat(e.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length);
    const readArrows = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-ovs-arrow]")).map((g) => {
          const l = g.querySelector("line");
          const tip = g.querySelector("polygon").getAttribute("points").split(" ")[0].split(",").map(Number);
          return { tail: { x: Number(l.getAttribute("x1")), y: Number(l.getAttribute("y1")) }, tip: { x: tip[0], y: tip[1] }, gx: Number(g.getAttribute("data-ovs-gx")), gy: Number(g.getAttribute("data-ovs-gy")) };
        }),
      );
    const readLines = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-ovs-fieldline]")).map((p) =>
          p
            .getAttribute("d")
            .split(/(?=[ML])/)
            .map((s) => s.slice(1).trim().split(" ").map(Number))
            .map(([x, y]) => ({ x, y })),
        ),
      );
    const polyLength = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

    // ---- arrows: length and direction at every grid point ----
    const full = 10 + 20 + 4;
    await frame("plain-scene", full);
    const arrows = await readArrows();
    const want = expectedArrows(box, [-1, 1], [-1, 1], 6, 5, swirl, (m) => m * S * 0.06);
    check("30 arrows, one per grid point (6 x 5)", arrows.length === 30);
    let worstTail = 0, worstTip = 0, worstLen = 0;
    arrows.forEach((a, i) => {
      const e = want[i];
      worstTail = Math.max(worstTail, Math.hypot(a.tail.x - e.tail.x, a.tail.y - e.tail.y));
      worstTip = Math.max(worstTip, Math.hypot(a.tip.x - (e.tail.x + e.dir.x * e.len), a.tip.y - (e.tail.y + e.dir.y * e.len)));
      worstLen = Math.max(worstLen, Math.abs(Math.hypot(a.tip.x - a.tail.x, a.tip.y - a.tail.y) - e.len));
    });
    console.log(`  worst tail error ${worstTail.toFixed(4)}px, tip error ${worstTip.toFixed(4)}px, length error ${worstLen.toFixed(4)}px`);
    check("every arrow starts on its grid point, within 0.01px", worstTail < 0.01);
    check("every arrow's tip is tail + scale * (fx, -fy), so length is |f| * scale and direction is the field's, within 0.01px", worstTip < 0.01 && worstLen < 0.01);
    check("the arrows are not all the same length (length carries |f|)", new Set(want.map((e) => e.len.toFixed(1))).size > 10);

    // the same thing in pixels: walk the longest arrow's ray and find where the amber stops
    const imgFull = await frame("plain-scene", full);
    const iMax = want.reduce((best, e, i) => (e.len > want[best].len ? i : best), 0);
    const reachOf = (img, e) => {
      let last = 0;
      for (let d = 2; d < e.len + 12; d += 0.5) if (close(rgb(img, Math.round(e.tail.x + e.dir.x * d), Math.round(e.tail.y + e.dir.y * d)), AMBER, 40)) last = d;
      return last;
    };
    const px = reachOf(imgFull, want[iMax]);
    console.log(`  longest arrow (#${iMax}): ${px}px drawn, expected ${want[iMax].len.toFixed(1)}`);
    check("pixels: the longest arrow is |f| * scale long, within 3px", near(px, want[iMax].len, 3));
    check("control: the same arrow is not S*0.066 long (a wrong scale is told apart)", !near(px, want[iMax].len * 1.1, 3));

    // ---- nothing before `at` ----
    const before = await frame("plain-scene", 6);
    check("nothing before at: no arrow elements and no amber pixel", (await readArrows()).length === 0 && !(() => { for (let y = 0; y < before.height; y += 2) for (let x = 0; x < before.width; x += 2) if (close(rgb(before, x, y), AMBER, 40)) return true; return false; })());
    const grown = await frame("plain-scene", 10 + 8);
    const midLen = (await readArrows()).map((a) => Math.hypot(a.tip.x - a.tail.x, a.tip.y - a.tail.y));
    check("arrows grow: part way through they are shorter than at the end", midLen.length === 30 && midLen.every((l, i) => l < want[i].len + 1e-6) && midLen.some((l, i) => l > 1 && l < want[i].len - 1));
    void grown;

    // ---- the field-lines toggle ----
    await frame("plain-scene", 55);
    check("fieldLines off (the default): no field lines at all", (await readLines()).length === 0);
    await frame("lines-scene", 10);
    check("fieldLines on: no line yet while the arrows are still growing", (await readLines()).length === 0);
    await frame("lines-scene", 20 + 22);
    const partial = await readLines();
    await frame("lines-scene", 20 + 45 + 3);
    const lines = await readLines();
    console.log(`  field lines: ${lines.length}; mid draw ${partial.map(polyLength).reduce((a, b) => a + b, 0).toFixed(0)}px, finished ${lines.map(polyLength).reduce((a, b) => a + b, 0).toFixed(0)}px`);
    check("fieldLines on: the lines are there (one per seed, every other grid point = 9)", lines.length === 9);
    check("the lines are drawn on: shorter part way through than at the end, and not empty", partial.length === 9 && partial.every((p, i) => polyLength(p) < polyLength(lines[i]) - 1) && partial.some((p) => polyLength(p) > 10));
    check("control: turning the toggle off changes the count (9 against 0)", lines.length !== (await (async () => { await frame("plain-scene", 55); return (await readLines()).length; })()));

    // ---- lines follow the field ----
    await frame("lines-scene", 20 + 45 + 3);
    const tw = toWorld(box, [-1, 1], [-1, 1]);
    let worstCos = 1, segments = 0;
    for (const pts of lines) {
      for (let i = 1; i < pts.length; i++) {
        const mid = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
        const w = tw(mid.x, mid.y);
        const [fx, fy] = swirl(w.x, w.y);
        const m = Math.hypot(fx, fy);
        const sx = pts[i].x - pts[i - 1].x, sy = pts[i].y - pts[i - 1].y;
        const sm = Math.hypot(sx, sy);
        if (sm < 1e-9) continue;
        worstCos = Math.min(worstCos, (fx * sx + -fy * sy) / (m * sm));
        segments++;
      }
    }
    console.log(`  ${segments} line segments, worst cosine with the field direction ${worstCos.toFixed(5)}`);
    check("every segment of every line points along the field at its midpoint (cosine above 0.995)", segments > 200 && worstCos > 0.995);
    // at each arrow's tail that is a seed, the line's direction is the arrow's direction
    const arrowsL = await readArrows();
    let tangent = 0, tangentWorst = 1;
    arrowsL.forEach((a, i) => {
      const e = want[i];
      for (const pts of lines) {
        const dists = pts.map((p) => Math.hypot(p.x - a.tail.x, p.y - a.tail.y));
        const k = dists.indexOf(Math.min(...dists));
        if (dists[k] < 0.5 && k > 0 && k < pts.length - 1) {
          const dx = pts[k + 1].x - pts[k - 1].x, dy = pts[k + 1].y - pts[k - 1].y;
          tangentWorst = Math.min(tangentWorst, (dx * e.dir.x + dy * e.dir.y) / Math.hypot(dx, dy));
          tangent++;
        }
      }
    });
    console.log(`  ${tangent} arrow tails sit on a line; worst cosine between line and arrow ${tangentWorst.toFixed(5)}`);
    check("where a field line passes an arrow's tail it is tangent to the arrow (cosine above 0.99), and that happens at at least the 9 seeds", tangent >= 9 && tangentWorst > 0.99);
    check("control: a line is not tangent to the arrow of a different point (cosine measured against the wrong arrow is lower)", (() => {
      const e = want[1];
      const pts = lines[0];
      const dists = pts.map((p) => Math.hypot(p.x - arrowsL[0].tail.x, p.y - arrowsL[0].tail.y));
      const k = dists.indexOf(Math.min(...dists));
      if (dists[k] > 0.5 || k < 1) return false;
      const dx = pts[k + 1].x - pts[k - 1].x, dy = pts[k + 1].y - pts[k - 1].y;
      return (dx * e.dir.x + dy * e.dir.y) / Math.hypot(dx, dy) < 0.99;
    })());

    // ---- normalize and maxLength say so in the numbers ----
    await frame("norm-scene", 30);
    const nArr = await readArrows();
    check("normalize: every arrow is exactly that many px long, direction still the field's", nArr.every((a, i) => near(Math.hypot(a.tip.x - a.tail.x, a.tip.y - a.tail.y), S * 0.05, 0.01) && near((a.tip.x - a.tail.x) / (S * 0.05), want[i].dir.x, 1e-6)));
    await frame("cap-scene", 30);
    const cArr = await readArrows();
    const capOk = cArr.every((a, i) => near(Math.hypot(a.tip.x - a.tail.x, a.tip.y - a.tail.y), Math.min(want[i].len, S * 0.04), 0.01));
    check("maxLength: arrows are min(|f| * scale, cap), and some are actually capped", capOk && want.some((e) => e.len > S * 0.04 + 1) && want.some((e) => e.len < S * 0.04 - 1));

    // ---- inside <Axes> ----
    await frame("in-axes-scene", 30);
    const axArrows = await readArrows();
    const ts = toScreen(box, [0, 4], [0, 3]);
    let axWorst = 0;
    axArrows.forEach((a, i) => {
      const c = i % 4, r = Math.floor(i / 4);
      const w = { x: c + 0.5, y: 3 - (r + 0.5) };
      const tail = ts(w.x, w.y);
      const [fx, fy] = [1, w.y - 1];
      const tip = { x: tail.x + fx * S * 0.05, y: tail.y - fy * S * 0.05 };
      axWorst = Math.max(axWorst, Math.hypot(a.tail.x - tail.x, a.tail.y - tail.y), Math.hypot(a.tip.x - tip.x, a.tip.y - tip.y));
    });
    check("inside <Axes>: 12 arrows at the Axes' own grid points, tips by the pixel rule although the axes are not square", axArrows.length === 12 && axWorst < 0.01);

    // ---- sample scene: a point charge ----
    await frame("charge-scene", 20 + 45 + 3);
    const cc = toScreen(box, [-box.width / box.height, box.width / box.height], [-1, 1])(0, 0);
    const chArrows = await readArrows();
    const radialCos = chArrows.map((a) => {
      const dx = a.tip.x - a.tail.x, dy = a.tip.y - a.tail.y;
      const rx = a.tail.x - cc.x, ry = a.tail.y - cc.y;
      return (dx * rx + dy * ry) / (Math.hypot(dx, dy) * Math.hypot(rx, ry));
    });
    console.log(`  charge: ${chArrows.length} arrows, min radial cosine ${Math.min(...radialCos)}`);
    check("point charge: 64 arrows, every one points straight away from the charge (cosine above 0.9999)", chArrows.length === 64 && radialCos.every((v) => v > 0.9999));
    const chLen = chArrows.map((a) => Math.hypot(a.tip.x - a.tail.x, a.tip.y - a.tail.y));
    const aspect = box.width / box.height;
    const twc = toWorld(box, [-aspect, aspect], [-1, 1]);
    const wantLen = chArrows.map((a) => { const w = twc(a.tail.x, a.tail.y); return Math.min((1 / Math.hypot(w.x, w.y)) * S * 0.02, S * 0.07); });
    check("point charge: each arrow is min(scale / r, cap) long, so the field gets weaker with distance", chLen.every((l, i) => near(l, wantLen[i], 0.01)) && Math.max(...chLen) > 2 * Math.min(...chLen));
    const cLines = await readLines();
    let radWorst = 1;
    for (const pts of cLines) for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i].x + pts[i - 1].x) / 2 - cc.x, my = (pts[i].y + pts[i - 1].y) / 2 - cc.y;
      const sx = pts[i].x - pts[i - 1].x, sy = pts[i].y - pts[i - 1].y;
      radWorst = Math.min(radWorst, (mx * sx + my * sy) / (Math.hypot(mx, my) * Math.hypot(sx, sy)));
    }
    console.log(`  charge: ${cLines.length} lines, worst radial cosine ${radWorst}, lengths ${cLines.map((p) => p.length).join(",")}`);
    check("point charge: 12 field lines, each running straight out from the charge", cLines.length === 12 && radWorst > 0.999);
    check("point charge: the lines reach the edge of the box", cLines.every((pts) => { const e = pts[pts.length - 1]; return Math.min(Math.abs(e.x - box.x), Math.abs(e.x - box.x - box.width), Math.abs(e.y - box.y), Math.abs(e.y - box.y - box.height)) < S * 0.03; }));

    // ---- purity and glow ----
    // Purity. The markup must be identical across interleaved renders. Pixels are compared on a warm
    // page: the very first paint of a long antialiased path after a scene switch can differ in a few
    // edge bytes in this browser, which says nothing about the component.
    const html = () => page.evaluate(() => document.querySelector("[data-ovs-vectorfield]").outerHTML);
    await frame("lines-scene", 40);
    const h1 = await html();
    await frame("lines-scene", 70);
    await frame("lines-scene", 40);
    const h2 = await html();
    check("frame-purity: frame 40 rendered twice, with another frame between, gives identical markup", h1 === h2 && h1.length > 1000);
    const a2 = await frame("lines-scene", 40);
    await frame("lines-scene", 70);
    const a3 = await frame("lines-scene", 40);
    check("frame-purity: and identical pixels once the page is warm", sameBytes(a2, a3));
    await frame("lines-scene", 41);
    check("control: a different frame (41) has different markup", (await html()) !== h2);
    check("no glow: a vector field never glows", (await glowing()) === 0);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) {
  skip("vector-field", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

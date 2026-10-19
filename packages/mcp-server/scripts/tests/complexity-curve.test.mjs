#!/usr/bin/env node
// complexity-curve: ComplexityCurve from @openvidstudio/stem (#142), measured in real frames at
// 1920x1080 and 1080x1920. Expected positions are worked out here: the axes' own mapping (box and
// ranges) applied to n, n log2 n and n^2 at the marked n.
//
// Sample scene: the three growth curves with a marker at n = 12.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, rgb, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);
const GREEN = [124, 255, 178];
const VIOLET = [181, 140, 255];
const RED = [255, 77, 94];
const f = { n: (x) => x, nlogn: (x) => x * Math.log2(x), n2: (x) => x * x };

// The scene imports straight from the source file so the test does not depend on index.ts.
const wrap = (name, body) => `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { ComplexityCurve } from "@openvidstudio/stem/src/ComplexityCurve";

export const ${name}: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
${body}
    </AbsoluteFill>
  );
};
`;

const SAMPLE = wrap("SampleScene", `      <ComplexityCurve n={12} xMax={20} yMax={200} at={10} duration={40} />`);
const AUTO = wrap("AutoScene", `      <ComplexityCurve n={12} at={0} duration={30} />`);
const SUBSET = wrap("SubsetScene", `      <ComplexityCurve curves={["n", "n2"]} n={8} xMax={10} yMax={80} duration={30} labels={false} box={{ x: Math.round(width * 0.15), y: Math.round(height * 0.2), width: Math.round(width * 0.7), height: Math.round(Math.min(width, height) * 0.5) }} />`);

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-cc-${width}x${height}-`,
    width,
    height,
    scenes: {
      "sample-scene": { source: SAMPLE, duration: 70 },
      "auto-scene": { source: AUTO, duration: 50 },
      "subset-scene": { source: SUBSET, duration: 50 },
    },
  });
  const S = Math.min(width, height);
  // The default box of <Axes>, as graph.tsx lays it out.
  const x0 = Math.round(width * 0.14);
  const dbox = height > width ? { x: x0, y: Math.round(height * 0.3), width: width - 2 * x0, height: Math.round(width * 0.78) } : { x: x0, y: Math.round(height * 0.14), width: width - 2 * x0, height: Math.round(height * 0.66) };
  const mk = (b, xMax, yMax) => (x, y) => ({ x: b.x + (x / xMax) * b.width, y: b.y + b.height - (y / yMax) * b.height });

  await inBrowser(project, async ({ comp, page, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowing = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-glow]")).filter((e) => Number.parseFloat(e.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length);
    const readPoints = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-ovs-plot="point"]')).map((g) => {
          const c = g.querySelector("circle");
          return { x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")), stroke: c.getAttribute("stroke"), text: g.querySelector("text")?.textContent ?? null };
        }),
      );
    const readCurves = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-ovs-plot="curve"]')).map((p) => {
          const pts = p.getAttribute("d").trim().split(/(?=[ML])/).map((s) => s.slice(1).trim().split(" ").map(Number));
          return { first: { x: pts[0][0], y: pts[0][1] }, last: { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }, stroke: p.getAttribute("stroke") };
        }),
      );
    const hasColour = (img, colours, tol = 30) => {
      for (let y = 0; y < img.height; y += 2) for (let x = 0; x < img.width; x += 2) if (colours.some((c) => close(rgb(img, x, y), c, tol))) return true;
      return false;
    };

    // ---- nothing before `at` ----
    const empty = await frame("sample-scene", 6);
    check("nothing before at: no curve, no dot, no rule, no label, no curve-coloured pixel", (await readCurves()).length === 0 && (await readPoints()).length === 0 && (await page.evaluate(() => document.querySelectorAll("[data-ovs-marker], [data-ovs-curve-label]").length)) === 0 && !hasColour(empty, [GREEN, VIOLET, RED]));

    // ---- part way: drawing on ----
    await frame("sample-scene", 10 + 20);
    const T = mk(dbox, 20, 200);
    const mid = await readCurves();
    const end = T(20, f.n2(20));
    check("part way through the draw-on the curves are there but have not reached the right end", mid.length === 3 && mid.every((c) => c.last.x > dbox.x + 5 && c.last.x < T(20, 0).x - 5));

    // ---- finished ----
    const done = await frame("sample-scene", 10 + 40 + 4);
    const curves = await readCurves();
    const endsOk = curves.length === 3 && ["n", "nlogn", "n2"].every((k, i) => near(curves[i].last.x, T(20, 0).x, 0.01) && near(curves[i].last.y, T(20, f[k](20)).y, 0.01) && near(curves[i].first.x, T(0, 0).x, 0.01));
    console.log(`  curve ends: ${curves.map((c) => `(${c.last.x.toFixed(1)}, ${c.last.y.toFixed(1)})`).join(" ")}; expected x ${T(20, 0).x.toFixed(1)}`);
    check("at the end of the draw-on every curve is drawn all the way to xMax = 20 at its own value (20, 86.4, 400)", endsOk);
    void end;
    const cx6 = T(6, f.nlogn(6));
    check("pixels: the n log n curve is violet at x = 6", close(rgb(done, cx6.x, cx6.y), VIOLET, 45));
    const cx10 = T(10, f.n(10));
    check("pixels: the n curve is green at x = 10", close(rgb(done, cx10.x, cx10.y), GREEN, 45));
    const cx9 = T(9, f.n2(9));
    check("pixels: the n squared curve is red at x = 9", close(rgb(done, cx9.x, cx9.y), RED, 45));

    // ---- the marker ----
    const pts = await readPoints();
    const wantY = { n: 12, nlogn: 12 * Math.log2(12), n2: 144 };
    const dots = ["n", "nlogn", "n2"].map((k) => ({ k, want: T(12, wantY[k]) }));
    let worst = 0;
    dots.forEach((d, i) => { if (pts[i]) worst = Math.max(worst, Math.hypot(pts[i].x - d.want.x, pts[i].y - d.want.y)); });
    console.log(`  marker dots: ${pts.map((p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).join(" ")} (worst error ${worst.toFixed(4)}px)`);
    check("three marker dots, each at Axes.toScreen(12, f(12)) for 12, 12 log2 12 and 144, within 0.01px", pts.length === 3 && worst < 0.01);
    check("on screen, at n = 12 the order is n below n log n below n squared (larger y is lower)", pts.length === 3 && pts[0].y > pts[1].y && pts[1].y > pts[2].y);
    check("the dots take their curve's colours (green, violet, red)", pts.length === 3 && pts[0].stroke.toUpperCase() === "#7CFFB2" && pts[1].stroke.toUpperCase() === "#B58CFF" && pts[2].stroke.toUpperCase() === "#FF4D5E");
    check("control: the base is 2, not e: with a natural log the dot would be more than 5px away", pts.length === 3 && Math.hypot(pts[1].x - T(12, 12 * Math.log(12)).x, pts[1].y - T(12, 12 * Math.log(12)).y) > 5);
    check("control: it is n squared, not n squared over two", pts.length === 3 && Math.abs(pts[2].y - T(12, 72).y) > 5);
    check("the values are written at the dots: 12, 43 and 144", JSON.stringify(pts.map((p) => p.text)) === JSON.stringify(["12", "43", "144"]));
    const rule = await page.evaluate(() => {
      const l = document.querySelector("[data-ovs-marker-rule]");
      return l ? { x1: Number(l.getAttribute("x1")), x2: Number(l.getAttribute("x2")), y1: Number(l.getAttribute("y1")), y2: Number(l.getAttribute("y2")) } : null;
    });
    check("the vertical rule stands at n = 12, from the x axis to the top of the plot", rule !== null && near(rule.x1, T(12, 0).x, 0.01) && near(rule.x2, T(12, 0).x, 0.01) && near(rule.y2, T(0, 0).y, 0.01) && near(rule.y1, dbox.y, 0.01));
    const texts = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-marker] text")).map((t) => t.textContent));
    check('the marker says "n = 12"', texts.includes("n = 12"));

    // ---- labels at the ends ----
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-curve-label]")).map((t) => ({ k: t.getAttribute("data-ovs-curve-label"), text: t.textContent, x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")), size: Number(t.getAttribute("font-size")), fill: t.getAttribute("fill") })));
    check("each curve is named at its end: n, n log n and n²", JSON.stringify(labels.map((l) => l.text)) === JSON.stringify(["n", "n log n", "n²"]));
    check("the names are inside the plot and at least 2.4% of the shorter side", labels.every((l) => l.x > dbox.x && l.x < dbox.x + dbox.width && l.y > dbox.y && l.y < dbox.y + dbox.height && l.size >= S * 0.024));
    check("the names are in their curve's colour", labels.length === 3 && labels[0].fill.toUpperCase() === "#7CFFB2" && labels[1].fill.toUpperCase() === "#B58CFF" && labels[2].fill.toUpperCase() === "#FF4D5E");
    const ends = labels.map((l) => l.x);
    check("the n and n log n names sit at the right end (past x = 17), the steep n squared name where that curve leaves the top (before x = 15)", labels.length === 3 && ends[0] > T(17, 0).x && ends[1] > T(17, 0).x && ends[2] < T(15, 0).x);

    // ---- auto yMax ----
    await frame("auto-scene", 40);
    const TA = mk(dbox, 18, 180);
    const autoPts = await readPoints();
    check("auto axes: xMax is 1.5 x n = 18 and yMax is 1.25 x 144 = 180, so the dots land where those axes put them", autoPts.length === 3 && ["n", "nlogn", "n2"].every((k, i) => near(autoPts[i].x, TA(12, wantY[k]).x, 0.01) && near(autoPts[i].y, TA(12, wantY[k]).y, 0.01)));

    // ---- a selection and a box ----
    await frame("subset-scene", 40);
    const sbox = { x: Math.round(width * 0.15), y: Math.round(height * 0.2), width: Math.round(width * 0.7), height: Math.round(S * 0.5) };
    const TS = mk(sbox, 10, 80);
    const sub = await readPoints();
    check("curves=[n, n2] with a box: two dots at Axes.toScreen(8, 8) and (8, 64) in that box, no value text with labels off", sub.length === 2 && near(sub[0].x, TS(8, 8).x, 0.01) && near(sub[0].y, TS(8, 8).y, 0.01) && near(sub[1].y, TS(8, 64).y, 0.01) && sub.every((p) => p.text === null));
    check("curves=[n, n2]: no n log n curve and no curve names", (await readCurves()).length === 2 && (await page.evaluate(() => document.querySelectorAll("[data-ovs-curve-label]").length)) === 0);

    // ---- purity and glow ----
    const a1 = await frame("sample-scene", 35);
    await frame("sample-scene", 60);
    const a2 = await frame("sample-scene", 35);
    check("frame-purity: frame 35 rendered twice, with another frame between, is identical bytes", sameBytes(a1, a2));
    check("no glow: the curves never glow", (await glowing()) === 0);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) {
  skip("complexity-curve", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

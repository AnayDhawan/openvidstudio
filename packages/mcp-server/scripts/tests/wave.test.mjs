#!/usr/bin/env node
// wave: the Wave primitive from @openvidstudio/stem (#141), measured in real frames at 1920x1080 and
// 1080x1920. Expected numbers are worked out here from the props the scene was given: a wave of
// wavelength 200 has crests 200 px apart, a crest is `amplitude` above the rest line, a travelling
// crest moves `speed` px per frame, and a standing wave's nodes never move.
//
// Sample scene: a travelling wave with its wavelength and amplitude labelled.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, rgb, brightCentroid, meanLuma, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);
const AMBER = [255, 179, 71];

const BOX = `{ x: Math.round((width - 960) / 2), y: Math.round(height * 0.4), width: 960, height: Math.round(height * 0.2) }`;
const wrap = (name, body) => `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Wave } from "@openvidstudio/stem/src/Wave";

export const ${name}: React.FC = () => {
  const { width, height } = useVideoConfig();
  const box = ${BOX};
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
${body}
    </AbsoluteFill>
  );
};
`;

const SCENES = {
  // labelled, with a Spark on a crest
  "travel-scene": wrap("TravelScene", `      <Wave box={box} wavelength={200} amplitude={80} speed={4} spark="crest" />`),
  // the same numbers with no labels and no Spark, so the stroke can be measured by pixel
  "bare-scene": wrap("BareScene", `      <Wave box={box} wavelength={200} amplitude={80} speed={4} labels={false} />`),
  "spark-scene": wrap("SparkScene", `      <Wave box={box} wavelength={200} amplitude={80} speed={4} labels={false} spark="crest" />`),
  "phase-scene": wrap("PhaseScene", `      <Wave box={box} wavelength={200} amplitude={50} speed={5} phase={Math.PI / 2} labels={{ wavelength: false, amplitude: false }} />`),
  "standing-scene": wrap("StandingScene", `      <Wave box={box} mode="standing" wavelength={200} amplitude={60} period={60} spark="crest" />`),
  "late-scene": wrap("LateScene", `      <Wave box={box} wavelength={200} amplitude={80} speed={4} at={20} />`),
};

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-wave-${width}x${height}-`,
    width,
    height,
    scenes: Object.fromEntries(Object.entries(SCENES).map(([id, source]) => [id, { source, duration: 90 }])),
  });
  const x0 = Math.round((width - 960) / 2);
  const y0 = Math.round(height * 0.4);
  const base = y0 + Math.round(height * 0.2) / 2;
  const weight = Math.max(3, Math.round(Math.min(width, height) / 360));
  const halfStroke = (weight * 1.6) / 2;
  const K = (2 * Math.PI) / 200;

  await inBrowser(project, async ({ comp, page, frame, seek, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowing = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-glow]")).filter((e) => Number.parseFloat(e.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length);
    const at = async (beat, local) => { await frame(beat, local); };
    // The wave's sampled points, read out of the drawn path.
    const points = () => page.evaluate(() => {
      const d = document.querySelector("[data-ovs-wave]")?.getAttribute("d");
      if (!d) return null;
      return Array.from(d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)).map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    });
    const yAt = (pts, x) => {
      for (let i = 1; i < pts.length; i++) if (x <= pts[i].x + 1e-9) {
        const k = (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x || 1);
        return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k;
      }
      return pts[pts.length - 1].y;
    };
    const attr = (sel, name) => page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null, [sel, name]);
    const crestList = async () => ((await attr("[data-ovs-wave]", "data-ovs-crests")) || "").split(",").filter(Boolean).map(Number);

    // ---- a travelling wave ----
    await at("travel-scene", 60);
    const pts60 = await points();
    check("travelling: the wave is drawn as a dense path (at least 24 samples per wavelength)", pts60 !== null && pts60.length >= 24 * 4.8);
    const ys = pts60.map((p) => p.y);
    console.log(`  peak height ${(base - Math.min(...ys)).toFixed(4)} (amplitude 80), trough depth ${(Math.max(...ys) - base).toFixed(4)}`);
    check("travelling: the peak is exactly the amplitude (80 px) above the rest line", near(base - Math.min(...ys), 80, 0.01));
    check("travelling: and the trough exactly 80 px below it", near(Math.max(...ys) - base, 80, 0.01));
    const c60 = await crestList();
    console.log(`  crests at t=60: ${c60.map((c) => (c - x0).toFixed(2)).join(", ")} (from the left edge)`);
    check("travelling: crests are where cos(k(x - x0 - speed t)) = 1, i.e. 40, 240, 440, ... from the left edge at t = 60", c60.length === 5 && c60.every((c, i) => near(c - x0, 40 + 200 * i, 0.01)));
    check("travelling: neighbouring crests are exactly one wavelength (200 px) apart", c60.slice(1).every((c, i) => near(c - c60[i], 200, 0.01)));
    check("control: the same crests are NOT 210 px apart (the spacing check can fail)", !c60.slice(1).every((c, i) => near(c - c60[i], 210, 0.5)));
    check("travelling: the path really peaks at every crest, 80 px above the rest line", c60.every((c) => near(yAt(pts60, c), base - 80, 0.05)));
    await at("travel-scene", 61);
    const c61 = await crestList();
    console.log(`  crest shift per frame: ${(c61[0] - c60[0]).toFixed(4)} (speed 4)`);
    check("travelling: one frame later every crest has moved exactly 4 px (the speed)", c61.length === c60.length && c61.every((c, i) => near(c - c60[i], 4, 0.001)));
    check("control: it has not moved 5 px", !c61.every((c, i) => near(c - c60[i], 5, 0.5)));
    await at("travel-scene", 80);
    const c80 = await crestList();
    check("travelling: twenty frames on, 80 px (not a wavelength off the pattern: crests at 120 + 200 n)", c80.every((c, i) => near(c - x0, 120 + 200 * i, 0.01)));

    // ---- the pixels agree ----
    const bare = await frame("bare-scene", 60);
    const topmost = (img, x) => { for (let y = Math.floor(y0 - 150); y < y0 + 400; y++) if (close(rgb(img, x, y), AMBER, 70)) return y; return -1; };
    const bottommost = (img, x) => { for (let y = Math.floor(y0 + 400); y > y0 - 150; y--) if (close(rgb(img, x, y), AMBER, 70)) return y; return -1; };
    const cx = x0 + 40;
    const top = topmost(bare, cx);
    console.log(`  stroke top at the first crest: y ${top}, expected ${(base - 80 - halfStroke).toFixed(1)}`);
    check("pixels: at the first crest the stroke's top edge is amplitude + half a stroke above the rest line", near(top, base - 80 - halfStroke, 2.5));
    check("pixels: half a wavelength on, at the trough, the stroke's bottom edge is amplitude + half a stroke below it", near(bottommost(bare, cx + 100), base + 80 + halfStroke, 2.5));
    check("control: a quarter wavelength on the stroke is nowhere near crest height", Math.abs(topmost(bare, cx + 50) - top) > 60);
    check("pixels: the second crest is 200 px on and just as high", near(topmost(bare, cx + 200), top, 2));
    check("pixels: nothing is drawn right of the box", topmost(bare, x0 + 960 + 40) === -1);
    check("pixels: no glow without a Spark", (await glowing()) === 0);

    // ---- the labels ----
    await at("travel-scene", 60);
    const wl = { x1: Number(await attr("[data-ovs-label=wavelength]", "data-ovs-x1")), x2: Number(await attr("[data-ovs-label=wavelength]", "data-ovs-x2")) };
    check("labels: the wavelength bracket is exactly 200 px wide", near(wl.x2 - wl.x1, 200, 0.01));
    check("labels: and it runs from one crest to the next", c60.some((c) => near(c, wl.x1, 0.01)) && c60.some((c) => near(c, wl.x2, 0.01)));
    const ampLine = await page.evaluate(() => { const l = document.querySelector("[data-ovs-amplitude-line]"); return l ? { y1: Number(l.getAttribute("y1")), y2: Number(l.getAttribute("y2")), x: Number(l.getAttribute("x1")) } : null; });
    check("labels: the amplitude arrow is exactly 80 px long, from the rest line up to the crest", ampLine !== null && near(ampLine.y1 - ampLine.y2, 80, 0.01) && near(ampLine.y1, base, 0.01));
    check("labels: and it stands on a crest", ampLine !== null && c60.some((c) => near(c, ampLine.x, 0.01)));
    const texts = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-label] text")).map((t) => ({ s: t.textContent, size: Number(t.getAttribute("font-size")) })));
    console.log(`  label texts: ${JSON.stringify(texts)}`);
    check("labels: the wavelength, amplitude and phase are named (λ, A, φ = 0)", ["λ", "A", "φ = 0"].every((s) => texts.some((t) => t.s === s)));
    check("labels: text is at least 2.4% of the shorter side", texts.every((t) => t.size >= Math.min(width, height) * 0.024 - 0.01));
    const strokeWidths = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-wave-root] line, [data-ovs-wave-root] path")).map((e) => Number(e.getAttribute("stroke-width"))));
    check("strokes are never thinner than the line weight", strokeWidths.every((w) => w >= weight - 1e-9));
    await at("bare-scene", 60);
    check("control: with labels switched off no label is drawn", (await page.evaluate(() => document.querySelectorAll("[data-ovs-label]").length)) === 0);

    // ---- the Spark rides a crest ----
    const sparkX = (t) => { const lo = x0 + 50; return lo + ((((x0 + 4 * t) - lo) % 200) + 200) % 200; };
    for (const t of [60, 80]) {
      const img = await frame("spark-scene", t);
      const sx = sparkX(t);
      const c = brightCentroid(img, 200, { x: Math.round(sx - 40), y: Math.round(base - 80 - 40), w: 80, h: 80 });
      console.log(`  Spark at t=${t}: found ${c ? `${c.x.toFixed(1)}, ${c.y.toFixed(1)}` : "none"}, crest at ${sx.toFixed(1)}, ${base - 80}`);
      check(`Spark: at frame ${t} the bright core sits on a crest (x ${sx - x0} from the left edge, ${80} px above the rest line)`, c !== null && near(c.x, sx, 3) && near(c.y, base - 80, 3));
      const dom = { x: Number(await attr("[data-ovs-crest-spark]", "data-ovs-x")), y: Number(await attr("[data-ovs-crest-spark]", "data-ovs-y")) };
      const crests = await crestList();
      check(`Spark: at frame ${t} that point is one of the wave's crests`, crests.some((cr) => near(cr, dom.x, 0.01)) && near(dom.y, base - 80, 0.01));
      check(`control: at frame ${t} the Spark is not 40 px off the crest`, !(c !== null && near(c.x, sx + 40, 3)));
    }
    check("Spark: exactly one glowing element", (await glowing()) === 1);

    // ---- a phase offset ----
    await at("phase-scene", 40);
    const cp = await crestList();
    console.log(`  phase pi/2, t=40, speed 5: crests ${cp.map((c) => (c - x0).toFixed(2)).join(", ")} from the left edge`);
    check("phase: a phase of pi/2 shifts the crests back a quarter wavelength (crest at (n - 1/4) wavelengths, plus 200 px of travel)", cp.every((c, i) => near(c - x0, 150 + 200 * i, 0.01)) && cp.length === 5);
    const ptsP = await points();
    check("phase: the displacement at the left edge is amplitude x cos(phase - k speed t)", near(base - ptsP[0].y, 50 * Math.cos(Math.PI / 2 - K * 5 * 40), 0.01));
    const phaseText = await page.evaluate(() => document.querySelector("[data-ovs-label=phase] text")?.textContent);
    check("phase: the marker says φ = 0.5π", phaseText === "φ = 0.5π");

    // ---- a standing wave ----
    const nodeXs = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-node]")).map((n) => Number(n.getAttribute("data-ovs-node"))));
    let nodes0 = null;
    for (const t of [30, 37, 45, 60, 75]) {
      await at("standing-scene", t);
      const pts = await points();
      const nodes = await nodeXs();
      if (nodes0 === null) nodes0 = nodes;
      check(`standing: at frame ${t} the nodes are at 50, 150, 250, ... px from the left edge`, nodes.length === 10 && nodes.every((n, i) => near(n - x0, 50 + 100 * i, 0.01)) && JSON.stringify(nodes) === JSON.stringify(nodes0));
      check(`standing: at frame ${t} the wave is on the rest line at every node`, nodes.every((n) => near(yAt(pts, n), base, 0.01)));
      const swing = 60 * Math.cos((2 * Math.PI * t) / 60);
      const a0 = yAt(pts, x0);
      const a1 = yAt(pts, x0 + 100);
      console.log(`  standing t=${t}: antinode at 0 is ${(base - a0).toFixed(3)} (expected ${swing.toFixed(3)}), at 100 is ${(base - a1).toFixed(3)}`);
      check(`standing: at frame ${t} the antinode at 0 is at ${swing.toFixed(2)} and its neighbour at 100 is the mirror image`, near(base - a0, swing, 0.01) && near(base - a1, -swing, 0.01));
    }
    await at("standing-scene", 45);
    const pts45 = await points();
    check("standing: a quarter period (15 frames) after full stretch every point is on the rest line", Math.abs(60 * Math.cos((2 * Math.PI * 45) / 60)) < 1e-9 && pts45.every((p) => near(p.y, base, 0.01)));
    check("control: an antinode that stayed put would fail the swing check (the swing at 37 differs from the swing at 30)", Math.abs(60 * Math.cos((2 * Math.PI * 37) / 60) - 60 * Math.cos((2 * Math.PI * 30) / 60)) > 10);
    // the Spark on the antinode
    for (const t of [30, 37]) {
      const img = await frame("standing-scene", t);
      const sx = x0 + 600;
      const sy = base - 60 * Math.cos((2 * Math.PI * t) / 60);
      const c = brightCentroid(img, 200, { x: sx - 40, y: Math.round(sy - 40), w: 80, h: 80 });
      console.log(`  standing Spark t=${t}: ${c ? `${c.x.toFixed(1)}, ${c.y.toFixed(1)}` : "none"} expected ${sx}, ${sy.toFixed(1)}`);
      check(`standing: at frame ${t} the Spark rides the antinode at 600 px, at ${(base - sy).toFixed(1)} above the rest line`, c !== null && near(c.x, sx, 3) && near(c.y, sy, 3));
    }
    check("standing: one glowing element", (await glowing()) === 1);

    // ---- purity and timing ----
    const html = () => page.evaluate(() => document.querySelector("[data-ovs-wave-root]")?.outerHTML ?? "");
    await frame("travel-scene", 60);
    const h1 = await html();
    await frame("travel-scene", 33);
    const hMid = await html();
    await frame("travel-scene", 60);
    const h2 = await html();
    check("a pure function of the frame: frame 60 rendered twice, with another frame between, gives identical markup", h1 === h2 && h1.length > 1000);
    check("control: a different frame gives different markup", hMid !== h1);
    // Pixels are identical once the page is warm (headless Chrome rasterises the first repaint after a jump a little differently).
    await frame("travel-scene", 33);
    const a = await frame("travel-scene", 60);
    await frame("travel-scene", 33);
    const b = await frame("travel-scene", 60);
    check("a pure function of the frame: and identical pixels once the page is warm", sameBytes(a, b));
    check("control: different frames are different pixels", !sameBytes(a, await frame("travel-scene", 33)));
    const early = await frame("late-scene", 10);
    check("nothing is drawn before `at`", (await page.evaluate(() => document.querySelectorAll("[data-ovs-wave]").length)) === 0 && meanLuma(early) < 8);
    await frame("late-scene", 60);
    check("and the wave is there after `at`", (await page.evaluate(() => document.querySelectorAll("[data-ovs-wave]").length)) === 1);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) {
  skip("wave", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

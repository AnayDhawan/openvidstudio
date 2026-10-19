#!/usr/bin/env node
// orbit: the Orbit primitive from @openvidstudio/stem (#141), measured in real frames at 1920x1080 and
// 1080x1920. Expected numbers are worked out here from the props the scene was given, with an
// independent solver for Kepler's equation (bisection, not the component's Newton iteration).
//
// Sample scene: an orbit with the velocity and force arrows at one instant.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, rgb, luma, brightCentroid, meanLuma, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);
const BLUE = [92, 200, 255];
const EMBER = [255, 122, 61];
const DIM = [140, 135, 153];

const wrap = (name, body) => `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Orbit } from "@openvidstudio/stem/src/Orbit";

export const ${name}: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
${body}
    </AbsoluteFill>
  );
};
`;

const SCENES = {
  "circle-scene": wrap("CircleScene", `      <Orbit semiMajor={300} period={120} v={20} F={40} scale={{ velocity: 6, force: 4 }} centre={{ x: width / 2, y: height * 0.46 }} centreLabel="M" />`),
  "ellipse-scene": wrap("EllipseScene", `      <Orbit semiMajor={300} eccentricity={0.5} period={120} v={20} F={40} scale={{ velocity: 3, force: 1 }} />`),
  "tilt-scene": wrap("TiltScene", `      <Orbit semiMajor={250} eccentricity={0.4} period={100} periapsisAngle={120} clockwise v={20} F={40} scale={{ velocity: 3, force: 1 }} />`),
  "noarrow-scene": wrap("NoarrowScene", `      <Orbit semiMajor={300} period={120} arrows={false} v={20} F={40} scale={{ velocity: 6, force: 4 }} centre={{ x: width / 2, y: height * 0.46 }} />`),
  "late-scene": wrap("LateScene", `      <Orbit semiMajor={300} period={120} at={20} v={20} F={40} scale={{ velocity: 6, force: 4 }} centre={{ x: width / 2, y: height * 0.46 }} />`),
};

/** Kepler's equation by bisection: E - e sin E = M, M in [0, 2pi). */
function solveE(M, e) {
  let lo = 0;
  let hi = 2 * Math.PI;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (mid - e * Math.sin(mid) < M) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Position relative to the focus, screen px, counter-clockwise, periapsis to the right (pa = 0). */
function expected(a, e, period, t) {
  const M = ((2 * Math.PI * t) / period) % (2 * Math.PI);
  const E = solveE(M, e);
  const b = a * Math.sqrt(1 - e * e);
  const px = a * (Math.cos(E) - e);
  const py = b * Math.sin(E);
  const tx = -a * Math.sin(E);
  const ty = b * Math.cos(E);
  const tl = Math.hypot(tx, ty);
  return { x: px, y: -py, r: a * (1 - e * Math.cos(E)), tangent: { x: tx / tl, y: -ty / tl } };
}

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-orbit-${width}x${height}-`,
    width,
    height,
    scenes: Object.fromEntries(Object.entries(SCENES).map(([id, source]) => [id, { source, duration: 150 }])),
  });
  const S = Math.min(width, height);
  const weight = Math.max(3, Math.round(S / 360));
  const circleCentre = { x: width / 2, y: height * 0.46 };
  const focusDefault = { x: width / 2 + 150, y: height * 0.46 };

  await inBrowser(project, async ({ comp, page, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowing = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-glow]")).filter((e) => Number.parseFloat(e.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length);
    const read = () => page.evaluate(() => {
      const num = (sel, n) => { const el = document.querySelector(sel); return el ? Number(el.getAttribute(n)) : null; };
      const arrow = (kind) => {
        const g = document.querySelector(`[data-ovs-arrow=${kind}]`);
        if (!g) return null;
        const line = g.querySelector("line");
        const poly = g.querySelector("polygon").getAttribute("points").split(" ")[0].split(",").map(Number);
        return { magnitude: Number(g.getAttribute("data-ovs-magnitude")), length: Number(g.getAttribute("data-ovs-length")), dx: Number(g.getAttribute("data-ovs-dx")), dy: Number(g.getAttribute("data-ovs-dy")), x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")), tip: { x: poly[0], y: poly[1] } };
      };
      return {
        body: { x: num("[data-ovs-body]", "cx"), y: num("[data-ovs-body]", "cy"), r: num("[data-ovs-body]", "data-ovs-r") },
        mass: { x: num("[data-ovs-mass]", "cx"), y: num("[data-ovs-mass]", "cy"), r: num("[data-ovs-mass]", "r") },
        v: arrow("velocity"),
        F: arrow("force"),
      };
    });
    const at = async (beat, t) => { await frame(beat, t); return read(); };
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    // ---- a circle ----
    const c0 = await at("circle-scene", 0);
    const centre = { x: c0.mass.x, y: c0.mass.y };
    check("circle: the central mass is where `centre` put it, a plain disc of 3.2% of the shorter side", near(centre.x, circleCentre.x, 0.01) && near(centre.y, circleCentre.y, 0.01) && near(c0.mass.r, Math.round(S * 0.032), 0.01));
    const massImg = await frame("circle-scene", 40);
    check("circle: the mass is a flat disc of the dim colour (no glow: its pixel is exactly DIM)", close(rgb(massImg, centre.x + 3, centre.y + 10), DIM, 4));
    const radii = [];
    for (const t of [0, 20, 45, 77, 103]) {
      const s = await at("circle-scene", t);
      radii.push(dist(s.body, centre));
    }
    console.log(`  circle radii: ${radii.map((r) => r.toFixed(4)).join(", ")}`);
    check("circle: the body is 300 px from the centre at every frame, to 0.001 px", radii.every((r) => near(r, 300, 0.001)));
    const q = await at("circle-scene", 30);
    check("circle: a quarter period in it is straight above the centre (counter-clockwise on screen)", near(q.body.x, centre.x, 0.01) && near(q.body.y, centre.y - 300, 0.01));
    const full = await at("circle-scene", 120);
    check("circle: after a full period (120 frames) it is back where it started", near(full.body.x, c0.body.x, 0.001) && near(full.body.y, c0.body.y, 0.001));
    check("control: half a period in it is NOT where it started", dist((await at("circle-scene", 60)).body, c0.body) > 500);
    // arrows
    for (const t of [40, 77]) {
      const s = await at("circle-scene", t);
      const rad = { x: (s.body.x - centre.x) / 300, y: (s.body.y - centre.y) / 300 };
      console.log(`  circle t=${t}: v arrow ${s.v.length.toFixed(3)} (6 x 20 = 120), F arrow ${s.F.length.toFixed(3)} (4 x 40 = 160)`);
      check(`circle t=${t}: the velocity arrow is exactly magnitude x scale (20 x 6 = 120 px) and the force arrow 40 x 4 = 160 px`, near(s.v.length, 120, 1e-6) && near(s.F.length, 160, 1e-6) && s.v.magnitude === 20 && s.F.magnitude === 40);
      check(`circle t=${t}: the velocity arrow's drawn tail-to-tip distance is also 120 px, and the force arrow's 160 px`, near(dist(s.v.tip, { x: s.v.x1, y: s.v.y1 }), 120, 1.5) && near(dist(s.F.tip, { x: s.F.x1, y: s.F.y1 }), 160, 1.5));
      check(`circle t=${t}: the velocity arrow is perpendicular to the radius (dot product 0)`, near(s.v.dx * rad.x + s.v.dy * rad.y, 0, 1e-9));
      check(`circle t=${t}: the force arrow points straight at the centre`, near(s.F.dx, -rad.x, 1e-9) && near(s.F.dy, -rad.y, 1e-9));
      check(`circle t=${t}: and both start at the body`, near(s.v.x1, s.body.x, 0.01) && near(s.F.x1, s.body.x, 0.01) && near(s.v.y1, s.body.y, 0.01));
    }
    // pixels on the circle
    const img = await frame("circle-scene", 40);
    const st = await read();
    const reach = (im, from, dir, color, tol = 25) => {
      let last = 0;
      let misses = 0;
      for (let d = 20; d < 500; d += 0.5) {
        const x = Math.round(from.x + dir.x * d);
        const y = Math.round(from.y + dir.y * d);
        if (x < 0 || y < 0 || x >= im.width || y >= im.height) break;
        if (close(rgb(im, x, y), color, tol)) { last = d; misses = 0; } else if (last > 0 && ++misses > 8) break;
      }
      return last;
    };
    const rot = (v, deg) => ({ x: v.x * Math.cos((deg * Math.PI) / 180) - v.y * Math.sin((deg * Math.PI) / 180), y: v.x * Math.sin((deg * Math.PI) / 180) + v.y * Math.cos((deg * Math.PI) / 180) });
    const lv = reach(img, st.body, { x: st.v.dx, y: st.v.dy }, BLUE);
    const lf = reach(img, st.body, { x: st.F.dx, y: st.F.dy }, EMBER);
    console.log(`  pixels: velocity arrow reaches ${lv} (120), force arrow ${lf} (160)`);
    check("pixels: the blue velocity arrow reaches 120 px along the tangent, within 3 px", near(lv, 120, 3));
    check("pixels: the ember force arrow reaches 160 px along the line to the centre, within 3 px", near(lf, 160, 3));
    check("control: along a direction 25 degrees off the tangent there is no velocity arrow", reach(img, st.body, rot({ x: st.v.dx, y: st.v.dy }, 25), BLUE) < 30);
    check("control: a wrong scale (velocity x 2) would put the tip 120 px further, so the reading cannot be 240", !near(lv, 240, 30));
    const bodyPix = brightCentroid(img, 200, { x: Math.round(st.body.x - 30), y: Math.round(st.body.y - 30), w: 60, h: 60 });
    check("pixels: the Spark's bright core is on the body, within 3 px", bodyPix !== null && near(bodyPix.x, st.body.x, 3) && near(bodyPix.y, st.body.y, 3));
    // scale bars
    const bars = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-scale]")).map((g) => ({ key: g.getAttribute("data-ovs-scale"), len: Number(g.getAttribute("data-ovs-scale-length")), text: g.querySelector("text").textContent })));
    console.log(`  scale bars: ${JSON.stringify(bars)}`);
    check("scale bars: 10 m/s is 60 px (10 x 6) and 20 N is 80 px (20 x 4), and each says so", bars.length === 2 && bars[0].len === 60 && bars[0].text === "10 m/s" && bars[1].len === 80 && bars[1].text === "20 N");
    const glow1 = await glowing();
    check("the body is the one glowing element", glow1 === 1);
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-orbit] text")).map((t) => ({ s: t.textContent, size: Number(t.getAttribute("font-size")) })));
    check("labels: v, F and M are named, at least 2.4% of the shorter side", ["v", "F", "M"].every((s) => labels.some((l) => l.s === s)) && labels.every((l) => l.size >= S * 0.024 - 0.01));
    const sw = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-orbit] line, [data-ovs-orbit] ellipse")).map((e) => Number(e.getAttribute("stroke-width"))));
    check("strokes are never thinner than the line weight", sw.every((w) => w >= weight - 1e-9));
    await at("noarrow-scene", 40);
    check("control: with arrows off there are no arrows and no scale bars", (await page.evaluate(() => document.querySelectorAll("[data-ovs-arrow], [data-ovs-scale]").length)) === 0);

    // ---- an ellipse ----
    const a = 300, e = 0.5;
    const peri = await at("ellipse-scene", 0);
    const focus = { x: peri.mass.x, y: peri.mass.y };
    check("ellipse: with no `centre` the whole ellipse is centred in the frame, the mass at the focus (150 px right of the middle)", near(focus.x, focusDefault.x, 0.01) && near(focus.y, focusDefault.y, 0.01));
    const ell = await page.evaluate(() => { const el = document.querySelector("[data-ovs-orbit-path]"); return { a: Number(el.getAttribute("rx")), b: Number(el.getAttribute("ry")), cx: Number(el.getAttribute("cx")), cy: Number(el.getAttribute("cy")) }; });
    check("ellipse: the drawn path has semi-axes 300 and 259.81 (b = a sqrt(1 - e^2)) and its centre is a e = 150 px from the mass", near(ell.a, 300, 1e-9) && near(ell.b, 300 * Math.sqrt(0.75), 1e-6) && near(focus.x - ell.cx, 150, 0.01) && near(ell.cy, focus.y, 0.01));
    check("ellipse: at t = 0 the body is at periapsis, a(1 - e) = 150 px from the mass, on its right", near(peri.body.r, 150, 1e-3) && near(dist(peri.body, focus), 150, 1e-3) && near(peri.body.x - focus.x, 150, 1e-3));
    const apo = await at("ellipse-scene", 60);
    console.log(`  periapsis r ${peri.body.r}, apoapsis r ${apo.body.r}`);
    check("ellipse: half a period later it is at apoapsis, a(1 + e) = 450 px away, on the far side", near(apo.body.r, 450, 1e-3) && near(dist(apo.body, focus), 450, 1e-3) && near(apo.body.x - focus.x, -450, 1e-3));
    const back = await at("ellipse-scene", 120);
    check("ellipse: a full period (120 frames) returns it to periapsis, the same pixel as t = 0", near(back.body.x, peri.body.x, 1e-3) && near(back.body.y, peri.body.y, 1e-3) && near(back.body.r, 150, 1e-3));
    check("control: the body is NOT at the circle radius 300 at either end", !near(peri.body.r, 300, 10) && !near(apo.body.r, 300, 10));
    let worst = 0;
    for (const t of [10, 25, 40, 75, 90, 111]) {
      const s = await at("ellipse-scene", t);
      const ex = expected(a, e, 120, t);
      worst = Math.max(worst, Math.hypot(s.body.x - focus.x - ex.x, s.body.y - focus.y - ex.y), Math.abs(s.body.r - ex.r));
      if (t >= 30) {
        const sv = Math.sqrt(2 * a / ex.r - 1) * 20;
        const sf = 40 * (a / ex.r) ** 2;
        check(`ellipse t=${t}: the velocity arrow is vis-viva speed ${sv.toFixed(3)} x 3 = ${(sv * 3).toFixed(2)} px and the force arrow ${sf.toFixed(3)} x 1 px`, near(s.v.length, sv * 3, 1e-6) && near(s.F.length, sf, 1e-6));
        check(`ellipse t=${t}: the velocity arrow is tangent to the true ellipse (independent Kepler solver), and the force arrow points at the mass`, near(s.v.dx, ex.tangent.x, 1e-6) && near(s.v.dy, ex.tangent.y, 1e-6) && near(s.F.dx, -ex.x / ex.r, 1e-6) && near(s.F.dy, -ex.y / ex.r, 1e-6));
      }
    }
    console.log(`  worst gap between the drawn body and an independent Kepler solver: ${worst.toExponential(2)} px`);
    check("ellipse: the body is where an independent solution of Kepler's equation puts it, to 0.001 px, at six frames", worst < 0.001);
    const fast = await at("ellipse-scene", 120);
    check("ellipse: at periapsis the speed is highest, v sqrt(3) = 34.64, and the arrows are 103.92 px and 160 px", near(fast.v.length, 3 * 20 * Math.sqrt(3), 1e-6) && near(fast.F.length, 160, 1e-6));
    const slow = await at("ellipse-scene", 60);
    check("ellipse: at apoapsis it is slowest, v / sqrt(3) = 11.55, and the force 17.78 (40 x (300/450)^2)", near(slow.v.magnitude, 20 / Math.sqrt(3), 1e-6) && near(slow.F.magnitude, 40 * (300 / 450) ** 2, 1e-6));
    check("control: the speed is NOT the same at apoapsis and periapsis (a circle would fail this)", !near(slow.v.magnitude, fast.v.magnitude, 5));
    const eimg = await frame("ellipse-scene", 120);
    const es = await read();
    const lve = reach(eimg, es.body, { x: es.v.dx, y: es.v.dy }, BLUE);
    const lfe = reach(eimg, es.body, { x: es.F.dx, y: es.F.dy }, EMBER);
    console.log(`  pixels at periapsis: velocity ${lve} (103.9), force ${lfe} (160)`);
    check("pixels: at periapsis the arrows reach 103.9 px and 160 px", near(lve, 103.92, 3) && near(lfe, 160, 3));
    check("ellipse: the Spark is the only glow", (await glowing()) === 1);

    // ---- a tilted, clockwise ellipse ----
    const t0 = await at("tilt-scene", 0);
    const f2 = { x: t0.mass.x, y: t0.mass.y };
    const pa = (120 * Math.PI) / 180;
    check("tilted: periapsis (150 px away) is 120 degrees counter-clockwise from the right", near(t0.body.x - f2.x, 150 * Math.cos(pa), 0.01) && near(t0.body.y - f2.y, -150 * Math.sin(pa), 0.01));
    const t50 = await at("tilt-scene", 50);
    check("tilted: apoapsis (350 px) is directly opposite", near(t50.body.x - f2.x, -350 * Math.cos(pa), 0.01) && near(t50.body.y - f2.y, 350 * Math.sin(pa), 0.01));
    for (const t of [30, 70]) {
      const before = await at("tilt-scene", t - 1);
      const mid = await at("tilt-scene", t);
      const after = await at("tilt-scene", t + 1);
      const chord = { x: after.body.x - before.body.x, y: after.body.y - before.body.y };
      const cl = Math.hypot(chord.x, chord.y);
      const along = (chord.x * mid.v.dx + chord.y * mid.v.dy) / cl;
      const cross = (mid.body.x - f2.x) * mid.v.dy - (mid.body.y - f2.y) * mid.v.dx;
      console.log(`  tilted t=${t}: velocity arrow vs the body's own path: cos ${along.toFixed(5)}, turning ${cross > 0 ? "clockwise" : "counter-clockwise"} on screen`);
      check(`tilted t=${t}: the velocity arrow is along the body's actual direction of travel`, along > 0.999);
      check(`tilted t=${t}: clockwise on screen (y down, so the cross product of radius and velocity is positive)`, cross > 0);
      console.log("  DBG", JSON.stringify({ F: mid.F, body: mid.body, f2 }), 40 * (250 / mid.body.r) ** 2);
      check(`tilted t=${t}: the force arrow points at the mass and is F (a/r)^2 x 1 px long`, near(mid.F.dx * (mid.body.y - f2.y) - mid.F.dy * (mid.body.x - f2.x), 0, 1e-9) && near(mid.F.length, 40 * (250 / mid.body.r) ** 2, 1e-4) && (mid.F.dx * (f2.x - mid.body.x) + mid.F.dy * (f2.y - mid.body.y)) > 0);
    }

    // ---- purity and timing ----
    const html = () => page.evaluate(() => document.querySelector("[data-ovs-orbit]")?.outerHTML ?? "");
    await frame("ellipse-scene", 70);
    const h1 = await html();
    await frame("ellipse-scene", 15);
    const hMid = await html();
    await frame("ellipse-scene", 70);
    const h2 = await html();
    check("a pure function of the frame: frame 70 rendered twice, with another frame between, gives identical markup", h1 === h2 && h1.length > 1000);
    check("control: a different frame gives different markup", hMid !== h1);
    // Pixels are identical once the page is warm (headless Chrome rasterises the first repaint after a jump a little differently).
    await frame("ellipse-scene", 15);
    const p1 = await frame("ellipse-scene", 70);
    await frame("ellipse-scene", 15);
    const p2 = await frame("ellipse-scene", 70);
    check("a pure function of the frame: and identical pixels once the page is warm", sameBytes(p1, p2));
    check("control: different frames are different pixels", !sameBytes(p1, await frame("ellipse-scene", 15)));
    const early = await frame("late-scene", 10);
    check("nothing is drawn before `at`", (await page.evaluate(() => document.querySelectorAll("[data-ovs-orbit]").length)) === 0 && meanLuma(early) < 8);
    await frame("late-scene", 40);
    check("and the orbit is there after `at`", (await page.evaluate(() => document.querySelectorAll("[data-ovs-orbit]").length)) === 1);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) {
  skip("orbit", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

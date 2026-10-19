#!/usr/bin/env node
// graph: Axes, Plot and NumberLine from @openvidstudio/stem (#110), measured in real frames.
//
// Each expected pixel is worked out here from the box and ranges the scene was given, not read back
// from the component, so a wrong mapping cannot agree with itself. The same scenes are checked at
// 1920x1080 and at 1080x1920. Projectile motion (a parabola with its range and peak marked) is the
// sample fixture.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, luma, rgb, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);
const ACCENT = [92, 200, 255]; // math, #5CC8FF
const TEXT = [243, 239, 230]; // warm white, #F3EFE6
const BASE = [7, 6, 11];

const sceneSource = (name, box, body) => `import React from "react";
import { AbsoluteFill } from "remotion";
import { Axes, Plot, NumberLine, countGlowing } from "@openvidstudio/stem";

export const ${name}: React.FC = () => (
  <AbsoluteFill style={{ background: "#07060B" }}>
${body.replace(/__BOX__/g, JSON.stringify(box))}
  </AbsoluteFill>
);
`;

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const box = { x: Math.round(width * 0.12), y: Math.round(height * 0.2), width: Math.round(width * 0.76), height: Math.round(height * 0.45) };
  const xMax = 4;
  const yMax = 16;
  const sx = (x) => box.x + (x / xMax) * box.width;
  const sy = (y) => box.y + box.height - (y / yMax) * box.height;

  // Projectile fixture: 20 m/s at 45 degrees, g = 10. Range 40 m, peak 10 m at x = 20.
  const px = (x) => box.x + (x / 48) * box.width;
  const py = (y) => box.y + box.height - (y / 14) * box.height;
  const nl = { x: Math.round(width * 0.1), y: Math.round(height * 0.5), width: Math.round(width * 0.8) };
  const nx = (v) => nl.x + ((v + 5) / 10) * nl.width;

  const project = lessonProject({
    prefix: `ovs-graph-${width}x${height}-`,
    width,
    height,
    scenes: {
      "plot-scene": {
        duration: 70,
        source: sceneSource("PlotScene", box, `    <Axes box={__BOX__} xRange={[0, 4]} yRange={[0, 16]} xStep={1} yStep={4}>
      <Plot fn={(x) => x * x} at={0} duration={60} tangent={{ at: 2 }} />
    </Axes>`),
      },
      "area-scene": {
        duration: 30,
        source: sceneSource("AreaScene", box, `    <Axes box={__BOX__} xRange={[0, 4]} yRange={[0, 16]} xStep={1} yStep={4}>
      <Plot fn={(x) => x * x} area={{ from: 1, to: 3 }} />
    </Axes>`),
      },
      "projectile-scene": {
        duration: 30,
        source: sceneSource("ProjectileScene", box, `    <Axes box={__BOX__} xRange={[0, 48]} yRange={[0, 14]} xStep={10} yStep={2} xLabel="distance (m)" yLabel="height (m)" subject="physics">
      <Plot fn={(x) => x * Math.tan(Math.PI / 4) - (10 * x * x) / (2 * 20 * 20 * Math.cos(Math.PI / 4) ** 2)} domain={[0, 40]}
        points={[{ x: 20, label: "peak 10 m" }, { x: 40, label: "range 40 m" }]} />
    </Axes>`),
      },
      "numberline-scene": {
        duration: 30,
        source: sceneSource("NumberlineScene", box, `    <NumberLine box={${JSON.stringify(nl)}} range={[-5, 5]} step={1}
      points={[{ value: 2, label: "2" }]}
      intervals={[{ from: -3, to: 1, openFrom: true }]}
      arrow={{ value: -4, label: "start" }} />`),
      },
    },
  });

  await inBrowser(project, async ({ comp, page, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowCount = () => page.evaluate(() => document.querySelectorAll("[data-ovs-glow]").length);

    // ---- Plot: a known function at known pixels ----
    const before = await frame("plot-scene", 0);
    const accentNear = (img, x, y, r = 3) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (close(rgb(img, x + dx, y + dy), ACCENT, 28)) return true;
      return false;
    };
    const accentColumns = (img) => {
      let right = -1;
      for (let x = box.x; x < box.x + box.width; x++) {
        for (let y = box.y; y < box.y + box.height; y++) if (close(rgb(img, x, y), ACCENT, 28)) { right = Math.max(right, x); break; }
      }
      return right;
    };
    check("Plot: before the draw-on starts nothing of the curve is drawn", accentColumns(before) === -1);
    const half = await frame("plot-scene", 30);
    const rightHalf = accentColumns(half);
    console.log(`  draw-on: half-way reaches x=${rightHalf}, the end of the domain is x=${sx(4)}, x=2 is at ${sx(2)}`);
    check("Plot: the draw-on is partial half-way (reaches x = 2, not x = 4)", rightHalf > 0 && near(rightHalf, sx(2), 8) && rightHalf < sx(4) - 100);
    const full = await frame("plot-scene", 60);
    check("Plot: it is complete at the end of the draw-on (reaches x = 4)", near(accentColumns(full), sx(4), 8));
    // The known pixels are read in a frame with no tangent drawn over the curve (the area scene draws
    // the same curve, whole).
    const whole = await frame("area-scene", 5);
    check("Plot: y = x squared passes through (2, 4) at the expected pixel", accentNear(whole, sx(2), sy(4)));
    check("Plot: ...and (1, 1) and (3, 9)", accentNear(whole, sx(1), sy(1)) && accentNear(whole, sx(3), sy(9)));
    check("control: a point off the curve, (2, 10), is not on it", !accentNear(whole, sx(2), sy(10), 5));
    const later = await frame("plot-scene", 66);
    check("Plot: once complete the frame holds still", sameBytes(full, later));
    const again = await frame("plot-scene", 60);
    check("Plot: two renders of the same frame are byte-identical", sameBytes(full, again));

    // ---- Tangent: measure the slope from two points on the line ----
    const tangentY = (img, x) => {
      const ys = [];
      for (let y = box.y; y < box.y + box.height; y++) if (close(rgb(img, Math.round(x), y), TEXT, 30)) ys.push(y);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
    };
    const xScale = box.width / 4;
    const yScale = box.height / 16;
    const xa = sx(2) + 0.1 * xScale;
    const xb = sx(2) + 0.55 * xScale;
    const ya = tangentY(full, xa);
    const yb = tangentY(full, xb);
    const slope = ya !== null && yb !== null ? (yb - ya) / (xb - xa) : null;
    const expected = (-4 * yScale) / xScale;
    console.log(`  tangent slope on screen: measured ${slope?.toFixed(3)}, expected ${expected.toFixed(3)} (f'(2) = 4)`);
    check("Tangent: the line is drawn, and has the right slope (measured from two points)", slope !== null && near(slope, expected, Math.abs(expected) * 0.06));
    check("Tangent: it touches the curve at x = 2", ya !== null && near(tangentY(full, sx(2)) ?? -1e9, sy(4), 3));
    check("Tangent: absent before the curve has reached x = 2", tangentY(await frame("plot-scene", 10), xa) === null);

    // ---- stroke weight: nothing thinner than the minimum line weight ----
    const axisY = sy(0);
    const thick = (img, x, y0) => {
      let n = 0;
      for (let y = y0 - 12; y <= y0 + 12; y++) if (luma(img, x, y) > 60) n++;
      return n;
    };
    const minWeight = Math.max(3, Math.round(Math.min(width, height) / 360));
    const betweenTicks = Math.round(sx(1.5));
    check(`line weight: the x axis is at least ${minWeight}px thick`, thick(full, betweenTicks, axisY) >= minWeight);
    check(`line weight: the plot line is thicker than the axes (about 1.7x)`, (() => {
      let n = 0;
      for (let y = sy(9) - 40; y < sy(9) + 40; y++) if (close(rgb(full, Math.round(sx(3)), y), ACCENT, 28)) n++;
      return n >= minWeight * 1.5;
    })());

    // ---- Axes ----
    check("Axes: the x axis is where y = 0 is, in the dim token", close(rgb(full, betweenTicks, Math.round(axisY)), [140, 135, 153], 30));
    check("Axes: the y axis is where x = 0 is", luma(full, Math.round(sx(0)), Math.round(sy(11))) > 60);
    check("Axes: a tick sits at x = 3, below the axis", luma(full, Math.round(sx(3)), Math.round(axisY) + Math.round(minWeight * 1.4)) > 60);
    check("Axes: gridlines run at the ticks, fainter than the axes", (() => {
      const gx = luma(full, Math.round(sx(3)), Math.round(sy(11)));
      return gx > 12 && gx < luma(full, betweenTicks, Math.round(axisY));
    })());

    // ---- shaded area ----
    const area = await frame("area-scene", 5);
    const inside = rgb(area, sx(2), sy(1.5));
    const outside = rgb(area, sx(0.5), sy(1.5));
    check("Area: the region under the curve between x = 1 and x = 3 is shaded (tinted toward the accent)", inside[2] > BASE[2] + 15 && inside[1] > BASE[1] + 15);
    check("Area: x outside [1, 3] under the curve is not", close(outside, rgb(area, sx(3.8), sy(0.3)), 40) && outside[2] < inside[2] - 10);
    check("Area: above the curve is not shaded either", luma(area, sx(2), sy(11)) < luma(area, sx(2), sy(1.5)) - 10);

    // ---- projectile motion ----
    const proj = await frame("projectile-scene", 10);
    const whiteDot = (img, x, y) => close(rgb(img, Math.round(x), Math.round(y)), TEXT, 20);
    check("Projectile: the peak (20 m, 10 m) is marked at its pixel", whiteDot(proj, px(20), py(10)));
    check("Projectile: the range (40 m) is marked on the axis at its pixel", whiteDot(proj, px(40), py(0)));
    check("Projectile: the parabola passes through (10, 7.5) in the physics amber", (() => {
      for (let dy = -3; dy <= 3; dy++) if (close(rgb(proj, Math.round(px(10)), Math.round(py(7.5)) + dy), [255, 179, 71], 30)) return true;
      return false;
    })());
    // The "range 40 m" label sits just right of the range marker, inside this region. Its anti-aliased edge can
    // produce a stray amber-ish pixel (one, at 1080x1920 on Windows: (228,180,99)), so a few pixels are label
    // fringe and the curve past x = 40 would be dozens: a 3px stroke over even one more unit.
    const pastRange = (() => {
      let n = 0;
      for (let x = Math.round(px(41)); x < box.x + box.width; x++) for (let y = box.y; y < box.y + box.height; y++) if (close(rgb(proj, x, y), [255, 179, 71], 30)) n++;
      return n;
    })();
    check(`Projectile: it stops at the range, nothing past x = 40 (${pastRange} amber pixels there, label fringe at most)`, pastRange < 8);
    const onCurve = (() => {
      let n = 0;
      for (let x = Math.round(px(30)); x < Math.round(px(35)); x++) for (let y = box.y; y < box.y + box.height; y++) if (close(rgb(proj, x, y), [255, 179, 71], 30)) n++;
      return n;
    })();
    check(`control: the same count over x = 30 to 35, where the curve is, is far above that threshold (${onCurve})`, onCurve > 40);

    // ---- NumberLine ----
    const line = await frame("numberline-scene", 5);
    const lineY = nl.y;
    check("NumberLine: the line is drawn between its ends", luma(line, Math.round(nx(-4.5)), lineY) > 60 && luma(line, Math.round(nx(4.5)), lineY) > 60);
    check("NumberLine: a tick at 0, crossing the line", luma(line, Math.round(nx(0)), lineY - 4) > 60 && luma(line, Math.round(nx(0)), lineY + 4) > 60);
    check("control: no tick between the ticks (at 3.5)", luma(line, Math.round(nx(3.5)), lineY - 4) < 30);
    check("NumberLine: the highlighted interval is in the accent between -3 and 1", close(rgb(line, nx(-1), lineY), ACCENT, 30) && close(rgb(line, nx(0.5), lineY), ACCENT, 30));
    check("NumberLine: and not outside it (at 3)", !close(rgb(line, nx(3), lineY), ACCENT, 30));
    check("NumberLine: the open end at -3 is hollow (the Void shows in its centre) with a ring around it", close(rgb(line, nx(-3), lineY), BASE, 12) && (() => {
      for (let dx = 4; dx < 30; dx++) if (close(rgb(line, Math.round(nx(-3)) + dx, lineY - 0), ACCENT, 40)) return true;
      return false;
    })());
    check("NumberLine: the closed end at 1 is filled", close(rgb(line, nx(1), lineY), ACCENT, 30));
    check("NumberLine: the labelled point at 2 is marked", close(rgb(line, nx(2), lineY), TEXT, 25));
    check("NumberLine: the arrow points at -4 from above the line", (() => {
      for (let dy = 20; dy < 120; dy++) if (close(rgb(line, Math.round(nx(-4)), lineY - dy), TEXT, 25)) return true;
      return false;
    })());
    check("control: nothing is drawn above the line at 4, where there is no arrow", (() => {
      for (let dy = 20; dy < 80; dy++) if (close(rgb(line, Math.round(nx(4)), lineY - dy), TEXT, 25)) return false;
      return true;
    })());

    check("none of the graph primitives glow (the Spark is the one that does)", (await glowCount()) === 0);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) {
  skip("graph", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

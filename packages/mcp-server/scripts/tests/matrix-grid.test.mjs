#!/usr/bin/env node
// matrix-grid: MatrixGrid from @openvidstudio/stem (#142), measured in real frames at 1920x1080 and
// 1080x1920. Expected screen positions are worked out here from the matrix and the scale the scene
// was given: after the transform every point is at M * p, mid-transform at (I + t (M - I)) * p.
//
// Sample scene: [[2, 1], [0, 1]] acting on the unit square, a shear and a stretch.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, meanLuma, rgb, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);
const BLUE = [92, 200, 255];
const TEXT = [243, 239, 230];

const scene = (name, matrix, extra = "") => `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import "@openvidstudio/stem";
import { MatrixGrid } from "@openvidstudio/stem/src/MatrixGrid";

export const ${name}: React.FC = () => {
  const { width, height } = useVideoConfig();
  const side = Math.min(width, height);
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
      <MatrixGrid matrix={${JSON.stringify(matrix)}} at={10} duration={40} ease={(t) => t}
        box={{ x: width * 0.15, y: height * 0.3, width: width * 0.7, height: height * 0.4 }} scale={side * 0.06} ${extra} />
    </AbsoluteFill>
  );
};
`;

const SHEAR = [[2, 1], [0, 1]];
const FLIP = [[1, 0], [0, -1]];
const apply = (m, x, y) => ({ x: m[0][0] * x + m[0][1] * y, y: m[1][0] * x + m[1][1] * y });
const lerpM = (m, t) => [[1 + (m[0][0] - 1) * t, m[0][1] * t], [m[1][0] * t, 1 + (m[1][1] - 1) * t]];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-matrix-${width}x${height}-`,
    width,
    height,
    scenes: {
      "shear-scene": { source: scene("ShearScene", SHEAR), duration: 70 },
      "flip-scene": { source: scene("FlipScene", FLIP), duration: 70 },
    },
  });
  const S = Math.min(width, height) * 0.06;
  const O = { x: width * 0.5, y: height * 0.5 };
  const toScreen = (p) => ({ x: O.x + p.x * S, y: O.y - p.y * S });

  await inBrowser(project, async ({ comp, page, frame, seek, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const read = (sel, attrs) => page.evaluate(({ sel, attrs }) => Array.from(document.querySelectorAll(sel)).map((e) => Object.fromEntries(attrs.map((a) => [a, e.getAttribute(a)]))), { sel, attrs });
    const corners = async () => (await read("[data-ovs-corner]", ["data-ovs-corner", "data-ovs-sx", "data-ovs-sy"])).map((c) => ({ x: Number(c["data-ovs-sx"]), y: Number(c["data-ovs-sy"]) }));
    const glowing = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-glow]")).filter((e) => Number.parseFloat(e.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length);
    const maxErr = (got, want) => Math.max(...got.map((p, i) => Math.hypot(p.x - want[i].x, p.y - want[i].y)));

    // nothing before `at`
    const early = await frame("shear-scene", 5);
    check("nothing is drawn before `at`: no MatrixGrid in the DOM and the frame is the bare background", (await page.evaluate(() => document.querySelectorAll("[data-ovs-matrixgrid]").length)) === 0 && meanLuma(early) < 12);

    // the end of the transform: corners at M * p
    const endShot = await frame("shear-scene", 60);
    const wantEnd = CORNERS.map(([x, y]) => toScreen(apply(SHEAR, x, y)));
    const gotEnd = await corners();
    console.log(`  corners (px): ${gotEnd.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(" ")}`);
    check("after the transform the unit square's four corners are at M * (0,0), (1,0), (1,1), (0,1) on screen, within 0.5px", gotEnd.length === 4 && maxErr(gotEnd, wantEnd) < 0.5);
    check("the picture agrees with the DOM: the image square's edge from M*(1,0) to M*(1,1) is drawn in the accent at its midpoint", close(rgb(endShot, (wantEnd[1].x + wantEnd[2].x) / 2, (wantEnd[1].y + wantEnd[2].y) / 2), BLUE, 45));
    check("and the corner dot for M * (1,1) = (3,1) is drawn there in the accent", close(rgb(endShot, wantEnd[2].x, wantEnd[2].y), BLUE, 45));
    const progEnd = Number(await page.evaluate(() => document.querySelector("[data-ovs-matrixgrid]").getAttribute("data-ovs-progress")));
    check("progress is exactly 1 once the transform is over", progEnd === 1);
    const origin = await read("[data-ovs-origin]", ["data-ovs-sx", "data-ovs-sy"]);
    check("a point at the origin stays fixed: the origin dot is at the centre of the box after the transform", near(Number(origin[0]["data-ovs-sx"]), O.x, 0.01) && near(Number(origin[0]["data-ovs-sy"]), O.y, 0.01));

    // every grid point
    const pts = await read("[data-ovs-point]", ["data-ovs-point", "data-ovs-sx", "data-ovs-sy"]);
    const worst = Math.max(...pts.map((p) => {
      const [x, y] = p["data-ovs-point"].split(",").map(Number);
      const w = toScreen(apply(SHEAR, x, y));
      return Math.hypot(Number(p["data-ovs-sx"]) - w.x, Number(p["data-ovs-sy"]) - w.y);
    }));
    check("all 25 grid points of the default grid sit at M * p, within 0.5px", pts.length === 25 && worst < 0.5);
    check("the grid includes the origin point, drawn at the origin", pts.some((p) => p["data-ovs-point"] === "0,0" && near(Number(p["data-ovs-sx"]), O.x, 0.01)));

    // i-hat and j-hat
    const basis = await read("[data-ovs-basis]", ["data-ovs-basis", "data-ovs-tip-x", "data-ovs-tip-y"]);
    const tip = (n) => { const b = basis.find((e) => e["data-ovs-basis"] === n); return { x: Number(b["data-ovs-tip-x"]), y: Number(b["data-ovs-tip-y"]) }; };
    const wantI = toScreen(apply(SHEAR, 1, 0));
    const wantJ = toScreen(apply(SHEAR, 0, 1));
    check("the arrows end at the images of i-hat (2, 0) and j-hat (1, 1)", Math.hypot(tip("i").x - wantI.x, tip("i").y - wantI.y) < 0.5 && Math.hypot(tip("j").x - wantJ.x, tip("j").y - wantJ.y) < 0.5);

    // mid-transform
    await seek("shear-scene", 30);
    const t = (30 - 10) / 40;
    const mid = lerpM(SHEAR, t);
    const gotMid = await corners();
    const wantMid = CORNERS.map(([x, y]) => toScreen(apply(mid, x, y)));
    const ptsMid = await read("[data-ovs-point]", ["data-ovs-point", "data-ovs-sx", "data-ovs-sy"]);
    const worstMid = Math.max(...ptsMid.map((p) => {
      const [x, y] = p["data-ovs-point"].split(",").map(Number);
      const w = toScreen(apply(mid, x, y));
      return Math.hypot(Number(p["data-ovs-sx"]) - w.x, Number(p["data-ovs-sy"]) - w.y);
    }));
    console.log(`  halfway: corner (1,1) at (${gotMid[2].x.toFixed(1)}, ${gotMid[2].y.toFixed(1)}), expected (${wantMid[2].x.toFixed(1)}, ${wantMid[2].y.toFixed(1)})`);
    check("half way (linear progress 0.5) the corners and every grid point are at the interpolated matrix [[1.5, 0.5], [0, 1]] applied, within 0.5px", maxErr(gotMid, wantMid) < 0.5 && worstMid < 0.5);
    check("control: the half-way corners are NOT where the final matrix puts them", maxErr(gotMid, wantEnd) > S * 0.4);
    check("control: nor where the identity puts them (the check can fail)", maxErr(gotMid, CORNERS.map(([x, y]) => toScreen({ x, y }))) > S * 0.2);
    await seek("shear-scene", 10);
    const start = await corners();
    check("at the first frame the plane is still the identity: the square is the unit square", maxErr(start, CORNERS.map(([x, y]) => toScreen({ x, y }))) < 0.5);

    // orientation and the determinant
    const orient = async (beat, local) => { await seek(beat, local); return page.evaluate(() => document.querySelector("[data-ovs-unit-square]").getAttribute("data-ovs-orientation")); };
    const oShear = await orient("shear-scene", 60);
    const oFlip = await orient("flip-scene", 60);
    check("a shear (determinant 2) keeps the square's orientation", oShear === "preserved");
    check("a reflection (determinant -1) flips it", oFlip === "flipped");
    const flipCorners = await corners();
    const wantFlip = CORNERS.map(([x, y]) => toScreen(apply(FLIP, x, y)));
    check("the reflection's corners are at M * p too: (0,1) goes below the axis", maxErr(flipCorners, wantFlip) < 0.5 && flipCorners[3].y > O.y + S * 0.9);
    const flipShot = await frame("flip-scene", 60);
    const jMid = { x: O.x, y: O.y + S * 0.5 };
    check("the j-hat arrow of the reflection is drawn pointing down (warm white shaft below the origin)", close(rgb(flipShot, jMid.x, jMid.y), TEXT, 50));
    const shearShot = await frame("shear-scene", 60);
    check("control: in the shear the same pixel is not the j-hat arrow (it points up and right)", !close(rgb(shearShot, jMid.x, jMid.y), TEXT, 50));
    check("control: the two orientations differ, so the check can tell them apart", oShear !== oFlip);

    // the matrix, in the safe zone
    await seek("shear-scene", 60);
    const entries2 = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-entry]")).map((e) => e.textContent));
    check("the shear's matrix shows 2, 1, 0, 1", JSON.stringify(entries2) === JSON.stringify(["2", "1", "0", "1"]));
    const mb = await page.evaluate(() => { const r = document.querySelector("[data-ovs-matrix]").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
    console.log(`  matrix box: ${JSON.stringify(mb)}`);
    check("the matrix sits inside the safe zone (below 14% and above 78% of the height, inside the width)", mb.top >= height * 0.14 && mb.bottom <= height * 0.78 && mb.left >= 0 && mb.right <= width);

    // purity and glow
    const a = await frame("shear-scene", 40);
    await frame("shear-scene", 15);
    const b = await frame("shear-scene", 40);
    check("frame purity: the same frame rendered twice, with another between, is byte-identical", sameBytes(a, b));
    check("control: different frames differ", !sameBytes(a, await frame("shear-scene", 15)));
    check("nothing glows (the matrix grid has no Spark)", (await glowing()) === 0);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) {
  skip("matrix-grid", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

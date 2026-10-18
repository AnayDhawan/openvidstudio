#!/usr/bin/env node
// freebody-arrayviz: FreeBody and ArrayViz from @openvidstudio/stem (#112), measured in real frames
// at 1920x1080 and 1080x1920. Expected pixels are worked out here from the numbers the scene was
// given: arrow lengths from magnitude x scale, cell centres from the row's geometry.
//
// Sample scenes: a block on a slope at rest (three forces that sum to zero) and binary search over
// a sorted array.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, luma, rgb, brightCentroid } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);
const RED = [255, 77, 94];
const BLUE = [92, 200, 255];
const AMBER = [255, 179, 71];
const TEXT = [243, 239, 230];
const DIM = [140, 135, 153];

const wrap = (name, body) => `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { FreeBody, ArrayViz } from "@openvidstudio/stem";

export const ${name}: React.FC = () => {
  const { width, height } = useVideoConfig();
  const scale = Math.min(width, height) * 0.006;
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
${body}
    </AbsoluteFill>
  );
};
`;

const SLOPE = wrap("SlopeScene", `      <FreeBody scale={scale} scaleValue={10} at={0} stagger={10} net objectRotation={-30} objectLabel="m"
        forces={[
          { label: "W", magnitude: 50, angle: 270, color: "#FF4D5E" },
          { label: "N", magnitude: 43.3, angle: 120, color: "#5CC8FF" },
          { label: "f", magnitude: 25, angle: 30, color: "#FFB347" },
        ]} />`);

const NET = wrap("NetScene", `      <FreeBody scale={scale} scaleValue={10} at={5} stagger={20} order={[1, 0]} net
        forces={[
          { label: "A", magnitude: 40, angle: 0, color: "#FF4D5E" },
          { label: "B", magnitude: 30, angle: 90, color: "#5CC8FF" },
        ]} />`);

const SORTED = "[2, 5, 8, 12, 16, 23, 38, 56, 72, 91]";
const SEARCH = wrap("SearchScene", `      <ArrayViz values={${SORTED}} highlights={[{ from: 5, to: 9 }]} dimmed={[{ from: 0, to: 4 }]}
        pointers={[{ name: "low", index: 5 }, { name: "high", index: 9, color: "#FFB347" }, { name: "mid", index: 7, color: "#FF4D5E" }]} />`);

const MOVE = wrap("MoveScene", `      <ArrayViz values={${SORTED}}
        pointers={[{ name: "mid", index: [{ frame: 0, index: 2 }, { frame: 40, index: 7 }], spark: true }]} />`);

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-physcs-${width}x${height}-`,
    width,
    height,
    scenes: {
      "slope-scene": { source: SLOPE, duration: 80 },
      "net-scene": { source: NET, duration: 90 },
      "search-scene": { source: SEARCH, duration: 30 },
      "move-scene": { source: MOVE, duration: 60 },
    },
  });
  const S = Math.min(width, height) * 0.006;
  const o = { x: width / 2, y: height / 2 };
  const weight = Math.max(3, Math.round(Math.min(width, height) / 360));

  await inBrowser(project, async ({ comp, page, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowing = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-glow]")).filter((e) => Number.parseFloat(e.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length);

    // The farthest pixel of `color` along a ray from the origin, stopping at the first gap (a label past the tip does not count).
    const reach = (img, angleDeg, color, tol = 45) => {
      const dx = Math.cos((angleDeg * Math.PI) / 180);
      const dy = -Math.sin((angleDeg * Math.PI) / 180);
      let last = 0;
      let misses = 0;
      for (let d = 12; d < Math.min(width, height); d += 0.5) {
        const x = Math.round(o.x + dx * d);
        const y = Math.round(o.y + dy * d);
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) break;
        if (close(rgb(img, x, y), color, tol)) { last = d; misses = 0; } else if (last > 0 && ++misses > 8) break;
      }
      return last;
    };
    const farthest = (img, angleDeg, color, limit, tol = 45) => {
      const dx = Math.cos((angleDeg * Math.PI) / 180);
      const dy = -Math.sin((angleDeg * Math.PI) / 180);
      let last = 0;
      for (let d = 12; d < limit; d += 0.5) if (close(rgb(img, Math.round(o.x + dx * d), Math.round(o.y + dy * d)), color, tol)) last = d;
      return last;
    };

    // ---- FreeBody: a block on a slope, at rest ----
    const empty = await frame("slope-scene", 0);
    check("FreeBody: before an arrow starts there is none (no arrow pixels beyond the object)", reach(empty, 270, RED) === 0 && reach(empty, 120, BLUE) === 0);
    const f = await frame("slope-scene", 70);
    const lenW = reach(f, 270, RED);
    const lenN = reach(f, 120, BLUE);
    const lenF = reach(f, 30, AMBER);
    console.log(`  arrow lengths (px): W ${lenW} (expected ${(50 * S).toFixed(1)}), N ${lenN} (${(43.3 * S).toFixed(1)}), f ${lenF} (${(25 * S).toFixed(1)})`);
    check("FreeBody: weight (50) is 50 x scale px long, within 3px", near(lenW, 50 * S, 3));
    check("FreeBody: the normal force (43.3) is 43.3 x scale px long, within 3px", near(lenN, 43.3 * S, 3));
    check("FreeBody: friction (25) is 25 x scale px long, within 3px", near(lenF, 25 * S, 3));
    check("FreeBody: length ratios match the magnitudes (W:N is 50:43.3, W:f is 2:1) to within 2%", near(lenW / lenN, 50 / 43.3, 0.02 * 50 / 43.3 + 0.03) && near(lenW / lenF, 2, 0.08));
    check("control: no arrow points along 200 degrees, where there is no force", reach(f, 200, RED) === 0 && reach(f, 200, BLUE) === 0 && reach(f, 200, AMBER) === 0);
    const forcesInDom = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-force]")).map((e) => e.getAttribute("data-ovs-force")));
    check("FreeBody: the three forces are drawn, labelled, and there is no net arrow when the net is zero", JSON.stringify(forcesInDom) === JSON.stringify(["W", "N", "f"]));
    const labelText = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-freebody] text")).map((t) => t.textContent));
    check("FreeBody: each arrow carries its label, and the object its own", ["W", "N", "f", "m"].every((l) => labelText.includes(l)));

    // the scale bar
    const barAt = { x: Math.round(width * 0.12), y: Math.round(height * 0.88) };
    let first = -1, lastX = -1;
    for (let x = 0; x < width; x++) if (close(rgb(f, x, barAt.y), DIM, 30) && x < barAt.x + 10 * S + weight + 4) { if (first < 0) first = x; lastX = x; }
    console.log(`  scale bar spans ${lastX - first + 1}px for 10 N (10 x scale = ${(10 * S).toFixed(1)}, plus the end tick's ${weight}px)`);
    check("FreeBody: the scale bar is 10 x scale px long, so the arrows can be read against it", near(lastX - first + 1, 10 * S + weight, 2));
    const scaleText = await page.evaluate(() => document.querySelector("[data-ovs-scale] text")?.textContent);
    check("FreeBody: and it says what it stands for", scaleText === "10 N");

    // arrival order and the net force
    const e12 = await frame("net-scene", 12);
    check("FreeBody: with order [1, 0], B arrives first: at frame 12 B is growing and A has not started", reach(e12, 90, BLUE) > 0 && reach(e12, 0, RED) === 0);
    const e36 = await frame("net-scene", 36);
    check("FreeBody: A starts 20 frames later, and arrows arrive one at a time", reach(e36, 0, RED) > 0 && reach(e36, 0, RED) < 40 * S + 3);
    check("FreeBody: no net arrow while the others are still arriving", farthest(e36, 36.87, TEXT, 60 * S) < 8);
    const net = await frame("net-scene", 85);
    const netLen = farthest(net, 36.87, TEXT, 60 * S, 40);
    console.log(`  net arrow: ${netLen}px (expected ${(50 * S).toFixed(1)}), A ${reach(net, 0, RED)} (${(40 * S).toFixed(1)}), B ${reach(net, 90, BLUE)} (${(30 * S).toFixed(1)})`);
    check("FreeBody: A (40) and B (30) reach 40 x and 30 x scale px", near(reach(net, 0, RED), 40 * S, 3) && near(reach(net, 90, BLUE), 30 * S, 3));
    check("FreeBody: the net force (50 at 36.87 degrees, the vector sum) is drawn as 50 x scale px", near(netLen, 50 * S, 4));
    check("FreeBody: arrows never glow", (await glowing()) === 0);

    // ---- ArrayViz: binary search ----
    const cell = Math.min(Math.floor((width * 0.84) / 10), Math.round(Math.min(width, height) * 0.11));
    const left = Math.round((width - 10 * cell) / 2);
    const top = Math.round(height * 0.45);
    const cx = (i) => left + (i + 0.5) * cell;
    const cy = top + cell / 2;
    const s = await frame("search-scene", 5);
    const tinted = (i) => {
      const c = rgb(s, cx(i) - cell * 0.3, cy + cell * 0.3);
      return c[2] > 55 && c[0] > 35;
    };
    const flags = Array.from({ length: 10 }, (_, i) => tinted(i));
    console.log(`  highlighted cells: ${flags.map((v, i) => (v ? i : "")).join(" ").trim()}`);
    check("ArrayViz: the highlight covers exactly cells 5 to 9 and no others", flags.every((v, i) => v === (i >= 5)));
    check("ArrayViz: the cells ruled out (0 to 4) are dimmed against the live ones' text", (() => {
      const textIn = (i) => {
        let best = 0;
        for (let dy = -fontOf(cell); dy <= fontOf(cell); dy++) for (let dx = -fontOf(cell); dx <= fontOf(cell); dx++) best = Math.max(best, luma(s, cx(i) + dx, cy + dy));
        return best;
      };
      return textIn(2) < textIn(7) * 0.6;
    })());
    const pointerX = (color) => {
      const base = top + cell + cell * 0.2 * 0.6;
      const band = { x: 0, y: Math.round(base), w: width, h: Math.round(cell * 0.2 * 1.5) };
      let n = 0, sx = 0;
      for (let y = band.y; y < band.y + band.h; y++) for (let x = 0; x < width; x++) if (close(rgb(s, x, y), color, 30)) { n++; sx += x; }
      return n > 0 ? sx / n : null;
    };
    const low = pointerX([181, 140, 255]);
    const high = pointerX(AMBER);
    const mid = pointerX(RED);
    console.log(`  pointers at x: low ${low?.toFixed(1)} (cell 5 centre ${cx(5)}), mid ${mid?.toFixed(1)} (cell 7: ${cx(7)}), high ${high?.toFixed(1)} (cell 9: ${cx(9)})`);
    check("ArrayViz: the low, mid and high pointers are at the centres of cells 5, 7 and 9, to within 1.5px", low !== null && mid !== null && high !== null && near(low, cx(5), 1.5) && near(mid, cx(7), 1.5) && near(high, cx(9), 1.5));
    const names = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-pointer]")).map((e) => e.getAttribute("data-ovs-pointer")));
    check("ArrayViz: the pointers are named in the picture (low, high, mid)", JSON.stringify(names) === JSON.stringify(["low", "high", "mid"]));
    check("ArrayViz: ten cells, each holding its value", await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-cell]")).map((g) => g.querySelector("text")?.textContent).join(",") === "2,5,8,12,16,23,38,56,72,91"));

    // ---- a Spark-driven pointer ----
    const sparkAt = (i) => ({ x: cx(i), y: top + cell + cell * 0.2 * 1.4 });
    // The Spark rides in a band just under the cells; the cell values above it are bright too, so look only there.
    const band = { x: 0, y: top + cell, w: width, h: Math.round(cell * 0.8) };
    const m0 = await frame("move-scene", 0);
    const h0 = brightCentroid(m0, 200, band);
    check("ArrayViz: the Spark pointer starts on cell 2", h0 !== null && near(h0.x, sparkAt(2).x, 2.5) && near(h0.y, sparkAt(2).y, 2.5));
    const mMid = await frame("move-scene", 20);
    const hMid = brightCentroid(mMid, 200, band);
    check("ArrayViz: half way through its move the Spark is between cells (index 4.5)", hMid !== null && near(hMid.x, cx(4.5), 4));
    const m1 = await frame("move-scene", 50);
    const h1 = brightCentroid(m1, 200, band);
    check("ArrayViz: and it lands on cell 7", h1 !== null && near(h1.x, sparkAt(7).x, 2.5) && near(h1.y, sparkAt(7).y, 2.5));
    check("ArrayViz: a Spark pointer is the one glowing element", (await glowing()) === 1);
    check("ArrayViz: the pointer has no separate marker when it is the Spark", (await page.evaluate(() => document.querySelectorAll("[data-ovs-pointer-tip]").length)) === 0);
    check("ArrayViz without a Spark pointer does not glow", (await frame("search-scene", 5), (await glowing()) === 0));
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

function fontOf(cell) {
  return Math.round(cell * 0.38 * 0.6);
}

if (!haveNodeModules) {
  skip("freebody-arrayviz", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

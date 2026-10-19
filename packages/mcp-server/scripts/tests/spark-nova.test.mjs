#!/usr/bin/env node
// spark-nova: Supernova's two signature primitives, Spark and Nova (#109), measured in real frames.
//
// A frame is mounted in a real browser through the Remotion bridge and read back from the pixels
// and the DOM, as core-primitives does. Every scene takes its sizes from useVideoConfig(), so the
// same source is checked at 1920x1080 and at 1080x1920.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, luma, rgb, meanLuma, brightCentroid, sameBytes } from "./_stem.mjs";

const BG = "#07060B";
const SPARK_SCENE = `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Spark } from "@openvidstudio/stem";

export const SparkScene: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "${BG}" }}>
      <Spark at={5} trail={18} path={(t) => ({ x: width * 0.2 + 8 * t, y: height * 0.5 })} />
    </AbsoluteFill>
  );
};
`;

const NOVA_SCENE = `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Nova } from "@openvidstudio/stem";

export const NovaScene: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "${BG}" }}>
      <Nova at={30} duration={60}>
        <div style={{ position: "absolute", left: width / 2 - 150, top: height / 2 - 150, width: 300, height: 300, background: "#5CC8FF" }} />
      </Nova>
    </AbsoluteFill>
  );
};
`;

// The Nova asked for by the name of an impact in the score, not by a frame number.
const IMPACT_SCENE = `import React from "react";
import { AbsoluteFill } from "remotion";
import { MusicClockProvider } from "@openvidstudio/core";
import { Nova } from "@openvidstudio/stem";

export const ImpactNova: React.FC = () => (
  <MusicClockProvider cues={{ bpm: 120, impacts: [{ label: "aha", atBar: 1 }] }} beatStarts={{ "impact-nova": 0 }}>
    <AbsoluteFill style={{ background: "${BG}" }}>
      <Nova beatId="impact-nova" impact="aha" duration={30} />
    </AbsoluteFill>
  </MusicClockProvider>
);
`;

// Every Spark behaviour, sampled at fixed local frames and printed for the test to read.
const PATHS_SCENE = `import React from "react";
import { AbsoluteFill } from "remotion";
import { trace, carry, orbit, split, fall, walk, polyline, keyframePath } from "@openvidstudio/stem";

export const PathsScene: React.FC = () => {
  const sample = (p: (t: number) => { x: number; y: number }, ts: number[]) => ts.map((t) => p(t));
  const tr = trace([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { duration: 60 });
  const ca = carry((x) => x * x, 0, 4, { duration: 40, map: (x, y) => ({ x: 100 + x * 50, y: 500 - y * 20 }) });
  const or = orbit({ x: 200, y: 200 }, 50, { period: 40 });
  const parent = (t: number) => ({ x: 10 * t, y: 0 });
  const sp = split(parent, 4, { at: 20, spread: 80, duration: 20 });
  const fa = fall(2, { x: 0, y: 0, vx: 5, vy: -10 }, { floorY: 30 });
  const wa = walk([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], { hop: 10, hold: 5 });
  const kf = keyframePath([{ frame: 0, x: 0, y: 0 }, { frame: 10, x: 100, y: 50 }]);
  const dump = {
    trace: sample(tr, [0, 30, 60, 90]),
    carry: sample(ca, [0, 20, 40, 80]),
    orbit: sample(or, [0, 10, 20, 40]),
    split: sp.map((p) => sample(p, [0, 20, 40])),
    fall: sample(fa, [0, 5, 10, 20, 40]),
    walk: sample(wa, [0, 10, 15, 20, 30, 99]),
    keyframes: sample(kf, [-5, 0, 10, 20]),
    polylineHalf: polyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])(0.5),
  };
  return (
    <AbsoluteFill>
      <pre id="dump">{JSON.stringify(dump)}</pre>
    </AbsoluteFill>
  );
};
`;

const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-spark-${width}x${height}-`,
    width,
    height,
    scenes: {
      "spark-scene": { source: SPARK_SCENE, duration: 60 },
      "nova-scene": { source: NOVA_SCENE, duration: 120 },
      "impact-nova": { source: IMPACT_SCENE, duration: 120 },
      "paths-scene": { source: PATHS_SCENE, duration: 10 },
    },
  });
  await inBrowser(project, async ({ comp, page, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowing = (kind) =>
      page.evaluate((k) => Array.from(document.querySelectorAll(`[data-ovs-glow="${k}"]`)).filter((el) => Number.parseFloat(el.getAttribute("data-ovs-glow-level") ?? "0") > 0.05).length, kind);
    const circles = () => page.evaluate(() => document.querySelectorAll("svg circle").length);

    // ---- Spark ----
    const headAt = (local) => ({ x: width * 0.2 + 8 * (local - 5), y: height * 0.5 });
    const before = await frame("spark-scene", 3);
    check("Spark: before `at` nothing is drawn (a flat Void frame)", brightCentroid(before, 40) === null && (await glowing("spark")) === 0);
    const f25 = await frame("spark-scene", 25);
    const head = brightCentroid(f25, 210, { x: 0, y: 0, w: width, h: height });
    console.log(`  spark head at frame 25: ${JSON.stringify(head)} expected ${JSON.stringify(headAt(25))}`);
    check("Spark: the head is where the path says at frame 25, to within 2px", head !== null && near(head.x, headAt(25).x, 2) && near(head.y, headAt(25).y, 2));
    const r = Math.max(2, Math.round(Math.min(width, height) * 0.014));
    check(`Spark: the core is a disc about ${r}px in radius (sized from the frame, not from 1920x1080)`, head !== null && near(head.n, Math.PI * r * r, Math.PI * r * r * 0.3));
    check("Spark: exactly one glowing element while it is on screen", (await glowing("spark")) === 1);
    const f10 = await frame("spark-scene", 10);
    const head10 = brightCentroid(f10, 210);
    check("control: at frame 10 the head is 120px to the left, so the measurement can tell frames apart", head10 !== null && near(head10.x, headAt(10).x, 2) && Math.abs(head10.x - head.x) > 100);
    const patch = (img, p) => {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += luma(img, p.x + dx, p.y + dy);
      return sum / 25;
    };
    const nearTrail = patch(f25, { x: headAt(25).x - 8 * 4, y: headAt(25).y });
    const farTrail = patch(f25, { x: headAt(25).x - 8 * 15, y: headAt(25).y });
    const nothing = patch(f25, { x: headAt(25).x - 8 * 30, y: headAt(25).y });
    console.log(`  trail luma: near ${nearTrail.toFixed(1)}, far ${farTrail.toFixed(1)}, past the tail ${nothing.toFixed(1)}`);
    check("Spark: the trail is brighter near the head than far from it", nearTrail > farTrail + 10);
    check("Spark: and fades to the background past its length", farTrail > nothing && nothing < 12);
    await frame("spark-scene", 40);
    const again = await frame("spark-scene", 25);
    check("Spark: two renders of the same frame are byte-identical", sameBytes(f25, again));

    // ---- Nova ----
    const novaBase = await frame("nova-scene", 0);
    const bgLuma = meanLuma(novaBase);
    const cx = width / 2;
    const cy = height / 2;
    const before29 = await frame("nova-scene", 29);
    check("Nova: before `at` nothing is drawn (identical to the empty frame)", sameBytes(novaBase, before29) && (await glowing("nova")) === 0);
    const flash = await frame("nova-scene", 30);
    const flashLuma = meanLuma(flash);
    console.log(`  nova mean luma: before ${meanLuma(before29).toFixed(1)}, flash ${flashLuma.toFixed(1)}`);
    check("Nova: during the flash the frame is measurably brighter", flashLuma > bgLuma + 25);
    check("Nova: the flash is a single glowing element", (await glowing("nova")) === 1);
    const fade = await frame("nova-scene", 32);
    check("Nova: the flash lasts three frames (gone by the fourth)", meanLuma(fade) > bgLuma + 3 && meanLuma(await frame("nova-scene", 33)) < flashLuma * 0.5 && (await glowing("nova")) === 0);

    // The ring: farthest bright pixel from the origin along the long axis, beyond the content.
    const ringReach = (img, side = 1) => {
      const horizontal = width >= height;
      const limit = horizontal ? width / 2 : height / 2;
      let far = 0;
      for (let d = 200; d < limit - 1; d++) {
        const x = horizontal ? cx + side * d : cx;
        const y = horizontal ? cy : cy + side * d;
        if (luma(img, x, y) > 30) far = d;
      }
      return far;
    };
    const img6 = await frame("nova-scene", 36);
    const ring6 = ringReach(img6);
    const ring14 = ringReach(await frame("nova-scene", 44));
    console.log(`  ring reach: frame 6 ${ring6}px, frame 14 ${ring14}px`);
    check("Nova: the shockwave ring is expanding between frames 6 and 14", ring6 > 0 && ring14 > ring6 + 100);
    check("Nova: the ring is centred on the frame centre (the default origin): the same reach both ways", ring6 > 0 && near(ringReach(img6, -1), ring6, 3));

    const mid = await frame("nova-scene", 50);
    const midCentre = rgb(mid, cx, cy);
    check("Nova: mid-condense the content is only partly there (the centre is not yet the final colour)", Math.abs(midCentre[0] - 92) + Math.abs(midCentre[1] - 200) + Math.abs(midCentre[2] - 255) > 30);
    check("Nova: particles are converging mid-way", (await circles()) >= 40);
    const end = await frame("nova-scene", 90);
    const endCentre = rgb(end, cx, cy);
    check("Nova: by the end the content is fully formed (the exact colour at the centre)", Math.abs(endCentre[0] - 92) <= 2 && Math.abs(endCentre[1] - 200) <= 2 && Math.abs(endCentre[2] - 255) <= 2);
    check("Nova: after it the ring has gone (nothing bright beyond the content) and no particles are left", ringReach(end) === 0 && (await circles()) === 0 && (await glowing("nova")) === 0);
    const later = await frame("nova-scene", 110);
    check("Nova: once formed the frame is stable", sameBytes(end, later));
    const repeat = await frame("nova-scene", 36);
    check("Nova: two renders of the same frame are byte-identical", sameBytes(await frame("nova-scene", 36), repeat));

    // The Nova named by an impact point lands on that point's frame.
    const hit = (await frame("impact-nova", 60));
    const justBefore = (await frame("impact-nova", 59));
    console.log(`  impact nova luma: frame 59 ${meanLuma(justBefore).toFixed(1)}, frame 60 ${meanLuma(hit).toFixed(1)}; errors ${JSON.stringify(errors.slice(0, 2))}`);
    check("Nova from the score: nothing at frame 59, the flash at bar 1 (frame 60 at 120 bpm)", meanLuma(justBefore) < 12 && meanLuma(hit) > 40);

    // ---- the behaviours ----
    await frame("paths-scene", 2);
    const dump = JSON.parse(await page.evaluate(() => document.getElementById("dump")?.textContent ?? "null"));
    if (dump === null) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 4))}`);
    const pt = (p, x, y, tol = 0.6) => near(p.x, x, tol) && near(p.y, y, tol);
    check("trace: starts at the first point, ends on the last at `duration`, and holds there", pt(dump.trace[0], 0, 0) && pt(dump.trace[2], 100, 100) && pt(dump.trace[3], 100, 100));
    check("trace: eased half way along the arc length (t=30) is the corner (100,0)", pt(dump.trace[1], 100, 0));
    check("trace: half way along the arc length is the corner (100,0)", pt(dump.polylineHalf, 100, 0));
    check("carry: the Spark sits on y = x squared, mapped to the screen (x=2 at t=20, y=4)", pt(dump.carry[1], 200, 420, 3) && pt(dump.carry[0], 100, 500) && pt(dump.carry[2], 300, 180));
    check("carry: holds at the end", pt(dump.carry[3], 300, 180));
    check("orbit: a circle of radius 50 round the target, a full turn in 40 frames", pt(dump.orbit[0], 250, 200) && pt(dump.orbit[1], 200, 250) && pt(dump.orbit[2], 150, 200) && pt(dump.orbit[3], 250, 200));
    check("split: all four share the parent's path until `at`", dump.split.every((s) => pt(s[0], 0, 0) && pt(s[1], 200, 0)));
    check("split: then fan out 80px each way, evenly (up, right, down, left)", pt(dump.split[0][2], 200 + 0, -80, 1) && pt(dump.split[1][2], 280, 0, 1) && pt(dump.split[2][2], 200, 80, 1) && pt(dump.split[3][2], 120, 0, 1));
    check("fall: gravity bends the path (y = -10t + t squared), x is steady", pt(dump.fall[1], 25, -25) && pt(dump.fall[2], 50, 0) && pt(dump.fall[3], 100, 30 - 0, 0.6) );
    check("fall: stops on the floor", pt(dump.fall[4], 200, 30));
    check("walk: rests on the first place, hops, rests, hops, and ends on the last", pt(dump.walk[0], 0, 0) && pt(dump.walk[1], 100, 0) && pt(dump.walk[2], 100, 0) && (dump.walk[3].x > 110 && dump.walk[3].x < 190) && pt(dump.walk[4], 200, 0) && pt(dump.walk[5], 200, 0));
    check("keyframes: held before the first and after the last, eased between", pt(dump.keyframes[0], 0, 0) && pt(dump.keyframes[1], 0, 0) && pt(dump.keyframes[2], 100, 50) && pt(dump.keyframes[3], 100, 50));
  });
}

if (!haveNodeModules) {
  skip("spark-nova", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

#!/usr/bin/env node
// animated-beams: the AnimatedBeams core primitive (#203). Pure geometry and timing first, then real
// frames rendered in a browser: stills at three frames of one beam, a curved beam, a chain that ripples,
// a fan-out, a reversed beam, a looping beam, and the colour coming from the brand tokens.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, monorepoRoot, check, skip, finish } from "./_harness.mjs";
import { sceneProject, inBrowser, haveNodeModules, sameBytes } from "./_browser.mjs";

const capture = require(path.join(monorepoRoot, "packages", "capture", "dist", "index.js"));
let browserAvailable = true;
try {
  await (await capture.launchChromium()).close();
} catch {
  browserAvailable = false;
}

const coreSrc = fs.readFileSync(path.join(monorepoRoot, "packages", "core", "src", "AnimatedBeams.tsx"), "utf8");
const coreIndex = fs.readFileSync(path.join(monorepoRoot, "packages", "core", "src", "index.ts"), "utf8");
const tokensSrc = fs.readFileSync(path.join(monorepoRoot, "packages", "core", "src", "tokens.ts"), "utf8");
const hexOf = (name) => {
  const hex = new RegExp(`${name}:\\s*"(#[0-9A-Fa-f]{6})"`).exec(tokensSrc)[1];
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
};

console.log("\n== the component: frame-driven, tokens, exported from core ==");
{
  check("it is exported from the core index", /export \{ AnimatedBeams[^}]*\} from "\.\/AnimatedBeams"/.test(coreIndex));
  const code = coreSrc.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
  check("no CSS animation, transition, keyframes, hover or random numbers anywhere in it", !/animation|transition|@keyframes|:hover|onMouse|Math\.random|requestAnimationFrame|setTimeout/.test(code));
  check("it reads the frame from Remotion", /useCurrentFrame\(\)/.test(code));
  check("the default colours are the accent tokens, read inside the component", /color\.accent, color\.accentAlt/.test(code) && !/#[0-9A-Fa-f]{6}/.test(code));
}

const { beamCurve, beamProgress, beamDash } = await import("node:module").then(async ({ createRequire }) => {
  // The pure helpers have no React in them, so load just those through a tiny transpile of their source.
  const ts = createRequire(import.meta.url)(path.join(monorepoRoot, "packages", "core", "node_modules", "typescript"));
  const js = ts.transpileModule(coreSrc.replace(/^import .*$/gm, "").replace(/export const AnimatedBeams[\s\S]*$/, ""), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", js)(mod, mod.exports);
  return mod.exports;
});

console.log("\n== geometry and timing ==");
{
  const straight = beamCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
  check("curvature 0 is a straight line", straight.d === "M 0 0 L 100 0" && straight.mid.x === 50 && straight.mid.y === 0);
  const bowed = beamCurve({ x: 0, y: 100 }, { x: 100, y: 100 }, 0.3);
  check("a positive curvature bows to the left of travel (up the screen for a left-to-right line), by curvature x length at the control point", bowed.control.y === 100 - 30 && bowed.control.x === 50);
  check("...and the curve's middle sits halfway to the control point", bowed.mid.y === 100 - 15);
  const down = beamCurve({ x: 0, y: 100 }, { x: 100, y: 100 }, -0.3);
  check("a negative curvature bows the other way", down.control.y === 130);

  const o = { at: 10, cycle: 60, loop: false, gap: 12, stagger: 0, index: 0 };
  check("before it starts a beam is not showing", beamProgress(9, o) === null);
  check("it starts at progress 0 on its first frame and reaches 0.5 half a cycle in", beamProgress(10, o) === 0 && beamProgress(40, o) === 0.5);
  check("a one-trip beam is gone once the cycle is over", beamProgress(69, o) !== null && beamProgress(70, o) === null);
  const lp = { ...o, loop: true };
  check("a looping beam rests for the gap and then goes again", beamProgress(70, lp) === null && beamProgress(81, lp) === null && beamProgress(82, lp) === 0);
  check("stagger delays each connection by its index", beamProgress(10, { ...o, stagger: 20, index: 2 }) === null && beamProgress(50, { ...o, stagger: 20, index: 2 }) === 0);

  const start = beamDash(0, 0.25);
  const end = beamDash(1, 0.25);
  check("at progress 0 the dash lies entirely before the path starts, at 1 entirely past its end (so it grows out of one anchor and drains into the other)", start.dashoffset === 0.25 && end.dashoffset === -1 && start.dasharray === "0.25 1");
  check("halfway the dash is centred on the path", Math.abs(beamDash(0.5, 0.25).dashoffset - (0.25 - 0.625)) < 1e-9);
}

console.log("\n== real frames ==");
if (!haveNodeModules) {
  skip("real frames", "no resolvable node_modules to scaffold a renderable project from");
} else if (!browserAvailable) {
  skip("real frames", "Chromium is not available in this environment");
} else {
  const scene = (name, jsx, header = "") => `import React from "react";
import { AbsoluteFill } from "remotion";
import { AnimatedBeams } from "@openvidstudio/core";
${header}
export const ${name}: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    ${jsx}
  </AbsoluteFill>
);
`;
  const A = "[{ x: 300, y: 540 }, { x: 1620, y: 540 }]";
  const scenes = {
    straight: { duration: 90, source: scene("Straight", `<AnimatedBeams anchors={${A}} curvature={0} at={10} cycle={60} loop={false} />`) },
    curved: { duration: 90, source: scene("Curved", `<AnimatedBeams anchors={[{ x: 300, y: 800 }, { x: 1620, y: 800 }]} curvature={0.3} at={10} cycle={60} loop={false} />`) },
    chain: { duration: 120, source: scene("Chain", `<AnimatedBeams anchors={[{ x: 300, y: 900 }, { x: 960, y: 300 }, { x: 1620, y: 900 }]} curvature={0} at={10} cycle={60} stagger={30} loop={false} />`) },
    fan: { duration: 90, source: scene("Fan", `<AnimatedBeams anchors={[{ x: 300, y: 540 }, { x: 1500, y: 300 }, { x: 1500, y: 800 }]} connections={[[0, 1], [0, 2]]} curvature={0} at={10} cycle={60} loop={false} />`) },
    reversed: { duration: 90, source: scene("Reversed", `<AnimatedBeams anchors={${A}} curvature={0} at={10} cycle={60} loop={false} reverse />`) },
    looping: { duration: 120, source: scene("Looping", `<AnimatedBeams anchors={${A}} curvature={0} at={10} cycle={30} gap={10} loop />`) },
  };
  const project = sceneProject({ prefix: "ovs-beams-", width: 1920, height: 1080, scenes });

  // Lit pixels: bright against the faint track, which is the accent at 18% opacity.
  const LIT = 100;
  const lit = (img, test) => {
    const pts = [];
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * img.channels;
        const luma = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        if (luma > LIT && (!test || test(x, y))) pts.push([x, y]);
      }
    }
    return pts;
  };
  const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const track = (img, x, y) => {
    const i = (y * img.width + x) * img.channels;
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  };
  const band = (y0, tol) => (_, y) => Math.abs(y - y0) <= tol;

  await inBrowser(project, async ({ frame, errors }) => {
    // ---- one beam, three frames ----
    const before = await frame("straight", 4);
    const f1 = await frame("straight", 25);
    const f2 = await frame("straight", 40);
    const f3 = await frame("straight", 55);
    const after = await frame("straight", 80);
    const c = [f1, f2, f3].map((f) => lit(f, band(540, 8)));
    check("frame 4 (before it starts): no lit pixels", lit(before).length === 0);
    check("...but the faint track is already drawn along the line", track(before, 960, 540) > 12 && track(before, 960, 540) < 60);
    check("frames 25, 40 and 55 all have a lit beam", c.every((p) => p.length > 400));
    const xs = c.map((p) => centroid(p)[0]);
    console.log(`  beam centroid x at frames 25/40/55: ${xs.map((x) => x.toFixed(0)).join(" / ")}`);
    check("the beam travels left to right: centroid x rises across the three frames", xs[0] < xs[1] && xs[1] < xs[2]);
    check("...from near the first anchor, through the middle, to near the last (300 to 1620)", xs[0] < 700 && Math.abs(xs[1] - 960) < 80 && xs[2] > 1230);
    check("every lit pixel sits between the anchors (plus the round cap)", c.every((p) => p.every(([x]) => x >= 290 && x <= 1630)));
    check("the beam is a short stretch of the line, not the whole of it (a quarter, so under 600px at frame 40)", Math.max(...c[1].map((p) => p[0])) - Math.min(...c[1].map((p) => p[0])) < 600);
    check("frame 80 (after its one trip): no lit pixels", lit(after).length === 0);
    check("the same frame rendered twice is byte-identical (a pure function of the frame)", sameBytes(await frame("straight", 40), f2));

    // ---- curved ----
    const cv = await frame("curved", 40);
    const cvLit = lit(cv, (x) => x > 900 && x < 1020);
    const cy = cvLit.length ? centroid(cvLit)[1] : null;
    console.log(`  curved beam at the middle: y ${cy?.toFixed(0)} (the anchors are at 800, the curve's middle at 602)`);
    check("a curved beam leaves the straight line: at the middle it is near the curve's middle (y 602), not at the anchors' y (800)", cy !== null && Math.abs(cy - 602) < 40);

    // ---- a chain that ripples ----
    const left = (x) => x < 900;
    const right = (x) => x > 1020;
    const c25 = await frame("chain", 25);
    const c85 = await frame("chain", 85);
    check("chain, frame 25: the first connection is lit and the second has not started", lit(c25, left).length > 100 && lit(c25, right).length === 0);
    check("chain, frame 85: the first has finished and the second is lit", lit(c85, left).length === 0 && lit(c85, right).length > 100);

    // ---- a fan out of one anchor ----
    const fn = await frame("fan", 45);
    const upper = lit(fn, (x, y) => x > 900 && y < 520);
    const lower = lit(fn, (x, y) => x > 900 && y > 560);
    check("a fan-out lights both branches from the one anchor (one rising, one falling)", upper.length > 100 && lower.length > 100);

    // ---- reversed ----
    const r = [await frame("reversed", 25), await frame("reversed", 40), await frame("reversed", 55)].map((f) => centroid(lit(f, band(540, 8)))[0]);
    check("reverse sends the beam from the last anchor to the first: centroid x falls across the frames", r[0] > r[1] && r[1] > r[2] && r[0] > 1230);

    // ---- looping ----
    const l1 = await frame("looping", 25); // first trip, 15 frames in
    const l2 = await frame("looping", 65); // second trip starts at 10 + 40: 15 frames in
    const gapFrame = await frame("looping", 45); // 35 frames in: inside the 10 frame rest after a 30 frame trip
    check("a looping beam shows the same picture at the same point of every trip", sameBytes(l1, l2));
    check("...and is dark during the rest between trips", lit(gapFrame).length === 0);

    check("no page errors while rendering any of it", errors.length === 0);
    if (errors.length) console.log(`  errors: ${JSON.stringify(errors.slice(0, 4))}`);
  });

  // ---- colour comes from the brand tokens ----
  const brandScene = scene(
    "Branded",
    `<AnimatedBeams anchors={${A}} curvature={0} at={0} cycle={60} loop={false} />`,
    `import { applyBrand } from "@openvidstudio/core";\napplyBrand({ color: { accent: "#00FF66", accentAlt: "#00FF66" } });`,
  );
  const brandProject = sceneProject({ prefix: "ovs-beams-brand-", width: 1920, height: 1080, scenes: { branded: { duration: 90, source: brandScene } } });
  await inBrowser(brandProject, async ({ frame }) => {
    const f = await frame("branded", 30);
    const pts = lit(f, band(540, 3));
    const [r, g, b] = [0, 1, 2].map((ch) => pts.reduce((s, [x, y]) => s + f.data[(y * f.width + x) * f.channels + ch], 0) / pts.length);
    console.log(`  branded beam mean colour: ${[r, g, b].map(Math.round)}`);
    check("with a brand applied the beam takes its colour (a green accent here), not the openvidstudio default", pts.length > 100 && g > 180 && r < 120 && b < 150);
  });
  const def = hexOf("accent");
  check("(control) the default accent is blue, so the check above could tell the difference", def[2] > def[1] && def[1] > def[0]);
}

finish();

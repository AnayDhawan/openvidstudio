#!/usr/bin/env node
// cinematic-pipeline: transitions drawn over the cut, the rhythm warning in validate_beats, and
// capture_screenshot layers. Everything that can be checked on real pixels is: a stitched
// composition is rendered and the frames are compared, not the generated text grepped.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  require,
  packageRoot,
  distDir,
  monorepoTemplateDir,
  check,
  skip,
  finish,
} from "./_harness.mjs";

const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const stitchModule = require(path.join(distDir, "tools", "stitchComposition.js"));
const { runStitchComposition } = stitchModule;
const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));

const TYPES = ["fade", "whip", "push", "wipe", "light-leak"];
const RED = "#c81e1e";
const BLUE = "#1e46c8";
const HALF = 6; // frames either side of a cut at 30 fps; the overlay is 2 * HALF long

console.log("\n== Transitions: the vocabulary is accepted and anything else is refused ==");
{
  const beat = (transition) => ({
    fps: 30,
    title: "T",
    beats: [
      { id: "a", start: 0, duration: 60, vo: "a short narration line here", visual: { captureMethod: "dom-demo" } },
      { id: "b", start: 60, duration: 60, vo: "a short narration line here", visual: { captureMethod: "dom-demo" }, ...(transition ? { transition } : {}) },
    ],
  });
  for (const t of ["cut", "whip", "fade", "push", "wipe", "light-leak"]) {
    check(`validate_beats accepts transition "${t}"`, validateBeatsLogic(beat(t)).valid === true);
  }
  const bad = validateBeatsLogic(beat("spin"));
  check("...and refuses an unknown one", bad.valid === false);
  check(
    "...naming every accepted type in the error",
    ["cut", "whip", "fade", "push", "wipe", "light-leak"].every((t) => bad.errors.join(" ").includes(`"${t}"`)),
  );
  // The transition check used to sit below the early returns for desktop/mobile/terminal beats,
  // so a typo on one of those was never reported.
  const terminal = validateBeatsLogic({
    fps: 30,
    title: "T",
    beats: [
      { id: "a", start: 0, duration: 60, vo: "a short narration line here", visual: { captureMethod: "dom-demo" } },
      { id: "b", start: 60, duration: 60, vo: "a short narration line here", visual: { captureMethod: "recording", source: "terminal", command: "hermes" }, transition: "spin" },
    ],
  });
  check("a bad transition on a terminal beat is reported too", terminal.errors.join(" ").includes("transition must be one of"));
  const { DEFAULT_TRANSITIONS } = (() => {
    const src = fs.readFileSync(path.join(packageRoot, "..", "core", "src", "designSystem.ts"), "utf8");
    const m = src.match(/DEFAULT_TRANSITIONS\s*=\s*(\[[^\]]*\])/);
    return { DEFAULT_TRANSITIONS: m ? JSON.parse(m[1]) : [] };
  })();
  check(
    "the design system's default transition list names all six",
    ["cut", "whip", "fade", "push", "wipe", "light-leak"].every((t) => DEFAULT_TRANSITIONS.includes(t)),
  );
  check("...and the stitcher's half-window scales with fps (6 at 30, 12 at 60, 5 at 24)",
    stitchModule.transitionHalfFrames?.(30) === 6 && stitchModule.transitionHalfFrames?.(60) === 12 && stitchModule.transitionHalfFrames?.(24) === 5);
}

console.log("\n== Rhythm: uniform shot lengths draw a warning, never an error ==");
{
  const file = (durations, extra = {}) => {
    let start = 0;
    return {
      fps: 30,
      title: "T",
      narration: "none",
      beats: durations.map((duration, i) => {
        const beat = { id: `b${i}`, start, duration, visual: { captureMethod: "dom-demo" } };
        start += duration;
        return beat;
      }),
      ...extra,
    };
  };
  const rhythm = (r) => r.warnings.filter((w) => /metronome/.test(w));

  const uniform = validateBeatsLogic(file([90, 90, 90, 90, 90]));
  check("five equal beats still validate: the rhythm note is a warning, not an error", uniform.valid === true && uniform.errors.length === 0);
  check("...and carry exactly one warning that names the problem (metronome)", rhythm(uniform).length === 1 && uniform.warnings.length === 1);
  check("...which says what to do (one long hold, one short punch)", /long hold/.test(uniform.warnings[0]) && /short punch/.test(uniform.warnings[0]));
  check("...and quotes the real numbers (longest 90 frames, shortest 90 frames, 1.00x)", /90 frames/.test(uniform.warnings[0]) && /1\.00x/.test(uniform.warnings[0]));

  const varied = validateBeatsLogic(file([150, 45, 90, 60]));
  check("four beats with a 3.3x spread draw no warning", varied.valid === true && varied.warnings.length === 0);
  check("three equal beats draw none (fewer than four is not a rhythm yet)", validateBeatsLogic(file([90, 90, 90])).warnings.length === 0);
  check("three beats of varied length draw none", validateBeatsLogic(file([150, 45, 90])).warnings.length === 0);

  // The line is "longest less than 2.5x the shortest": 2.5x exactly is fine, a hair under is not.
  check("a longest exactly 2.5x the shortest (100 vs 40) draws none", validateBeatsLogic(file([100, 40, 70, 70])).warnings.length === 0);
  check("...and 100 vs 41 (2.44x) does", rhythm(validateBeatsLogic(file([100, 41, 70, 70]))).length === 1);
  // Control meant to fail if the check ever stops reading the durations: the same four ids
  // with the spread removed must warn, the one above must not.
  check("control: [100,40,70,70] and [70,70,70,70] disagree", validateBeatsLogic(file([100, 40, 70, 70])).warnings.length === 0 && rhythm(validateBeatsLogic(file([70, 70, 70, 70]))).length === 1);

  // The documented worked example is the first thing an agent copies, so it must not trip the note.
  const planning = fs.readFileSync(path.join(packageRoot, "..", "docs", "PLANNING.md"), "utf8").replace(/\r\n/g, "\n");
  const example = JSON.parse(planning.slice(planning.search(/^## \d+\. Worked example/m)).match(/```json\n([\s\S]*?)\n```/)[1]);
  const exampleResult = validateBeatsLogic(example);
  check(`PLANNING.md's worked example is valid and draws no rhythm warning (${example.beats.map((b) => b.duration).join("/")} frames)`, exampleResult.valid === true && exampleResult.warnings.length === 0);

  const withErrors = validateBeatsLogic(file([90, 90, 90, 90], { beats: undefined }));
  check("a file with no beats array returns no warnings and no crash", Array.isArray(withErrors.warnings) && withErrors.warnings.length === 0 && withErrors.valid === false);
  const { runWriteBeatsFile } = require(path.join(distDir, "tools", "writeBeatsFile.js"));
  const wroteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-rhythm-"));
  check("write_beats_file still writes a uniform file: a warning does not block", runWriteBeatsFile({ projectRoot: wroteRoot, videoName: "u", beatsJson: file([90, 90, 90, 90]) }).written === true);
}

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
if (!fs.existsSync(templateNodeModules)) {
  skip("transition renders", "no resolvable node_modules to scaffold a renderable project from");
  finish();
  process.exit(process.exitCode ?? 0);
}

console.log("\n== Transitions: real renders of stitched compositions ==");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-cin-pipeline-"));
for (let attempt = 1; ; attempt++) {
  try {
    runInitProject({ name: "cin", projectRoot: root });
    break;
  } catch (err) {
    if (attempt >= 3) throw err;
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
  }
}
fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");

// A beat is a flat colour, so any difference between two renders of it is the overlay and
// nothing else. Ids are the only thing that differs between videos; the scenes are copied.
const pascal = (id) => id.charAt(0).toUpperCase() + id.slice(1);
function makeVideo(name, plan, { fps = 30 } = {}) {
  const videoDir = path.join(root, "src", "videos", name);
  const scenesDir = path.join(videoDir, "custom-scenes");
  fs.mkdirSync(scenesDir, { recursive: true });
  let start = 0;
  const beats = plan.map((p, i) => {
    const id = `s${i}`;
    fs.writeFileSync(
      path.join(scenesDir, `${pascal(id)}.tsx`),
      `import React from "react";\nimport { AbsoluteFill } from "remotion";\n\nexport const ${pascal(id)}: React.FC = () => <AbsoluteFill style={{ background: "${p.color}" }} />;\n`,
      "utf8",
    );
    const beat = { id, start, duration: p.duration, scene: `./custom-scenes/${pascal(id)}.tsx`, ...(p.transition ? { transition: p.transition } : {}) };
    start += p.duration;
    return beat;
  });
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps, beats }, null, 2));
  return runStitchComposition({ projectRoot: root, videoName: name });
}
const demoText = (name) => fs.readFileSync(path.join(root, "src", "videos", name, `${name.charAt(0).toUpperCase() + name.slice(1)}Demo.tsx`), "utf8");

// Two scenes, cut versus fade, and a six-scene run with one of each type at successive cuts.
const six = (transitions) =>
  [RED, BLUE, RED, BLUE, RED, BLUE].map((color, i) => ({ color, duration: 90, ...(i > 0 && transitions[i - 1] ? { transition: transitions[i - 1] } : {}) }));
const tcut = makeVideo("tcut", [{ color: RED, duration: 90 }, { color: BLUE, duration: 90 }]);
const tfade = makeVideo("tfade", [{ color: RED, duration: 90 }, { color: BLUE, duration: 90, transition: "fade" }]);
const tplain = makeVideo("tplain", six([]));
const tmix = makeVideo("tmix", six(TYPES));
// A first beat shorter than the half-window: the overlay must clamp, not reach before frame 0.
const tshort = makeVideo("tshort", [{ color: RED, duration: 4 }, { color: BLUE, duration: 60, transition: "fade" }]);
const tshortPlain = makeVideo("tshortplain", [{ color: RED, duration: 4 }, { color: BLUE, duration: 60 }]);

// ---- text: nothing changes unless a beat asks for a transition ----
const seriesBlock = (text) => text.slice(text.indexOf("<Series>"), text.indexOf("</Series>") + "</Series>".length);
check("a cut-only composition has no overlay, import or sequence for one", !/TransitionOverlay|transition/i.test(demoText("tcut")));
check("...nor does a plain six-beat one", !/TransitionOverlay|transition/i.test(demoText("tplain")));
check("a composition with a transition imports the overlay and draws it", /import \{[^}]*TransitionOverlay[^}]*\} from "@openvidstudio\/core"/.test(demoText("tfade")) && demoText("tfade").includes("<TransitionOverlay"));
check("the Series (what fixes every beat's start and duration) is byte-for-byte the same with and without one", seriesBlock(demoText("tcut")) === seriesBlock(demoText("tfade")) && seriesBlock(demoText("tplain")) === seriesBlock(demoText("tmix")));
check("both compositions are the same length", tcut.durationInFrames === 180 && tfade.durationInFrames === 180 && tplain.durationInFrames === 540 && tmix.durationInFrames === 540);
{
  // An explicit "cut" and a first beat's transition both mean no overlay.
  const explicitCut = makeVideo("texplicit", [{ color: RED, duration: 90, transition: "fade" }, { color: BLUE, duration: 90, transition: "cut" }]);
  check("transition \"cut\" and a transition on beat 0 draw nothing (there is no cut into the first beat)", !demoText("texplicit").includes("TransitionOverlay") && explicitCut.durationInFrames === 180);
}

const bridge = require(path.join(distDir, "remotionBridge.js"));
const bundleDir = await bridge.bundleProject(root);
const browser = await bridge.openRenderBrowser();
const stillDir = path.join(root, "stills");
const compositions = new Map();
async function still(video, compositionId, frame) {
  if (!compositions.has(compositionId)) compositions.set(compositionId, await bridge.resolveComposition(bundleDir, compositionId, browser));
  const outPath = path.join(stillDir, `${video}-${frame}.png`);
  await bridge.renderStillPng({ serveUrl: bundleDir, composition: compositions.get(compositionId), frame, outPath, browser });
  const { data, info } = await sharp(outPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}
// Fraction of pixels that differ by more than 2 levels in any channel, and the frame's mean luma.
function compare(a, b) {
  let differing = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const o = i * a.channels;
    if (Math.abs(a.data[o] - b.data[o]) > 2 || Math.abs(a.data[o + 1] - b.data[o + 1]) > 2 || Math.abs(a.data[o + 2] - b.data[o + 2]) > 2) differing++;
  }
  return differing / n;
}
function luma(a) {
  let sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const o = i * a.channels;
    sum += 0.299 * a.data[o] + 0.587 * a.data[o + 1] + 0.114 * a.data[o + 2];
  }
  return sum / n;
}

try {
  // ---- (b) fade versus cut on the same two scenes ----
  const cutAt = 90;
  const cutCut = await still("tcut", tcut.compositionId, cutAt);
  const cutFade = await still("tfade", tfade.compositionId, cutAt);
  const lumaCut = luma(cutCut);
  const lumaFade = luma(cutFade);
  check(`the plain cut frame is the incoming scene (mean luma ${lumaCut.toFixed(1)})`, lumaCut > 60 && lumaCut < 90);
  check(`at the cut the fade frame is clearly darker (mean luma ${lumaFade.toFixed(1)} vs ${lumaCut.toFixed(1)})`, lumaFade < lumaCut * 0.5);
  // The dip is to the brand background token (bg0, #0B0E14 until a brand overrides it), not to black.
  const bg0 = Buffer.alloc(cutFade.data.length);
  for (let i = 0; i < bg0.length; i += cutFade.channels) {
    bg0[i] = 0x0b;
    bg0[i + 1] = 0x0e;
    bg0[i + 2] = 0x14;
  }
  check(`...and it is the background token's colour, not black (${(compare(cutFade, { ...cutFade, data: bg0 }) * 100).toFixed(3)}% of pixels off)`, compare(cutFade, { ...cutFade, data: bg0 }) === 0);
  const before20 = [await still("tcut", tcut.compositionId, cutAt - 20), await still("tfade", tfade.compositionId, cutAt - 20)];
  const after20 = [await still("tcut", tcut.compositionId, cutAt + 20), await still("tfade", tfade.compositionId, cutAt + 20)];
  check(`20 frames before the cut the two compositions are pixel-identical (${(compare(...before20) * 100).toFixed(3)}% differ)`, compare(...before20) === 0);
  check(`20 frames after the cut they are pixel-identical (${(compare(...after20) * 100).toFixed(3)}% differ)`, compare(...after20) === 0);
  // Control meant to fail: the comparator must be able to see two different scenes as different,
  // otherwise "identical" above proves nothing.
  const redFrame = await still("tcut", tcut.compositionId, 30);
  check("control: the comparator sees red and blue scenes as different", compare(redFrame, after20[0]) > 0.99);
  check("control: ...and a frame as identical to itself", compare(redFrame, redFrame) === 0);

  // ---- (c) each type, one per cut of the six-scene run ----
  console.log("\n  per-type measurements (share of pixels that differ from the plain cut):");
  for (let i = 0; i < TYPES.length; i++) {
    const type = TYPES[i];
    const cut = 90 * (i + 1);
    const plainAtCut = await still("tplain", tplain.compositionId, cut);
    const mixAtCut = await still("tmix", tmix.compositionId, cut);
    const share = compare(plainAtCut, mixAtCut);
    check(`${type}: the frame at the cut differs from the plain cut frame (${(share * 100).toFixed(1)}% of pixels)`, share > 0.2);

    // The overlay really ends: HALF + 2 frames out either side the render is the plain one.
    const farBefore = [await still("tplain", tplain.compositionId, cut - HALF - 2), await still("tmix", tmix.compositionId, cut - HALF - 2)];
    const farAfter = [await still("tplain", tplain.compositionId, cut + HALF + 2), await still("tmix", tmix.compositionId, cut + HALF + 2)];
    check(`${type}: HALF+2 frames before the cut the frame is identical to plain (${(compare(...farBefore) * 100).toFixed(3)}% differ)`, compare(...farBefore) === 0);
    check(`${type}: HALF+2 frames after the cut the frame is identical to plain (${(compare(...farAfter) * 100).toFixed(3)}% differ)`, compare(...farAfter) === 0);

    // It also eases to nothing rather than popping off: the last frame the overlay is mounted on
    // either side is already invisible.
    const lastBefore = [await still("tplain", tplain.compositionId, cut - HALF + 1), await still("tmix", tmix.compositionId, cut - HALF + 1)];
    const lastAfter = [await still("tplain", tplain.compositionId, cut + HALF - 1), await still("tmix", tmix.compositionId, cut + HALF - 1)];
    check(`${type}: the overlay's first and last mounted frames are already clear (${(compare(...lastBefore) * 100).toFixed(3)}% / ${(compare(...lastAfter) * 100).toFixed(3)}%)`, compare(...lastBefore) < 0.001 && compare(...lastAfter) < 0.001);

    // Next to the cut it is visibly there on both sides, so the cut is covered, not just the one frame.
    const nearBefore = [await still("tplain", tplain.compositionId, cut - 2), await still("tmix", tmix.compositionId, cut - 2)];
    check(`${type}: two frames before the cut the overlay is already drawn (${(compare(...nearBefore) * 100).toFixed(1)}%)`, compare(...nearBefore) > 0.05);
  }

  // ---- a first beat shorter than the half-window ----
  const shortCut = await still("tshort", tshort.compositionId, 4);
  const shortPlainCut = await still("tshortplain", tshortPlain.compositionId, 4);
  check(`a 4-frame first beat: the overlay clamps to the composition start and still covers the cut (${(compare(shortCut, shortPlainCut) * 100).toFixed(1)}% differ)`, compare(shortCut, shortPlainCut) > 0.2);
  const shortFirst = [await still("tshort", tshort.compositionId, 0), await still("tshortplain", tshortPlain.compositionId, 0)];
  check("...and frame 0 is untouched", compare(...shortFirst) === 0);
} finally {
  await browser.close({ silent: true });
}

finish();

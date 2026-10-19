#!/usr/bin/env node
// validate-scenes-supernova: validate_scenes and the disclosure rules know about lessons (#115).
//
// Two checks written for product videos misfire on a lesson: "numbers typed into copy without facts.json"
// flags every constant in an equation or a worked example (they are computed, not claimed), and "constructed
// content must be disclosed" assumes a real product being imitated. And one Supernova rule had no check:
// one glowing element at a time. Each is run against a standard project (existing behaviour, asserted
// unchanged) and a supernova one.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { require, distDir, monorepoTemplateDir, check, skip, finish } from "./_harness.mjs";

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const { runValidateScenes, runValidateScenesFull, lessonNumbers, typedNumbers } = require(path.join(distDir, "tools", "validateScenes.js"));
const { validateBriefLogic } = require(path.join(distDir, "tools", "writeBrief.js"));
const { runWriteDescription } = require(path.join(distDir, "tools", "writeDescription.js"));
const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));

function project(prefix, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "lesson", projectRoot: root, ...(mode ? { mode } : {}) });
      return root;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
}
const videoDirOf = (root) => path.join(root, "src", "videos", "lesson");
function scenes(root, map, extraBeats = {}) {
  const dir = path.join(videoDirOf(root), "scenes");
  fs.mkdirSync(dir, { recursive: true });
  const beats = [];
  let start = 0;
  for (const [id, source] of Object.entries(map)) {
    const component = id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
    fs.writeFileSync(path.join(dir, `${component}.tsx`), source, "utf8");
    beats.push({ id, start, duration: 60, vo: "A line of narration for this beat of the lesson.", visual: { captureMethod: "dom-demo" } });
    start += 60;
  }
  fs.writeFileSync(path.join(videoDirOf(root), "beats.json"), JSON.stringify({ fps: 30, narration: "none", ...extraBeats, beats }));
}
const camera = `camera={[{ frame: 0, x: 540, y: 960, scale: 1 }, { frame: 60, x: 540, y: 960, scale: 1.05 }]}`;
const sceneWithText = (name, jsx) => `import React from "react";
import { CinematicScene } from "@openvidstudio/core";
import { Equation } from "@openvidstudio/stem";
export const ${name}: React.FC = () => (
  <CinematicScene ${camera}>
${jsx}
  </CinematicScene>
);
`;
const numbersFinding = (result, beatId) => result.findings.find((f) => f.beatId === beatId && f.check === "numbers-sourcing");

console.log("\n== numbers typed into copy ==");
{
  const typedScene = (name) => sceneWithText(name, `    <div>Launched at 20 m/s</div>\n    <div>The range is 73 m</div>`);
  const equationScene = (name) => sceneWithText(name, `    <Equation tex={String.raw\`y = 36x\`} spoken="y equals thirty six x" />\n    <div>The slope is 36</div>`);
  const strayScene = (name) => sceneWithText(name, `    <div>The answer is 73</div>`);

  // standard: unchanged
  const std = project("ovs-vs-std-");
  fs.writeFileSync(path.join(videoDirOf(std), "concept.json"), JSON.stringify({ goal: "g", terms: [], example: "a ball launched at 20 m/s" }));
  scenes(std, { typed: typedScene("Typed"), eq: equationScene("Eq") });
  const stdResult = runValidateScenes({ projectRoot: std, videoName: "lesson" });
  const stdTyped = numbersFinding(stdResult, "typed");
  check("standard project: both typed numbers (20 and 73) are flagged, concept card or not (existing behaviour)", !!stdTyped && /20/.test(stdTyped.message) && /73/.test(stdTyped.message));
  check("standard project: an Equation's TeX does not excuse a typed number", !!numbersFinding(stdResult, "eq") && /36/.test(numbersFinding(stdResult, "eq").message));
  check("standard project: the result says mode standard", stdResult.mode === "standard");

  // supernova
  const sn = project("ovs-vs-sn-", "supernova");
  fs.writeFileSync(path.join(videoDirOf(sn), "concept.json"), JSON.stringify({ goal: "g", terms: [], example: "a ball launched at 20 m/s" }));
  scenes(sn, { typed: typedScene("Typed"), eq: equationScene("Eq"), stray: strayScene("Stray") });
  const snResult = runValidateScenes({ projectRoot: sn, videoName: "lesson" });
  const snTyped = numbersFinding(snResult, "typed");
  check("supernova project: a number from the worked example (20) passes, a stray one (73) is flagged", !!snTyped && !/\b20\b/.test(snTyped.message) && /73/.test(snTyped.message));
  check("supernova project: a number in an Equation's TeX (36) passes", numbersFinding(snResult, "eq") === undefined);
  check("supernova project: a stray number that appears nowhere is flagged", !!numbersFinding(snResult, "stray") && /73/.test(numbersFinding(snResult, "stray").message));
  check("supernova project: the result says mode supernova", snResult.mode === "supernova");
  check("control: removing the concept card makes 20 a stray number again", (() => {
    fs.rmSync(path.join(videoDirOf(sn), "concept.json"));
    const again = runValidateScenes({ projectRoot: sn, videoName: "lesson" });
    return /\b20\b/.test(numbersFinding(again, "typed")?.message ?? "");
  })());
  check("the file-level opt-out comment still works in a lesson", (() => {
    scenes(sn, { typed: `// ovs-numbers-ok: fixed labels\n${typedScene("Typed")}` });
    return numbersFinding(runValidateScenes({ projectRoot: sn, videoName: "lesson" }), "typed") === undefined;
  })());

  check("lessonNumbers reads tex written four ways", (() => {
    const src = `<Equation tex="a 11" /><Equation tex={"b 22"} /><Equation tex={\`c 33\`} /><Equation tex={String.raw\`d 44\`} />`;
    const set = lessonNumbers(undefined, src);
    return ["11", "22", "33", "44"].every((n) => set.has(n));
  })());
  check("typedNumbers is unchanged (the standard check's own reader)", JSON.stringify(typedNumbers("<p>Over 1,200 users and 73%</p>")) === JSON.stringify(["1,200", "73"]));
}

console.log("\n== camera keyframes: a product-demo rule, not a lesson one ==");
{
  const cameraWarning = (result, beatId) => result.findings.find((f) => f.beatId === beatId && /camera/i.test(f.message));
  const flat = `import React from "react";
export const Flat: React.FC = () => <div>A flat lesson scene</div>;
`;
  const oneKeyframe = `import React from "react";
import { CinematicScene } from "@openvidstudio/core";
export const One: React.FC = () => (
  <CinematicScene camera={[{ frame: 0, x: 540, y: 960, scale: 1 }]}>
    <div>One keyframe</div>
  </CinematicScene>
);
`;
  const staticCamera = `import React from "react";
import { CinematicScene } from "@openvidstudio/core";
export const Still: React.FC = () => (
  <CinematicScene camera={[{ frame: 0, x: 540, y: 960, scale: 1 }, { frame: 60, x: 540, y: 960, scale: 1 }]}>
    <div>Two identical keyframes</div>
  </CinematicScene>
);
`;
  const sn = project("ovs-vs-cam-sn-", "supernova");
  scenes(sn, { flat, one: oneKeyframe, still: staticCamera });
  const snResult = runValidateScenes({ projectRoot: sn, videoName: "lesson" });
  check("supernova project: plain scenes get no camera warning", snResult.findings.every((f) => !/camera/i.test(f.message)));
  check("supernova project: the result is still mode supernova", snResult.mode === "supernova");

  const std = project("ovs-vs-cam-std-");
  scenes(std, { flat, one: oneKeyframe, still: staticCamera });
  const stdResult = runValidateScenes({ projectRoot: std, videoName: "lesson" });
  check("standard project: a scene with no camera still warns", !!cameraWarning(stdResult, "flat"));
  check("standard project: a one-keyframe scene still warns", /Fewer than two camera keyframes/.test(cameraWarning(stdResult, "one")?.message ?? ""));
  check("standard project: a camera that never moves still warns", /never moves/.test(cameraWarning(stdResult, "still")?.message ?? ""));
}

console.log("\n== constructed content: disclosed in a product video, one line in a lesson ==");
{
  const briefBase = {
    logline: "Why a derivative is a slope.",
    audience: "IB maths students",
    feeling: "Oh, that is all it is.",
    storyDevice: { device: "a ball rolling down a hill", reason: "a slope you can feel" },
    arc: { hook: "h", tension: "t", turn: "u", proof: "p", payoff: "y", cta: "c" },
  };
  const constructedShot = { beatId: "one", real: false, provenance: "an animated graph", focalPoint: "the curve" };
  const standardBrief = validateBriefLogic({ ...briefBase, creativeLevel: "peak", shotList: [constructedShot] });
  check("standard brief: a shot with real: false and no whyConstructed is refused (existing rule)", standardBrief.errors.some((e) => /whyConstructed/.test(e)));
  const lessonBrief = validateBriefLogic({ ...briefBase, mode: "supernova", shotList: [constructedShot] });
  check("supernova brief: the same shot needs no whyConstructed", !lessonBrief.errors.some((e) => /shotList/.test(e)));
  check("supernova brief: the shot list may be left out altogether", !validateBriefLogic({ ...briefBase, mode: "supernova" }).errors.some((e) => /shotList/.test(e)));
  check("standard brief: the shot list is still required", validateBriefLogic({ ...briefBase, creativeLevel: "peak" }).errors.some((e) => /shotList/.test(e)));
  check("supernova brief: a shot entry must still say which beat it is about", validateBriefLogic({ ...briefBase, mode: "supernova", shotList: [{}] }).errors.some((e) => /shotList\[0\]\.beatId/.test(e)));

  const description = (mode) => {
    const root = project(`ovs-vs-desc-${mode ?? "std"}-`, mode);
    fs.writeFileSync(path.join(videoDirOf(root), "beats.json"), JSON.stringify({ fps: 30, beats: [{ id: "one", start: 0, duration: 90, vo: "How steep is a hill at one spot?", visual: { captureMethod: "dom-demo" } }] }));
    fs.writeFileSync(path.join(videoDirOf(root), "brief.json"), JSON.stringify({ logline: "L", audience: "A", feeling: "F", shotList: [{ beatId: "one", real: false, provenance: "an animated graph", focalPoint: "f", whyConstructed: "there is no product to film" }], ...(mode ? { mode } : {}) }));
    const r = runWriteDescription({ projectRoot: root, videoName: "lesson" });
    return { r, text: fs.readFileSync(r.path, "utf8") };
  };
  const std = description(undefined);
  check("standard description: the constructed shot is disclosed in a Sample content section", /## Sample content used in this video/.test(std.text) && std.r.sampleContentDisclosed.includes("one") && !/constructed explanation/.test(std.text));
  const lesson = description("supernova");
  check("lesson description: the sample-content section is replaced by one line", !/Sample content/.test(lesson.text) && lesson.text.includes("This video is a constructed explanation, not footage.") && lesson.r.sampleContentDisclosed.length === 0);
  check("lesson description: that line appears exactly once", lesson.text.split("constructed explanation, not footage").length === 2);
}

console.log("\n== the glow budget (render mode) ==");
if (!fs.existsSync(templateNodeModules)) {
  skip("glow budget", "no resolvable node_modules to scaffold a renderable project from");
} else {
  const sparkScene = (name, count, nova = false) => `import React from "react";
import { AbsoluteFill } from "remotion";
import { Spark, Nova, trace } from "@openvidstudio/stem";
export const ${name}: React.FC = () => (
  <AbsoluteFill style={{ background: "#07060B" }}>
${Array.from({ length: count }, (_, i) => `    <Spark path={trace([{ x: 200, y: ${600 + 200 * i} }, { x: 800, y: ${600 + 200 * i} }], { duration: 50 })} />`).join("\n")}
${nova ? `    <Nova at={5} duration={40}><div style={{ position: "absolute", left: 340, top: 900, width: 400, height: 100, background: "#5CC8FF" }} /></Nova>` : ""}
  </AbsoluteFill>
);
`;
  const sn = project("ovs-vs-glow-sn-", "supernova");
  fs.symlinkSync(templateNodeModules, path.join(sn, "node_modules"), "junction");
  scenes(sn, { one: sparkScene("One", 1), two: sparkScene("Two", 2), three: sparkScene("Three", 3), "nova-beat": sparkScene("NovaBeat", 2, true) });
  runStitchComposition({ projectRoot: sn, videoName: "lesson" });
  const rendered = await runValidateScenesFull({ projectRoot: sn, videoName: "lesson", render: true });
  const glow = (id) => rendered.findings.filter((f) => f.beatId === id && f.check === "glow-budget");
  console.log(`  glow findings: ${JSON.stringify(rendered.findings.filter((f) => f.check === "glow-budget").map((f) => [f.beatId, f.severity]))}`);
  check("render mode measured all four beats", rendered.render?.beatsMeasured === 4 && rendered.render.beatsSkipped.length === 0);
  check("one glowing element (a Spark) is within budget: no finding", glow("one").length === 0);
  check("two glowing elements are a warning", glow("two").length === 1 && glow("two")[0].severity === "warning" && /2 elements glow/.test(glow("two")[0].message));
  check("three glowing elements are an error", glow("three").length === 1 && glow("three")[0].severity === "error" && /3 elements glow/.test(glow("three")[0].message));
  check("a beat with a Nova is exempt, even with two Sparks on screen", glow("nova-beat").length === 0);
  check("only the error fails the result", rendered.ok === false && rendered.findings.filter((f) => f.severity === "error" && f.check === "glow-budget").length === 1);

  // The same glow markers in a standard project are not judged: the budget is a Supernova rule.
  const std = project("ovs-vs-glow-std-");
  fs.symlinkSync(templateNodeModules, path.join(std, "node_modules"), "junction");
  const fakeGlow = `import React from "react";
import { AbsoluteFill } from "remotion";
export const Plain: React.FC = () => (
  <AbsoluteFill style={{ background: "#07060B" }}>
    {[0, 1, 2].map((i) => <div key={i} data-ovs-glow="spark" data-ovs-glow-level="1" style={{ position: "absolute", left: 100 + 200 * i, top: 300, width: 40, height: 40, background: "#fff" }} />)}
  </AbsoluteFill>
);
`;
  scenes(std, { plain: fakeGlow });
  runStitchComposition({ projectRoot: std, videoName: "lesson" });
  const stdRendered = await runValidateScenesFull({ projectRoot: std, videoName: "lesson", render: true });
  check("standard project: three glow-tagged elements draw no glow finding (existing behaviour unchanged)", stdRendered.mode === "standard" && stdRendered.findings.every((f) => f.check !== "glow-budget"));
}

finish();

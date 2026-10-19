#!/usr/bin/env node
// validate-scenes-arc: the lesson arc checks (#138): the diagram is drawn inside 15 s, and nothing sits still for 8 s.
//
// Both rules are about the picture, so a script linter cannot see them. They are judged from the frames
// validate_scenes already samples in render mode. This file checks the judgement on its own (pure functions and
// real pixels), then on rendered fixture lessons: a blank opening, a diagram at 6 s, a 10 s hold and a 6 s hold.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharp from "sharp";
import { require, distDir, monorepoTemplateDir, check, skip, finish } from "./_harness.mjs";

const { judgeLessonArc, measureArcFrame, drawnShare, DEFAULT_ARC_THRESHOLDS } = require(path.join(distDir, "lessonArc.js"));

console.log("\n== judging samples ==");
{
  const at = (time, drawn, changed, beatId = "b") => ({ time, beatId, drawn, changedFromPrevious: changed });
  const moving = (times, firstDrawn = 0) => times.map((t, i) => at(t, t >= firstDrawn ? 0.05 : 0, i === 0 ? null : 0.3));
  const findings = (samples, lesson) => judgeLessonArc(samples, lesson);
  const of = (list, check) => list.filter((f) => f.check === check);

  check("a diagram at 6 s is not late", of(findings(moving([1, 3, 6, 9, 12], 6), 14), "diagram-late").length === 0);
  const late = of(findings(moving([2, 6, 10, 14, 18, 22], 18), 24), "diagram-late");
  check("a diagram first drawn at 18 s is a warning", late.length === 1 && late[0].severity === "warning" && /18 s/.test(late[0].message));
  const veryLate = of(findings(moving([5, 15, 25, 35], 35), 40), "diagram-late");
  check("a diagram first drawn past 25 s is an error", veryLate.length === 1 && veryLate[0].severity === "error");
  const never = of(findings(moving([5, 15, 25], 999), 30), "diagram-late");
  check("no frame ever drawing anything is an error", never.length === 1 && never[0].severity === "error" && /never/.test(never[0].message));
  check("the thresholds are options", of(judgeLessonArc(moving([2, 6, 10], 10), 12, { ...DEFAULT_ARC_THRESHOLDS, diagramWarnSeconds: 8 }), "diagram-late").length === 1);

  // Holds. Each sample is 2 s apart; a changed sample bounds a hold by the midpoint between the two.
  const run = (heldFrom, heldTo, n = 12) => Array.from({ length: n }, (_, i) => at((i + 1) * 2, 0.05, i === 0 ? null : i >= heldFrom && i <= heldTo ? 0 : 0.3));
  const tenSecondHold = of(findings(run(3, 6), 24), "static-stretch");
  check("a hold of about 10 s is flagged", tenSecondHold.length === 1 && tenSecondHold[0].severity === "warning" && /10 s/.test(tenSecondHold[0].message));
  check("a hold of about 6 s is not", of(findings(run(3, 5), 24), "static-stretch").length === 0);
  check("a hold touching the end of the lesson runs to its end", of(findings(run(8, 11), 36), "static-stretch").length === 1);
  check("motion in every frame draws no static finding", of(findings(moving([2, 4, 6, 8, 10, 12], 0), 14), "static-stretch").length === 0);
  check("two short holds are not one long one", of(findings(run(2, 3).map((s, i) => (i === 6 ? { ...s, changedFromPrevious: 0 } : s)), 24), "static-stretch").length === 0);
  check("staticSeconds is an option", of(judgeLessonArc(run(3, 5), 24, { ...DEFAULT_ARC_THRESHOLDS, staticSeconds: 5 }), "static-stretch").length === 1);
}

console.log("\n== measuring real pixels ==");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-arc-px-"));
  const W = 270;
  const H = 480;
  const make = async (name, paint) => {
    const data = Buffer.alloc(W * H * 3);
    for (let p = 0; p < W * H; p++) {
      data[p * 3] = 7;
      data[p * 3 + 1] = 6;
      data[p * 3 + 2] = 11;
    }
    paint(data);
    const file = path.join(dir, `${name}.png`);
    await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
    return file;
  };
  const box = (data, x0, y0, w, h, rgb) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) rgb.forEach((v, c) => (data[(y * W + x) * 3 + c] = v));
  };
  const grid = (data) => {
    for (let y = 0; y < H; y += 30) box(data, 0, y, W, 1, [20, 19, 24]);
    for (let x = 0; x < W; x += 30) box(data, x, 0, 1, H, [20, 19, 24]);
  };
  const blank = await make("blank", grid);
  const captioned = await make("captioned", (d) => (grid(d), box(d, 40, 420, 190, 30, [243, 239, 230])));
  const drawn = await make("drawn", (d) => (grid(d), box(d, 100, 200, 60, 60, [92, 200, 255])));
  const moved = await make("moved", (d) => (grid(d), box(d, 140, 240, 60, 60, [92, 200, 255])));
  const captionedDrawn = await make("captioned-drawn", (d) => (grid(d), box(d, 100, 200, 60, 60, [92, 200, 255]), box(d, 40, 420, 190, 30, [243, 239, 230])));

  const a = await measureArcFrame(blank, [], null);
  check("an empty Void with its hairline grid has nothing drawn", a.drawn < 0.0005);
  const b = await measureArcFrame(captioned, [], a.signature);
  check("captions alone (the bottom band) count as nothing drawn", b.drawn < 0.0005);
  check("and a frame that only gained a caption has not changed", b.changedFromPrevious !== null && b.changedFromPrevious <= 0.002);
  const c = await measureArcFrame(drawn, [], b.signature);
  check("a drawn element is seen", c.drawn > 0.01);
  check("and it is a change from the frame before", c.changedFromPrevious > 0.01);
  const d = await measureArcFrame(moved, [], c.signature);
  check("an element that moved is a change", d.changedFromPrevious > 0.01);
  const e = await measureArcFrame(captionedDrawn, [{ x: 40, y: 420, width: 190, height: 30 }], d.signature);
  check("when the page names its caption box, only that box is ignored", e.drawn > 0.01);
  const sameElementWithCaption = await measureArcFrame(captionedDrawn, [{ x: 40, y: 420, width: 190, height: 30 }], c.signature);
  check("the same picture with a caption added is unchanged", sameElementWithCaption.changedFromPrevious <= 0.002);
  check("control: without the caption box named, a caption in the middle of the frame counts as drawn", (await measureArcFrame(await make("mid", (d2) => box(d2, 40, 100, 190, 30, [243, 239, 230])), [{ x: 0, y: 440, width: W, height: 40 }], null)).drawn > 0.01);
  check("drawnShare of an unmasked uniform frame is zero", drawnShare(Buffer.alloc(30, 9), new Uint8Array(10), 10, 1) === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n== validate_scenes on rendered lessons ==");
const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
if (!fs.existsSync(templateNodeModules)) {
  skip("lesson arc on rendered fixtures", "no resolvable node_modules to scaffold a renderable project from");
} else {
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  const { runValidateScenesFull } = require(path.join(distDir, "tools", "validateScenes.js"));
  const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));

  const FPS = 30;
  // Every scene carries a caption box whose text changes every frame, so a Void with only captions is
  // still a blank frame and a hold with moving captions is still a hold.
  const scene = (name, body) => `import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
export const ${name}: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
${body}
      <div data-ovs-captions style={{ position: "absolute", left: 140, top: 1500, width: 800, height: 80, color: "#F3EFE6", fontSize: 48 }}>caption {frame}</div>
    </AbsoluteFill>
  );
};
`;
  const blank = (name) => scene(name, "");
  const still = (name) => scene(name, `      <div style={{ position: "absolute", left: 300, top: 600, width: 400, height: 400, background: "#5CC8FF" }} />`);
  const moving = (name, appearsAt = 0) =>
    scene(name, `      {frame >= ${appearsAt} ? <div style={{ position: "absolute", left: 100 + ((frame * 4) % 700), top: 600, width: 200, height: 200, background: "#5CC8FF" }} /> : null}`);

  function lesson(prefix, plan) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    runInitProject({ name: "lesson", projectRoot: root, mode: "supernova" });
    fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");
    const dir = path.join(root, "src", "videos", "lesson");
    const beats = [];
    let start = 0;
    for (const [id, seconds, source] of plan) {
      const component = id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
      fs.mkdirSync(path.join(dir, "scenes"), { recursive: true });
      fs.writeFileSync(path.join(dir, "scenes", `${component}.tsx`), source(component), "utf8");
      beats.push({ id, start, duration: seconds * FPS, vo: "A line of narration for this beat.", visual: { captureMethod: "dom-demo" } });
      start += seconds * FPS;
    }
    fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify({ fps: FPS, narration: "none", beats }));
    runStitchComposition({ projectRoot: root, videoName: "lesson" });
    return root;
  }
  const arc = (result) => result.findings.filter((f) => f.check === "diagram-late" || f.check === "static-stretch");
  const summary = (result) => JSON.stringify(arc(result).map((f) => [f.beatId, f.check, f.severity]));

  // A diagram at 6 s, then a 6 s hold between two moving beats: a healthy lesson.
  const good = lesson("ovs-arc-good-", [["open", 12, (n) => moving(n, 180)], ["hold", 6, still], ["go", 12, (n) => moving(n)]]);
  const goodResult = await runValidateScenesFull({ projectRoot: good, videoName: "lesson", render: true });
  console.log(`  good lesson arc findings: ${summary(goodResult)}`);
  check("rendered all three beats", goodResult.render?.beatsMeasured === 3 && goodResult.render.beatsSkipped.length === 0);
  check("a diagram at 6 s and a 6 s hold draw no arc finding", arc(goodResult).length === 0);

  const tight = await runValidateScenesFull({ projectRoot: good, videoName: "lesson", render: true, staticSeconds: 4 });
  console.log(`  with staticSeconds 4: ${summary(tight)}`);
  check("control: the same lesson with staticSeconds 4 flags the 6 s hold", arc(tight).some((f) => f.check === "static-stretch" && f.severity === "warning"));

  // A blank Void for 20 s (with only captions on it), then the diagram.
  const late = lesson("ovs-arc-late-", [["empty", 20, blank], ["diagram", 12, (n) => moving(n)]]);
  const lateResult = await runValidateScenesFull({ projectRoot: late, videoName: "lesson", render: true });
  console.log(`  late lesson arc findings: ${summary(lateResult)}`);
  const lateFinding = arc(lateResult).find((f) => f.check === "diagram-late");
  check("a blank opening of 20 s is a diagram-late warning", !!lateFinding && lateFinding.severity === "warning");
  check("the blank opening is also a static stretch", arc(lateResult).some((f) => f.check === "static-stretch"));
  const lateStrict = await runValidateScenesFull({ projectRoot: late, videoName: "lesson", render: true, diagramErrorSeconds: 18 });
  check("diagramErrorSeconds makes it an error, and the result fails", arc(lateStrict).some((f) => f.check === "diagram-late" && f.severity === "error") && lateStrict.ok === false);
  const lateOnly = await runValidateScenesFull({ projectRoot: late, videoName: "lesson", render: true, beatIds: ["diagram"] });
  check("measuring only some beats does not judge the arc", arc(lateOnly).length === 0);

  // A 10 s hold between two moving beats.
  const held = lesson("ovs-arc-hold-", [["a", 6, (n) => moving(n)], ["hold", 10, still], ["c", 6, (n) => moving(n)]]);
  const heldResult = await runValidateScenesFull({ projectRoot: held, videoName: "lesson", render: true });
  console.log(`  10 s hold arc findings: ${summary(heldResult)}`);
  check("a 10 s hold is a static-stretch warning on that beat", arc(heldResult).some((f) => f.check === "static-stretch" && f.beatId === "hold" && f.severity === "warning"));
  check("and the diagram is not late", arc(heldResult).every((f) => f.check !== "diagram-late"));

  // The same checks are a Supernova rule only.
  const standard = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-arc-std-"));
  runInitProject({ name: "lesson", projectRoot: standard });
  fs.symlinkSync(templateNodeModules, path.join(standard, "node_modules"), "junction");
  const sdir = path.join(standard, "src", "videos", "lesson");
  fs.mkdirSync(path.join(sdir, "scenes"), { recursive: true });
  fs.writeFileSync(path.join(sdir, "scenes", "Empty.tsx"), blank("Empty"), "utf8");
  fs.writeFileSync(path.join(sdir, "beats.json"), JSON.stringify({ fps: FPS, narration: "none", beats: [{ id: "empty", start: 0, duration: 20 * FPS, vo: "A line.", visual: { captureMethod: "dom-demo" } }] }));
  runStitchComposition({ projectRoot: standard, videoName: "lesson" });
  const standardResult = await runValidateScenesFull({ projectRoot: standard, videoName: "lesson", render: true });
  check("a standard project is not judged by the arc", arc(standardResult).length === 0);
}

finish();

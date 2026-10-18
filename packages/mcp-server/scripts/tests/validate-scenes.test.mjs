#!/usr/bin/env node
// validate-scenes: Part 53, Part 54 (split out of the former single manual-test.mjs; see _harness.mjs)

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  require,
  __dirname,
  packageRoot,
  distDir,
  monorepoRoot,
  monorepoTemplateDir,
  check,
  skip,
  listFilesRecursive,
  setQuiet,
  finish,
} from "./_harness.mjs";

// ---- fixtures (quiet): state this file's checks expect from earlier in the old single script ----
setQuiet(true);
// fixture: INIT
const bundledTemplateDir = path.join(packageRoot, "templates", "default");
if (!fs.existsSync(bundledTemplateDir)) {
  console.error(`Bundled template not found at ${bundledTemplateDir}. Run "npm run build" first.`);
  process.exit(1);
}

const { TEMPLATE_DIR } = require(path.join(distDir, "paths.js"));
check("TEMPLATE_DIR points at the bundled copy (not monorepo templates/default)", TEMPLATE_DIR === bundledTemplateDir);
check("TEMPLATE_DIR exists on disk", fs.existsSync(TEMPLATE_DIR));

const bundledFileList = listFilesRecursive(bundledTemplateDir);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-init-test-"));
const backupDir = `${monorepoTemplateDir}.manual-test-bak`;

let initResult;
const monorepoTemplateExisted = false; // only init-project.test.mjs hides the monorepo template; a rename that fails (a watcher holding a handle) would strand it and break every later file
if (!monorepoTemplateExisted) {
  console.log(`  (monorepo templates/default already absent, skipping rename-away step)`);
}
try {
  if (monorepoTemplateExisted) {
    fs.renameSync(monorepoTemplateDir, backupDir);
  }
  // The monorepo-relative path templates/default does NOT exist right now. If
  // init_project's compiled code resolved its template through anything other than
  // TEMPLATE_DIR (packages/mcp-server/templates/default), this call fails.
  delete require.cache[require.resolve(path.join(distDir, "tools", "initProject.js"))];
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  initResult = runInitProject({
    name: "demo",
    projectRoot: tmpRoot,
    hasHiggsfield: true,
    targetDurationSeconds: 45,
  });
} finally {
  if (monorepoTemplateExisted && fs.existsSync(backupDir)) {
    fs.renameSync(backupDir, monorepoTemplateDir);
  }
}

check("init_project succeeded with the monorepo template path unavailable", !!initResult);
check("openvidstudio.config.json written with merged fields", (() => {
  const cfg = JSON.parse(fs.readFileSync(path.join(tmpRoot, "openvidstudio.config.json"), "utf8"));
  return cfg.hasHiggsfield === true && cfg.targetDurationSeconds === 45 && cfg.videoConfig.fps === 30;
})());

// src/Root.tsx is the one deliberate exception (B): init_project seeds preflight's
// benchmark composition into the registry and immediately regenerates Root.tsx from it
// (see initProject.ts), so the scaffolded copy is bigger than the bundled template's bare
// `return null;` starting point by design, not a copy failure.
const EXPECTED_TO_DIFFER = new Set([path.join("src", "Root.tsx")]);
let allBundledFilesCopied = true;
for (const rel of bundledFileList) {
  if (EXPECTED_TO_DIFFER.has(rel)) continue;
  const src = path.join(bundledTemplateDir, rel);
  const dst = path.join(tmpRoot, rel);
  if (!fs.existsSync(dst) || fs.statSync(src).size !== fs.statSync(dst).size) {
    allBundledFilesCopied = false;
    console.log(`  MISMATCH: ${rel}`);
  }
}
check(
  `every file in packages/mcp-server/templates/default (${bundledFileList.length} files, Root.tsx excepted) was copied into the scaffolded project`,
  allBundledFilesCopied,
);
check("src/videos/demo/scenes/ was created", fs.existsSync(path.join(tmpRoot, "src", "videos", "demo", "scenes")));
check(
  "src/Root.tsx was regenerated to register the preflight benchmark composition (B)",
  fs.readFileSync(path.join(tmpRoot, "src", "Root.tsx"), "utf8").includes("PreflightBenchmark"),
);
// fixture: PIPELINE

const beatsJson = {
  fps: 30,
  title: "Manual Test Demo",
  beats: [
    {
      id: "hook",
      start: 0,
      duration: 150,
      vo: "This tool scaffolds a demo video project from a single beats file quickly.",
      visual: { captureMethod: "screenshot", url: "https://example.com/app", interactions: [] },
    },
    {
      id: "explain",
      start: 150,
      duration: 180,
      vo: "Every beat gets its own scene file, ready for a developer to fill in content.",
      visual: { captureMethod: "dom-demo" },
    },
    {
      id: "outro",
      start: 330,
      duration: 120,
      vo: "A quiet establishing shot closes the demo with calm motion.",
      visual: {
        captureMethod: "higgsfield",
        higgsfieldPrompt: "slow drone push over a misty forest canopy at dawn, no text, cinematic",
      },
    },
  ],
};

const { runWriteBeatsFile } = require(path.join(distDir, "tools", "writeBeatsFile.js"));
const writeResult = runWriteBeatsFile({ projectRoot: tmpRoot, videoName: "demo", beatsJson });
check("write_beats_file accepted the 3-beat draft", writeResult.written === true);
check("beats.json written to disk", fs.existsSync(path.join(tmpRoot, "src", "videos", "demo", "beats.json")));

const { runScaffoldScene } = require(path.join(distDir, "tools", "scaffoldScene.js"));
const sceneSpecs = [
  { beatId: "hook", kind: "real-screenshot" },
  { beatId: "explain", kind: "dom-demo" },
  { beatId: "outro", kind: "higgsfield-clip" },
];
for (const spec of sceneSpecs) {
  const res = runScaffoldScene({ projectRoot: tmpRoot, videoName: "demo", beatId: spec.beatId, kind: spec.kind });
  check(`scaffold_scene wrote ${spec.beatId} (${spec.kind})`, res.written === true && fs.existsSync(res.path));
}

// Refusal-without-overwrite check.
let refused = false;
try {
  runScaffoldScene({ projectRoot: tmpRoot, videoName: "demo", beatId: "hook", kind: "real-screenshot" });
} catch (err) {
  refused = /already exists/.test(String(err.message));
}
check("scaffold_scene refuses to clobber an existing scene without overwrite: true", refused);

const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
const stitchResult = runStitchComposition({ projectRoot: tmpRoot, videoName: "demo" });
check("stitch_composition succeeded", stitchResult.written === true);
check("DemoDemo.tsx written", fs.existsSync(path.join(tmpRoot, "src", "videos", "demo", "DemoDemo.tsx")));
check("durationInFrames matches beats.json's last beat", stitchResult.durationInFrames === 450);
check("no VO beats found (no public/audio/vo/*.mp3 exists in this throwaway project)", stitchResult.voBeatsFound.length === 0);
check("no music bed found", stitchResult.musicBedFound === false);

const rootTsx = fs.readFileSync(path.join(tmpRoot, "src", "Root.tsx"), "utf8");
check("Root.tsx registers the DemoDemo composition", rootTsx.includes('id="DemoDemo"') && rootTsx.includes("DemoDemo"));
// fixture: NM
const tempNodeModules = path.join(tmpRoot, "node_modules");
const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
// Link only. The tsc pass over the scaffolded project is scaffold-and-stitch's own check.
let tscOk = false;
if (fs.existsSync(templateNodeModules)) {
  try {
    fs.symlinkSync(templateNodeModules, tempNodeModules, "junction");
    tscOk = true;
  } catch {}
}
setQuiet(false);
// ---- checks ----

console.log("\n== Part 53: validate_scenes render mode, pure judgement (C7) ==");
{
  const {
    judgeBeat,
    readTypeMinimums,
    MAX_READING_WORDS_PER_SEC,
    READING_OVERHEAD_SEC,
    contrastAgainst,
    backgroundBehind,
    colorShares,
    brandHexColors,
    judgeBrandPalette,
    readDeliberateHolds,
  } = require(path.join(distDir, "tools", "validateScenesRender.js"));
  const probe = (over) => ({ text: "hello", fontPx: 40, mono: false, label: false, inStage: true, opacity: 1, croppedRatio: 0, overhangPx: 0, ...over });
  const beat = { id: "pure", start: 0, duration: 150 };
  const mins = { body: 26, mono: 15, label: 16 };
  const run = (samples, maxChangedRatio = 0.5, b = beat) => judgeBeat({ beat: b, fps: 30, minimums: mins, samples, maxChangedRatio });
  const same = (p) => [[p], [p], [p], [p], [p]];

  check("a clean beat yields no findings", run(same(probe({}))).length === 0);
  check(
    "crop is flagged when stage text is cut in most samples",
    run(same(probe({ text: "wide", croppedRatio: 0.4, overhangPx: 300 }))).some((f) => f.check === "crop" && f.severity === "error"),
  );
  check(
    "crop is NOT flagged for a slide-in cut in only two of five samples",
    !run([[probe({ text: "slide", croppedRatio: 0.6, overhangPx: 200 })], [probe({ text: "slide", croppedRatio: 0.3, overhangPx: 90 })], [probe({ text: "slide" })], [probe({ text: "slide" })], [probe({ text: "slide" })]]).some((f) => f.check === "crop"),
  );
  check(
    "overlay text is exempt from the crop check",
    !run(same(probe({ inStage: false, croppedRatio: 0.5, overhangPx: 200 }))).some((f) => f.check === "crop"),
  );
  check("text below the body minimum is flagged", run(same(probe({ fontPx: 14 }))).some((f) => f.check === "text-size"));
  check("mono text is held to the mono minimum, not the body one", !run(same(probe({ fontPx: 18, mono: true }))).some((f) => f.check === "text-size"));
  check("a label (Pill/ToolChip) at 18px is not flagged, even though that is below the body minimum", !run(same(probe({ fontPx: 18, label: true }))).some((f) => f.check === "text-size"));
  check("a label below its own, lower minimum is still flagged", run(same(probe({ fontPx: 10, label: true }))).some((f) => f.check === "text-size" && /label/.test(f.message)));
  const words = Array.from({ length: 40 }, (_, i) => "w" + i).join(" ");
  check(
    "too much text for the beat's duration is flagged with the documented rate (3.5 words/sec plus 0.8s, shared with validate_beats)",
    MAX_READING_WORDS_PER_SEC === 3.5 && READING_OVERHEAD_SEC === 0.8 && run(same(probe({ text: words })), 0.5, { ...beat, duration: 60 }).some((f) => f.check === "reading-time"),
  );
  check("the same text on a long enough beat is not flagged", !run(same(probe({ text: words })), 0.5, { ...beat, duration: 600 }).some((f) => f.check === "reading-time"));
  {
    // 7 words need 7 / 3.5 + 0.8 = 2.8s: a 2.7s beat is flagged, a 2.9s one is not. Three words per
    // second would have wanted 3.13s, so this pins the new constants rather than the old ones.
    const seven = "one two three four five six seven";
    check("the reading budget includes the 0.8s overhead (7 words: 2.7s flagged)", run(same(probe({ text: seven })), 0.5, { ...beat, duration: 81 }).some((f) => f.check === "reading-time"));
    check("...and 7 words fit a 2.9s beat", !run(same(probe({ text: seven })), 0.5, { ...beat, duration: 87 }).some((f) => f.check === "reading-time"));
  }
  check("identical frames are flagged dead", run(same(probe({})), 0).some((f) => f.check === "dead-frames"));
  check("a null pixel comparison never flags dead frames", !run(same(probe({})), null).some((f) => f.check === "dead-frames"));
  check("a beat the brief marks as a deliberate hold is not reported as dead", !judgeBeat({ beat, fps: 30, minimums: mins, samples: same(probe({})), maxChangedRatio: 0, deliberateHold: true }).some((f) => f.check === "dead-frames"));
  {
    const holdDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-hold-"));
    check("no brief means no declared holds (the strict reading)", readDeliberateHolds(holdDir).length === 0);
    fs.writeFileSync(path.join(holdDir, "brief.json"), JSON.stringify({ shotList: [{ beatId: "title", deliberateHold: true }, { beatId: "demo" }, { beatId: "quiet", deliberateHold: false }, { beatId: "end", deliberateHold: true }] }));
    check("readDeliberateHolds returns exactly the shots marked true", readDeliberateHolds(holdDir).join() === "title,end");
    fs.writeFileSync(path.join(holdDir, "brief.json"), "{ not json");
    check("an unreadable brief declares no holds rather than crashing", readDeliberateHolds(holdDir).length === 0);
  }

  // ---- the additional C7 gates: em dash, contrast, safe area, HUD ----
  const dash = "Faster \u2014 and simpler";
  const emDash = run(same(probe({ text: dash }))).find((f) => f.check === "em-dash");
  check("an em dash in on-screen text is an error", emDash?.severity === "error" && emDash.message.includes("Faster"));
  check("an en dash or a hyphen is not an em dash", !run(same(probe({ text: "2024–2025 and well-known" }))).some((f) => f.check === "em-dash"));

  const white = [255, 255, 255, 1];
  const grey = [150, 150, 150, 1];
  check("contrastAgainst: white on black is 21:1", Math.abs(contrastAgainst(white, 1, [0, 0, 0]) - 21) < 0.01);
  check("contrastAgainst: identical colours are 1:1", Math.abs(contrastAgainst(grey, 1, [150, 150, 150]) - 1) < 0.001);
  check("contrastAgainst: a half-transparent white over black is weaker than opaque", contrastAgainst([255, 255, 255, 0.5], 1, [0, 0, 0]) < contrastAgainst(white, 1, [0, 0, 0]));
  check("contrastAgainst: ancestor opacity weakens the text the same way", Math.abs(contrastAgainst(white, 0.5, [0, 0, 0]) - contrastAgainst([255, 255, 255, 0.5], 1, [0, 0, 0])) < 0.001);
  const lowContrast = run(same(probe({ text: "faint", fontPx: 40, rgba: [120, 120, 120, 1], bg: [110, 110, 110] }))).find((f) => f.check === "contrast");
  check("near-identical text and background is flagged as an error (under 3:1)", lowContrast?.severity === "error");
  // grey 110 on grey 30 is 3.27:1, between the large-text floor (3) and the ordinary one (4.5)
  const midContrast = run(same(probe({ text: "small", fontPx: 18, rgba: [110, 110, 110, 1], bg: [30, 30, 30] }))).find((f) => f.check === "contrast");
  check("small text between 3:1 and 4.5:1 is a warning", midContrast?.severity === "warning");
  check("the same ratio passes for large text (3:1 floor)", !run(same(probe({ text: "big", fontPx: 40, rgba: [110, 110, 110, 1], bg: [30, 30, 30] }))).some((f) => f.check === "contrast"));
  check("strong contrast is not flagged", !run(same(probe({ rgba: [255, 255, 255, 1], bg: [10, 10, 30] }))).some((f) => f.check === "contrast"));
  check("a probe with no measured background is not guessed at", !run(same(probe({ rgba: [120, 120, 120, 1] }))).some((f) => f.check === "contrast"));
  check("gradient or clipped text (alpha 0) is skipped", !run(same(probe({ rgba: [120, 120, 120, 0], bg: [110, 110, 110] }))).some((f) => f.check === "contrast"));

  check("text inside the frame but past the safe inset is a warning", run(same(probe({ text: "edge", safeOverhangPx: 40 }))).some((f) => f.check === "safe-area" && f.severity === "warning"));
  check("a few pixels of slop past the safe inset is tolerated", !run(same(probe({ safeOverhangPx: 1.5 }))).some((f) => f.check === "safe-area"));
  check("text that is actually cropped is a crop finding, not also a safe-area one", !run(same(probe({ text: "cut", croppedRatio: 0.4, overhangPx: 300, safeOverhangPx: 340 }))).some((f) => f.check === "safe-area"));
  check("HUD text is exempt from the safe-area check", !run(same(probe({ hud: true, safeOverhangPx: 40 }))).some((f) => f.check === "safe-area"));

  check("scene text over the HUD is flagged", run(same(probe({ text: "covered", hudOverlap: 0.5 }))).some((f) => f.check === "hud-overlap"));
  check("a sliver of overlap is not", !run(same(probe({ hudOverlap: 0.02 }))).some((f) => f.check === "hud-overlap"));
  check("HUD chrome is exempt from the text-size and reading checks", !run(same(probe({ hud: true, fontPx: 12, text: words }))).some((f) => f.check === "text-size" || f.check === "reading-time"));

  // ---- C8: numbers shown on screen come from facts or a capture ----
  {
    const { typedNumbers } = require(path.join(distDir, "tools", "validateScenes.js"));
    check("a number typed into JSX text is found", typedNumbers("<div>Ten tools, 32 in all</div>").join() === "32");
    check("a number in a text prop is found, in either quote style", typedNumbers('<Words text="Cut render time by 47%" />').join() === "47" && typedNumbers("<Pill label='12 files' />").join() === "12");
    check("decimals and thousands separators are one number each", typedNumbers("<b>3.5 words/s over 1,200 frames</b>").join() === "3.5,1,200");
    check("years, version strings and single digits are not claims", typedNumbers("<i>Since 2024, v1.2.3 shipped step 3 of 3</i>").length === 0);
    check("digits inside identifiers and colours are not numbers", typedNumbers('<div style={{ color: "#ff5a1f", left: 300 }}>word12 and a2b</div>').length === 0);
    check("numbers in code, not in visible text, are not flagged", typedNumbers("const x = 42; const y = compute(1920, 1080);").length === 0);
    check("the same number twice is reported once", typedNumbers("<p>64 tools</p><p>64 again</p>").length === 1);

    // Through the static pass, on real scene files.
    const { runValidateScenes } = require(path.join(distDir, "tools", "validateScenes.js"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c8-"));
    const dir = path.join(root, "src", "videos", "c8");
    fs.mkdirSync(path.join(dir, "scenes"), { recursive: true });
    const scene = (name, body) => fs.writeFileSync(path.join(dir, "scenes", `${name}.tsx`), `import React from "react";\n${body}\nexport const ${name}: React.FC = () => <CinematicScene camera={[{ frame: 0, x: 960, y: 540, scale: 1 }, { frame: 90, x: 960, y: 540, scale: 1.05 }]}>{null}</CinematicScene>;\n`);
    scene("Typed", "const copy = <div>Ships 32 tools</div>;");
    scene("Sourced", 'import facts from "../facts.json";\nconst copy = <div>Ships {facts.tools} tools, 32 of them</div>;');
    scene("OptedOut", "// ovs-numbers-ok: a step counter\nconst copy = <div>Step 12</div>;");
    scene("Clean", "const copy = <div>Ships the whole pipeline</div>;");
    fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify({ fps: 30, beats: ["typed", "sourced", "opted-out", "clean"].map((id, i) => ({ id, start: i * 90, duration: 90 })) }));
    const out = runValidateScenes({ projectRoot: root, videoName: "c8" });
    const sourcing = (id) => out.findings.filter((f) => f.beatId === id && f.check === "numbers-sourcing");
    check("a scene that types a number and does not import facts is warned", sourcing("typed").length === 1 && sourcing("typed")[0].severity === "warning" && /32/.test(sourcing("typed")[0].message) && /collect_facts/.test(sourcing("typed")[0].message));
    check("a scene that imports facts.json is not", sourcing("sourced").length === 0);
    check("an ovs-numbers-ok comment opts a file out", sourcing("opted-out").length === 0);
    check("copy with no numbers is untouched", sourcing("clean").length === 0);
  }

  // ---- background sampling and the palette check, on real pixels ----
  {
    const W = 200;
    const H = 100;
    const buf = new Uint8Array(W * H * 3);
    const fill = (x0, y0, x1, y1, [r, g, b]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 3; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; }
    };
    fill(0, 0, W, H, [20, 40, 160]); // a blue surface
    fill(60, 30, 140, 70, [250, 250, 250]); // a big bright "text" block covering most of the box below
    const bg = backgroundBehind(buf, W, H, 3, { l: 60, t: 30, r: 140, b: 70 }, 6);
    check("backgroundBehind reads the surface from the ring, not the glyph pixels inside the box", bg && Math.abs(bg[0] - 20) <= 2 && Math.abs(bg[1] - 40) <= 2 && Math.abs(bg[2] - 160) <= 2);
    const whole = backgroundBehind(buf, W, H, 3, { l: 0, t: 0, r: W, b: H }, 6);
    check("a box that fills the frame falls back to its own interior", whole !== null);

    const shares = colorShares(buf, W, H, 3, ["#1428a0", "#ff0000"]);
    check("colorShares finds the blue surface (about 80% of the frame) and not a colour that is absent", shares.get("#1428a0") > 0.7 && shares.get("#ff0000") === 0);
  }
  {
    const brandDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-brand-"));
    check("no brand.ts means no brand colours to look for", brandHexColors(brandDir).length === 0);
    fs.mkdirSync(path.join(brandDir, "src"));
    fs.writeFileSync(path.join(brandDir, "src", "brand.ts"), 'applyBrand({ bg0: "#0A0B10", accent: "#FF5A1F", text: "#ffffff", black: "#000000" });\n');
    const colors = brandHexColors(brandDir);
    check("brandHexColors returns the palette, lowercased, minus pure black and white", colors.join(",") === "#0a0b10,#ff5a1f");
    check("a palette that reaches a frame produces no finding", judgeBrandPalette(new Map([["#0a0b10", 0.6], ["#ff5a1f", 0.001]])).length === 0);
    const missing = judgeBrandPalette(new Map([["#0a0b10", 0], ["#ff5a1f", 0]]));
    check("a palette that never shows is one warning naming the likely causes", missing.length === 1 && missing[0].check === "brand-palette" && /FIRST import/.test(missing[0].message) && /sideEffects/.test(missing[0].message));
    check("no brand colours means nothing to judge", judgeBrandPalette(new Map()).length === 0);
  }

  const dsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c7-design-"));
  check("no design.ts falls back to the default minimums", readTypeMinimums(dsDir).body === 26 && readTypeMinimums(dsDir).mono === 15 && readTypeMinimums(dsDir).label === 16);
  fs.writeFileSync(path.join(dsDir, "design.ts"), "typeScale: { display: [120, 220], headline: [56, 84], body: [30, 40], mono: [18, 24] },");
  check("design.ts typeScale overrides body/mono", readTypeMinimums(dsDir).body === 30 && readTypeMinimums(dsDir).mono === 18);
  check("...but label has no typeScale counterpart, so it stays fixed regardless", readTypeMinimums(dsDir).label === 16);
}

console.log("\n== Part 54: validate_scenes render mode against real rendered scenes (C7) ==");
if (fs.existsSync(templateNodeModules)) {
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  const { runValidateScenesFull } = require(path.join(distDir, "tools", "validateScenes.js"));
  const c7Root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c7-render-"));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "c7check", projectRoot: c7Root });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(c7Root, { recursive: true, force: true });
      fs.mkdirSync(c7Root, { recursive: true });
    }
  }
  fs.symlinkSync(templateNodeModules, path.join(c7Root, "node_modules"), "junction");

  const videoDir = path.join(c7Root, "src", "videos", "c7check");
  const customDir = path.join(videoDir, "custom-scenes");
  fs.mkdirSync(customDir, { recursive: true });
  const longCopy = Array.from({ length: 64 }, (_, i) => "word" + i).join(" ");

  // Correct: copy is short and large, everything is inside the frame, the camera pushes in.
  fs.writeFileSync(
    path.join(customDir, "GoodScene.tsx"),
    [
      'import React from "react";',
      'import { CinematicScene, E } from "@openvidstudio/core";',
      "export const GoodScene: React.FC = () => (",
      "  <CinematicScene camera={[{ frame: 0, x: 960, y: 540, scale: 1.0 }, { frame: 150, x: 960, y: 540, scale: 1.15, easing: E.drift }]}>",
      '    <div style={{ position: "absolute", left: 300, top: 360, fontSize: 72, color: "#fff" }}>Ship the demo</div>',
      '    <div style={{ position: "absolute", left: 300, top: 480, fontSize: 36, color: "#fff" }}>Ten tools, one pipeline.</div>',
      "  </CinematicScene>",
      ");",
      "",
    ].join("\n"),
  );
  // Broken in all four ways: a static camera (dead), text running off the right edge (crop),
  // 12px text that is 15.6px on screen at scale 1.3 (text size), and 64 words in a 2s beat.
  fs.writeFileSync(
    path.join(customDir, "BadScene.tsx"),
    [
      'import React from "react";',
      'import { CinematicScene } from "@openvidstudio/core";',
      "export const BadScene: React.FC = () => (",
      "  <CinematicScene camera={[{ frame: 0, x: 960, y: 540, scale: 1.3 }, { frame: 60, x: 960, y: 540, scale: 1.3 }]}>",
      '    <div style={{ position: "absolute", left: 1500, top: 300, fontSize: 40, whiteSpace: "nowrap", color: "#fff" }}>This line runs off the right edge of the frame</div>',
      '    <div style={{ position: "absolute", left: 400, top: 420, fontSize: 12, color: "#fff" }}>tiny caption nobody can read</div>',
      '    <div style={{ position: "absolute", left: 400, top: 500, width: 1000, fontSize: 30, color: "#fff" }}>' + longCopy + "</div>",
      "  </CinematicScene>",
      ");",
      "",
    ].join("\n"),
  );
  // The later C7 gates, each tripped once, on a camera that drifts so it is not also "dead":
  // an em dash, text nearly the colour of its panel, text 70px from the left edge (inside the
  // frame, outside the title-safe inset), and text drawn over the chapter HUD's top-left label.
  fs.writeFileSync(
    path.join(customDir, "ExtrasScene.tsx"),
    [
      'import React from "react";',
      'import { CinematicScene, ChapterHud } from "@openvidstudio/core";',
      "export const ExtrasScene: React.FC = () => (",
      "  <CinematicScene",
      "    camera={[{ frame: 0, x: 960, y: 540, scale: 1.0 }, { frame: 150, x: 960, y: 540, scale: 1.04 }]}",
      '    overlay={<ChapterHud chapters={[{ label: "ONE" }, { label: "TWO" }]} activeIndex={0} firstFrame={false} />}',
      "  >",
      '    <div style={{ position: "absolute", left: 300, top: 300, fontSize: 56, color: "#fff" }}>Fast \u2014 and simple</div>',
      '    <div style={{ position: "absolute", left: 300, top: 600, width: 700, height: 100, background: "#2a2a2a" }}>',
      '      <span style={{ fontSize: 44, color: "#333" }}>barely visible</span>',
      "    </div>",
      // left 70 is 34px in from the edge once the camera has pushed in to 1.04x: inside the frame
      // (not a crop) and well inside the 77px title-safe inset (so a safe-area finding).
      '    <div style={{ position: "absolute", left: 70, top: 220, fontSize: 40, color: "#fff" }}>hugging the edge</div>',
      '    <div style={{ position: "absolute", left: 80, top: 62, fontSize: 40, color: "#fff" }}>over the hud</div>',
      "  </CinematicScene>",
      ");",
      "",
    ].join("\n"),
  );
  // A brand palette, written before stitching so Root.tsx imports it first. The colours are
  // distinctive on purpose: the palette check looks for them in the rendered frames.
  fs.writeFileSync(
    path.join(c7Root, "src", "brand.ts"),
    ['import { applyBrand } from "@openvidstudio/core";', 'applyBrand({ color: { bg0: "#123456", bg1: "#1d4f7a" } });', ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(videoDir, "beats.json"),
    JSON.stringify({
      fps: 30,
      beats: [
        { id: "good-scene", start: 0, duration: 150, scene: "./custom-scenes/GoodScene.tsx" },
        { id: "bad-scene", start: 150, duration: 60, scene: "./custom-scenes/BadScene.tsx" },
        { id: "extras-scene", start: 210, duration: 150, scene: "./custom-scenes/ExtrasScene.tsx" },
      ],
    }),
  );
  runStitchComposition({ projectRoot: c7Root, videoName: "c7check" });

  const res = await runValidateScenesFull({ projectRoot: c7Root, videoName: "c7check", render: true });
  const renderFindings = res.findings.filter((f) => f.source === "render");
  const forBeat = (id, kind) => renderFindings.filter((f) => f.beatId === id && f.check === kind);
  console.log("  render findings:", JSON.stringify(renderFindings.map((f) => [f.beatId, f.check, f.severity])));

  check("render mode measured all three beats and skipped none", res.render?.beatsMeasured === 3 && res.render.beatsSkipped.length === 0);
  check("the correct scene has zero render findings (no false positives)", renderFindings.filter((f) => f.beatId === "good-scene").length === 0);
  check("the broken scene has no em dash, contrast, safe-area or HUD findings it did not earn", ["em-dash", "contrast", "safe-area", "hud-overlap"].every((k) => forBeat("bad-scene", k).length === 0));
  check("the em dash in the extras scene is found, as an error", forBeat("extras-scene", "em-dash").length === 1 && forBeat("extras-scene", "em-dash")[0].severity === "error");
  check("text nearly the colour of its panel fails contrast, measured against the rendered pixels", forBeat("extras-scene", "contrast").length === 1 && forBeat("extras-scene", "contrast")[0].message.includes("barely visible"));
  check("text 20px from the edge is outside the safe area but is not a crop", forBeat("extras-scene", "safe-area").length === 1 && forBeat("extras-scene", "safe-area")[0].message.includes("hugging the edge") && forBeat("extras-scene", "crop").length === 0);
  check("text drawn over the chapter HUD is found", forBeat("extras-scene", "hud-overlap").length === 1 && forBeat("extras-scene", "hud-overlap")[0].message.includes("over the hud"));
  check("the HUD's own small text is not reported as too small", !forBeat("extras-scene", "text-size").some((f) => /ONE|TWO/.test(f.message)));
  check("a brand.ts whose colours reach the frame (sideEffects lists it) produces no palette finding", renderFindings.filter((f) => f.check === "brand-palette").length === 0);
  check("the broken scene is flagged for cropped text", forBeat("bad-scene", "crop").length === 1 && forBeat("bad-scene", "crop")[0].message.includes("runs off the right edge"));
  check("the broken scene is flagged for text below the minimum size", forBeat("bad-scene", "text-size").length === 1 && forBeat("bad-scene", "text-size")[0].message.includes("tiny caption"));
  check("the broken scene is flagged for reading time", forBeat("bad-scene", "reading-time").length === 1);
  check("the broken scene is flagged for dead frames", forBeat("bad-scene", "dead-frames").length === 1);
  check(
    "the static pass reads each beat's bespoke scene override and finds no error in either",
    res.scenesChecked === 3 && res.findings.filter((f) => f.source === "static" && f.severity === "error").length === 0,
  );
  check("a crop error makes the result not ok", res.ok === false);

  // The #61 regression, end to end: with the template's old sideEffects ("*.css" only) the bundler
  // drops src/brand.ts as side-effect free, the palette never lands, and the palette check says so.
  const pkgPath = path.join(c7Root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  check("a freshly scaffolded project lists ./src/brand.ts in sideEffects", Array.isArray(pkg.sideEffects) && pkg.sideEffects.includes("./src/brand.ts"));
  pkg.sideEffects = ["*.css"];
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  const treeShaken = await runValidateScenesFull({ projectRoot: c7Root, videoName: "c7check", render: true, beatIds: ["good-scene"] });
  const palette = treeShaken.findings.filter((f) => f.check === "brand-palette");
  check("with sideEffects reverted, the palette never reaches a frame and validate_scenes warns", palette.length === 1 && palette[0].severity === "warning" && /sideEffects/.test(palette[0].message));

  // Without the flag, no render happens and the result has no render block.
  const staticOnly = runValidateScenesFull({ projectRoot: c7Root, videoName: "c7check" });
  check("without render:true no render pass runs", (await staticOnly).render === undefined);
} else {
  skip("Part 54: validate_scenes render mode", "no resolvable node_modules to scaffold a renderable project from");
}

finish();

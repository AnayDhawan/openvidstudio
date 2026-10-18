#!/usr/bin/env node
// supernova-mode: the production mode flag, the stem package and the Void + Spark design system
// (#108). A lesson video is a different kind of production, not a fourth creative level, so:
//   - init_project with mode "supernova" scaffolds a project that can import @openvidstudio/stem and
//     renders a frame in the Void palette, 1080x1920 by default;
//   - with the mode unset nothing about a project changes: same files, same config, same package.json;
//   - the design system reads back the right accent per subject, and its text is never pure white.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { require, packageRoot, distDir, monorepoRoot, monorepoTemplateDir, check, skip, listFilesRecursive, finish } from "./_harness.mjs";

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
const { validateBriefLogic } = require(path.join(distDir, "tools", "writeBrief.js"));
const { runPlanProductionLogic } = require(path.join(distDir, "tools", "planProduction.js"));
const { loadConfig, productionMode } = require(path.join(distDir, "config.js"));
const bundledTemplateDir = path.join(packageRoot, "templates", "default");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function scaffold(prefix, input) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "lesson", projectRoot: root, ...input });
      return root;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
}

console.log("\n== a standard project is untouched by the mode flag ==");
const standardRoot = scaffold("ovs-standard-", {});
{
  const files = listFilesRecursive(standardRoot);
  const stemish = files.filter((f) => /openvidstudio-stem|space-grotesk/i.test(f));
  check("no vendored stem package and no display font in a standard project", stemish.length === 0);
  const bundled = listFilesRecursive(bundledTemplateDir).filter((f) => f.split(path.sep)[0] !== "openvidstudio-stem");
  check("every bundled file except the stem package is there, and nothing else is added beside the video and config",
    bundled.every((f) => files.includes(f) || f === path.join("src", "Root.tsx")) &&
      files.filter((f) => !bundled.includes(f)).every((f) => /^(docs[\\/]|src[\\/]videos[\\/]|openvidstudio\.config\.json$|src[\\/]Root\.tsx$|src[\\/]PreflightBenchmark)/.test(f)));
  const config = readJson(path.join(standardRoot, "openvidstudio.config.json"));
  check("the config file has no production.mode key", !("mode" in (config.production ?? {})));
  check("...and the production block is exactly what it was before (empty)", JSON.stringify(config.production ?? {}) === "{}");
  check("the frame is the usual 1920x1080", config.videoConfig.width === 1920 && config.videoConfig.height === 1080);
  const pkg = readJson(path.join(standardRoot, "package.json"));
  check("package.json does not depend on stem", !("@openvidstudio/stem" in pkg.dependencies));
  check("productionMode() reads a standard project as \"standard\"", productionMode(loadConfig(standardRoot)) === "standard");
  const before = JSON.stringify(readJson(path.join(standardRoot, "package.json")));
  runInitProject({ name: "second", projectRoot: standardRoot });
  check("a second standard init_project in the same project changes nothing in package.json", JSON.stringify(readJson(path.join(standardRoot, "package.json"))) === before);
}

console.log("\n== init_project with mode \"supernova\" scaffolds a lesson project ==");
const lessonRoot = scaffold("ovs-supernova-", { mode: "supernova" });
{
  check("production.mode is stored as \"supernova\"", readJson(path.join(lessonRoot, "openvidstudio.config.json")).production.mode === "supernova");
  check("productionMode() reads it back", productionMode(loadConfig(lessonRoot)) === "supernova");
  const cfg = readJson(path.join(lessonRoot, "openvidstudio.config.json"));
  check("the frame defaults to 1080x1920", cfg.videoConfig.width === 1080 && cfg.videoConfig.height === 1920);
  const pkg = readJson(path.join(lessonRoot, "package.json"));
  check("package.json depends on the vendored stem package by a relative file: path", pkg.dependencies["@openvidstudio/stem"] === "file:./openvidstudio-stem");
  check("the stem source is vendored into the project", fs.existsSync(path.join(lessonRoot, "openvidstudio-stem", "src", "index.ts")) && fs.existsSync(path.join(lessonRoot, "openvidstudio-stem", "package.json")));
  check("the display font is in public/fonts, where the local font loader looks",
    ["500", "700"].every((w) => fs.existsSync(path.join(lessonRoot, "public", "fonts", `space-grotesk-latin-${w}-normal.woff2`))));
  check("its licence travels with it", fs.existsSync(path.join(lessonRoot, "public", "fonts", "SPACE-GROTESK-LICENSE.txt")));
  check("the core fonts are still there", fs.existsSync(path.join(lessonRoot, "public", "fonts", "inter-latin-400-normal.woff2")));
  const explicit = scaffold("ovs-supernova-wide-", { mode: "supernova", videoConfig: { fps: 30, width: 1920, height: 1080 } });
  check("an explicit frame size still wins", readJson(path.join(explicit, "openvidstudio.config.json")).videoConfig.width === 1920);
  const existing = scaffold("ovs-standard-then-lesson-", {});
  runInitProject({ name: "lesson", projectRoot: existing, mode: "supernova" });
  const existingCfg = readJson(path.join(existing, "openvidstudio.config.json"));
  check("making a lesson in an existing 16:9 project adds stem and the mode but keeps its frame size",
    existingCfg.production.mode === "supernova" && existingCfg.videoConfig.width === 1920 &&
      readJson(path.join(existing, "package.json")).dependencies["@openvidstudio/stem"] === "file:./openvidstudio-stem");
}

console.log("\n== the mode is read by validate_beats, write_brief and plan_production ==");
{
  const beat = { id: "hook", start: 0, duration: 90, vo: "About two point seven words a second fits.", visual: { captureMethod: "dom-demo" } };
  check("validate_beats accepts production.mode \"supernova\"", validateBeatsLogic({ fps: 30, production: { mode: "supernova" }, beats: [beat] }).valid === true);
  check("...and \"standard\"", validateBeatsLogic({ fps: 30, production: { mode: "standard" }, beats: [beat] }).valid === true);
  const bad = validateBeatsLogic({ fps: 30, production: { mode: "turbo" }, beats: [beat] });
  check("...and rejects an unknown mode by name", bad.valid === false && bad.errors.some((e) => e.includes("production.mode")));
  const silent = validateBeatsLogic({ fps: 30, narration: "none", production: { mode: "supernova" }, beats: [beat] });
  check("a silent lesson is a warning, not an error", silent.valid === true && silent.warnings.some((w) => /supernova/.test(w)));
  check("control: a silent standard video draws no such warning", !validateBeatsLogic({ fps: 30, narration: "none", beats: [beat] }).warnings.some((w) => /supernova/.test(w)));

  const brief = (over) => ({
    logline: "Why a derivative is a slope.",
    audience: "IB maths students",
    feeling: "Oh, that is all it is.",
    storyDevice: { device: "a ball rolling down a hill", reason: "a slope you can feel" },
    arc: { hook: "h", tension: "t", turn: "u", proof: "p", payoff: "y", cta: "c" },
    ...over,
  });
  const standardBrief = validateBriefLogic(brief({ creativeLevel: "peak" }));
  check("a brief with a creative level still validates the way it did (this brief may fail on other fields, but not on the level)", !standardBrief.errors.some((e) => e.startsWith("creativeLevel")));
  check("a standard brief without a creative level is still refused", validateBriefLogic(brief({})).errors.some((e) => e.startsWith("creativeLevel")));
  check("a supernova brief needs no creative level", !validateBriefLogic(brief({ mode: "supernova" })).errors.some((e) => e.startsWith("creativeLevel")));
  check("an unknown brief mode is rejected by name", validateBriefLogic(brief({ mode: "turbo", creativeLevel: "peak" })).errors.some((e) => e.startsWith("mode ")));
  check("write_brief accepts the new void-spark motif", !validateBriefLogic(brief({ creativeLevel: "peak", designSystem: { path: "p", paletteRationale: "x", motif: "void-spark", motifRationale: "x", motionRationale: "x" } })).errors.some((e) => /designSystem\.motif/.test(e)));
  check("control: a made-up motif is still refused", validateBriefLogic(brief({ creativeLevel: "peak", designSystem: { path: "p", paletteRationale: "x", motif: "swirly", motifRationale: "x", motionRationale: "x" } })).errors.some((e) => /designSystem\.motif/.test(e)));

  const measured = { fps: 7.32, cpuCount: 8, source: "benchmark", bundleSeconds: 7 };
  const lesson = runPlanProductionLogic({ mode: "supernova", timeBudgetMinutes: 60, targetDurationSeconds: 75 }, measured, { fps: 30 });
  check("plan_production plans a lesson with no creative level", lesson.mode === "supernova" && lesson.creativeLevel === null);
  check("...with the lesson arc, not a product arc", /hook question/.test(lesson.arc) && /check question/.test(lesson.arc));
  check("...and no capture time, since nothing is captured", lesson.phases.find((p) => p.phase === "capture").seconds === 0);
  const peak = runPlanProductionLogic({ creativeLevel: "peak", timeBudgetMinutes: 60, targetDurationSeconds: 75 }, measured, { fps: 30 });
  check("a standard plan is unchanged in shape: mode \"standard\", its level kept, a capture term", peak.mode === "standard" && peak.creativeLevel === "peak" && peak.phases.find((p) => p.phase === "capture").seconds > 0);
  let threw = "";
  try { runPlanProductionLogic({ timeBudgetMinutes: 60 }, measured, { fps: 30 }); } catch (e) { threw = String(e.message); }
  check("a standard plan with no creative level is refused", /creativeLevel is required/.test(threw));
}

console.log("\n== a lesson project imports stem, renders in the Void palette, and the design system reads back ==");
{
  const bridge = require(path.join(distDir, "remotionBridge.js"));
  const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
  const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
  fs.symlinkSync(templateNodeModules, path.join(lessonRoot, "node_modules"), "junction");
  const videoDir = path.join(lessonRoot, "src", "videos", "lesson");
  fs.mkdirSync(path.join(videoDir, "custom-scenes"), { recursive: true });
  fs.writeFileSync(
    path.join(videoDir, "custom-scenes", "Void.tsx"),
    `import React from "react";
import { AbsoluteFill } from "remotion";
import { CinematicScene, Layer } from "@openvidstudio/core";
import { supernovaDesignSystem, SUBJECTS, VOID } from "@openvidstudio/stem";

export const Void: React.FC = () => {
  const design = supernovaDesignSystem("physics");
  const all = Object.fromEntries(SUBJECTS.map((s) => {
    const d = supernovaDesignSystem(s);
    return [s, { accent: d.color.accent, accentAlt: d.color.accentAlt, text: d.color.textPrimary, dim: d.color.textSecondary, bg: d.color.bg0, panel: d.color.panel, motif: d.motif, display: d.display, grid: d.grid, ui: d.font.ui }];
  }));
  return (
    <CinematicScene grain={0} vignette={0} camera={[{ frame: 0, x: 540, y: 960, scale: 1 }, { frame: 30, x: 540, y: 960, scale: 1.01 }]}>
      <Layer depth={0}>
        <AbsoluteFill style={{ background: design.color.bg0 }} />
        <div style={{ position: "absolute", left: 440, top: 860, width: 200, height: 200, background: design.color.accent }} />
        <pre id="all" style={{ position: "absolute", left: 0, top: 0, opacity: 0, fontSize: 1 }}>{JSON.stringify({ all, void: VOID })}</pre>
      </Layer>
    </CinematicScene>
  );
};
`,
    "utf8",
  );
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, narration: "none", production: { mode: "supernova" }, beats: [{ id: "void", start: 0, duration: 30, scene: "./custom-scenes/Void.tsx" }] }));
  const stitched = runStitchComposition({ projectRoot: lessonRoot, videoName: "lesson" });
  const bundleDir = await bridge.bundleProject(lessonRoot);
  const server = await bridge.serveBundleDirectory(bundleDir);
  const remotionBrowser = await bridge.openRenderBrowser();
  let browser = null;
  try {
    const comp = await bridge.resolveComposition(bundleDir, stitched.compositionId, remotionBrowser);
    check("the lesson's composition is 1080x1920", comp.width === 1080 && comp.height === 1920);
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
    await bridge.openSeekablePage({ page, bundleUrl: server.url, composition: comp, timeoutMs: 30000 });
    await bridge.seekToFrame(page, comp.id, 5, 30000);
    const file = path.join(lessonRoot, "void.png");
    await page.screenshot({ path: file });
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);
    const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
    console.log(`  corner ${JSON.stringify(px(4, 4))}, centre ${JSON.stringify(px(540, 960))}`);
    check("the frame's background is the Void base #07060B", near(px(4, 4), [7, 6, 11], 3));
    check("the swatch is the physics accent #FFB347", near(px(540, 960), [255, 179, 71], 4));

    const dump = JSON.parse(await page.evaluate(() => document.getElementById("all")?.textContent ?? "null"));
    check("the design system was read back from inside the bundle", dump !== null && Object.keys(dump.all).length === 5);
    const expected = { math: "#5CC8FF", physics: "#FFB347", cs: "#B58CFF", chemistry: "#FF4D5E", biology: "#7CFFB2" };
    for (const [subject, accent] of Object.entries(expected)) {
      check(`${subject}: accent ${accent}`, dump.all[subject].accent.toLowerCase() === accent.toLowerCase());
    }
    check("physics keeps ember as its second accent", dump.all.physics.accentAlt.toLowerCase() === "#ff7a3d");
    check("all five subjects have different accents", new Set(Object.values(dump.all).map((d) => d.accent)).size === 5);
    const pureWhite = (c) => /^#?f{3}(f{3})?$/i.test(c.trim()) || /^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/i.test(c);
    check("text is never pure white, on any subject", Object.values(dump.all).every((d) => !pureWhite(d.text) && !pureWhite(d.dim)));
    check("text is the warm white #F3EFE6 and the dim token #8C8799", Object.values(dump.all).every((d) => d.text.toLowerCase() === "#f3efe6" && d.dim.toLowerCase() === "#8c8799"));
    check("the base is #07060B and the panels #0E0C16 on every subject", Object.values(dump.all).every((d) => d.bg.toLowerCase() === "#07060b" && d.panel.toLowerCase() === "#0e0c16"));
    check("the motif is void-spark and the display face is Space Grotesk over an Inter body", Object.values(dump.all).every((d) => d.motif === "void-spark" && d.display === "Space Grotesk" && d.ui === "Inter"));
    check("the grid keeps key content clear of the Reels UI (108 / 270 / 420)", Object.values(dump.all).every((d) => d.grid.marginX === 108 && d.grid.marginTop === 270 && d.grid.marginBottom === 420));
    check("control: the standard design system's text is not the Void warm white", dump.void.text.toLowerCase() === "#f3efe6" && "#E6EAF2".toLowerCase() !== dump.void.text.toLowerCase());
    const fontsLoaded = await page.evaluate(() => Array.from(document.fonts).some((f) => f.family.replace(/"/g, "") === "Space Grotesk" && f.status === "loaded"));
    check("the display font loaded from the project's own files", fontsLoaded === true);
  } finally {
    await browser?.close().catch(() => undefined);
    await remotionBrowser.close({ silent: true });
    await server.close();
  }
}

finish();

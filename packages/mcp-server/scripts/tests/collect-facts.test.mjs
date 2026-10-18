#!/usr/bin/env node
// collect-facts: Part 55 (split out of the former single manual-test.mjs; see _harness.mjs)

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
// fixture: RENDERCMD
const { buildRenderCommand, runRenderVideo } = require(path.join(distDir, "tools", "renderVideo.js"));
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
// fixture: CAP
const captureCore = require(path.join(packageRoot, "..", "capture", "dist", "browser.js"));
const { cropAndUpscale } = require(path.join(distDir, "tools", "captureScreenshot.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
const { buildFfmpegTranscodeArgs, buildFfprobeDurationArgs } = require(path.join(distDir, "tools", "captureScreenRecording.js"));
// fixture: BROWSER
let browserAvailable = false;
try {
  const probeBrowser = await captureCore.launchChromium();
  await probeBrowser.close();
  browserAvailable = true;
} catch {}
setQuiet(false);
// ---- checks ----

console.log("\n== Part 55: run records and collect_facts, against a real capture, render and validation (C8) ==");
if (fs.existsSync(templateNodeModules) && browserAvailable) {
  const http = await import("node:http");
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));
  const { runCaptureTerminal } = require(path.join(distDir, "tools", "captureTerminal.js"));
  const { runValidateScenes } = require(path.join(distDir, "tools", "validateScenes.js"));
  const { runValidateBeats } = require(path.join(distDir, "tools", "validateBeats.js"));
  const { runCollectFacts } = require(path.join(distDir, "tools", "collectFacts.js"));

  const c8Root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c8-facts-"));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "c8check", projectRoot: c8Root });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(c8Root, { recursive: true, force: true });
      fs.mkdirSync(c8Root, { recursive: true });
    }
  }
  fs.symlinkSync(templateNodeModules, path.join(c8Root, "node_modules"), "junction");

  // Nothing has run yet, so there is nothing to collect: an error, not an empty facts.json.
  const videoDir = path.join(c8Root, "src", "videos", "c8check");
  fs.mkdirSync(path.join(videoDir, "custom-scenes"), { recursive: true });
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, beats: [] }));
  let noRecordsError = "";
  try {
    runCollectFacts({ projectRoot: c8Root, videoName: "c8check" });
  } catch (err) {
    noRecordsError = String(err.message);
  }
  check("collect_facts refuses when no run records exist yet", /No run records/.test(noRecordsError));
  check("...and wrote no facts.json", !fs.existsSync(path.join(videoDir, "facts.json")));

  const scene = (name) =>
    [
      'import React from "react";',
      'import { CinematicScene, E } from "@openvidstudio/core";',
      "export const " + name + ": React.FC = () => (",
      "  <CinematicScene camera={[{ frame: 0, x: 960, y: 540, scale: 1.0 }, { frame: 45, x: 960, y: 540, scale: 1.1, easing: E.drift }]}>",
      '    <div style={{ position: "absolute", left: 300, top: 400, fontSize: 64, color: "#fff" }}>' + name + "</div>",
      "  </CinematicScene>",
      ");",
      "",
    ].join("\n");
  const beatDefs = [
    { id: "shot", scene: "Shot", visual: { captureMethod: "screenshot", url: "http://placeholder", interactions: [] } },
    { id: "term", scene: "Term", visual: { captureMethod: "recording", source: "terminal" } },
    { id: "built", scene: "Built", visual: { captureMethod: "dom-demo" } },
    { id: "claimed", scene: "Claimed", visual: { captureMethod: "screenshot" } },
  ];
  beatDefs.forEach((b) => fs.writeFileSync(path.join(videoDir, "custom-scenes", b.scene + ".tsx"), scene(b.scene)));

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><body style='margin:0;background:#224'><h1 style='color:#fff'>facts page</h1></body>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const factsUrl = "http://127.0.0.1:" + server.address().port + "/";

  const beatsDoc = {
    fps: 30,
    narration: "none",
    beats: beatDefs.map((b, i) => ({
      id: b.id,
      start: i * 45,
      duration: 45,
      visual: b.id === "shot" ? { ...b.visual, url: factsUrl } : b.visual,
      scene: "./custom-scenes/" + b.scene + ".tsx",
    })),
  };
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify(beatsDoc));

  try {
    // The real pipeline: capture, stitch, render, validate. Beat "claimed" is never captured.
    const shot = await runCaptureScreenshot({ projectRoot: c8Root, beatId: "shot", url: factsUrl, viewport: { width: 800, height: 600 } });
    const term = await runCaptureTerminal({
      projectRoot: c8Root,
      beatId: "term",
      command: process.execPath,
      args: ["-e", "console.log('hello facts')"],
      mode: "pipe",
    });
    runStitchComposition({ projectRoot: c8Root, videoName: "c8check" });
    const render = await runRenderVideo({ projectRoot: c8Root, videoName: "c8check", draft: true, skipBrandLock: true, incremental: true });
    check("the fixture render succeeded for real", render.success === true && fs.existsSync(render.outPath));
    runValidateScenes({ projectRoot: c8Root, videoName: "c8check" });
    const beatsValidation = runValidateBeats({ beatsJson: beatsDoc, videoName: "c8check", projectRoot: c8Root });

    const runsDir = path.join(c8Root, ".openvidstudio", "runs");
    const runFiles = fs.readdirSync(runsDir);
    const has = (tool) => runFiles.some((f) => f.startsWith(tool + "-") && f.endsWith(".json"));
    check(
      "real tool runs left one record file each in .openvidstudio/runs",
      ["capture_screenshot", "capture_terminal", "stitch_composition", "render_video", "validate_scenes", "validate_beats"].every(has),
    );

    const result = runCollectFacts({ projectRoot: c8Root, videoName: "c8check" });
    const facts = JSON.parse(fs.readFileSync(path.join(videoDir, "facts.json"), "utf8"));
    check("collect_facts wrote src/videos/<name>/facts.json and read every record", result.factsPath === path.join(videoDir, "facts.json") && result.recordsRead === runFiles.length);

    // Evidence, compared with what is really on disk rather than with the record's own text.
    const shotFacts = facts.beats.shot.captures.find((c) => c.tool === "capture_screenshot");
    check("shot: provenance is a real capture", facts.beats.shot.provenance === "capture");
    check("shot: the recorded size is the real PNG's size on disk", shotFacts?.bytes === fs.statSync(shot.outPath).size && shotFacts.bytes > 0);
    check("shot: the recorded URL and path are what was captured", shotFacts?.url === factsUrl && shotFacts.outPath === "public/images/shot.png");
    const termFacts = facts.beats.term.captures.find((c) => c.tool === "capture_terminal");
    check("term: the terminal capture records the command and its real exit code", termFacts?.exitCode === 0 && /hello facts/.test(termFacts.command) && termFacts.eventCount === term.eventCount);
    check("built: a dom-demo beat is a construction, with no capture claimed", facts.beats.built.provenance === "construction" && facts.beats.built.captures.length === 0);
    check("claimed: a beat that claims a screenshot nobody took is unverified", facts.beats.claimed.provenance === "unverified");
    check(
      "claimed: ...and listed as a discrepancy",
      facts.discrepancies.some((d) => d.beatId === "claimed" && d.kind === "claimed-capture-without-record") &&
        !facts.discrepancies.some((d) => d.beatId === "shot" || d.beatId === "term"),
    );
    check(
      "render: records the real file size and which beats it actually rendered",
      facts.video.render?.bytes === fs.statSync(render.outPath).size && facts.video.render.success === true &&
        JSON.stringify([...facts.video.render.renderedBeats].sort()) === JSON.stringify(["built", "claimed", "shot", "term"]),
    );
    check("render: each beat records whether it was rendered or reused", facts.beats.shot.render?.status === "rendered");
    check(
      "validate_beats: the real error is attributed to the beat it belongs to",
      beatsValidation.valid === false &&
        facts.beats.claimed.validation.some((v) => v.tool === "validate_beats" && v.findings.length > 0) &&
        facts.beats.shot.validation.find((v) => v.tool === "validate_beats")?.findings.length === 0,
    );
    check("validate_scenes: its record is merged in per beat", facts.beats.shot.validation.some((v) => v.tool === "validate_scenes"));
    check("stitch: the composition id is recorded", typeof facts.video.composition?.compositionId === "string");

    // A second render with nothing changed reuses every beat, and the facts follow.
    await runRenderVideo({ projectRoot: c8Root, videoName: "c8check", draft: true, skipBrandLock: true, incremental: true });
    runCollectFacts({ projectRoot: c8Root, videoName: "c8check" });
    const again = JSON.parse(fs.readFileSync(path.join(videoDir, "facts.json"), "utf8"));
    check("an unchanged re-render is recorded as reused, from the cache", again.beats.shot.render?.status === "reused");

    // The record outlives the file: delete the capture and the next collect says so.
    fs.rmSync(shot.outPath);
    runCollectFacts({ projectRoot: c8Root, videoName: "c8check" });
    const gone = JSON.parse(fs.readFileSync(path.join(videoDir, "facts.json"), "utf8"));
    check("a recorded capture whose file is gone is reported", gone.discrepancies.some((d) => d.beatId === "shot" && d.kind === "capture-file-missing"));

    // A malformed record is skipped, not fatal.
    fs.writeFileSync(path.join(runsDir, "capture_screenshot-garbage.json"), "{not json");
    check("a malformed record file does not break collect_facts", runCollectFacts({ projectRoot: c8Root, videoName: "c8check" }).recordsRead === fs.readdirSync(runsDir).length - 1);

    // A read-only runs dir must not turn a successful tool into a failure.
    const ro = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c8-ro-"));
    fs.writeFileSync(path.join(ro, ".openvidstudio"), "a file where the directory should be");
    const { writeFactRecord } = require(path.join(distDir, "facts.js"));
    check("writeFactRecord returns null instead of throwing when it cannot write", writeFactRecord(ro, { tool: "x", facts: {} }) === null);
  } finally {
    server.close();
  }
} else {
  skip("Part 55: run records and collect_facts", "needs a resolvable node_modules and a real Chromium");
}

finish();

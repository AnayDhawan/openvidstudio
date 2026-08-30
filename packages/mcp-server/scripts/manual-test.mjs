#!/usr/bin/env node
// Manual end-to-end + unit test for @openvidstudio/mcp-server, run against the
// package's own compiled dist/ output (never against src/ via ts-node, and never via
// a pnpm workspace symlink shortcut) -- see task-3-brief.md's Verification section.
//
// Covers:
//   1. init_project's bundled-template resolution, tested by temporarily renaming the
//      monorepo's own templates/default out of the way and confirming init_project
//      (compiled dist code) still succeeds and copies files identical to
//      packages/mcp-server/templates/default -- proving it never depended on the
//      monorepo-relative path at all.
//   2. write_beats_file -> scaffold_scene x3 -> stitch_composition, against a
//      throwaway temp project, then `tsc --noEmit` on the scaffolded output.
//   3. Pure argv-builder unit checks for render_video and qc_extract_frames (no real
//      process spawned).
//
// Run with: node scripts/manual-test.mjs   (after `npm run build`)

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, "..");
const distDir = path.join(packageRoot, "dist");
const monorepoTemplateDir = path.resolve(packageRoot, "..", "..", "templates", "default");

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else {
      out.push(path.relative(base, full));
    }
  }
  return out.sort();
}

if (!fs.existsSync(distDir)) {
  console.error(`dist/ not found at ${distDir}. Run "npm run build" first.`);
  process.exit(1);
}

console.log("== Part 1: init_project bundled-template resolution ==");
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
const monorepoTemplateExisted = fs.existsSync(monorepoTemplateDir);
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

let allBundledFilesCopied = true;
for (const rel of bundledFileList) {
  const src = path.join(bundledTemplateDir, rel);
  const dst = path.join(tmpRoot, rel);
  if (!fs.existsSync(dst) || fs.statSync(src).size !== fs.statSync(dst).size) {
    allBundledFilesCopied = false;
    console.log(`  MISMATCH: ${rel}`);
  }
}
check(
  `every file in packages/mcp-server/templates/default (${bundledFileList.length} files) was copied into the scaffolded project`,
  allBundledFilesCopied,
);
check("src/videos/demo/scenes/ was created", fs.existsSync(path.join(tmpRoot, "src", "videos", "demo", "scenes")));

console.log("\n== Part 2: write_beats_file -> scaffold_scene x3 -> stitch_composition ==");

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

console.log("\n== Part 3: pure argv builders (no process spawned) ==");
const { buildRenderCommand } = require(path.join(distDir, "tools", "renderVideo.js"));
const renderCmd = buildRenderCommand("DemoDemo", path.join("out", "demo.mp4"));
check(
  "buildRenderCommand returns an argv array (npx/npx.cmd render <id> <outPath>)",
  Array.isArray(renderCmd.args) &&
    renderCmd.args[0] === "remotion" &&
    renderCmd.args[1] === "render" &&
    renderCmd.args[2] === "DemoDemo" &&
    renderCmd.args[3] === path.join("out", "demo.mp4"),
);
check(
  "render command name is platform-correct (npx.cmd on win32)",
  renderCmd.command === (process.platform === "win32" ? "npx.cmd" : "npx"),
);

const { buildFfmpegFrameArgs } = require(path.join(distDir, "tools", "qcExtractFrames.js"));
const ffArgs = buildFfmpegFrameArgs("out/demo.mp4", 2.5, "out/qc/demo/hook-mid.jpg");
check(
  "buildFfmpegFrameArgs returns the expected argv array",
  JSON.stringify(ffArgs) ===
    JSON.stringify(["-nostdin", "-ss", "2.500", "-i", "out/demo.mp4", "-frames:v", "1", "-q:v", "3", "out/qc/demo/hook-mid.jpg", "-y"]),
);

// Source-level confirmation these two tools use spawn (argv array) and never exec/execSync.
const renderSrc = fs.readFileSync(path.join(packageRoot, "src", "tools", "renderVideo.ts"), "utf8");
const qcSrc = fs.readFileSync(path.join(packageRoot, "src", "tools", "qcExtractFrames.ts"), "utf8");
const utilSrc = fs.readFileSync(path.join(packageRoot, "src", "util.ts"), "utf8");
check("renderVideo.ts never calls exec/execSync", !/\bexec(Sync)?\(/.test(renderSrc));
check("qcExtractFrames.ts never calls exec/execSync", !/\bexec(Sync)?\(/.test(qcSrc));
check("util.ts's spawnCapture uses spawn(...) with shell:false", /spawn\(command, args, \{ cwd, shell: false \}\)/.test(utilSrc));

console.log("\n== Part 4: tsc --noEmit against the scaffolded project ==");
const tempNodeModules = path.join(tmpRoot, "node_modules");
const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
let tscOk = false;
if (fs.existsSync(templateNodeModules)) {
  try {
    fs.symlinkSync(templateNodeModules, tempNodeModules, "junction");
    const tscBin = path.join(tempNodeModules, ".bin", process.platform === "win32" ? "tsc.CMD" : "tsc");
    // shell:true here only because Windows can't exec a .CMD shim via CreateProcess
    // directly (EINVAL) -- this is a fixed-argv verification script, not shipped
    // product code, so it carries none of renderVideo.ts/qcExtractFrames.ts's
    // user-input shell-injection concerns.
    execFileSync(tscBin, ["--noEmit"], { cwd: tmpRoot, stdio: "inherit", shell: process.platform === "win32" });
    tscOk = true;
  } catch (err) {
    console.log(`  tsc failed: ${err.message}`);
  }
} else {
  console.log(`  (skipped: ${templateNodeModules} not present locally -- run pnpm install at the monorepo root first)`);
}
check("tsc --noEmit passed against the scaffolded temp project", tscOk);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
console.log(`temp project left at: ${tmpRoot}`);
process.exitCode = failures === 0 ? 0 : 1;

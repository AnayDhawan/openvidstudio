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
const monorepoRoot = path.resolve(packageRoot, "..", "..");
const monorepoTemplateDir = path.join(monorepoRoot, "templates", "default");

let failures = 0;
let skipped = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}
// A skip is a distinct, explicitly-counted outcome, never silent: a block that
// doesn't run because a local dependency (Chromium, ffmpeg, ffprobe, a symlinked
// node_modules) is unavailable must still show up in the final summary, so
// "ALL CHECKS PASSED" can't quietly mean "some of this didn't execute at all".
function skip(label, reason) {
  console.log(`  SKIP ${label}${reason ? ` (${reason})` : ''}`);
  skipped++;
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
const { buildRenderCommand, runRenderVideo } = require(path.join(distDir, "tools", "renderVideo.js"));
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
// spawnCapture moved to @openvidstudio/capture when the capture engine was split out; the
// invariant it has to hold is unchanged, so the check follows it to its new home.
const spawnSrc = fs.readFileSync(
  path.join(packageRoot, "..", "capture", "src", "process.ts"),
  "utf8",
);
check("renderVideo.ts never calls exec/execSync", !/\bexec(Sync)?\(/.test(renderSrc));
check("qcExtractFrames.ts never calls exec/execSync", !/\bexec(Sync)?\(/.test(qcSrc));
// Task 4 (real end-to-end pipeline run) found spawnCapture's old blanket shell:false threw a
// synchronous EINVAL for npx.cmd on this repo's actual Windows/Node runtime -- Node does not
// transparently shell out for a .cmd/.bat target the way the old comment here assumed. Fixed
// by routing exactly that one Windows-shim case through shell:true (WINDOWS_SHIM_RE),
// still always via an argv array, never an interpolated shell string, and still behind the same
// DANGEROUS_CHARS sanitization every path/id reaching this function already passes through. This
// check now pins the narrower, actually-correct invariant instead of the always-false claim.
check(
  "@openvidstudio/capture's spawnCapture always uses an argv array (never exec/execSync), and only sets shell:true for the win32 .cmd/.bat shim case",
  /const child = spawn\(command, finalArgs, \{ cwd, shell \}\)/.test(spawnSrc) &&
    /WINDOWS_SHIM_RE\.test\(command\)/.test(spawnSrc) &&
    !/\bexec(Sync)?\(/.test(spawnSrc),
);

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

console.log("\n== Part 4b: render_video real invocation (Task 4 Windows spawn regression pin) ==");
// Regression pin for the Task 4 EINVAL bug fixed in util.ts's spawnCapture (see Part 3's
// comment above): before that fix, EVERY real render_video call on this repo's actual
// Windows/Node runtime failed immediately with a synchronous EINVAL spawning npx.cmd, and
// nothing in this suite actually exercised it -- Part 3's check only confirms the source
// text has the right shape. This block calls runRenderVideo for real, against a tiny
// scaffolded dom-demo-only composition (no captured assets needed, keeps the render itself
// fast: a single 90-frame beat), reusing the same tempNodeModules symlink Part 4 already set
// up. A second invocation with a space in outPath exercises the defensive arg-quoting
// util.ts added alongside the shell:true fix (Node's shell:true + args-array does NOT
// escape/quote args on its own -- DEP0190 -- so an unquoted space would silently word-split
// across argv once shell:true is in effect); without that quoting this second call would
// fail or write to the wrong path instead of producing a real mp4 at the exact requested
// (spaced) path.
if (fs.existsSync(tempNodeModules)) {
  const { validateBeatsLogic: validateRenderTestBeats } = require(path.join(distDir, "tools", "validateBeats.js"));

  const renderTestBeatsJson = {
    fps: 30,
    title: "Render Test",
    beats: [
      {
        id: "only",
        start: 0,
        duration: 90,
        vo: "This beat only proves render_video spawns for real.",
        visual: { captureMethod: "dom-demo" },
      },
    ],
  };
  const renderTestValidation = validateRenderTestBeats(renderTestBeatsJson);
  check(
    "render_video regression pin: its own tiny beats.json passes validate_beats",
    renderTestValidation.valid === true,
  );

  const renderTestWrite = runWriteBeatsFile({ projectRoot: tmpRoot, videoName: "rendertest", beatsJson: renderTestBeatsJson });
  const renderTestScaffold = runScaffoldScene({ projectRoot: tmpRoot, videoName: "rendertest", beatId: "only", kind: "dom-demo" });
  const renderTestStitch = runStitchComposition({ projectRoot: tmpRoot, videoName: "rendertest" });
  check(
    "render_video regression pin: rendertest project scaffolded (write_beats_file -> scaffold_scene -> stitch_composition)",
    renderTestWrite.written === true && renderTestScaffold.written === true && renderTestStitch.written === true,
  );

  function ffprobeHasVideoStream(filePath) {
    try {
      const out = execFileSync(
        "ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath],
        { encoding: "utf8" },
      );
      // A Remotion render (unlike capture_screen_recording's video-only transcode) always
      // muxes an audio track too, and this ffprobe/ffmpeg build's csv=p=0 writer appends a
      // trailing comma in that case ("video,\r\n" rather than a bare "video\n") -- confirmed
      // for real against both render outputs below (full `ffprobe -show_entries stream=...`
      // shows a genuine single h264 video stream at index 0 plus an aac audio stream at
      // index 1, not a malformed or duplicated stream). Strip trailing punctuation/whitespace
      // rather than exact-match so this pins the real invariant (a video stream exists)
      // instead of one ffprobe build's CSV formatting.
      return out.trim().replace(/[,\s]+$/, "") === "video";
    } catch (err) {
      console.log(`  (ffprobe check skipped: ${err.message})`);
      return null; // ffprobe unavailable locally -- not a failure of render_video itself
    }
  }

  const normalOutRel = path.join("out", "render-test-normal.mp4");
  const normalResult = await runRenderVideo({
    projectRoot: tmpRoot,
    videoName: "rendertest",
    outPath: normalOutRel,
    skipBrandLock: true, // this fixture project never runs extract_brand; the gate itself is Part 10's job
  });
  check(
    "render_video real invocation succeeds for a normal (no-space) outPath, on this platform " +
      `(${process.platform})`,
    normalResult.success === true && fs.existsSync(normalResult.outPath),
  );
  const normalStream = ffprobeHasVideoStream(normalResult.outPath);
  if (normalStream !== null) {
    check("render_video's normal-path output is a real mp4 with a video stream (ffprobe)", normalStream === true);
  } else {
    skip("render_video's normal-path output is a real mp4 with a video stream (ffprobe)", "ffprobe unavailable locally");
  }

  const spacedOutRel = path.join("out", "render test with space.mp4");
  const spacedResult = await runRenderVideo({ projectRoot: tmpRoot, videoName: "rendertest", outPath: spacedOutRel, skipBrandLock: true });
  check(
    "render_video real invocation succeeds for a SPACE-containing outPath " +
      "(win32 shell:true arg-quoting regression pin)",
    spacedResult.success === true && fs.existsSync(spacedResult.outPath),
  );
  const spacedStream = ffprobeHasVideoStream(spacedResult.outPath);
  if (spacedStream !== null) {
    check("render_video's space-path output is a real mp4 with a video stream (ffprobe)", spacedStream === true);
  } else {
    skip("render_video's space-path output is a real mp4 with a video stream (ffprobe)", "ffprobe unavailable locally");
  }
} else {
  skip(
    "Part 4b: render_video real invocation regression pin (entire section)",
    `${tempNodeModules} not present -- Part 4's node_modules symlink didn't succeed, run pnpm install at the monorepo root first`,
  );
}

console.log("\n== Part 5: capture_screenshot / capture_screen_recording -- pure functions (no browser) ==");

const captureCore = require(path.join(distDir, "capture.js"));
const { detectAndCompensateZoom, ZoomCompensationError, DEFAULT_VIEWPORT } = captureCore;

check(
  "DEFAULT_VIEWPORT matches CAPTURE.md's worked example (1600x1000)",
  DEFAULT_VIEWPORT.width === 1600 && DEFAULT_VIEWPORT.height === 1000,
);

// Fake `page` -- only setViewportSize/evaluate are called by detectAndCompensateZoom, so a
// plain object satisfies it at runtime (this is compiled JS, no TS structural checking here).
function fakePage(sequence) {
  let call = 0;
  return {
    async setViewportSize() {
      // no-op; the fake's evaluate() below returns canned measurements regardless of the
      // requested size, exactly like a real desynced browser profile would.
    },
    async evaluate() {
      const result = sequence[call];
      call += 1;
      return result;
    },
  };
}

{
  // Case 1: no desync at all -- zoom measures to exactly 1.
  const page = fakePage([[1600, 1000]]);
  const result = await detectAndCompensateZoom(page, { width: 1600, height: 1000 });
  check("zoom=1 case: no compensation needed", result.zoom === 1 && result.viewport.width === 1600 && result.viewport.height === 1000);
}

{
  // Case 2: CAPTURE.md's own worked example -- requesting 1600x1000 renders at 2000x1250
  // (zoom = 0.8), compensating to 1280x800 brings it back to exactly 1600x1000.
  const page = fakePage([
    [2000, 1250],
    [1600, 1000],
  ]);
  const result = await detectAndCompensateZoom(page, { width: 1600, height: 1000 });
  check(
    "zoom=0.8 desync case converges (CAPTURE.md's worked example)",
    Math.abs(result.zoom - 0.8) < 1e-9 && result.viewport.width === 1280 && result.viewport.height === 800,
  );
}

{
  // Case 3: compensation attempted but the second measurement still doesn't match target --
  // must throw ZoomCompensationError, not silently proceed with a wrong crop.
  const page = fakePage([
    [2000, 1250],
    [1700, 1050], // still off after "compensating"
  ]);
  let threw = null;
  try {
    await detectAndCompensateZoom(page, { width: 1600, height: 1000 });
  } catch (err) {
    threw = err;
  }
  check(
    "non-convergent desync throws ZoomCompensationError instead of proceeding",
    threw instanceof ZoomCompensationError,
  );
}

const { cropAndUpscale } = require(path.join(distDir, "tools", "captureScreenshot.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
{
  // A 100x100 solid-color PNG, cropped/upscaled per crop-shot.py's math (rect in effective CSS
  // space, zoom = 2 physical-per-css): rect (10,10,20,20) at zoom 2 -> physical box (20,20,60,60),
  // a 40x40 extract, upscaled back to the rect's own 20x20 CSS size.
  const srcBuffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
  const outBuffer = await cropAndUpscale(srcBuffer, { x: 10, y: 10, width: 20, height: 20 }, 2);
  const meta = await sharp(outBuffer).metadata();
  check("cropAndUpscale (crop-shot.py port) resizes to the rect's own (unshrunk) size", meta.width === 20 && meta.height === 20);
}

const { buildFfmpegTranscodeArgs, buildFfprobeDurationArgs } = require(
  path.join(distDir, "tools", "captureScreenRecording.js"),
);
check(
  "buildFfmpegTranscodeArgs returns the expected argv array",
  JSON.stringify(buildFfmpegTranscodeArgs("in.webm", "out.mp4")) ===
    JSON.stringify(["-nostdin", "-i", "in.webm", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "out.mp4", "-y"]),
);
check(
  "buildFfprobeDurationArgs returns the expected argv array",
  JSON.stringify(buildFfprobeDurationArgs("out.mp4")) ===
    JSON.stringify(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "out.mp4"]),
);

const captureScreenshotSrc = fs.readFileSync(path.join(packageRoot, "src", "tools", "captureScreenshot.ts"), "utf8");
const captureRecordingSrc = fs.readFileSync(path.join(packageRoot, "src", "tools", "captureScreenRecording.ts"), "utf8");
check(
  "captureScreenRecording.ts's ffmpeg transcode goes through spawnCapture, never exec/execSync",
  !/\bexec(Sync)?\(/.test(captureRecordingSrc) && /spawnCapture\(\s*"ffmpeg"/.test(captureRecordingSrc),
);
check("captureScreenshot.ts never calls exec/execSync", !/\bexec(Sync)?\(/.test(captureScreenshotSrc));

console.log("\n== Part 6: capture_screenshot / capture_screen_recording -- real browser E2E ==");

const { launchChromium } = captureCore;
let browserAvailable = false;
try {
  const probeBrowser = await launchChromium();
  await probeBrowser.close();
  browserAvailable = true;
} catch (err) {
  console.log(`  (skipped: real Chromium is not available in this environment: ${err.message})`);
}

if (browserAvailable) {
  const http = await import("node:http");
  const testPageHtml = `<!doctype html>
<html><head><style>
  body { margin: 0; background: #f0f0f0; }
  #target { position: absolute; left: 50px; top: 80px; width: 400px; height: 300px; background: #3355ff; }
  #status { position: absolute; left: 10px; top: 400px; font-family: sans-serif; }
  #btn { position: absolute; left: 10px; top: 440px; }
  #inp { position: absolute; left: 10px; top: 470px; }
</style></head>
<body>
  <div id="status">idle</div>
  <button id="btn" onclick="document.getElementById('status').textContent = 'clicked'">Click me</button>
  <input id="inp" />
  <div id="target"></div>
  <script>
    document.getElementById('inp').addEventListener('input', function (e) {
      document.getElementById('status').textContent = 'typed:' + e.target.value;
    });
  </script>
</body></html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(testPageHtml);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  const captureTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-capture-test-"));

  try {
    const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));
    const shotResult = await runCaptureScreenshot({
      projectRoot: captureTmpRoot,
      beatId: "hook",
      url: testUrl,
      viewport: { width: 800, height: 600 },
      interactions: [
        { type: "click", selector: "#btn" },
        { type: "fill", selector: "#inp", value: "hello" },
      ],
      cropSelector: "#target",
    });
    check(
      "capture_screenshot wrote to the default public/images/<beatId>.png convention",
      shotResult.outPath === path.join(captureTmpRoot, "public", "images", "hook.png"),
    );
    check("capture_screenshot's output file exists on disk", fs.existsSync(shotResult.outPath));
    check("capture_screenshot reports a numeric zoom (real live measurement, not skipped)", typeof shotResult.zoom === "number" && shotResult.zoom > 0);
    check(
      "capture_screenshot's cropSelector result matches #target's own CSS size (400x300), unshrunk regardless of measured zoom",
      shotResult.width === 400 && shotResult.height === 300,
    );
    const shotMeta = await sharp(shotResult.outPath).metadata();
    check("capture_screenshot's saved PNG's real pixel dimensions match the reported {width,height}", shotMeta.width === shotResult.width && shotMeta.height === shotResult.height);

    const ffmpegAvailable = (() => {
      try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();

    if (ffmpegAvailable) {
      const { runCaptureScreenRecording } = require(path.join(distDir, "tools", "captureScreenRecording.js"));
      const recResult = await runCaptureScreenRecording({
        projectRoot: captureTmpRoot,
        beatId: "hook",
        url: testUrl,
        viewport: { width: 800, height: 600 },
        interactions: [
          { type: "click", selector: "#btn" },
          { type: "wait", ms: 200 },
        ],
      });
      check(
        "capture_screen_recording wrote to the default public/video/<beatId>.mp4 convention",
        recResult.outPath === path.join(captureTmpRoot, "public", "video", "hook.mp4"),
      );
      check("capture_screen_recording's output file exists and is non-empty", fs.existsSync(recResult.outPath) && fs.statSync(recResult.outPath).size > 0);
      check("capture_screen_recording reports a numeric zoom", typeof recResult.zoom === "number" && recResult.zoom > 0);

      let ffprobeOk = false;
      try {
        const probeOut = execFileSync(
          "ffprobe",
          ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", recResult.outPath],
          { encoding: "utf8" },
        );
        ffprobeOk = probeOut.trim() === "video";
      } catch (err) {
        console.log(`  (ffprobe stream check skipped: ${err.message})`);
      }
      check("ffprobe confirms the transcoded mp4 has a video stream", ffprobeOk);
    } else {
      console.log("  (skipped capture_screen_recording: ffmpeg not found on PATH)");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} else {
  console.log("  (skipped entirely: no real Chromium available -- see DONE_WITH_CONCERNS note in the task report)");
}

console.log("\n== Part 7: import_higgsfield_clip -- gating + ingest logic (no Higgsfield call, no network) ==");

const { createMcpServer } = require(path.join(distDir, "server.js"));

// Gating: registerTools must add import_higgsfield_clip in exactly one of these two cases.
// Reaching into McpServer's own _registeredTools map is the compiled SDK's actual runtime
// state (no public "list currently registered tool names" accessor exists on McpServer
// itself), which is fine for this verification script the same way this file already
// reaches into other packages' compiled internals (e.g. TEMPLATE_DIR) elsewhere above.
function registeredToolNames(server) {
  return Object.keys(server._registeredTools ?? {});
}

const serverWithoutHiggsfield = createMcpServer({
  hasHiggsfield: false,
  targetDurationSeconds: 60,
  videoConfig: { fps: 30, width: 1920, height: 1080 },
});
check(
  "import_higgsfield_clip absent when hasHiggsfield: false",
  !registeredToolNames(serverWithoutHiggsfield).includes("import_higgsfield_clip"),
);

const serverWithoutConfigAtAll = createMcpServer();
check(
  "import_higgsfield_clip absent when no config is passed at all (matches stdio.ts's un-initialized-project default)",
  !registeredToolNames(serverWithoutConfigAtAll).includes("import_higgsfield_clip"),
);

const serverWithHiggsfield = createMcpServer({
  hasHiggsfield: true,
  targetDurationSeconds: 60,
  videoConfig: { fps: 30, width: 1920, height: 1080 },
});
check(
  "import_higgsfield_clip present when hasHiggsfield: true",
  registeredToolNames(serverWithHiggsfield).includes("import_higgsfield_clip"),
);
check(
  "every other tool is still registered regardless of the gate (spot-check init_project + capture_screen_recording)",
  ["init_project", "capture_screen_recording"].every((name) =>
    registeredToolNames(serverWithHiggsfield).includes(name) && registeredToolNames(serverWithoutHiggsfield).includes(name),
  ),
);

// Ingest logic: no Higgsfield MCP call exists in this design at all (see HIGGSFIELD.md /
// task-5-report.md), so there is no credit-spend concern to guard against here the way
// there was for capture_screen_recording's real-browser E2E section above. Both branches
// (local path, URL) are exercised against fakes only.
const { runImportHiggsfieldClip } = require(path.join(distDir, "tools", "importHiggsfieldClip.js"));
const higgsfieldTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-higgsfield-test-"));

{
  // "path" branch: a fake local file standing in for whatever the calling agent's own
  // Higgsfield generate_video/jobs_wait call produced on disk.
  const fakeSourcePath = path.join(higgsfieldTmpRoot, "fake-source.bin");
  const fakeBytes = Buffer.from("fake mp4 bytes from a fake local higgsfield result");
  fs.writeFileSync(fakeSourcePath, fakeBytes);

  const result = await runImportHiggsfieldClip({
    projectRoot: higgsfieldTmpRoot,
    beatId: "outro",
    source: { type: "path", path: fakeSourcePath },
  });
  check(
    "path branch: outPath matches the public/video/<beatId>.mp4 convention",
    result.outPath === path.join(higgsfieldTmpRoot, "public", "video", "outro.mp4") && result.beatId === "outro",
  );
  check(
    "path branch: bytes at outPath match the fake source exactly",
    fs.existsSync(result.outPath) && Buffer.compare(fs.readFileSync(result.outPath), fakeBytes) === 0,
  );

  let missingPathThrew = null;
  try {
    await runImportHiggsfieldClip({
      projectRoot: higgsfieldTmpRoot,
      beatId: "missing",
      source: { type: "path", path: path.join(higgsfieldTmpRoot, "does-not-exist.bin") },
    });
  } catch (err) {
    missingPathThrew = err;
  }
  check(
    "path branch: a missing local file is a structured failure (does not exist), not a silent no-op",
    missingPathThrew !== null && /does not exist/.test(missingPathThrew.message),
  );
}

{
  // "url" branch: a fake fetch (matching this project's existing fake-Playwright-page
  // pattern, a controlled fake rather than a real network call) standing in for whatever
  // URL the calling agent's Higgsfield result pointed at.
  const fakeUrlBytes = Buffer.from("fake mp4 bytes from a fake url higgsfield result");
  const fakeFetchOk = async (url) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async arrayBuffer() {
      return fakeUrlBytes.buffer.slice(fakeUrlBytes.byteOffset, fakeUrlBytes.byteOffset + fakeUrlBytes.byteLength);
    },
  });

  const result = await runImportHiggsfieldClip(
    { projectRoot: higgsfieldTmpRoot, beatId: "hook", source: { type: "url", url: "https://example.invalid/clip.mp4" } },
    { fetchImpl: fakeFetchOk },
  );
  check(
    "url branch: outPath matches the public/video/<beatId>.mp4 convention",
    result.outPath === path.join(higgsfieldTmpRoot, "public", "video", "hook.mp4"),
  );
  check(
    "url branch: bytes at outPath match the fake fetch response exactly",
    fs.existsSync(result.outPath) && Buffer.compare(fs.readFileSync(result.outPath), fakeUrlBytes) === 0,
  );

  const fakeFetch404 = async () => ({ ok: false, status: 404, statusText: "Not Found" });
  let badUrlThrew = null;
  try {
    await runImportHiggsfieldClip(
      { projectRoot: higgsfieldTmpRoot, beatId: "bad", source: { type: "url", url: "https://example.invalid/missing.mp4" } },
      { fetchImpl: fakeFetch404 },
    );
  } catch (err) {
    badUrlThrew = err;
  }
  check(
    "url branch: a non-ok response is a structured failure carrying the status code, not a silent no-op",
    badUrlThrew !== null && /404/.test(badUrlThrew.message),
  );

  const fakeFetchNetworkError = async () => {
    throw new Error("simulated DNS failure");
  };
  let networkErrorThrew = null;
  try {
    await runImportHiggsfieldClip(
      { projectRoot: higgsfieldTmpRoot, beatId: "bad2", source: { type: "url", url: "https://example.invalid/unreachable.mp4" } },
      { fetchImpl: fakeFetchNetworkError },
    );
  } catch (err) {
    networkErrorThrew = err;
  }
  check(
    "url branch: a fetch-level network error is a structured failure, not an uncaught throw escaping this test",
    networkErrorThrew !== null && /simulated DNS failure/.test(networkErrorThrew.message),
  );
}

const importHiggsfieldClipSrc = fs.readFileSync(path.join(packageRoot, "src", "tools", "importHiggsfieldClip.ts"), "utf8");
check(
  "importHiggsfieldClip.ts never imports/requires a Higgsfield SDK or client package (only fetch + node:fs)",
  !/(from\s*["'][^"']*higgsfield[^"']*["']|require\(\s*["'][^"']*higgsfield[^"']*["']\s*\))/i.test(importHiggsfieldClipSrc),
);

console.log("\n== Part 8: PLANNING.md's own worked example passes validate_beats (I4 regression pin) ==");

const planningMdPath = path.join(monorepoRoot, "packages", "docs", "PLANNING.md");
// Normalize CRLF -> LF first: a Windows checkout with core.autocrlf=true reads this file
// back as CRLF regardless of what's committed, and the fence regex is LF-literal.
const planningMd = fs.readFileSync(planningMdPath, "utf8").replace(/\r\n/g, "\n");
// Anchor on the worked-example section rather than "first json fence in the file":
// a fenced example added to any earlier section used to silently steal this pin, which
// is exactly what happened when the capture-sources section was written.
const workedExampleSection = planningMd.slice(planningMd.search(/^## \d+\. Worked example/m));
const jsonFenceMatch = workedExampleSection.match(/```json\n([\s\S]*?)\n```/);
check("PLANNING.md has a fenced ```json worked example", jsonFenceMatch !== null);

if (jsonFenceMatch) {
  const workedExampleBeats = JSON.parse(jsonFenceMatch[1]);
  const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
  const workedExampleResult = validateBeatsLogic(workedExampleBeats);
  check(
    `PLANNING.md's worked example passes validate_beats (errors: ${JSON.stringify(workedExampleResult.errors)})`,
    workedExampleResult.valid === true,
  );
}

console.log("\n== Part 9: diff_beats -- pure function (no filesystem-dependent artifact checks) ==");

{
  const { diffBeatsLogic } = require(path.join(distDir, "tools", "diffBeats.js"));
  const fakeRoot = path.join(tmpRoot, "diff-beats-fake-root");
  fs.mkdirSync(fakeRoot, { recursive: true });

  const oldBeats = {
    fps: 30,
    title: "Old",
    beats: [
      { id: "hook", start: 0, duration: 90, vo: "hook line", visual: { captureMethod: "dom-demo" } },
      {
        id: "demo",
        start: 90,
        duration: 120,
        vo: "demo line",
        visual: { captureMethod: "screenshot", url: "https://example.com", interactions: [] },
      },
      { id: "gone", start: 210, duration: 60, vo: "cut me", visual: { captureMethod: "dom-demo" } },
    ],
  };
  const newBeats = {
    fps: 30,
    title: "Old",
    beats: [
      { id: "hook", start: 0, duration: 90, vo: "hook line", visual: { captureMethod: "dom-demo" } },
      {
        id: "demo",
        start: 90,
        duration: 150,
        vo: "demo line, edited",
        visual: { captureMethod: "screenshot", url: "https://example.com", interactions: [] },
      },
      { id: "new-beat", start: 240, duration: 60, vo: "brand new", visual: { captureMethod: "dom-demo" } },
    ],
  };

  const result = diffBeatsLogic(oldBeats, newBeats, fakeRoot);
  const byId = Object.fromEntries(result.beats.map((b) => [b.id, b]));

  check("hook beat (unchanged) reports status unchanged", byId.hook?.status === "unchanged");
  check("hook beat needs neither recapture nor rescaffold", byId.hook?.needsRecapture === false && byId.hook?.needsRescaffold === false);
  check(
    "demo beat (duration + vo edited) reports status changed with both fields listed",
    byId.demo?.status === "changed" &&
      byId.demo.changedFields.includes("duration") &&
      byId.demo.changedFields.includes("vo"),
  );
  check("demo beat's visual untouched, so needsRecapture is false", byId.demo?.needsRecapture === false);
  check("demo beat's content changed, so needsRescaffold is true", byId.demo?.needsRescaffold === true);
  check("gone beat reports status removed", byId.gone?.status === "removed");
  check("new-beat reports status added, needsRescaffold true", byId["new-beat"]?.status === "added" && byId["new-beat"].needsRescaffold === true);
  check(
    "new-beat is dom-demo, so needsRecapture is false even though added",
    byId["new-beat"]?.needsRecapture === false,
  );
  check(
    "summary counts match (1 added, 1 removed, 1 changed, 1 unchanged)",
    result.summary.added === 1 && result.summary.removed === 1 && result.summary.changed === 1 && result.summary.unchanged === 1,
  );
  check("rerenderNeeded is true whenever anything changed/added/removed", result.rerenderNeeded === true);
  check(
    "identical beats.json against itself reports rerenderNeeded false",
    diffBeatsLogic(oldBeats, oldBeats, fakeRoot).rerenderNeeded === false,
  );

  // A visual.captureMethod change on an existing beat is the real needsRecapture case.
  const recaptureOld = { fps: 30, title: "T", beats: [{ id: "b", start: 0, duration: 60, vo: "x", visual: { captureMethod: "dom-demo" } }] };
  const recaptureNew = {
    fps: 30,
    title: "T",
    beats: [{ id: "b", start: 0, duration: 60, vo: "x", visual: { captureMethod: "screenshot", url: "https://x.example", interactions: [] } }],
  };
  const recaptureResult = diffBeatsLogic(recaptureOld, recaptureNew, fakeRoot);
  check(
    "switching a beat from dom-demo to screenshot sets needsRecapture true",
    recaptureResult.beats[0]?.needsRecapture === true,
  );
}

console.log("\n== Part 10: render_video's brand-lock gate ==");

{
  const gateRoot = path.join(tmpRoot, "brand-lock-gate-test");
  fs.mkdirSync(path.join(gateRoot, "src"), { recursive: true });

  let threw = false;
  let thrownMessage = "";
  try {
    await runRenderVideo({ projectRoot: gateRoot, videoName: "whatever" });
  } catch (err) {
    threw = true;
    thrownMessage = err instanceof Error ? err.message : String(err);
  }
  check("render_video refuses to run when src/brand.ts is missing and skipBrandLock is not passed", threw);
  check("the refusal names extract_brand as the fix", thrownMessage.includes("extract_brand"));

  // skipBrandLock: true bypasses the gate but the render itself still fails fast here
  // (no real Remotion project scaffolded at gateRoot) -- this only proves the gate check
  // ran and let it past to the actual spawn, not that the render succeeded.
  let bypassedGate = false;
  try {
    await runRenderVideo({ projectRoot: gateRoot, videoName: "whatever", skipBrandLock: true });
    bypassedGate = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    bypassedGate = !msg.includes("Brand-lock gate");
  }
  check("skipBrandLock: true bypasses the gate (fails later, on the actual missing project, not on the gate)", bypassedGate);

  fs.writeFileSync(path.join(gateRoot, "src", "brand.ts"), "// fake brand.ts for the gate test\n", "utf8");
  let gatePassedWithBrandFile = false;
  try {
    await runRenderVideo({ projectRoot: gateRoot, videoName: "whatever" });
    gatePassedWithBrandFile = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gatePassedWithBrandFile = !msg.includes("Brand-lock gate");
  }
  check("gate passes once src/brand.ts exists, no skipBrandLock needed (fails later, on the missing project)", gatePassedWithBrandFile);
}

console.log("\n== Part 10b: missing narration is reported, not silent ==");

{
  // The demo project from Part 2 has no VO files at all, so every beat is missing one.
  const stitched = runStitchComposition({ projectRoot: tmpRoot, videoName: "demo" });
  check("stitch_composition lists every beat that will render silent", stitched.voBeatsMissing.length === 3);
  check("...and raises a warning rather than staying quiet", stitched.warnings.length === 1);
  check("...naming the convention path it looked for", stitched.warnings[0].includes("public/audio/vo/<beatId>.mp3"));

  let refused = false;
  let refusalMessage = "";
  try {
    runStitchComposition({ projectRoot: tmpRoot, videoName: "demo", requireNarration: true });
  } catch (err) {
    refused = true;
    refusalMessage = err instanceof Error ? err.message : String(err);
  }
  check("requireNarration: true turns missing narration into a hard failure", refused);
  check("...and the refusal names the offending beats", refusalMessage.includes("hook"));
}

console.log("\n== Part 11: non-browser capture -- pure argv builders (no process spawned) ==");

{
  const native = require(path.join(packageRoot, "..", "capture", "dist", "native.js"));
  const {
    buildDesktopCaptureArgs,
    buildAdbRecordArgs,
    buildAdbPullArgs,
    buildSimctlRecordArgs,
    buildRemuxArgs,
    sanitizeDeviceId,
    sanitizeWindowTitle,
  } = native;

  const win = buildDesktopCaptureArgs({
    platform: "win32", framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check("win32 full-screen capture uses gdigrab against `desktop`", win.includes("gdigrab") && win.includes("desktop"));
  check("win32 capture bounds itself with -t", win[win.indexOf("-t") + 1] === "5");

  const winWindow = buildDesktopCaptureArgs({
    platform: "win32", window: "Hermes Agent", framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check(
    "win32 window capture passes title= as ONE argv entry (spaces intact, never shell-split)",
    winWindow.includes("title=Hermes Agent"),
  );

  const winRegion = buildDesktopCaptureArgs({
    platform: "win32", region: { x: 10, y: 20, width: 640, height: 480 },
    framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check(
    "win32 region capture uses gdigrab's own offset/video_size input flags",
    winRegion.includes("-offset_x") && winRegion.includes("-video_size") && winRegion.includes("640x480"),
  );

  const mac = buildDesktopCaptureArgs({
    platform: "darwin", display: 1, framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check("darwin capture uses avfoundation with a <display>:none input", mac.includes("avfoundation") && mac.includes("1:none"));

  const macRegion = buildDesktopCaptureArgs({
    platform: "darwin", region: { x: 5, y: 6, width: 300, height: 200 },
    framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check(
    "darwin region becomes a crop filter (avfoundation cannot grab a sub-rect)",
    macRegion.join(" ").includes("crop=300:200:5:6"),
  );

  const linux = buildDesktopCaptureArgs({
    platform: "linux", region: { x: 100, y: 50, width: 800, height: 600 },
    framerate: 25, durationSeconds: 5, outPath: "out.mp4",
  });
  check("linux capture uses x11grab with the region in its input spec", linux.includes("x11grab") && linux.includes(":0.0+100,50"));

  // h264/yuv420p cannot encode odd dimensions, and a hand-picked region very often is odd.
  for (const [name, args] of [["win32", win], ["darwin", mac], ["linux", linux]]) {
    check(
      `${name} output forces even dimensions (odd-width regions would fail at the encoder)`,
      args.join(" ").includes("trunc(iw/2)*2:trunc(ih/2)*2"),
    );
  }
  check("desktop output is yuv420p + faststart so Remotion can seek it", win.includes("yuv420p") && win.includes("+faststart"));

  const adb = buildAdbRecordArgs("/sdcard/x.mp4", 20, "emulator-5554");
  check("adb record targets the chosen device and self-terminates via --time-limit",
    adb[0] === "-s" && adb[1] === "emulator-5554" && adb.includes("--time-limit") && adb.includes("20"));
  check("adb record omits -s entirely when no deviceId is given", buildAdbRecordArgs("/sdcard/x.mp4", 20)[0] === "shell");
  check("adb pull moves the device file to a local path", buildAdbPullArgs("/sdcard/x.mp4", "local.mp4").join(" ") === "pull /sdcard/x.mp4 local.mp4");
  check("simctl defaults to the booted simulator", buildSimctlRecordArgs("out.mp4").includes("booted"));
  check("remux copies streams rather than re-encoding", buildRemuxArgs("in.mp4", "out.mp4").join(" ").includes("-c copy"));

  check("sanitizeDeviceId accepts a real adb serial", sanitizeDeviceId("emulator-5554") === "emulator-5554");
  let rejectedId = false;
  try { sanitizeDeviceId("a; rm -rf /"); } catch { rejectedId = true; }
  check("sanitizeDeviceId rejects a shell-metacharacter payload", rejectedId);
  check("sanitizeWindowTitle allows spaces and quotes (argv is passed intact)", sanitizeWindowTitle('My "App" v2') === 'My "App" v2');
  let rejectedTitle = false;
  try { sanitizeWindowTitle("bad\ntitle"); } catch { rejectedTitle = true; }
  check("sanitizeWindowTitle rejects a newline (it would truncate gdigrab's selector)", rejectedTitle);
}

console.log("\n== Part 12: validate_beats understands non-browser sources ==");

{
  const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
  // 5 words over 2.00s is 2.5 words/sec, inside SCRIPT.md's 2.3-2.9 budget, so these
  // fixtures exercise the source rules rather than tripping the pacing check.
  const beat = (visual, extra = {}) => ({
    fps: 30, title: "T",
    beats: [{ id: "b", start: 0, duration: 60, vo: "a short narration line here", visual, ...extra }],
  });

  check(
    "a browser beat with no source field still validates (backward compatible)",
    validateBeatsLogic(beat({ captureMethod: "recording", url: "https://x.example", interactions: [] })).valid,
  );
  check(
    "a desktop beat validates with durationSeconds",
    validateBeatsLogic(beat({ captureMethod: "recording", source: "desktop", window: "App", durationSeconds: 8 })).valid,
  );
  check(
    "a desktop beat without durationSeconds is rejected",
    !validateBeatsLogic(beat({ captureMethod: "recording", source: "desktop", window: "App" })).valid,
  );
  check(
    "a terminal beat validates with a bare command",
    validateBeatsLogic(beat({ captureMethod: "recording", source: "terminal", command: "hermes", args: ["--help"] })).valid,
  );
  const shellish = validateBeatsLogic(beat({ captureMethod: "recording", source: "terminal", command: "npm run build" }));
  check("a terminal command containing a full command line is rejected", !shellish.valid);
  check("...and the error explains that args belong in visual.args", shellish.errors.join(" ").includes("visual.args"));
  const longAndroid = validateBeatsLogic(
    beat({ captureMethod: "recording", source: "mobile", device: "android", durationSeconds: 240 }),
  );
  check("an Android beat over the 180s screenrecord limit is rejected", !longAndroid.valid);
  check("...and the error names the silent-truncation reason", longAndroid.errors.join(" ").includes("truncates silently"));
  check(
    "a non-browser source on a screenshot beat is rejected",
    !validateBeatsLogic(beat({ captureMethod: "screenshot", source: "desktop", durationSeconds: 5 })).valid,
  );
  check(
    "an unknown source is rejected",
    !validateBeatsLogic(beat({ captureMethod: "recording", source: "hologram", durationSeconds: 5 })).valid,
  );
  check(
    "an existing-asset beat validates with a path and attribution",
    validateBeatsLogic(beat({ captureMethod: "existing-asset", assetPath: "public/images/x.png", attribution: "the project's own README" })).valid,
  );
  const unattributed = validateBeatsLogic(beat({ captureMethod: "existing-asset", assetPath: "public/images/x.png" }));
  check("an existing-asset beat WITHOUT attribution is rejected", !unattributed.valid);
  check("...and the error says why an unattributed borrowed frame is a problem", unattributed.errors.join(" ").includes("attribution"));
}

console.log("\n== Part 13: Wayland backend selection and pipewiregrab argv ==");

{
  const native = require(path.join(packageRoot, "..", "capture", "dist", "native.js"));
  const { detectLinuxDisplayServer, buildDesktopCaptureArgs, hasFilter, buildFilterProbeArgs } = native;

  check("XDG_SESSION_TYPE=wayland is detected", detectLinuxDisplayServer({ XDG_SESSION_TYPE: "wayland" }) === "wayland");
  check("XDG_SESSION_TYPE=x11 is detected", detectLinuxDisplayServer({ XDG_SESSION_TYPE: "x11" }) === "x11");
  // Containers and some session managers leave XDG_SESSION_TYPE unset, so WAYLAND_DISPLAY
  // is the fallback signal rather than defaulting a Wayland box to x11grab.
  check(
    "WAYLAND_DISPLAY alone still means wayland",
    detectLinuxDisplayServer({ WAYLAND_DISPLAY: "wayland-0" }) === "wayland",
  );
  check("an empty environment falls back to x11", detectLinuxDisplayServer({}) === "x11");

  const wayland = buildDesktopCaptureArgs({
    platform: "linux",
    displayServer: "wayland",
    framerate: 30,
    durationSeconds: 6,
    outPath: "out.mp4",
  });
  check("a wayland capture goes through lavfi's pipewiregrab", wayland.includes("lavfi") && wayland.some((a) => a.startsWith("pipewiregrab=")));
  check("...and never through x11grab", !wayland.includes("x11grab"));
  // pipewiregrab is a filter source, not an input device, so there is no -framerate to ask
  // the device for: the rate is imposed downstream with fps.
  check("...and imposes the framerate with the fps filter", wayland.join(" ").includes("fps=30"));
  check("...and still forces even dimensions for h264", wayland.join(" ").includes("scale=trunc(iw/2)*2"));

  const waylandCropped = buildDesktopCaptureArgs({
    platform: "linux",
    displayServer: "wayland",
    framerate: 24,
    durationSeconds: 3,
    outPath: "out.mp4",
    region: { x: 10, y: 20, width: 640, height: 481 },
  });
  check("a region on wayland becomes a crop filter", waylandCropped.join(" ").includes("crop=640:481:10:20"));

  const withNode = buildDesktopCaptureArgs({
    platform: "linux",
    displayServer: "wayland",
    framerate: 30,
    durationSeconds: 3,
    outPath: "out.mp4",
    pipewire: { node: 42 },
  });
  check("a pre-negotiated portal node id is passed to the filter", withNode.join(" ").includes("node=42"));

  const x11 = buildDesktopCaptureArgs({ platform: "linux", framerate: 30, durationSeconds: 3, outPath: "out.mp4" });
  check("an x11 session is unchanged by any of this", x11.includes("x11grab"));

  check("buildFilterProbeArgs asks ffmpeg for its filter list", JSON.stringify(buildFilterProbeArgs()) === JSON.stringify(["-hide_banner", "-filters"]));
  check(
    "hasFilter finds pipewiregrab in real ffmpeg -filters output",
    hasFilter(" T.. crop              V->V       Crop the input video.\n ... pipewiregrab      |->V       Capture a portal stream.\n", "pipewiregrab"),
  );
  check(
    "hasFilter does not false-positive on a build without it",
    !hasFilter(" T.. crop              V->V       Crop the input video.\n", "pipewiregrab"),
  );
}

console.log("\n== Part 14: capture_terminal records a real command run ==");

{
  const { recordTerminal, loadPty } = require(path.join(packageRoot, "..", "capture", "dist", "terminal.js"));
  const ptyAvailable = loadPty() !== null;
  console.log(`  (node-pty ${ptyAvailable ? "is" : "is not"} installed here, so the default path is ${ptyAvailable ? "pty" : "pipe"})`);

  const piped = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdout.write('hello\\n'); process.stderr.write('warn\\n');"],
    cwd: packageRoot,
    mode: "pipe",
  });
  check("a piped run exits 0", piped.cast.exitCode === 0);
  check("...and reports pipe mode", piped.mode === "pipe");
  check("...and the cast records the mode it was captured in", piped.cast.mode === "pipe");
  check("...and captures stdout", piped.cast.events.some(([, stream, text]) => stream === "o" && text.includes("hello")));
  // The separation of stderr is exactly what a pty cannot give you, so it is worth pinning
  // on the backend that can.
  check("...and keeps stderr distinguishable from stdout", piped.cast.events.some(([, stream, text]) => stream === "e" && text.includes("warn")));
  check("...and nothing is truncated for a small run", piped.truncated === false);

  const scripted = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdin.on('data', (d) => process.stdout.write('got:' + d));"],
    cwd: packageRoot,
    script: [{ type: "type", text: "ping\n" }, { type: "wait", ms: 50 }],
    mode: "pipe",
  });
  check("scripted stdin reaches the program", scripted.cast.events.some(([, , text]) => text.includes("got:ping")));

  let ptyRefusal = "";
  if (!ptyAvailable) {
    try {
      await recordTerminal({ command: process.execPath, args: ["-e", "0"], cwd: packageRoot, mode: "pty" });
    } catch (err) {
      ptyRefusal = err instanceof Error ? err.message : String(err);
    }
    check('mode "pty" fails loudly when node-pty is absent rather than silently piping', ptyRefusal.includes("node-pty"));
  } else {
    const ptyRun = await recordTerminal({
      command: process.execPath,
      args: ["-e", "process.stdout.write('tty:' + Boolean(process.stdout.isTTY) + '\\n');"],
      cwd: packageRoot,
      mode: "pty",
    });
    check("a pty run reports pty mode", ptyRun.mode === "pty");
    // The whole point of the pty path: the program believes it is talking to a terminal,
    // which is what keeps its colour on.
    check("...and the program sees a real tty", ptyRun.cast.events.some(([, , text]) => text.includes("tty:true")));
  }

  const truncating = await recordTerminal({
    command: process.execPath,
    args: ["-e", "for (let i = 0; i < 200000; i++) process.stdout.write('x'.repeat(200) + '\\n');"],
    cwd: packageRoot,
    mode: "pipe",
    timeoutMs: 30000,
  });
  check("a runaway process is truncated rather than exhausting memory", truncating.truncated === true);
  check("...and the truncation is visible in the cast", truncating.cast.events.some(([, , text]) => text.includes("truncated")));
}

console.log("\n== Part 15: per-beat render cache -- pure logic ==");

{
  const cache = require(path.join(distDir, "renderCache.js"));
  const { buildSegmentRenderArgs, buildConcatList, buildConcatArgs, renderKey, hashFile } = cache;

  const seg = buildSegmentRenderArgs("DemoDemo", "output/segments/demo/hook.mp4", 0, 89);
  check("a segment render asks Remotion for exactly that beat's frame range", seg.args.includes("--frames=0-89"));
  // Without this, a beat with no narration renders with no audio stream at all, and the
  // concat demuxer cannot stream-copy a segment that has an audio track together with one
  // that does not. It either fails or silently drops audio for the rest of the file.
  check("...and forces an audio track so every segment has uniform streams", seg.args.includes("--enforce-audio-track"));
  check("...and still asks for verbose logs, since Remotion hides progress off a TTY", seg.args.includes("--log=verbose"));
  const draftSeg = buildSegmentRenderArgs("DemoDemo", "s.mp4", 0, 9, { draft: true, concurrency: 4 });
  check("a draft segment carries the draft flags", draftSeg.args.includes("--scale=0.5") && draftSeg.args.includes("--concurrency=4"));

  check(
    "draft and final never share a cache",
    renderKey({ draft: true, width: 1920, height: 1080, fps: 30 }) !==
      renderKey({ draft: false, width: 1920, height: 1080, fps: 30 }),
  );
  check(
    "a resolution change invalidates the cache",
    renderKey({ draft: false, width: 1920, height: 1080, fps: 30 }) !==
      renderKey({ draft: false, width: 1080, height: 1920, fps: 30 }),
  );

  check(
    "the concat list is in ffmpeg's own format",
    buildConcatList(["hook.mp4", "body.mp4"]) === "file 'hook.mp4'\nfile 'body.mp4'\n",
  );
  // A beat id cannot contain a quote (sanitizeSegment forbids it), but the list writer is
  // the wrong place to rely on that, so it escapes per ffmpeg's rules regardless.
  check("...and escapes a quote the way ffmpeg expects", buildConcatList(["it's.mp4"]).includes("'it'\\''s.mp4'"));
  const concatArgs = buildConcatArgs("concat.txt", "../../demo.mp4");
  check("the concat is a stream copy, never a re-encode", concatArgs.includes("-c") && concatArgs.includes("copy"));
  check("...and writes a seekable moov", concatArgs.includes("+faststart"));
  check("...and allows relative paths in the list", concatArgs.includes("-safe") && concatArgs.includes("0"));

  const missing = hashFile(path.join(tmpRoot, "definitely-not-here.png"));
  check("a missing artifact hashes to a stable sentinel rather than throwing", typeof missing === "string" && missing.length === 64);
}

console.log("\n== Part 16: per-beat render cache -- real incremental render ==");

if (fs.existsSync(tempNodeModules)) {
  const cacheMod = require(path.join(distDir, "renderCache.js"));
  const incBeatsJson = {
    fps: 30,
    title: "Incremental",
    beats: [
      { id: "one", start: 0, duration: 90, vo: "First beat of the incremental render test.", visual: { captureMethod: "dom-demo" } },
      { id: "two", start: 90, duration: 90, vo: "Second beat of the incremental render test.", visual: { captureMethod: "dom-demo" } },
      { id: "three", start: 180, duration: 90, vo: "Third beat of the incremental render test.", visual: { captureMethod: "dom-demo" } },
    ],
  };
  const incWrite = runWriteBeatsFile({ projectRoot: tmpRoot, videoName: "inctest", beatsJson: incBeatsJson });
  check("the incremental fixture passes validate_beats", incWrite.written === true);
  for (const id of ["one", "two", "three"]) {
    runScaffoldScene({ projectRoot: tmpRoot, videoName: "inctest", beatId: id, kind: "dom-demo" });
  }
  runStitchComposition({ projectRoot: tmpRoot, videoName: "inctest" });

  const incOut = path.join("out", "incremental.mp4");
  const first = await runRenderVideo({
    projectRoot: tmpRoot,
    videoName: "inctest",
    outPath: incOut,
    skipBrandLock: true,
    incremental: true,
  });
  if (!first.success) console.log(first.stderr.slice(-3000));
  check("a cold incremental render succeeds", first.success === true && fs.existsSync(first.outPath));
  check("...and renders every beat, because nothing is cached yet", first.renderedBeats.length === 3 && first.reusedBeats.length === 0);
  check("...and renders exactly the composition's frame count", first.framesRendered === 270 && first.totalFrames === 270);
  check("...and leaves one segment per beat on disk", ["one", "two", "three"].every((id) => fs.existsSync(path.join(tmpRoot, "output", "segments", "inctest", `${id}.mp4`))));

  const second = await runRenderVideo({
    projectRoot: tmpRoot,
    videoName: "inctest",
    outPath: incOut,
    skipBrandLock: true,
    incremental: true,
  });
  check("an unchanged re-render reuses every segment", second.success === true && second.reusedBeats.length === 3);
  check("...and renders zero frames", second.framesRendered === 0);

  // The acceptance criterion from the issue: change one beat, re-render, and only that
  // beat is recomputed.
  const scenePath = path.join(tmpRoot, "src", "videos", "inctest", "scenes", "Two.tsx");
  const sceneSrc = fs.readFileSync(scenePath, "utf8");
  fs.writeFileSync(scenePath, sceneSrc + "\n// edited by the cache test\n", "utf8");

  const third = await runRenderVideo({
    projectRoot: tmpRoot,
    videoName: "inctest",
    outPath: incOut,
    skipBrandLock: true,
    incremental: true,
  });
  check("editing one beat's scene re-renders only that beat", third.renderedBeats.join(",") === "two");
  check("...and reuses the other two", third.reusedBeats.join(",") === "one,three");
  check("...and renders only that beat's frames", third.framesRendered === 90);
  check("...and still produces the whole video", third.success === true && fs.existsSync(third.outPath));

  // A brand change repaints frames whose own scene file never moved, because applyBrand
  // mutates the token objects every scene reads. If the cache misses that, it ships a
  // video half in the old palette.
  fs.writeFileSync(path.join(tmpRoot, "src", "brand.ts"), "// brand touched by the cache test\nexport {};\n", "utf8");
  const fourth = await runRenderVideo({
    projectRoot: tmpRoot,
    videoName: "inctest",
    outPath: incOut,
    skipBrandLock: true,
    incremental: true,
  });
  check("touching brand.ts invalidates every segment, not just one", fourth.renderedBeats.length === 3);

  const cacheFile = cacheMod.cachePath(tmpRoot, "inctest");
  check("the cache manifest is written beside the segments", fs.existsSync(cacheFile));

  try {
    const probe = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(tmpRoot, incOut)],
      { encoding: "utf8" },
    );
    const seconds = Number.parseFloat(probe.trim().replace(/[,\s]+$/, ""));
    // 270 frames at 30fps. Concatenated segments must add up to the same duration a single
    // pass would have produced, otherwise the stream copy dropped or duplicated something.
    check("the concatenated video is the full nine seconds, not one segment", Math.abs(seconds - 9) < 0.35);
  } catch (err) {
    skip("the concatenated video is the full nine seconds", `ffprobe unavailable: ${err.message}`);
  }
} else {
  skip("Part 16: real incremental render (entire section)", `${tempNodeModules} not present`);
}

console.log("\n== Part 17: vertical reformat -- manifest-driven crop ==");

{
  const vert = require(path.join(distDir, "tools", "reformatVertical.js"));
  const { inferFocus, cropRect, planCrops, buildVerticalFilterGraph, buildReformatArgs, parseProbe } = vert;

  // A terminal is text pinned to the left margin. A centre crop cuts the command in half,
  // which is the single most visible way automated reframing gets it wrong.
  check(
    "a terminal beat crops left",
    inferFocus({ id: "t", start: 0, duration: 30, visual: { captureMethod: "recording", source: "terminal" } }).focus === "left",
  );
  check(
    "a dom-demo panel crops centre",
    inferFocus({ id: "d", start: 0, duration: 30, visual: { captureMethod: "dom-demo" } }).focus === "center",
  );
  check(
    "an explicit focus overrides the inference",
    inferFocus({ id: "x", start: 0, duration: 30, visual: { captureMethod: "dom-demo" }, vertical: { focus: "right" } }).focus === "right",
  );
  check(
    "...and the result says why, so a wrong guess is visible",
    inferFocus({ id: "t", start: 0, duration: 30, visual: { captureMethod: "recording", source: "terminal" } }).reason.includes("left margin"),
  );

  const centre = cropRect(1920, 1080, 1080, 1920, "center");
  check("a 9:16 crop of 1920x1080 is the full height", centre.height === 1080);
  check("...and 608 wide, the largest 9:16 width that fits", centre.width === 608);
  check("...and centred horizontally", centre.x === 656);
  // h264 in yuv420p subsamples chroma 2x2, so an odd crop or offset fails at the encoder
  // with an error that never mentions the real cause.
  check(
    "every crop dimension and offset is even",
    [centre.x, centre.y, centre.width, centre.height].every((n) => n % 2 === 0),
  );
  check("a left focus starts at x=0", cropRect(1920, 1080, 1080, 1920, "left").x === 0);
  check("a right focus ends at the right edge", cropRect(1920, 1080, 1080, 1920, "right").x === 1312);

  // A phone recording is already portrait: there is nothing to crop away, and the frame
  // gets fitted and padded instead of stretched.
  const portrait = cropRect(886, 1920, 1080, 1920, "center");
  check("a source narrower than the target aspect is not cropped wider than it is", portrait.width === 886);

  const crops = planCrops({
    beats: [
      { id: "one", start: 0, duration: 30, visual: { captureMethod: "dom-demo" } },
      { id: "two", start: 30, duration: 60, visual: { captureMethod: "recording", source: "terminal" } },
    ],
    fps: 30,
    sourceWidth: 1920,
    sourceHeight: 1080,
    targetWidth: 1080,
    targetHeight: 1920,
  });
  check("each beat gets its own crop", crops.length === 2 && crops[0].focus === "center" && crops[1].focus === "left");
  check("...over its own time range", crops[1].startSeconds === 1 && crops[1].endSeconds === 3);

  const graph = buildVerticalFilterGraph(crops, 1080, 1920, true);
  check("the filtergraph trims per beat", graph.includes("trim=start=1.0000:end=3.0000"));
  check("...crops per beat", graph.includes("crop=608:1080:0:0") && graph.includes("crop=608:1080:656:0"));
  check("...pads rather than stretching a portrait source", graph.includes("force_original_aspect_ratio=decrease") && graph.includes("pad=1080:1920"));
  check("...and concatenates the slices back into one stream", graph.includes("concat=n=2:v=1:a=1"));
  const silentGraph = buildVerticalFilterGraph(crops, 1080, 1920, false);
  check("a silent source produces no audio branch", !silentGraph.includes("atrim") && silentGraph.includes("concat=n=2:v=1:a=0"));

  const args = buildReformatArgs("in.mp4", "out.mp4", graph, true);
  check("the reformat maps the concatenated streams", args.includes("[vout]") && args.includes("[aout]"));
  check("...and writes a seekable h264 file", args.includes("+faststart") && args.includes("yuv420p"));

  const probed = parseProbe(JSON.stringify({ streams: [{ codec_type: "video", width: 1920, height: 1080 }, { codec_type: "audio" }] }));
  check("ffprobe json is parsed into dimensions plus an audio flag", probed.width === 1920 && probed.hasAudio === true);
  let probeRefusal = "";
  try {
    parseProbe(JSON.stringify({ streams: [{ codec_type: "audio" }] }));
  } catch (err) {
    probeRefusal = err instanceof Error ? err.message : String(err);
  }
  check("an input with no video stream is refused rather than reformatted", probeRefusal.includes("no video stream"));
}

console.log("\n== Part 18: vertical reformat -- real ffmpeg run ==");

if (fs.existsSync(path.join(tmpRoot, "out", "incremental.mp4"))) {
  const { runReformatVertical } = require(path.join(distDir, "tools", "reformatVertical.js"));
  const reformatted = await runReformatVertical({
    projectRoot: tmpRoot,
    videoName: "inctest",
    inPath: path.join("out", "incremental.mp4"),
    outPath: path.join("out", "incremental-vertical.mp4"),
  });
  check("the reformat produces a file", fs.existsSync(reformatted.outPath));
  check("...and reports a crop for every beat", reformatted.beats.length === 3);
  check("...and read the source dimensions from the file itself", reformatted.sourceWidth === 1920 && reformatted.sourceHeight === 1080);

  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0", reformatted.outPath],
      { encoding: "utf8" },
    );
    check("the reformatted file is actually 1080x1920", out.includes("1080,1920"));
    const seconds = Number.parseFloat(out.trim().split("\n").pop().replace(/[,\s]+$/, ""));
    // The trims have to add back up to the original: a reformat that silently drops the
    // last beat is the failure mode worth pinning.
    check("...and the same nine seconds as the source", Math.abs(seconds - 9) < 0.35);
  } catch (err) {
    skip("the reformatted file is actually 1080x1920", `ffprobe unavailable: ${err.message}`);
  }
} else {
  skip("Part 18: real vertical reformat (entire section)", "Part 16 did not produce a video to reformat");
}

console.log("\n== Part 19: other renderers over the same beats ==");

{
  const rend = require(path.join(distDir, "tools", "exportRendition.js"));
  const { buildPaletteArgs, buildGifArgs, buildFrameArgs, buildStoreFrameArgs, buildScreenshotIndex, beatMidpointSeconds, STORE_DEVICES } = rend;

  // A GIF is 256 colours. Without a generated palette ffmpeg uses a fixed web-safe one and
  // bands flat UI into mud, which is why most README GIFs look the way they do.
  check("the GIF export generates a palette first", buildPaletteArgs("in.mp4", "p.png", 12, 720).join(" ").includes("palettegen"));
  check("...and uses it on the second pass", buildGifArgs("in.mp4", "p.png", "out.gif", 12, 720).join(" ").includes("paletteuse"));
  check("...and loops forever, since a README GIF that plays once is a still", buildGifArgs("in.mp4", "p.png", "out.gif", 12, 720).includes("-loop"));

  // -ss after -i decodes to the exact timestamp. Before -i it seeks on keyframes, which is
  // fast and lands on the wrong frame, which is not acceptable for a docs screenshot.
  const frameArgs = buildFrameArgs("in.mp4", 1.5, "out.png");
  check("a docs frame seeks accurately, not to the nearest keyframe", frameArgs.indexOf("-i") < frameArgs.indexOf("-ss"));

  check("a beat's screenshot comes from its midpoint", beatMidpointSeconds({ id: "b", start: 30, duration: 60 }, 30) === 2);

  check("every store device has real dimensions", STORE_DEVICES["iphone-6.9"].width === 1290 && STORE_DEVICES["iphone-6.9"].height === 2796);
  const storeArgs = buildStoreFrameArgs("in.mp4", 1, "out.png", STORE_DEVICES["android-phone"], 32).join(" ");
  check("a store frame is padded to the exact canvas the store demands", storeArgs.includes("pad=1080:1920"));
  // Filling the canvas would crop away exactly the UI the screenshot exists to show.
  check("...and fits the shot rather than cropping it to fill", storeArgs.includes("force_original_aspect_ratio=decrease"));

  const index = buildScreenshotIndex("demo", [{ file: "01-hook.png", beat: { id: "hook", start: 0, duration: 90, vo: "What this beat says." } }]);
  check("the screenshot index pairs each shot with its narration", index.includes("![hook](./01-hook.png)") && index.includes("What this beat says."));
  check("...and says it is generated, so nobody hand-edits it", index.includes("overwritten"));
}

console.log("\n== Part 20: other renderers -- real ffmpeg runs ==");

if (fs.existsSync(path.join(tmpRoot, "out", "incremental.mp4"))) {
  const { runExportRendition } = require(path.join(distDir, "tools", "exportRendition.js"));
  const src = path.join("out", "incremental.mp4");

  const gif = await runExportRendition({
    projectRoot: tmpRoot,
    videoName: "inctest",
    format: "gif",
    inPath: src,
    outPath: path.join("out", "inctest.gif"),
    width: 320,
    fps: 8,
  });
  check("the GIF export produces a real gif", fs.existsSync(path.join(tmpRoot, gif.files[0])));
  check("...and reports its size, since a README GIF that is too big is a real problem", gif.notes.join(" ").includes("MB"));
  // The palette is an intermediate, not an artefact. Leaving it behind next to the gif
  // would be litter in someone's output directory.
  check("...and cleans up the palette it generated", !fs.existsSync(path.join(tmpRoot, "out", "inctest-palette.png")) && !fs.existsSync(path.join(tmpRoot, "output", "inctest-palette.png")));

  const shots = await runExportRendition({
    projectRoot: tmpRoot,
    videoName: "inctest",
    format: "screenshots",
    inPath: src,
    outDir: path.join("out", "shots"),
  });
  check("the screenshot export writes one frame per beat", shots.files.length === 3 && shots.files.every((f) => fs.existsSync(path.join(tmpRoot, f))));
  check("...and a docs index beside them", fs.existsSync(path.join(tmpRoot, shots.indexPath)));
  check(
    "...whose captions are the beats' own narration",
    fs.readFileSync(path.join(tmpRoot, shots.indexPath), "utf8").includes("Second beat of the incremental render test."),
  );

  const store = await runExportRendition({
    projectRoot: tmpRoot,
    videoName: "inctest",
    format: "store-frames",
    inPath: src,
    outDir: path.join("out", "store"),
    device: "android-phone",
    beatIds: ["two"],
  });
  check("the store export honours a beat selection", store.files.length === 1);
  try {
    const dims = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(tmpRoot, store.files[0])],
      { encoding: "utf8" },
    );
    check("...and produces exactly the store's dimensions", dims.includes("1080,1920"));
  } catch (err) {
    skip("...and produces exactly the store's dimensions", `ffprobe unavailable: ${err.message}`);
  }
} else {
  skip("Part 20: real rendition exports (entire section)", "Part 16 did not produce a video to export from");
}

console.log("\n== Part 21: frame comparison ==");

{
  const sharp = require("sharp");
  const { compareFrames, judgeDrift } = require(path.join(distDir, "frameDiff.js"));
  const { inferBindings } = require(path.join(distDir, "tools", "docsDrift.js"));

  const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-framediff-"));
  const flat = (r, g, b, width = 400, height = 300) =>
    sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png();

  const base = path.join(diffDir, "base.png");
  const same = path.join(diffDir, "same.png");
  const nudged = path.join(diffDir, "nudged.png");
  const repainted = path.join(diffDir, "repainted.png");
  const taller = path.join(diffDir, "taller.png");
  await flat(30, 30, 40).toFile(base);
  await flat(30, 30, 40).toFile(same);
  // Within the per-pixel threshold: this is the shape of encoder noise, which a useful
  // comparison has to ignore or it reports a difference on every single run.
  await flat(31, 31, 41).toFile(nudged);
  await flat(200, 40, 40).toFile(repainted);
  await flat(30, 30, 40, 400, 500).toFile(taller);

  const identical = await compareFrames(base, same);
  check("two identical frames compare as identical", identical.changedRatio === 0 && identical.meanDelta === 0);
  check("...and are not reported as resized", identical.resized === false);
  check("...and judge as unchanged", judgeDrift(identical).drifted === false);

  const noise = await compareFrames(base, nudged);
  check("a sub-threshold nudge moves no pixels past the threshold", noise.changedRatio === 0);
  check("...and still judges as unchanged, which is what stops every run flagging", judgeDrift(noise).drifted === false);

  const changed = await compareFrames(base, repainted);
  check("a repaint moves every pixel", changed.changedRatio === 1);
  check("...and judges as drifted", judgeDrift(changed).drifted === true);

  // A page that got taller has genuinely changed. Refusing to compare would hide the
  // finding behind a crash.
  const resized = await compareFrames(base, taller);
  check("a size change is reported rather than throwing", resized.resized === true);
  check("...and is drift on its own", judgeDrift(resized).drifted === true);

  const diffOut = path.join(diffDir, "out.diff.png");
  await compareFrames(base, repainted, { diffPath: diffOut });
  check("a diff image is written when asked for", fs.existsSync(diffOut));

  // Either signal alone is enough: a repainted button barely moves the mean, and a
  // palette shift barely moves the changed-pixel count.
  check(
    "a small mean shift alone still counts as drift",
    judgeDrift({ meanDelta: 0.05, changedRatio: 0, width: 10, height: 10, resized: false }).drifted === true,
  );

  const bindings = inferBindings([
    { id: "hook", visual: { captureMethod: "screenshot", url: "https://example.com/docs/start" } },
    { id: "panel", visual: { captureMethod: "dom-demo" } },
    { id: "term", visual: { captureMethod: "recording", source: "terminal" } },
    { id: "noUrl", visual: { captureMethod: "screenshot" } },
  ]);
  check("drift bindings are inferred from browser screenshot beats that carry a url", bindings.length === 1 && bindings[0].beatId === "hook");
  check("...and default to that beat's own capture as the reference", bindings[0].referencePath.includes("hook.png"));
}

console.log("\n== Part 22: visual regression against a real render ==");

if (fs.existsSync(path.join(tmpRoot, "out", "incremental.mp4"))) {
  const { runVisualRegression } = require(path.join(distDir, "tools", "visualRegression.js"));
  const src = path.join("out", "incremental.mp4");

  const first = await runVisualRegression({
    projectRoot: tmpRoot,
    videoName: "inctest",
    videoPath: src,
    baselineDir: path.join("out", "baseline"),
    outDir: path.join("out", "vdiff"),
  });
  // A check that fails its own first run, because there is nothing to compare against
  // yet, is a check people turn off.
  check("the first run writes a baseline instead of failing", first.baselineCreated === true && first.ok === true);
  check("...and says so in the comment it would post", first.markdown.includes("baseline created"));
  check("...and stored one frame per beat", ["one", "two", "three"].every((id) => fs.existsSync(path.join(tmpRoot, "out", "baseline", `${id}.png`))));

  const second = await runVisualRegression({
    projectRoot: tmpRoot,
    videoName: "inctest",
    videoPath: src,
    baselineDir: path.join("out", "baseline"),
    outDir: path.join("out", "vdiff"),
  });
  check("an unchanged render reports no visual change", second.ok === true && second.changedBeats.length === 0);
  check("...and the comment stays short when nothing happened", second.markdown.includes("No visual change"));

  // A hue rotation is a global change: it barely moves the changed-pixel count on a dark
  // frame but moves every pixel a little, which is exactly the case a pixel-count-only
  // check would miss.
  const shifted = path.join("out", "incremental-shifted.mp4");
  execFileSync(
    "ffmpeg",
    ["-nostdin", "-v", "error", "-i", path.join(tmpRoot, src), "-vf", "hue=h=120:s=2", "-c:a", "copy", path.join(tmpRoot, shifted), "-y"],
    { stdio: "inherit" },
  );
  const third = await runVisualRegression({
    projectRoot: tmpRoot,
    videoName: "inctest",
    videoPath: shifted,
    baselineDir: path.join("out", "baseline"),
    outDir: path.join("out", "vdiff"),
  });
  check("a recoloured render is caught", third.ok === false && third.changedBeats.length === 3);
  check("...and the comment names the beats and the numbers", third.markdown.includes("`two`") && third.markdown.includes("%"));
  check("...and a diff image exists for each", third.beats.every((b) => fs.existsSync(path.join(tmpRoot, b.diffFrame))));

  const accepted = await runVisualRegression({
    projectRoot: tmpRoot,
    videoName: "inctest",
    videoPath: shifted,
    baselineDir: path.join("out", "baseline"),
    outDir: path.join("out", "vdiff"),
    updateBaseline: true,
  });
  check("accepting the change updates the baseline", accepted.baselineUpdated === true);
  const afterAccept = await runVisualRegression({
    projectRoot: tmpRoot,
    videoName: "inctest",
    videoPath: shifted,
    baselineDir: path.join("out", "baseline"),
    outDir: path.join("out", "vdiff"),
  });
  check("...so the next run is clean", afterAccept.ok === true);
} else {
  skip("Part 22: visual regression (entire section)", "Part 16 did not produce a video to diff");
}

console.log("\n== Part 23: docs drift against a real page ==");

if (browserAvailable) {
  const http = await import("node:http");
  const { runDocsDrift } = require(path.join(distDir, "tools", "docsDrift.js"));
  const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));

  let pageBody = '<h1 style="font:700 48px sans-serif">Install</h1><p style="font:24px sans-serif">npm install the-thing</p>';
  const driftServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body style="margin:0;background:#ffffff">${pageBody}</body></html>`);
  });
  await new Promise((resolve) => driftServer.listen(0, "127.0.0.1", resolve));
  const driftUrl = `http://127.0.0.1:${driftServer.address().port}/`;
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-drift-test-"));

  try {
    // A real manifest, so the bindings can be inferred rather than handed over: the beat
    // already records the url it was captured from.
    const driftBeats = {
      fps: 30,
      title: "Drift",
      beats: [
        {
          id: "install",
          start: 0,
          duration: 90,
          vo: "The install page, captured straight from the docs.",
          visual: { captureMethod: "screenshot", url: driftUrl, interactions: [] },
        },
      ],
    };
    const driftWrite = runWriteBeatsFile({ projectRoot: driftRoot, videoName: "drift", beatsJson: driftBeats });
    check("the drift fixture passes validate_beats", driftWrite.written === true);

    await runCaptureScreenshot({ projectRoot: driftRoot, beatId: "install", url: driftUrl, viewport: { width: 800, height: 600 } });

    const clean = await runDocsDrift({ projectRoot: driftRoot, videoName: "drift" });
    check("a page that has not changed reports no drift", clean.ok === true && clean.checked === 1);
    check("...and says the clip still matches", clean.nextSteps.join(" ").includes("still match"));

    pageBody = '<h1 style="font:700 48px sans-serif">Install</h1><p style="font:24px sans-serif">pnpm add the-thing, the npm route is gone</p><div style="width:600px;height:300px;background:#c0392b"></div>';
    const drifted = await runDocsDrift({ projectRoot: driftRoot, videoName: "drift" });
    check("a changed page is caught", drifted.ok === false && drifted.driftedBeats.join(",") === "install");
    check("...with a diff image showing where", fs.existsSync(path.join(driftRoot, drifted.findings[0].diffPath)));
    // Knowing which beat is stale is only half of it; the point is that fixing it is now
    // one capture and one beat's worth of render, not a re-record.
    check("...and the next steps name the incremental re-render", drifted.nextSteps.join(" ").includes("incremental"));
  } finally {
    driftServer.close();
  }
} else {
  skip("Part 23: docs drift (entire section)", "real Chromium is not available in this environment");
}

console.log("\n== Part 24: multilingual narration ==");

{
  const narration = require(path.join(distDir, "tools", "generateNarration.js"));
  const { lineFor, sanitizeLanguage } = narration;
  const { validateBeatsLogic: validateLangBeats } = require(path.join(distDir, "tools", "validateBeats.js"));

  const beat = { id: "hook", duration: 90, vo: "The English line.", voTranslations: { hi: "The Hindi line.", "pt-BR": "The Brazilian line." } };
  check("the base language reads the beat's own vo", lineFor(beat, "en", "en") === "The English line.");
  check("another language reads its translation", lineFor(beat, "hi", "en") === "The Hindi line.");
  check("a language with no translation has no line, rather than falling back silently", lineFor(beat, "de", "en") === undefined);

  check("a regional tag is a valid language", sanitizeLanguage("pt-BR") === "pt-BR");
  let langRefusal = "";
  try {
    // The tag becomes a directory name, so it is checked before it is joined into a path.
    sanitizeLanguage("../../etc");
  } catch (err) {
    langRefusal = err instanceof Error ? err.message : String(err);
  }
  check("a path traversal dressed as a language tag is refused", langRefusal.includes("BCP-47"));

  const langBeat = (extra) => ({
    fps: 30,
    beats: [{ id: "b", start: 0, duration: 60, vo: "a short narration line here", visual: { captureMethod: "dom-demo" }, ...extra }],
  });
  check("a beat with translations validates", validateLangBeats(langBeat({ voTranslations: { hi: "kuch shabd yahan" } })).valid);
  check("...an empty translation is rejected", !validateLangBeats(langBeat({ voTranslations: { hi: "  " } })).valid);
  check("...a bad language key is rejected", !validateLangBeats(langBeat({ voTranslations: { "not a tag": "x" } })).valid);
  check("...and an em dash in a translation is caught too", !validateLangBeats(langBeat({ voTranslations: { hi: "kuch — shabd" } })).valid);
  // English pacing is an English number. The same sentence runs 20 to 30 percent longer in
  // German or Hindi, so holding a translation to it would reject correct translations.
  check(
    "a long translation is NOT held to the English words-per-second budget",
    validateLangBeats(langBeat({ voTranslations: { de: "ein deutlich laengerer deutscher satz mit sehr vielen zusaetzlichen woertern darin" } })).valid,
  );
}

console.log("\n== Part 25: one composition per language ==");

if (fs.existsSync(tempNodeModules)) {
  const langBeatsJson = {
    fps: 30,
    title: "Languages",
    beats: [
      { id: "one", start: 0, duration: 90, vo: "First beat of the multilingual narration test.", voTranslations: { hi: "pehla hissa is video ka" }, visual: { captureMethod: "dom-demo" } },
      { id: "two", start: 90, duration: 90, vo: "Second beat of the multilingual narration test.", voTranslations: { hi: "doosra hissa is video ka" }, visual: { captureMethod: "dom-demo" } },
    ],
  };
  const langWrite = runWriteBeatsFile({ projectRoot: tmpRoot, videoName: "langtest", beatsJson: langBeatsJson });
  check("the multilingual fixture passes validate_beats", langWrite.written === true);
  for (const id of ["one", "two"]) {
    runScaffoldScene({ projectRoot: tmpRoot, videoName: "langtest", beatId: id, kind: "dom-demo" });
  }

  // Real narration files rather than mocked paths: what is being tested is that the stitch
  // finds each language where generate_narration puts it.
  const voRoot = path.join(tmpRoot, "public", "audio", "vo");
  fs.mkdirSync(path.join(voRoot, "hi"), { recursive: true });
  for (const id of ["one", "two"]) {
    fs.writeFileSync(path.join(voRoot, `${id}.mp3`), "not really audio");
    fs.writeFileSync(path.join(voRoot, "hi", `${id}.mp3`), "not really audio");
  }

  const stitched = runStitchComposition({ projectRoot: tmpRoot, videoName: "langtest", languages: ["en", "hi"] });
  check("both languages are reported", stitched.languages.length === 2);
  check("the base language keeps the unsuffixed composition id", stitched.languages[0].compositionId === "LangtestDemo");
  check("...and another language gets its own composition", stitched.languages[1].compositionId === "LangtestDemoHi");
  check("each language found its own narration", stitched.languages.every((l) => l.voBeatsFound.length === 2));

  const demoSrc = fs.readFileSync(stitched.demoPath, "utf8");
  check("the generated file exports a component per language", demoSrc.includes("export const LangtestDemo:") && demoSrc.includes("export const LangtestDemoHi:"));
  // One scene tree, one audio map per language: duplicating the scene tree per language
  // would be a second copy of the thing most likely to be edited.
  check("...over a single shared scene tree", (demoSrc.match(/<Series>/g) || []).length === 1);
  check("...and points the Hindi cut at the Hindi directory", demoSrc.includes('"audio/vo/hi/one.mp3"'));
  check("...while the base cut keeps the flat path", demoSrc.includes('"audio/vo/one.mp3"'));

  const registry = JSON.parse(fs.readFileSync(path.join(tmpRoot, "src", "videos", ".registry.json"), "utf8"));
  check("Root.tsx registers both compositions", registry.filter((e) => e.videoName === "langtest").length === 2);

  // A missing translation has to fail the language it is missing from, not the whole
  // stitch: saying "narration is missing" once would hide which cut is broken.
  fs.rmSync(path.join(voRoot, "hi", "two.mp3"));
  let perLanguageRefusal = "";
  try {
    runStitchComposition({ projectRoot: tmpRoot, videoName: "langtest", languages: ["en", "hi"], requireNarration: true });
  } catch (err) {
    perLanguageRefusal = err instanceof Error ? err.message : String(err);
  }
  check("requireNarration fails on the language that is missing a line", perLanguageRefusal.includes("hi narration"));
  check("...and names the beat", perLanguageRefusal.includes("two"));

  // The generated multi-language component has to compile, which is the check that catches
  // a template bug no assertion on the string would.
  fs.writeFileSync(path.join(voRoot, "hi", "two.mp3"), "not really audio");
  runStitchComposition({ projectRoot: tmpRoot, videoName: "langtest", languages: ["en", "hi"] });
  try {
    const tscBin = path.join(tempNodeModules, ".bin", process.platform === "win32" ? "tsc.CMD" : "tsc");
    execFileSync(tscBin, ["--noEmit"], { cwd: tmpRoot, stdio: "inherit", shell: process.platform === "win32" });
    check("the multilingual composition typechecks", true);
  } catch (err) {
    check(`the multilingual composition typechecks (${err.message})`, false);
  }
} else {
  skip("Part 25: one composition per language (entire section)", `${tempNodeModules} not present`);
}

console.log("\n== Part 26: plan_shots ranks from real repo signal ==");

{
  const shots = require(path.join(distDir, "tools", "planShots.js"));
  const { parseReadmeFeatures, parseChangelogFeatures, discoverRoutes, countRouteMentions, summarizeChurn, shortTitle, overlaps, runPlanShots } = shots;

  const readme = [
    "# Thing",
    "Some intro prose that is not a feature.",
    "## Features",
    "- **Instant search.** Finds anything in the repo.",
    "- **Offline first.** No account needed.",
    "- Plain bullet with no bold lead",
    "## Install",
    "- npm install thing",
  ].join("\n");
  const features = parseReadmeFeatures(readme);
  // Order is the signal: the first feature is what the author thinks sells the project.
  check("features are read in the author's order", features.map((f) => f.rank).join(",") === "1,2,3");
  check("...a bold lead-in becomes the title", features[0].title === "Instant search");
  check("...a plain bullet still counts", features[2].title === "Plain bullet with no bold lead");
  // The install section is a list too, and it is not a feature list.
  check("...and bullets outside a feature heading are ignored", features.length === 3);

  const changelog = [
    "# Changelog",
    "## [1.4.0]",
    "### Added",
    "- Real-time collaboration",
    "- fix: a crash on startup",
    "### Fixed",
    "- Something else entirely",
    "## [1.3.0]",
    "### Added",
    "- An older feature that has had its moment",
  ].join("\n");
  const entries = parseChangelogFeatures(changelog);
  check("only the newest release is ranked", entries.length === 1 && entries[0].version === "1.4.0");
  // "We fixed a crash" is not a demo beat.
  check("...and fixes are not candidate shots", entries[0].title === "Real-time collaboration");

  const routes = discoverRoutes([
    "src/app/page.tsx",
    "src/app/(marketing)/pricing/page.tsx",
    "src/app/docs/[slug]/page.tsx",
    "src/app/api/health/route.ts",
    "pages/about.tsx",
    "pages/api/hook.ts",
  ]);
  check("routes are read out of the file tree", routes.includes("/pricing") && routes.includes("/about"));
  // A route group in parentheses is organisational and is not part of the URL.
  check("...with route groups stripped", !routes.some((r) => r.includes("(")));
  check("...and api handlers are not pages to film", !routes.some((r) => r.includes("api")));

  const mentions = countRouteMentions(["/pricing", "/about"], "see /pricing and /pricing again");
  check("docs links are counted per route", mentions["/pricing"] === 2 && mentions["/about"] === 0);

  const churn = summarizeChurn("commit abc\nsrc/search/index.ts\nsrc/search/rank.ts\ndocs/readme.md\n");
  check("recent work is summarized by directory", churn["src/search"] === 2);

  const longTitle = shortTitle("capture_desktop records a window, a region, or a whole display through ffmpeg on every platform");
  check("a long title is cut at a word, not mid-word", longTitle === "capture_desktop records a window, a region, or a whole display through");
  // Underscores survive: a changelog names capture_desktop far more often than it uses
  // underscore emphasis, and stripping them ran tool names together.
  check("...and a tool name keeps its underscore", longTitle.startsWith("capture_desktop"));
  // A single unbroken 90-character word has no word boundary to cut at, so the hard cut
  // is the only honest option rather than returning nothing.
  check("...and a title with no word boundary is still cut", shortTitle("b".repeat(90)).length === 72);
  check("overlapping titles merge rather than compete", overlaps("Instant search", "the search page") === true);
  check("...and unrelated ones do not", overlaps("Instant search", "billing portal") === false);

  // A real run against this repository, which has a README feature list, a changelog, no
  // routes, and a package that ships a bin.
  const real = await runPlanShots({ repoRoot: path.join(packageRoot, "..", ".."), maxShots: 5 });
  check("a real repo produces a ranked list", real.candidates.length === 5);
  check("...in descending order", real.candidates.every((c, i) => i === 0 || real.candidates[i - 1].score >= c.score));
  check("...every candidate carries its evidence", real.candidates.every((c) => c.evidence.length > 0));
  check("...the README's first feature outranks its fourth", real.candidates[0].evidence.join(" ").includes("first"));
  // A thin result should be explained rather than mysterious.
  check("...and missing signals are named", real.signalsMissing.some((m) => m.includes("routes")));
  // This repo has no routes and does ship a command, so recommending a reconstructed panel
  // would be recommending a fake of something that can be filmed for real.
  check("...a browserless repo is not told to reconstruct panels", real.candidates.every((c) => c.suggestedCapture !== "dom-demo"));
  check("...and the notes say plan_shots feeds the intake rather than replacing it", real.notes.join(" ").includes("PLANNING.md"));
}

console.log("\n== Part 27: release diff ==");

{
  const rel = require(path.join(distDir, "tools", "releaseDiff.js"));
  const { routeSlug, routesFromDiff, buildDraftManifest } = rel;

  check("a route becomes a usable beat id", routeSlug("/docs/getting-started") === "docs-getting-started");
  check("...and the root route is named rather than empty", routeSlug("/") === "home");

  const allRoutes = ["/", "/pricing", "/docs"];
  check(
    "a changed page names its own route",
    routesFromDiff(["src/app/pricing/page.tsx"], allRoutes).join(",") === "/pricing",
  );
  // A shared component has no route of its own and can repaint every page, so guessing at
  // an import graph would be less reliable than checking all of them and letting the visual
  // comparison narrow it down.
  check(
    "a shared component makes every route a candidate",
    routesFromDiff(["src/components/Button.tsx"], allRoutes).length === 3,
  );
  check(
    "a release that touches no source touches no routes",
    routesFromDiff(["README.md", "package-lock.json"], allRoutes).length === 0,
  );

  const draft = buildDraftManifest({
    videoName: "rel",
    beforeRef: "v1.0.0",
    afterRef: "v1.1.0",
    changes: [{ route: "/pricing", beforePath: "a.png", afterPath: "b.png" }],
    fps: 30,
    beatFrames: 90,
  });
  check("the draft pairs a before and an after per route", draft.beats.length === 2);
  check("...contiguously, the way validate_beats requires", draft.beats[0].start === 0 && draft.beats[1].start === 90);
  // The before frame cannot be re-captured from a live URL once the release is out, and
  // existing-asset is what that honestly is.
  check("...as existing-asset beats", draft.beats.every((b) => b.visual.captureMethod === "existing-asset"));
  check("...attributed to the ref each came from", draft.beats[0].visual.attribution.includes("v1.0.0") && draft.beats[1].visual.attribution.includes("v1.1.0"));
  // Writing narration is drafting content, which this server does not do: the approval gate
  // exists so a human sees the words before they are spoken over their product.
  check("...with the narration left for a human", draft.beats.every((b) => b.vo === ""));
  check("...and the draft says how many words fit", draft.suggestedWordsPerBeat === 8);
  check("...and marks itself unfinished", draft.draft === true);
}

console.log("\n== Part 28: release diff against two real running versions ==");

if (browserAvailable) {
  const http = await import("node:http");
  const { runReleaseDiff } = require(path.join(distDir, "tools", "releaseDiff.js"));

  const page = (body) => `<!doctype html><html><body style="margin:0;background:#fff;font:24px sans-serif">${body}</body></html>`;
  const serve = (html) =>
    new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        // Both versions serve every path, so /pricing and /about differ only by content.
        res.end(html(req.url));
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });

  const before = await serve((url) => page(url === "/pricing" ? "<h1>Pricing</h1><p>Free and Pro.</p>" : "<h1>About</h1><p>Unchanged page.</p>"));
  const after = await serve((url) =>
    url === "/pricing"
      ? page('<h1>Pricing</h1><p>Free, Pro and Team.</p><div style="width:700px;height:400px;background:#2d7"></div>')
      : page("<h1>About</h1><p>Unchanged page.</p>"),
  );
  const relRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-release-test-"));

  try {
    const result = await runReleaseDiff({
      projectRoot: relRoot,
      videoName: "rel",
      repoRoot: relRoot,
      beforeRef: "v1.0.0",
      afterRef: "v1.1.0",
      beforeUrl: `http://127.0.0.1:${before.address().port}`,
      afterUrl: `http://127.0.0.1:${after.address().port}`,
      routes: ["/pricing", "/about"],
      viewport: { width: 800, height: 600 },
    });

    check("both routes were captured on both sides", result.routes.length === 2);
    check("the changed route is caught", result.changedRoutes.join(",") === "/pricing");
    // The filtering is the important half: a what's-new clip showing identical pages is
    // worse than no clip at all.
    check("...and the unchanged one is dropped, not filmed", !result.changedRoutes.includes("/about"));
    check("...with the numbers reported either way", result.routes.every((r) => typeof r.changedRatio === "number"));
    check("a diff image exists for each route", result.routes.every((r) => fs.existsSync(path.join(relRoot, r.diffPath))));

    const draft = JSON.parse(fs.readFileSync(path.join(relRoot, result.draftPath), "utf8"));
    check("the draft manifest only covers what changed", draft.beats.length === 2);
    check("...and its assets are the real captures on disk", draft.beats.every((b) => fs.existsSync(path.join(relRoot, b.visual.assetPath))));
    // The draft is a draft: this tool does not install a manifest and does not write the
    // script.
    check("the draft is not installed as the video's beats.json", !fs.existsSync(path.join(relRoot, "src", "videos", "rel", "beats.json")));
    check("the next steps send it through the approval gate", result.nextSteps.join(" ").includes("write_beats_file"));
  } finally {
    before.close();
    after.close();
  }
} else {
  skip("Part 28: release diff (entire section)", "real Chromium is not available in this environment");
}

console.log("\n== Part 29: scene templates, from a real production run ==");

{
  const tpl = require(path.join(distDir, "scenes", "templates.js"));
  const { captionLine, renderTemplate } = tpl;

  // A hard slice(0, 70) put "This is their real installer, rec" on screen in a real video.
  check(
    "a caption prefers the first whole sentence when the line is too long for one",
    captionLine(
      "A terminal is not a web page either. This is their real installer, recorded as text rather than pixels.",
    ) === "A terminal is not a web page either.",
  );
  // 79 characters: it fits, so it is not cut at all. The rule is "cut well when you must",
  // not "always cut".
  check(
    "a line that fits is left whole",
    captionLine("Omarchy is a Linux distribution. No localhost, no browser, nothing to point at.") ===
      "Omarchy is a Linux distribution. No localhost, no browser, nothing to point at.",
  );
  check("a short line is left alone", captionLine("Short enough already.") === "Short enough already.");
  const long = "Forty thousand stars read live from the GitHub API during this particular recording session";
  const noStop = captionLine(long);
  check("a long line with no sentence break is cut", noStop.length <= 82 && noStop.length < long.length);
  check("...at a word boundary, never mid-word", long.startsWith(noStop) && !long.slice(noStop.length).startsWith("x"));
  check("...and the cut lands on a space in the original", long[noStop.length] === " ");

  // The browser template sized the frame to nearly fill the stage and then pushed the
  // camera to 1.78 anyway, so validate_scenes rejected what scaffold_scene had just
  // written. A 1440x900 capture is CAPTURE.md's own default viewport, which made this the
  // commonest path through the tool rather than an edge case.
  const src = renderTemplate("browser-capture", {
    beatId: "shot",
    componentName: "Shot",
    vo: "A line of narration for this beat.",
    durationFrames: 150,
    captureWidth: 1440,
    captureHeight: 900,
    url: "https://example.com",
  }, "real-screenshot");
  const frameW = Number(/const FRAME_W = (\d+)/.exec(src)[1]);
  const frameH = Number(/const FRAME_H = (\d+)/.exec(src)[1]);
  const scales = [...src.matchAll(/scale: ([\d.]+)/g)].map((m) => Number(m[1]));
  const maxScale = Math.max(...scales);
  check("the browser template still pushes in", scales.length >= 2 && maxScale > Math.min(...scales));
  check("...but never past the point where the frame gets cropped", frameW <= 1920 / maxScale && frameH <= 1080 / maxScale);

  // Same check against a capture wide enough that the old fixed 1.78 was fine, so the fix
  // did not just clamp every scene to a near-static camera.
  const small = renderTemplate("browser-capture", {
    beatId: "shot",
    componentName: "Shot",
    vo: "A line of narration for this beat.",
    durationFrames: 150,
    captureWidth: 800,
    captureHeight: 600,
    url: "https://example.com",
  }, "real-screenshot");
  const smallScales = [...small.matchAll(/scale: ([\d.]+)/g)].map((m) => Number(m[1]));
  check("a small capture still gets a real push-in", Math.max(...smallScales) >= 1.3);
}

console.log("\n== Part 30: capture_terminal bounds an unshowable output ==");

{
  const { recordTerminal } = require(path.join(packageRoot, "..", "capture", "dist", "terminal.js"));

  // The real case: fetching one project's installer returned 169,000 characters, which at
  // any watchable typing speed is over an hour of screen time for a seven second beat.
  const bounded = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(50000));"],
    cwd: packageRoot,
    mode: "pipe",
    maxOutputChars: 900,
  });
  const text = bounded.cast.events.map(([, , t]) => t).join("");
  check("output is cut at the bound", bounded.truncated === true);
  check("...close to the bound, not a whole chunk past it", text.length < 1100);
  // Cutting mid-chunk matters: a single write can be the entire file, so dropping the
  // chunk (what the memory cap does) would record nothing at all here.
  check("...and what was kept is real output, not an empty cast", text.startsWith("xxxx"));
  check("...with the truncation visible on screen", text.includes("truncated"));

  const unbounded = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdout.write('hello');"],
    cwd: packageRoot,
    mode: "pipe",
  });
  check("no bound means no change in behaviour", unbounded.truncated === false);
}

console.log(`\n${failures === 0 ? `ALL CHECKS PASSED (${skipped} skipped)` : `${failures} CHECK(S) FAILED (${skipped} skipped)`}`);
console.log(`temp project left at: ${tmpRoot}`);
process.exitCode = failures === 0 ? 0 : 1;

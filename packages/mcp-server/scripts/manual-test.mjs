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
const utilSrc = fs.readFileSync(path.join(packageRoot, "src", "util.ts"), "utf8");
check("renderVideo.ts never calls exec/execSync", !/\bexec(Sync)?\(/.test(renderSrc));
check("qcExtractFrames.ts never calls exec/execSync", !/\bexec(Sync)?\(/.test(qcSrc));
// Task 4 (real end-to-end pipeline run) found spawnCapture's old blanket shell:false threw a
// synchronous EINVAL for npx.cmd on this repo's actual Windows/Node runtime -- Node does not
// transparently shell out for a .cmd/.bat target the way the old comment here assumed. Fixed
// by routing exactly that one Windows-shim case through shell:true (util.ts's WINDOWS_SHIM_RE),
// still always via an argv array, never an interpolated shell string, and still behind the same
// DANGEROUS_CHARS sanitization every path/id reaching this function already passes through. This
// check now pins the narrower, actually-correct invariant instead of the always-false claim.
check(
  "util.ts's spawnCapture always uses an argv array (never exec/execSync), and only sets shell:true for the win32 .cmd/.bat shim case",
  /const child = spawn\(command, finalArgs, \{ cwd, shell \}\)/.test(utilSrc) &&
    /WINDOWS_SHIM_RE\.test\(command\)/.test(utilSrc) &&
    !/\bexec(Sync)?\(/.test(utilSrc),
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
  const normalResult = await runRenderVideo({ projectRoot: tmpRoot, videoName: "rendertest", outPath: normalOutRel });
  check(
    "render_video real invocation succeeds for a normal (no-space) outPath, on this platform " +
      `(${process.platform})`,
    normalResult.success === true && fs.existsSync(normalResult.outPath),
  );
  const normalStream = ffprobeHasVideoStream(normalResult.outPath);
  if (normalStream !== null) {
    check("render_video's normal-path output is a real mp4 with a video stream (ffprobe)", normalStream === true);
  }

  const spacedOutRel = path.join("out", "render test with space.mp4");
  const spacedResult = await runRenderVideo({ projectRoot: tmpRoot, videoName: "rendertest", outPath: spacedOutRel });
  check(
    "render_video real invocation succeeds for a SPACE-containing outPath " +
      "(win32 shell:true arg-quoting regression pin)",
    spacedResult.success === true && fs.existsSync(spacedResult.outPath),
  );
  const spacedStream = ffprobeHasVideoStream(spacedResult.outPath);
  if (spacedStream !== null) {
    check("render_video's space-path output is a real mp4 with a video stream (ffprobe)", spacedStream === true);
  }
} else {
  console.log(
    `  (skipped: ${tempNodeModules} not present -- Part 4's node_modules symlink didn't succeed, run pnpm install at the monorepo root first)`,
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
const planningMd = fs.readFileSync(planningMdPath, "utf8");
const jsonFenceMatch = planningMd.match(/```json\n([\s\S]*?)\n```/);
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

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
console.log(`temp project left at: ${tmpRoot}`);
process.exitCode = failures === 0 ? 0 : 1;

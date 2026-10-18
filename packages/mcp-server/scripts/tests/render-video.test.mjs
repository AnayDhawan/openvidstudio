#!/usr/bin/env node
// render-video: Part 3#2, Part 4b, Part 10, Part 10b (split out of the former single manual-test.mjs; see _harness.mjs)

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
// A6: frame-index extraction (select=eq(n,N)), never a bare timestamp seek -- see
// buildFfmpegFrameArgs's own doc comment for why sample-time seeking causes an off-by-one.
// fps=30, target frame 75: a 1s (30-frame) margin puts the coarse seek at frame 45 (1.5s
// exactly), and N is that same margin (30), landing on frame 45+30=75.
const ffArgs = buildFfmpegFrameArgs("out/demo.mp4", 75, 30, "out/qc/demo/hook-mid.jpg");
check(
  "buildFfmpegFrameArgs returns a frame-index argv array (coarse -ss, then select=eq(n,N))",
  JSON.stringify(ffArgs) ===
    JSON.stringify([
      "-nostdin", "-ss", "1.500000", "-i", "out/demo.mp4",
      "-vf", "select=eq(n\\,30)", "-vsync", "0",
      "-frames:v", "1", "-q:v", "3", "out/qc/demo/hook-mid.jpg", "-y",
    ]),
);
// Near the start of the file, the margin can't reach a full second back -- it's clamped to
// the target frame itself, so the coarse seek never goes negative.
const ffArgsNearStart = buildFfmpegFrameArgs("out/demo.mp4", 10, 30, "out/qc/demo/hook-mid.jpg");
check(
  "buildFfmpegFrameArgs clamps the margin near frame 0 (no negative seek)",
  JSON.stringify(ffArgsNearStart) ===
    JSON.stringify([
      "-nostdin", "-ss", "0.000000", "-i", "out/demo.mp4",
      "-vf", "select=eq(n\\,10)", "-vsync", "0",
      "-frames:v", "1", "-q:v", "3", "out/qc/demo/hook-mid.jpg", "-y",
    ]),
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
  /const child = spawn\(finalCommand, finalArgs, \{ cwd, shell \}\)/.test(spawnSrc) &&
    /WINDOWS_SHIM_RE\.test\(command\)/.test(spawnSrc) &&
    !/\bexec(Sync)?\(/.test(spawnSrc),
);

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

finish();

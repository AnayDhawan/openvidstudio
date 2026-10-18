#!/usr/bin/env node
// reformat-vertical: Part 17 (split out of the former single manual-test.mjs; see _harness.mjs)

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
setQuiet(false);
// ---- checks ----

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

finish();

#!/usr/bin/env node
// diff-beats: Part 9 (split out of the former single manual-test.mjs; see _harness.mjs)

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

finish();

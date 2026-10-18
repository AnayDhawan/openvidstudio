#!/usr/bin/env node
// stitch-composition: Part 34, Part 50 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 34: narration:\"none\", onScreenText, musicBed volume, overrides.tsx (A8) ==");
{
  const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
  const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));

  // narration: "none" -- vo may be omitted, onScreenText is checked for reading time instead.
  const okNone = validateBeatsLogic({
    fps: 30,
    narration: "none",
    beats: [
      {
        id: "hook",
        start: 0,
        duration: 60, // 2s at 30fps: 6 words / 3.5 + 0.8 = 2.51s needed... see next case
        visual: { captureMethod: "dom-demo" },
        onScreenText: "Fast, quiet, and free.",
      },
    ],
  });
  check("narration:none with no vo and a fitting onScreenText validates", okNone.valid === true);

  const tooFast = validateBeatsLogic({
    fps: 30,
    narration: "none",
    beats: [
      {
        id: "hook",
        start: 0,
        duration: 30, // 1s -- nowhere near enough to read the line below
        visual: { captureMethod: "dom-demo" },
        onScreenText: "This on-screen card carries a lot more words than one second can hold.",
      },
    ],
  });
  check(
    "narration:none rejects onScreenText that outruns the reading-time budget",
    tooFast.valid === false && tooFast.errors.some((e) => e.includes("onScreenText needs at least")),
  );

  const stillNeedsVo = validateBeatsLogic({
    fps: 30,
    beats: [{ id: "hook", start: 0, duration: 60, visual: { captureMethod: "dom-demo" } }],
  });
  check(
    "narration omitted (defaults to \"voice\") still requires vo -- unchanged behavior",
    stillNeedsVo.valid === false && stillNeedsVo.errors.some((e) => e.includes(`missing or invalid "vo"`)),
  );

  // Real stitch: music bed defaults to full level with no narration, and can be overridden.
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a8-"));
  const videoName = "silent";
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "public", "audio"), { recursive: true });
  fs.writeFileSync(
    path.join(videoDir, "beats.json"),
    JSON.stringify({
      fps: 30,
      narration: "none",
      beats: [
        { id: "hook", start: 0, duration: 60, visual: { captureMethod: "dom-demo" }, onScreenText: "Made with itself." },
        { id: "cta", start: 60, duration: 90, visual: { captureMethod: "dom-demo" }, onScreenText: "Try it today." },
      ],
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(projectRoot, "public", "audio", "music-bed.mp3"), Buffer.from([0]));

  const stitched = runStitchComposition({ projectRoot, videoName });
  check("music-only stitch reports the bed found", stitched.musicBedFound === true && stitched.musicBedFile === "music-bed.mp3");
  check("...at full volume by default with no narration", stitched.musicBedVolume === 1);
  const demoContent1 = fs.readFileSync(stitched.demoPath, "utf8");
  check("...and the generated composition actually carries volume={1}", demoContent1.includes("volume={1}"));

  const stitchedCustom = runStitchComposition({ projectRoot, videoName, musicBed: { file: "music-bed.mp3", volume: 0.42 } });
  check("musicBed.volume overrides the default", stitchedCustom.musicBedVolume === 0.42);
  const demoContentCustom = fs.readFileSync(stitchedCustom.demoPath, "utf8");
  check("...reflected in the generated composition", demoContentCustom.includes("volume={0.42}"));

  // overrides.tsx: a hand-authored extension point that must survive re-stitching untouched.
  const overridesPath = path.join(videoDir, "overrides.tsx");
  const overridesMarker = "export default function Overrides() { return <div data-testid=\"ovs-override-marker\" />; }\n";
  fs.writeFileSync(overridesPath, `import React from "react";\n${overridesMarker}`, "utf8");

  const withOverrides = runStitchComposition({ projectRoot, videoName });
  check("overrides.tsx present is reported", withOverrides.overridesApplied === true);
  const demoWithOverrides = fs.readFileSync(withOverrides.demoPath, "utf8");
  check(
    "...and wired into the generated composition",
    demoWithOverrides.includes('import Overrides from "./overrides";') && demoWithOverrides.includes("<Overrides />"),
  );

  const overridesBefore = fs.readFileSync(overridesPath, "utf8");
  const restitched = runStitchComposition({ projectRoot, videoName }); // as if a caption were edited
  const overridesAfter = fs.readFileSync(overridesPath, "utf8");
  check("re-stitching never touches overrides.tsx's own content", overridesBefore === overridesAfter);
  const demoAfterRestitch = fs.readFileSync(restitched.demoPath, "utf8");
  check(
    "...and the override still survives being wired into the re-stitched composition",
    demoAfterRestitch.includes("<Overrides />"),
  );
}

console.log("\n== Part 50: stitch_composition's per-beat scene override, and its shape check (C5) ==");
{
  const c5StitchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c5-stitch-"));
  const videoDir = path.join(c5StitchRoot, "src", "videos", "c5-stitch");
  const scenesDir = path.join(videoDir, "scenes");
  const customDir = path.join(videoDir, "custom-scenes");
  fs.mkdirSync(scenesDir, { recursive: true });
  fs.mkdirSync(customDir, { recursive: true });
  fs.writeFileSync(
    path.join(scenesDir, "ConventionalShot.tsx"),
    `import React from "react";\nexport const ConventionalShot: React.FC = () => null;\n`,
  );
  fs.writeFileSync(
    path.join(customDir, "CustomPathShot.tsx"),
    `import React from "react";\nexport const CustomPathShot: React.FC = () => null;\n`,
  );
  fs.writeFileSync(
    path.join(videoDir, "beats.json"),
    JSON.stringify({
      fps: 30,
      beats: [
        { id: "conventional-shot", start: 0, duration: 90 },
        { id: "custom-path-shot", start: 90, duration: 90, scene: "./custom-scenes/CustomPathShot.tsx" },
      ],
    }),
  );

  const stitched = runStitchComposition({ projectRoot: c5StitchRoot, videoName: "c5-stitch" });
  check("stitch_composition succeeds with a mix of conventional and overridden scene paths", stitched.written === true);
  const demoSrc = fs.readFileSync(path.join(videoDir, "C5StitchDemo.tsx"), "utf8");
  check(
    "a beat with no scene override still imports from the ./scenes/<PascalId> convention",
    demoSrc.includes('import { ConventionalShot } from "./scenes/ConventionalShot";'),
  );
  check(
    "a beat with a scene override imports from that exact path instead, extension stripped",
    demoSrc.includes('import { CustomPathShot } from "./custom-scenes/CustomPathShot";'),
  );
  check(
    "...and the custom path is never imported from the conventional scenes/ location",
    !demoSrc.includes('"./scenes/CustomPathShot"'),
  );

  // Path-traversal guard: a scene override that escapes the video directory must throw,
  // not silently generate an import pointing outside the project.
  const escapeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c5-stitch-escape-"));
  const escapeVideoDir = path.join(escapeRoot, "src", "videos", "escape-demo");
  fs.mkdirSync(escapeVideoDir, { recursive: true });
  fs.writeFileSync(
    path.join(escapeVideoDir, "beats.json"),
    JSON.stringify({ fps: 30, beats: [{ id: "escaping-shot", start: 0, duration: 90, scene: "../../../outside" }] }),
  );
  let escapeThrew = false;
  let escapeMessage = "";
  try {
    runStitchComposition({ projectRoot: escapeRoot, videoName: "escape-demo" });
  } catch (err) {
    escapeThrew = true;
    escapeMessage = String(err.message);
  }
  check(
    `a beat's scene path escaping the video directory throws instead of generating a bad import (got: ${escapeMessage || "no throw"})`,
    escapeThrew && /escaping-shot/.test(escapeMessage) && /project root/.test(escapeMessage),
  );

  const { validateBeatsLogic: validateC5SceneBeats } = require(path.join(distDir, "tools", "validateBeats.js"));
  const sceneBeat = (scene) => ({
    fps: 30,
    // 12 words over 150 frames at 30fps (5.0s) is 2.4 words/sec, inside SCRIPT.md's
    // 2.3-2.9 budget -- this is a fixture for the scene field, not a VO-pacing test.
    // visual is required on every beat regardless of a scene override (PLANNING.md S4).
    beats: [{
      id: "b1", start: 0, duration: 150,
      vo: "A line that holds the pace this beat needs for its length.",
      visual: { captureMethod: "dom-demo" },
      scene,
    }],
  });
  check("validate_beats accepts a beat with a real, non-empty scene override", validateC5SceneBeats(sceneBeat("./scenes/B1.tsx")).valid);
  check(
    "validate_beats rejects an empty-string scene override",
    !validateC5SceneBeats(sceneBeat("")).valid && validateC5SceneBeats(sceneBeat("")).errors.some((e) => e.includes("scene")),
  );
  check(
    "validate_beats rejects a non-string scene override",
    !validateC5SceneBeats(sceneBeat(123)).valid && validateC5SceneBeats(sceneBeat(123)).errors.some((e) => e.includes("scene")),
  );
  check("validate_beats doesn't require scene at all (omitted is fine)", validateC5SceneBeats(sceneBeat(undefined)).valid);
}

finish();

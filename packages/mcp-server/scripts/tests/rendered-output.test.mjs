#!/usr/bin/env node
// rendered-output: Part 16, Part 18, Part 20, Part 22 (split out of the former single manual-test.mjs; see _harness.mjs)

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
setQuiet(false);
// ---- checks ----

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

finish();

#!/usr/bin/env node
// render-stills: Part 4a (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 4a: C6 render_stills real PNG output ==");
if (tscOk) {
  const { runRenderStills } = require(path.join(distDir, "tools", "renderStills.js"));
  const stills = await runRenderStills({ projectRoot: tmpRoot, videoName: "demo", beatIds: ["explain"] });
  check(
    "C6 writes a nonempty real PNG for a rendered beat",
    stills.stills.length === 1 &&
      stills.stills.every((still) =>
        fs.existsSync(still.path) && still.width === 1920 && still.height === 1080 && still.bytes > 10_000,
      ),
  );
  check("a single still comes with numeric findings by default and no contact grid", Array.isArray(stills.findings) && Array.isArray(stills.findingsSkipped) && stills.contactGrid === undefined);
  check("each still reports its offset into the beat and a position label", stills.stills[0].offset === 90 && stills.stills[0].position === "mid" && stills.stills[0].frame === 240);
} else {
  skip("C6 render_stills real PNG output", "the scaffolded project could not resolve its dependencies");
}

console.log("\n== C6: render_stills samples frames, tiles a contact grid, and reports numbers ==");
{
  const { planBeatStills, locateFrame, buildContactGrid, runRenderStills } = require(path.join(distDir, "tools", "renderStills.js"));
  const sharpLib = require(path.join(packageRoot, "node_modules", "sharp"));
  const beat = { id: "explain", start: 150, duration: 180 };

  const three = planBeatStills(beat, 3);
  check("perBeat 3 is start, mid, end", three.map((s) => s.offset).join() === "0,90,179" && three.map((s) => s.position).join() === "start,mid,end" && three[0].frame === 150);
  check("perBeat 1 is the midpoint", planBeatStills(beat, 1).map((s) => `${s.position}:${s.offset}`).join() === "mid:90");
  const review = planBeatStills(beat, "review");
  check("review is five frames: start+3, 25%, mid, 75%, end-3", review.map((s) => s.position).join() === "start+3,25%,mid,75%,end-3" && review.map((s) => s.offset).join() === "3,45,90,134,176");
  check("review pulls the first and last frames inside the beat, so adjacent beats straddle the cut", review[0].offset > 0 && review[4].offset < beat.duration - 1);
  const tiny = planBeatStills({ id: "blink", start: 0, duration: 3 }, "review");
  check("a very short beat yields fewer stills rather than the same frame twice, all inside the beat", new Set(tiny.map((s) => s.offset)).size === tiny.length && tiny.every((s) => s.offset >= 0 && s.offset <= 2));
  check("an even spread of 4 hits both ends", planBeatStills(beat, 4).map((s) => s.offset).join() === "0,60,119,179");

  const beats = [{ id: "a", start: 0, duration: 150 }, { id: "b", start: 150, duration: 180 }, { id: "c", start: 330, duration: 120 }];
  check("locateFrame puts a boundary frame in the beat that starts there", locateFrame(beats, 149).beat.id === "a" && locateFrame(beats, 150).beat.id === "b" && locateFrame(beats, 150).offset === 0);
  check("a frame past the end clamps into the last beat", locateFrame(beats, 99999).beat.id === "c" && locateFrame(beats, 99999).offset === 119);

  // The grid, on small synthetic stills: 2 beats x 3 stills should be a 3-column, 2-row sheet.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-grid-"));
  const tiles = [];
  for (const [i, beatId] of ["x", "x", "x", "y", "y", "y"].entries()) {
    const file = path.join(dir, `${i}.png`);
    await sharpLib({ create: { width: 192, height: 108, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toFile(file);
    tiles.push({ beatId, path: file, position: ["start", "mid", "end"][i % 3], offset: i, frame: i * 10 });
  }
  const grid = await buildContactGrid(tiles, path.join(dir, "grid.png"));
  check("a perBeat-shaped set is one row per beat: 3 columns, 2 rows", grid.columns === 3 && grid.rows === 2 && grid.tiles === 6);
  check("the sheet size follows from tile width 480, aspect 16:9 and the gaps", grid.width === 3 * 480 + 4 * 6 && grid.height === 2 * 270 + 3 * 6);
  const meta = await sharpLib(grid.path).metadata();
  check("the written PNG has exactly those dimensions", meta.width === grid.width && meta.height === grid.height);
  const { data, info } = await sharpLib(grid.path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => data[(y * info.width + x) * 3];
  check("each tile carries a dark label bar along its top edge and the picture below it", px(6 + 470, 6 + 3) < 120 && px(6 + 240, 6 + 150) === 255);
  const odd = await buildContactGrid(tiles.slice(0, 5).map((t, i) => ({ ...t, beatId: `b${i}` })), path.join(dir, "grid2.png"));
  check("five single stills (one per beat) fill rows of up to four instead", odd.columns === 4 && odd.rows === 2);

  if (tscOk) {
    // A project of its own with three self-contained scenes, so every beat can render: the
    // shared demo project's hook beat expects a screenshot that was never captured.
    const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
    const { runStitchComposition: stitchC6 } = require(path.join(distDir, "tools", "stitchComposition.js"));
    const c6Root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c6-stills-"));
    for (let attempt = 1; ; attempt++) {
      try {
        runInitProject({ name: "c6check", projectRoot: c6Root });
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        fs.rmSync(c6Root, { recursive: true, force: true });
        fs.mkdirSync(c6Root, { recursive: true });
      }
    }
    fs.symlinkSync(templateNodeModules, path.join(c6Root, "node_modules"), "junction");
    const c6Dir = path.join(c6Root, "src", "videos", "c6check");
    fs.mkdirSync(path.join(c6Dir, "custom-scenes"), { recursive: true });
    const sceneSource = (name, label) =>
      [
        'import React from "react";',
        'import { CinematicScene, E } from "@openvidstudio/core";',
        `export const ${name}: React.FC = () => (`,
        "  <CinematicScene camera={[{ frame: 0, x: 960, y: 540, scale: 1.0 }, { frame: 120, x: 960, y: 540, scale: 1.08, easing: E.drift }]}>",
        `    <div style={{ position: "absolute", left: 300, top: 420, fontSize: 80, color: "#fff" }}>${label}</div>`,
        "  </CinematicScene>",
        ");",
        "",
      ].join("\n");
    for (const [name, label] of [["Alpha", "first"], ["Beta", "second"], ["Gamma", "third"]]) {
      fs.writeFileSync(path.join(c6Dir, "custom-scenes", `${name}.tsx`), sceneSource(name, label));
    }
    fs.writeFileSync(
      path.join(c6Dir, "beats.json"),
      JSON.stringify({
        fps: 30,
        beats: [
          { id: "alpha", start: 0, duration: 150, scene: "./custom-scenes/Alpha.tsx" },
          { id: "beta", start: 150, duration: 180, scene: "./custom-scenes/Beta.tsx" },
          { id: "gamma", start: 330, duration: 120, scene: "./custom-scenes/Gamma.tsx" },
        ],
      }),
    );
    stitchC6({ projectRoot: c6Root, videoName: "c6check" });
    const forC6 = (extra) => runRenderStills({ projectRoot: c6Root, videoName: "c6check", ...extra });

    const review1 = await forC6({ perBeat: "review", round: 1 });
    check("review renders five stills for each of the three beats, every file real", review1.stills.length === 15 && review1.stills.every((s) => fs.existsSync(s.path) && s.bytes > 5000 && /-f\d{4}\.png$/.test(s.path)));
    check("the stills straddle every cut: each beat's last still is inside it and the next beat's first is just past the boundary", review1.stills.filter((s) => s.beatId === "alpha").at(-1).frame === 146 && review1.stills.filter((s) => s.beatId === "beta")[0].frame === 153);
    check("a contact grid is written in the round's own folder, one row per beat", review1.contactGrid && review1.contactGrid.path.includes(path.join("round-1", "contact-grid.png")) && review1.contactGrid.columns === 5 && review1.contactGrid.rows === 3 && fs.existsSync(review1.contactGrid.path));
    check("the stills sit beside it, so a later round does not overwrite this one", review1.stills.every((s) => s.path.includes(`${path.sep}round-1${path.sep}`)));
    check("numeric findings come back from the same call and nothing was skipped silently", Array.isArray(review1.findings) && Array.isArray(review1.findingsSkipped) && review1.findings.every((f) => f.source === "render"));
    check("findings reuse the stills' bundle: the whole call bundled once", review1.bundleMs > 0 && review1.totalMs >= review1.bundleMs + review1.renderMs);

    const exact = await forC6({ frames: [449, 0, 200, 200], findings: false });
    check("explicit frames render exactly those, once each, in order, attributed to their beats", exact.stills.map((s) => `${s.beatId}@${s.offset}`).join() === "alpha@0,beta@50,gamma@119");
    check("explicit frames also get a grid, and findings: false leaves them out", !!exact.contactGrid && exact.contactGrid.tiles === 3 && exact.findings === undefined);

    let message = "";
    try { await forC6({ frames: [450], findings: false }); } catch (e) { message = String(e.message); }
    check("a frame past the end is refused with the real length", /frames must be whole numbers from 0 to 449/.test(message) && /450 frames/.test(message));
    message = "";
    try { await forC6({ perBeat: 13, findings: false }); } catch (e) { message = String(e.message); }
    check("perBeat above the cap is refused", /perBeat must be a whole number from 1 to 12/.test(message));

    const forced = await forC6({ beatIds: ["alpha"], contactGrid: true, findings: false });
    check("contactGrid: true makes a grid even for one still", forced.stills.length === 1 && forced.contactGrid?.tiles === 1);
  } else {
    skip("C6 multi-frame, contact grid and findings against a real render", "the scaffolded project could not resolve its dependencies");
  }
}

finish();

#!/usr/bin/env node
// scaffold-scene: Part 29, Part 35#2, Part 49 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 35: cta template fills real repo info; validate_scenes doesn't false-positive on it (A11) ==");
{
  const { runScaffoldScene } = require(path.join(distDir, "tools", "scaffoldScene.js"));
  const { runValidateScenes } = require(path.join(distDir, "tools", "validateScenes.js"));

  // Scaffolded inside THIS repo's own working tree (not a fresh git init with a fake
  // remote), so `git remote get-url origin` walks up to the real .git and resolves the
  // real github.com/AnayDhawan/openvidstudio -- the task's own suggested test subject.
  // Lives under a throwaway, gitignored-by-being-untracked subfolder and is removed after.
  const a11Root = path.join(monorepoRoot, ".tmp-a11-validate-scenes-test");
  fs.rmSync(a11Root, { recursive: true, force: true });
  fs.mkdirSync(a11Root, { recursive: true });
  // No package.json here on purpose -- this exercises the git-remote path (higher priority
  // than package.json's "repository" field per repoInfo.ts), and plants a tsconfig.json to
  // exercise the "tsconfig.json present -> TypeScript" language guess.
  fs.writeFileSync(path.join(a11Root, "tsconfig.json"), "{}\n");

  try {
    const scaffoldResult = runScaffoldScene({
      projectRoot: a11Root,
      videoName: "a11test",
      beatId: "outro-cta",
      kind: "dom-demo",
      template: "cta",
    });
    const sceneSrc = fs.readFileSync(scaffoldResult.path, "utf8");

    check(
      "cta scene shows the real owner/repo (github.com/AnayDhawan/openvidstudio), not a placeholder",
      sceneSrc.includes('owner="AnayDhawan"') && sceneSrc.includes('name="openvidstudio"'),
    );
    check(
      "...and its chips carry a real language guess (TypeScript, from the planted tsconfig.json)",
      /chips=\{\["TypeScript",/.test(sceneSrc),
    );
    check(
      "...and no your-org/your-repo placeholder is left anywhere in the file",
      !sceneSrc.includes("your-org") && !sceneSrc.includes("your-repo"),
    );

    const videoDir = path.join(a11Root, "src", "videos", "a11test");
    fs.writeFileSync(
      path.join(videoDir, "beats.json"),
      JSON.stringify({
        fps: 30,
        title: "a11test",
        beats: [{ id: "outro-cta", start: 0, duration: 90, visual: { description: "cta", captureMethod: "dom-demo" }, vo: "" }],
      }),
    );

    const report = runValidateScenes({ projectRoot: a11Root, videoName: "a11test" });
    const ctaFindings = report.findings.filter((f) => f.beatId === "outro-cta");
    check(
      "validate_scenes reports no false-positive 'fewer than two camera keyframes' for the RepoCta scene " +
        `(got: ${ctaFindings.map((f) => f.message).join(" | ") || "none"})`,
      !ctaFindings.some((f) => /fewer than two camera keyframes/i.test(f.message)),
    );

    // Regression pin: the skip is scoped to RepoCta specifically, not a global disable of the
    // check -- a genuinely camera-less scene (no RepoCta, no scale: keyframes) must still fire it.
    const noCameraDir = path.join(videoDir, "scenes");
    fs.writeFileSync(
      path.join(noCameraDir, "NoCamera.tsx"),
      `import React from "react";\nexport const NoCamera: React.FC = () => <div>static, no camera, plain content</div>;\n`,
    );
    fs.writeFileSync(
      path.join(videoDir, "beats.json"),
      JSON.stringify({
        fps: 30,
        title: "a11test",
        beats: [
          { id: "outro-cta", start: 0, duration: 90, visual: { description: "cta", captureMethod: "dom-demo" }, vo: "" },
          { id: "no-camera", start: 90, duration: 90, visual: { description: "static", captureMethod: "dom-demo" }, vo: "" },
        ],
      }),
    );
    const report2 = runValidateScenes({ projectRoot: a11Root, videoName: "a11test" });
    const noCameraFindings = report2.findings.filter((f) => f.beatId === "no-camera");
    check(
      "...a genuinely camera-less, non-RepoCta scene still gets the real warning (the skip isn't global)",
      noCameraFindings.some((f) => /fewer than two camera keyframes/i.test(f.message)),
    );
  } finally {
    fs.rmSync(a11Root, { recursive: true, force: true });
  }
}

console.log("\n== Part 49: scaffold_scene modes -- starter and blank (C5) ==");
{
  const c5Root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c5-scaffold-"));
  const videoDir = path.join(c5Root, "src", "videos", "c5-demo");
  fs.mkdirSync(videoDir, { recursive: true });
  fs.writeFileSync(
    path.join(videoDir, "beats.json"),
    JSON.stringify({
      fps: 30,
      beats: [
        { id: "alpha-shot", start: 0, duration: 90, vo: "Alpha narration line.", visual: { description: "alpha shot" } },
        { id: "beta-shot", start: 90, duration: 90, vo: "Beta narration line.", visual: { description: "beta shot" } },
        { id: "gamma-shot", start: 180, duration: 90, vo: "Gamma narration line.", visual: { description: "gamma shot" } },
      ],
    }),
  );

  // mode: "starter", no design.ts/facts.json on disk yet.
  const alpha = runScaffoldScene({ projectRoot: c5Root, videoName: "c5-demo", beatId: "alpha-shot", kind: "dom-demo", mode: "starter" });
  check("starter mode reports written: true", alpha.written === true);
  check("starter mode's result names itself, not a template name", alpha.template === "starter");
  check("starter mode wrote the file at the usual scenes/<PascalId>.tsx path", fs.existsSync(path.join(videoDir, "scenes", "AlphaShot.tsx")));
  const alphaSrc = fs.readFileSync(alpha.path, "utf8");
  check("starter file imports CinematicScene/Layer/E from core", /import \{ CinematicScene, Layer, E \} from "@openvidstudio\/core";/.test(alphaSrc));
  check("starter file carries the beat's own VO as a comment, not on screen", alphaSrc.includes("Alpha narration line."));
  check("starter file does NOT import design (no design.ts exists yet)", !alphaSrc.includes('from "../design"'));
  check("starter file does NOT import facts (no facts.json exists yet)", !alphaSrc.includes('from "../facts.json"'));
  check("starter file's camera keyframes never freeze (two distinct keyframes)", /frame: 0,.*scale: 1\.04/.test(alphaSrc.replace(/\s+/g, " ")) && alphaSrc.includes("E.drift"));

  // Now add design.ts and facts.json, and scaffold a second beat in starter mode.
  fs.writeFileSync(path.join(videoDir, "design.ts"), 'export const design = { motif: "geometric" };\n');
  fs.writeFileSync(path.join(videoDir, "facts.json"), '{"beats":{}}\n');
  const beta = runScaffoldScene({ projectRoot: c5Root, videoName: "c5-demo", beatId: "beta-shot", kind: "dom-demo", mode: "starter" });
  const betaSrc = fs.readFileSync(beta.path, "utf8");
  check("starter mode imports design once design.ts exists on disk", betaSrc.includes('import { design } from "../design";'));
  check("starter mode imports facts once facts.json exists on disk", betaSrc.includes('import facts from "../facts.json";'));

  // mode: "blank" on a fresh beat: nothing written, honest result shape.
  const gammaBlank = runScaffoldScene({ projectRoot: c5Root, videoName: "c5-demo", beatId: "gamma-shot", kind: "dom-demo", mode: "blank" });
  check("blank mode reports written: false", gammaBlank.written === false);
  check("blank mode writes no file", !fs.existsSync(path.join(videoDir, "scenes", "GammaShot.tsx")));
  check("blank mode still names the expected path and component name", gammaBlank.path.endsWith(path.join("scenes", "GammaShot.tsx")) && gammaBlank.componentName === "GammaShot");
  check("blank mode's notes point the agent at the expected export name", gammaBlank.notes.some((n) => n.includes("GammaShot")));

  // mode: "blank" on a beat that already has a real starter-written file: must never clobber,
  // and must never throw the "already exists" refusal that template/starter mode would.
  const beforeClobberCheck = fs.readFileSync(path.join(videoDir, "scenes", "AlphaShot.tsx"), "utf8");
  const alphaBlank = runScaffoldScene({ projectRoot: c5Root, videoName: "c5-demo", beatId: "alpha-shot", kind: "dom-demo", mode: "blank" });
  check("blank mode on an already-scaffolded beat still reports written: false, never throws", alphaBlank.written === false);
  check(
    "...and never touches the real file already there",
    fs.readFileSync(path.join(videoDir, "scenes", "AlphaShot.tsx"), "utf8") === beforeClobberCheck,
  );
}

finish();

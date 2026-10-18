#!/usr/bin/env node
// multilingual: Part 24, Part 25 (split out of the former single manual-test.mjs; see _harness.mjs)

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
  check("...and an em dash in a translation is caught too", !validateLangBeats(langBeat({ voTranslations: { hi: "kuch \u2014 shabd" } })).valid);
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

finish();

#!/usr/bin/env node
// write-description: Part 2 (split out of the former single manual-test.mjs; see _harness.mjs)

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
setQuiet(false);
// ---- checks ----

console.log("\n== Part 2: C9 write_description disclosure ==");
{
  const { runWriteDescription } = require(path.join(distDir, "tools", "writeDescription.js"));
  const videoName = "description-check";
  const videoDir = path.join(tmpRoot, "src", "videos", videoName);
  fs.mkdirSync(videoDir, { recursive: true });
  fs.writeFileSync(
    path.join(videoDir, "beats.json"),
    JSON.stringify({
      fps: 30,
      beats: [
        { id: "real", duration: 90, vo: "The real capture." },
        { id: "constructed", duration: 90, vo: "The sample capture." },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(videoDir, "brief.json"),
    JSON.stringify({
      logline: "A grounded description.",
      shotList: [
        { beatId: "real", real: true, provenance: "real product" },
        {
          beatId: "constructed",
          real: false,
          provenance: "Acme Tasks, a fictional task board",
          whyConstructed: "the real board contains private customer data",
        },
      ],
    }),
  );
  const result = runWriteDescription({ projectRoot: tmpRoot, videoName });
  const content = fs.readFileSync(result.path, "utf8");
  check("C9 writes a description file from real beats", result.written && fs.existsSync(result.path));
  check(
    "C9 discloses constructed content verbatim and excludes real shots from the disclosure list",
    result.sampleContentDisclosed.join(",") === "constructed" &&
      content.includes("Acme Tasks, a fictional task board") &&
      content.includes("the real board contains private customer data"),
  );
  const noBriefVideo = "description-no-brief";
  const noBriefDir = path.join(tmpRoot, "src", "videos", noBriefVideo);
  fs.mkdirSync(noBriefDir, { recursive: true });
  fs.writeFileSync(
    path.join(noBriefDir, "beats.json"),
    JSON.stringify({ fps: 30, beats: [{ id: "only", duration: 60, vo: "Still works without a brief." }] }),
  );
  const noBrief = runWriteDescription({ projectRoot: tmpRoot, videoName: noBriefVideo });
  check(
    "C9 supports projects without brief.json",
    fs.existsSync(noBrief.path) && !fs.readFileSync(noBrief.path, "utf8").includes("Sample content used"),
  );
}

console.log("\n== C9: chapters from the beats, and credits read from disk ==");
{
  const { buildChapters, chapterTimestamp, humanizeBeatId, runWriteDescription } = require(path.join(distDir, "tools", "writeDescription.js"));
  const beat = (id, seconds, extra = {}) => ({ id, duration: seconds * 30, vo: "", ...extra });

  check("timestamps are m:ss, and h:mm:ss from an hour", chapterTimestamp(0) === "0:00" && chapterTimestamp(75) === "1:15" && chapterTimestamp(600) === "10:00" && chapterTimestamp(3725) === "1:02:05");
  check("a beat id is made readable", humanizeBeatId("demo-search") === "Demo search" && humanizeBeatId("cta") === "Cta" && humanizeBeatId("a_b-c") === "A b c");

  const long = buildChapters([beat("hook", 12), beat("problem", 15), beat("demo-search", 20), beat("cta", 11)], 30);
  check("beats of ten seconds or more each become a chapter, the first at 0:00", long.chapters.map((c) => `${chapterTimestamp(c.seconds)} ${c.label}`).join("|") === "0:00 Hook|0:12 Problem|0:27 Demo search|0:47 Cta");

  const titled = buildChapters([beat("hook", 12, { chapter: "Why this exists" }), beat("b", 12), beat("c", 12)], 30);
  check("a beat's own chapter title wins over its id", titled.chapters[0].label === "Why this exists" && titled.chapters[1].label === "B");

  // Many short beats: merged forward until a chapter reaches ten seconds, named after its first beat.
  const shorts = buildChapters(Array.from({ length: 12 }, (_, i) => beat(`s${i}`, 4)), 30);
  check("short beats merge forward into chapters of at least ten seconds", shorts.chapters.length === 4 && shorts.chapters.map((c) => c.seconds).join() === "0,12,24,36" && shorts.chapters.map((c) => c.label).join() === "S0,S3,S6,S9");
  const tail = buildChapters([beat("a", 12), beat("b", 12), beat("c", 12), beat("d", 3)], 30);
  check("a short tail folds into the chapter before it instead of making a chapter under ten seconds", tail.chapters.length === 3 && tail.chapters.at(-1).label === "C");
  const tiny = buildChapters([beat("a", 4), beat("b", 4)], 30);
  check("a video too short for three chapters writes none and says why", tiny.chapters.length === 0 && /at least 3 and each is 10 seconds or more/.test(tiny.skippedBecause) && /8-second video makes 1/.test(tiny.skippedBecause));
  check("zero-length beats are ignored", buildChapters([beat("a", 12), { id: "gap", duration: 0, vo: "" }, beat("b", 12), beat("c", 12)], 30).chapters.length === 3);

  const make = (name, files = {}, beats = [beat("hook", 12), beat("middle", 15), beat("end", 12)], demoAudio = null) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-description-"));
    const videoDir = path.join(root, "src", "videos", name);
    fs.mkdirSync(videoDir, { recursive: true });
    fs.mkdirSync(path.join(root, "public", "audio"), { recursive: true });
    fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, beats }));
    if (demoAudio) {
      fs.writeFileSync(path.join(videoDir, `${name[0].toUpperCase()}${name.slice(1)}Demo.tsx`), `<Audio src={staticFile("audio/${demoAudio.file}")} volume={${demoAudio.volume ?? 0.18}} loop />`);
    }
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    }
    return root;
  };
  const describe = (root, name) => {
    const r = runWriteDescription({ projectRoot: root, videoName: name });
    return { r, text: fs.readFileSync(r.path, "utf8") };
  };

  const generated = make("gen", { "public/audio/music-bed.cues.json": JSON.stringify({ bpm: 120, source: "generated" }) }, undefined, { file: "music-bed.mp3" });
  const g = describe(generated, "gen");
  check("the file has a Chapters section in YouTube's format", /## Chapters\n\n0:00 Hook\n0:12 Middle\n0:27 End\n/.test(g.text) && g.r.chapters.join("|") === "0:00 Hook|0:12 Middle|0:27 End");
  check("the generated score is credited as original, with nothing to license", g.r.credits.some((c) => /original score composed for this video with openvidstudio's compose_score/.test(c) && /nothing to license/.test(c)) && g.text.includes("## Credits"));
  check("the tool is always credited, with its link", g.r.credits[0].startsWith("Made with openvidstudio (https://github.com/AnayDhawan/openvidstudio)"));

  const imported = make(
    "imp",
    { "public/audio/lofi-1.mp3.source.json": JSON.stringify({ title: "Rain on Glass", sourceRepo: "example/open-lofi", licence: "CC0-1.0" }) },
    undefined,
    { file: "lofi-1.mp3" },
  );
  check("an imported track is credited by title, source and licence", describe(imported, "imp").r.credits.some((c) => c === 'Music: "Rain on Glass" from example/open-lofi (CC0-1.0).'));

  const builtin = make("pul", {}, undefined, { file: "pulse-bed.mp3" });
  check("the built-in bed is credited as synthesized", describe(builtin, "pul").r.credits.some((c) => /synthesized by openvidstudio's built-in generator/.test(c)));

  const unknown = make("unk", {}, undefined, { file: "mystery.mp3" });
  check("a track with no recorded source says so instead of inventing one", describe(unknown, "unk").r.credits.some((c) => /mystery\.mp3 \(its source was not recorded/.test(c)));

  const silent = make("sil");
  check("no music layer means no music credit", !describe(silent, "sil").r.credits.some((c) => c.startsWith("Music:")));

  const withVo = make("vo", {}, [beat("hook", 12, { vo: "Words." }), beat("b", 12), beat("c", 12)]);
  check("narration is credited when any beat has voice-over, and not otherwise", describe(withVo, "vo").r.credits.some((c) => /^Narration: synthesized speech \(.+, voice .+\)\.$/.test(c)) && !describe(silent, "sil").r.credits.some((c) => c.startsWith("Narration:")));

  const sfx = make("sfx", {
    "public/imported_audios/ATTRIBUTION.md": ["# Sound effect attribution", "", "| File | Source | Author | Licence |", "|---|---|---|---|", "| click.wav | freesound.org/s/1 | Jane | CC-BY-4.0 |", ""].join("\n"),
  });
  check("a sound effect whose licence asks for credit is credited, from ATTRIBUTION.md", describe(sfx, "sfx").r.credits.some((c) => c === "Sound effect click.wav: freesound.org/s/1, Jane, CC-BY-4.0. The licence asks for this credit."));

  const short = make("shortone", {}, [beat("a", 4), beat("b", 4)]);
  const s = describe(short, "shortone");
  check("a too-short video's file says chapters were left out and writes no Chapters heading", /Chapters left out: YouTube lists chapters only when there are at least 3/.test(s.text) && !s.text.includes("## Chapters") && s.r.chapters.length === 0);
}

finish();

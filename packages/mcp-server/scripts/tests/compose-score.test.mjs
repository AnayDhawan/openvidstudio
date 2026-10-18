#!/usr/bin/env node
// compose-score: Part 2b (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 2b: C3 compose_score real generation ==");
{
  const python = spawnSync(process.platform === "win32" ? "where" : "which", ["python"], { encoding: "utf8" });
  const deps = python.status === 0
    ? spawnSync("python", ["-c", "import numpy, scipy, soundfile, pyloudnorm, matplotlib"], { encoding: "utf8" })
    : { status: 1 };
  if (deps.status !== 0) {
    skip("C3 compose_score real generation", "python DSP dependencies are not installed");
  } else {
    const { runComposeScore } = require(path.join(distDir, "tools", "composeScore.js"));
    const { runMusicCues } = require(path.join(distDir, "tools", "musicCues.js"));
    const scoreRoot = path.join(tmpRoot, "c3-score");
    const result = runComposeScore({
      projectRoot: scoreRoot,
      videoName: "score-check",
      mode: "bed",
      music: {
        bpm: 120,
        key: "C major",
        sectionMap: [
          { label: "intro", startBar: 0, endBar: 2 },
          { label: "reveal", startBar: 2, endBar: 4 },
        ],
        impactPoints: [{ name: "reveal", bar: 2 }],
      },
    });
    const cueResult = await runMusicCues({ projectRoot: scoreRoot, track: result.mp3Path });
    check(
      "C3 writes a real mp3, cues file, and spectrogram",
      fs.statSync(path.join(scoreRoot, result.mp3Path)).size > 0 &&
        fs.existsSync(path.join(scoreRoot, result.cuesPath)) &&
        fs.existsSync(path.join(scoreRoot, result.spectrogramPath)),
    );
    check(
      "C3 generated cues round trip through plan_music_cues from cache",
      cueResult.source === "cached" && cueResult.bpm === 120 && cueResult.track === result.mp3Path,
    );
  }
}

console.log("\n== compose_score: no percussion tick by default ==");
{
  const python = spawnSync(process.platform === "win32" ? "where" : "which", ["python"], { encoding: "utf8" });
  const deps = python.status === 0
    ? spawnSync("python", ["-c", "import numpy, scipy, soundfile, pyloudnorm, matplotlib"], { encoding: "utf8" })
    : { status: 1 };
  if (deps.status !== 0) {
    skip("compose_score percussion tick check", "python DSP dependencies are not installed");
  } else {
    const { runComposeScore, computeWarnings } = require(path.join(distDir, "tools", "composeScore.js"));
    // tension, groove and peak are the sections that used to carry the per-beat tick, the
    // off-beat hat and the 16th-note grid. 12 bars at 120bpm is 24 seconds.
    const music = {
      bpm: 120,
      key: "A minor",
      sectionMap: [
        { label: "tension", startBar: 0, endBar: 4 },
        { label: "groove", startBar: 4, endBar: 8 },
        { label: "peak", startBar: 8, endBar: 12 },
      ],
      impactPoints: [{ name: "peak", bar: 8 }],
    };
    const quiet = runComposeScore({ projectRoot: path.join(tmpRoot, "tick-none"), videoName: "tick-none", mode: "bed", music });
    const ticking = runComposeScore({
      projectRoot: path.join(tmpRoot, "tick-full"),
      videoName: "tick-full",
      mode: "bed",
      music,
      percussion: "full",
    });
    const quietTick = quiet.cues.checks?.percussionTick;
    const fullTick = ticking.cues.checks?.percussionTick;
    check("default score reports a percussionTick check", !!quietTick && typeof quietTick.peak === "number");
    check(
      `default score has no periodic high-frequency transients (autocorrelation ${quietTick?.peak} < 0.3)`,
      !!quietTick && quietTick.peak < 0.3 && quietTick.verdict === "ok",
    );
    check("default score raises no tick warning", !quiet.warnings.some((w) => /periodic|tick/i.test(w)));
    check(
      `control: percussion "full" (the old tick/hat/kick grid) is caught by the same check (autocorrelation ${fullTick?.peak} >= 0.3)`,
      !!fullTick && fullTick.peak >= 0.3 && fullTick.verdict !== "ok",
    );
    check("control: the full-percussion score raises a tick warning", ticking.warnings.some((w) => /periodic|tick/i.test(w)));
    check(
      "computeWarnings turns a periodic verdict into a warning",
      computeWarnings({ checks: { percussionTick: { peak: 0.9, lagMs: 625, verdict: "periodic" } } }).some((w) => /625/.test(w)),
    );
    check("default score still has no clicks", quiet.cues.checks?.clickCount === 0);
  }
}

finish();

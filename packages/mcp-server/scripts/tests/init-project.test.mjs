#!/usr/bin/env node
// init-project: Part 1 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("== Part 1: init_project bundled-template resolution ==");
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

// A backup left by an earlier run that died between the two renames: put it back first.
if (fs.existsSync(backupDir) && !fs.existsSync(monorepoTemplateDir)) fs.renameSync(backupDir, monorepoTemplateDir);

// Renaming a directory on Windows fails with EPERM while anything (an editor, an indexer) holds a
// handle inside it. Retry briefly rather than strand the template, which breaks every later file.
function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 25 || !/EPERM|EBUSY|EACCES/.test(String(err.code))) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

let initResult;
const monorepoTemplateExisted = fs.existsSync(monorepoTemplateDir);
if (!monorepoTemplateExisted) {
  console.log(`  (monorepo templates/default already absent, skipping rename-away step)`);
}
try {
  if (monorepoTemplateExisted) {
    renameWithRetry(monorepoTemplateDir, backupDir);
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
    renameWithRetry(backupDir, monorepoTemplateDir);
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
//
// The other two exceptions are Supernova's: the vendored openvidstudio-stem/ belongs only to a
// project made with mode "supernova", and a standard project's package.json is the bundled one
// without the dependency on it (checked below). supernova-mode.test.mjs covers both in depth.
const EXPECTED_TO_DIFFER = new Set([path.join("src", "Root.tsx"), "package.json"]);
const isStemFile = (rel) => rel.split(path.sep)[0] === "openvidstudio-stem";
let allBundledFilesCopied = true;
for (const rel of bundledFileList) {
  if (EXPECTED_TO_DIFFER.has(rel) || isStemFile(rel)) continue;
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
{
  const bundledPkg = JSON.parse(fs.readFileSync(path.join(bundledTemplateDir, "package.json"), "utf8"));
  delete bundledPkg.dependencies["@openvidstudio/stem"];
  const scaffoldedPkg = JSON.parse(fs.readFileSync(path.join(tmpRoot, "package.json"), "utf8"));
  check("a standard project's package.json is the bundled one minus the stem dependency", JSON.stringify(scaffoldedPkg) === JSON.stringify(bundledPkg));
  check("a standard project has no vendored stem package", !fs.existsSync(path.join(tmpRoot, "openvidstudio-stem")));
}
check("src/videos/demo/scenes/ was created", fs.existsSync(path.join(tmpRoot, "src", "videos", "demo", "scenes")));
check(
  "src/Root.tsx was regenerated to register the preflight benchmark composition (B)",
  fs.readFileSync(path.join(tmpRoot, "src", "Root.tsx"), "utf8").includes("PreflightBenchmark"),
);

// A stray file in the template's output/ (a render left on the maintainer's machine) must not
// reach a new project, while the two tracked files still do. Checked at both steps: the build
// that vendors the template, and init_project itself (a stale bundled copy can hold strays).
{
  const strayName = "stray-render.mp4";
  const monorepoStray = path.join(monorepoTemplateDir, "output", strayName);
  const bundledStray = path.join(bundledTemplateDir, "output", strayName);
  try {
    fs.writeFileSync(monorepoStray, "not in git");
    execFileSync(process.execPath, [path.join(__dirname, "copy-template.mjs")], { stdio: "ignore" });
    check("copy-template leaves an untracked file in output/ out of the bundled template", !fs.existsSync(bundledStray));
    check(
      "copy-template keeps the tracked output/README.md and output/.gitignore",
      fs.existsSync(path.join(bundledTemplateDir, "output", "README.md")) &&
        fs.existsSync(path.join(bundledTemplateDir, "output", ".gitignore")),
    );
    fs.writeFileSync(bundledStray, "stale copy");
    const strayRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-init-stray-"));
    const { runInitProject: runInit } = require(path.join(distDir, "tools", "initProject.js"));
    runInit({ name: "stray", projectRoot: strayRoot });
    check("init_project does not copy a stray file from the template's output/", !fs.existsSync(path.join(strayRoot, "output", strayName)));
    check(
      "init_project still copies output/README.md and output/.gitignore",
      fs.existsSync(path.join(strayRoot, "output", "README.md")) && fs.existsSync(path.join(strayRoot, "output", ".gitignore")),
    );
    fs.rmSync(strayRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(monorepoStray, { force: true });
    fs.rmSync(bundledStray, { force: true });
  }
}

finish();

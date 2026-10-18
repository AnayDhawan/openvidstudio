#!/usr/bin/env node
// preflight: Part 41, Part 44, Part 45 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 41: preflight resolves Chromium the same way real capture launches it (A5) ==");
{
  // Playwright resolves its browser path registry once at module load, from env vars read
  // at THAT time -- mutating process.env.PLAYWRIGHT_BROWSERS_PATH later in this same long-
  // lived process does not change what an already-loaded chromium.executablePath() returns.
  // A real client only ever sets this once per process too, so each case here runs preflight
  // in its own fresh child process, exactly like three separate real invocations would.
  const preflightRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a5-"));
  // Written inside packageRoot (not the temp project), so plain `require("@openvidstudio/
  // capture")` resolves through this package's own node_modules exactly like preflight.ts's
  // real import does, rather than finding nothing from a bare temp directory.
  const probeScript = path.join(packageRoot, ".a5-probe-preflight.cjs");
  fs.writeFileSync(
    probeScript,
    `const { runPreflight } = require(${JSON.stringify(path.join(distDir, "tools", "preflight.js"))});
     const { chromium } = require("@openvidstudio/capture");
     (async () => {
       let realPath = null;
       try { realPath = chromium.executablePath(); } catch {}
       const r = await runPreflight({ projectRoot: ${JSON.stringify(preflightRoot)} });
       console.log(JSON.stringify({ realPath, check: r.checks.find((c) => c.name === "chromium") }));
     })();`,
    "utf8",
  );
  const runProbe = (browsersPath) => {
    const env = { ...process.env };
    if (browsersPath === undefined) delete env.PLAYWRIGHT_BROWSERS_PATH;
    else env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
    const out = execFileSync("node", [probeScript], { env, encoding: "utf8" });
    return JSON.parse(out.trim().split("\n").pop());
  };
  try {

  const { realPath: defaultRealPath, check: defaultCheck } = runProbe(undefined);
  check(
    "with no PLAYWRIGHT_BROWSERS_PATH, preflight resolves Chromium via the same playwright capture uses",
    defaultCheck.ok === (defaultRealPath !== null && fs.existsSync(defaultRealPath)) &&
      /playwright \d+\.\d+\.\d+/.test(defaultCheck.detail),
  );

  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a5-empty-"));
  const { check: emptyCheck } = runProbe(emptyDir);
  check(
    "an empty custom PLAYWRIGHT_BROWSERS_PATH fails with the resolved (not-found) path and the exact fix command",
    emptyCheck.ok === false && emptyCheck.detail.includes(emptyDir) && emptyCheck.fix === "npx playwright install chromium",
  );

  if (defaultRealPath && fs.existsSync(defaultRealPath)) {
    const buildDirName = defaultRealPath.split(path.sep).find((p) => /^chromium[_-]/.test(p));
    const cacheRoot = buildDirName ? defaultRealPath.slice(0, defaultRealPath.indexOf(buildDirName) - 1) : null;
    if (buildDirName && cacheRoot) {
      const customDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a5-custom-"));
      fs.cpSync(path.join(cacheRoot, buildDirName), path.join(customDir, buildDirName), { recursive: true });
      const { check: customCheck } = runProbe(customDir);
      check(
        "the same build copied under a custom PLAYWRIGHT_BROWSERS_PATH is found there (false 'no chromium' fixed)",
        customCheck.ok === true && customCheck.detail.includes(customDir),
      );
    } else {
      skip("Part 41: custom PLAYWRIGHT_BROWSERS_PATH positive case", "could not parse the default build's cache dir");
    }
  } else {
    skip("Part 41: custom PLAYWRIGHT_BROWSERS_PATH positive case", "no default Chromium build resolved on this machine to copy");
  }
  } finally {
    fs.rmSync(probeScript, { force: true });
  }
}

console.log("\n== Part 44: render.browserExecutable reuses a configured browser instead of Remotion's own download (A12) ==");
{
  const { buildRenderCommand } = require(path.join(distDir, "tools", "renderVideo.js"));
  const { buildSegmentRenderArgs } = require(path.join(distDir, "renderCache.js"));
  const fakeExe = "C:/fake/chrome.exe";

  check(
    "buildRenderCommand adds --browser-executable when configured",
    buildRenderCommand("Demo", "out.mp4", { browserExecutable: fakeExe }).args.includes(`--browser-executable=${fakeExe}`),
  );
  check(
    "buildSegmentRenderArgs adds it too, for the incremental path",
    buildSegmentRenderArgs("Demo", "seg.mp4", 0, 29, { browserExecutable: fakeExe }).args.includes(`--browser-executable=${fakeExe}`),
  );
  check(
    "omitted entirely when not configured -- unset stays Remotion's default behavior",
    !buildRenderCommand("Demo", "out.mp4", {}).args.some((a) => a.startsWith("--browser-executable")) &&
      !buildSegmentRenderArgs("Demo", "seg.mp4", 0, 29, {}).args.some((a) => a.startsWith("--browser-executable")),
  );

  const { runPreflight } = require(path.join(distDir, "tools", "preflight.js"));
  const { writeConfig } = require(path.join(distDir, "config.js"));
  const beRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a12-browserexec-"));

  const noConfig = await runPreflight({ projectRoot: beRoot });
  check(
    "preflight adds no render.browserExecutable check when it isn't configured",
    !noConfig.checks.some((c) => c.name === "render.browserExecutable"),
  );

  writeConfig(beRoot, { render: { browserExecutable: path.join(beRoot, "does-not-exist.exe") } });
  const missingConfigured = await runPreflight({ projectRoot: beRoot });
  const missingCheck = missingConfigured.checks.find((c) => c.name === "render.browserExecutable");
  check(
    "a configured but missing render.browserExecutable fails preflight with that exact path named",
    missingCheck?.ok === false && missingCheck.detail.includes("does-not-exist.exe"),
  );

  const realExistingFile = path.join(beRoot, "stand-in.exe");
  fs.writeFileSync(realExistingFile, "");
  writeConfig(beRoot, { render: { browserExecutable: realExistingFile } });
  const presentConfigured = await runPreflight({ projectRoot: beRoot });
  const presentCheck = presentConfigured.checks.find((c) => c.name === "render.browserExecutable");
  check("an existing configured path passes preflight", presentCheck?.ok === true);
}

console.log("\n== Part 45: preflight's render benchmark (B) ==");
{
  const { buildBenchmarkArgs, parseBenchmarkSeconds } = require(path.join(distDir, "tools", "preflight.js"));

  const args = buildBenchmarkArgs("C:\\proj", { frames: 60 });
  check(
    "buildBenchmarkArgs targets the seeded benchmark composition at the right frame range",
    args.includes("OvsPreflightBenchmark") && args.includes("--frames=0-59"),
  );
  const withBrowser = buildBenchmarkArgs("C:\\proj", { frames: 60, browserExecutable: "C:/fake/chrome.exe" });
  check(
    "...and passes --browser-executable through when configured",
    withBrowser.includes("--browser-executable=C:/fake/chrome.exe"),
  );

  const sample =
    "Rendering (1 out of 1 runs) \u001b[34m\u2501\u2501\u001b[39m 100.00% \n\n" +
    "    Time (\u001b[32mmean\u001b[39m \u00b1 \u001b[32m\u03c3\u001b[39m):         \u001b[32m12.84177s\u001b[39m \u00b1 \u001b[32m0.00000s\u001b[39m\n" +
    "    Range (\u001b[34mmin\u001b[39m ... \u001b[31mmax\u001b[39m):     \u001b[34m12.84177s\u001b[39m ... \u001b[31m12.84177s\u001b[39m \t \u001b[90m1 runs\u001b[39m\n";
  check(
    "parseBenchmarkSeconds reads the real ANSI-coloured CLI output remotion benchmark prints",
    parseBenchmarkSeconds(sample) === 12.84177,
  );
  check("...and returns null on unrecognized output rather than throwing", parseBenchmarkSeconds("nothing here") === null);

  if (fs.existsSync(templateNodeModules)) {
    const { runPreflight } = require(path.join(distDir, "tools", "preflight.js"));
    const benchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-b-bench-"));
    const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
    // copyTemplateTree copies ~1700 small files; on Windows a transient ENOENT here (seen in
    // practice after many prior Parts' own rapid file I/O in the same run, never reproduced
    // in isolation) is filesystem contention, not a real failure -- retry a couple of times
    // before treating it as one.
    for (let attempt = 1; ; attempt++) {
      try {
        runInitProject({ name: "bench", projectRoot: benchRoot });
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        console.log(`  (init_project hit ${err.code ?? err.message}, retrying: attempt ${attempt})`);
        fs.rmSync(benchRoot, { recursive: true, force: true });
        fs.mkdirSync(benchRoot, { recursive: true });
      }
    }
    // Same junction-to-the-monorepo's-own-template-node_modules trick Part 4 uses, so this
    // doesn't need its own real npm install just to resolve the remotion CLI.
    fs.symlinkSync(templateNodeModules, path.join(benchRoot, "node_modules"), "junction");

    const rootTsx = fs.readFileSync(path.join(benchRoot, "src", "Root.tsx"), "utf8");
    check(
      "init_project seeds the benchmark composition into Root.tsx before any video is stitched",
      rootTsx.includes("PreflightBenchmark") && rootTsx.includes('id="OvsPreflightBenchmark"'),
    );

    const withoutBenchmark = await runPreflight({ projectRoot: benchRoot });
    check("benchmark: false (default) returns no benchmarkResult", withoutBenchmark.benchmarkResult === undefined);

    const withBenchmark = await runPreflight({ projectRoot: benchRoot, benchmark: true });
    check(
      "benchmark: true renders the seeded composition for real and reports a plausible fps and cpuCount",
      withBenchmark.benchmarkResult?.ok === true &&
        withBenchmark.benchmarkResult.fps > 0 &&
        withBenchmark.benchmarkResult.fps < 1000 &&
        withBenchmark.benchmarkResult.cpuCount === os.cpus().length,
    );
  } else {
    skip("Part 45: real benchmark render", "no resolvable node_modules to scaffold a benchmarkable project from");
  }
}

finish();

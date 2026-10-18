#!/usr/bin/env node
// docs-drift: Part 23, Part 39 (split out of the former single manual-test.mjs; see _harness.mjs)

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
// fixture: CAP
const captureCore = require(path.join(packageRoot, "..", "capture", "dist", "browser.js"));
const { cropAndUpscale } = require(path.join(distDir, "tools", "captureScreenshot.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
const { buildFfmpegTranscodeArgs, buildFfprobeDurationArgs } = require(path.join(distDir, "tools", "captureScreenRecording.js"));
// fixture: BROWSER
let browserAvailable = false;
try {
  const probeBrowser = await captureCore.launchChromium();
  await probeBrowser.close();
  browserAvailable = true;
} catch {}
setQuiet(false);
// ---- checks ----

console.log("\n== Part 23: docs drift against a real page ==");

if (browserAvailable) {
  const http = await import("node:http");
  const { runDocsDrift } = require(path.join(distDir, "tools", "docsDrift.js"));
  const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));

  let pageBody = '<h1 style="font:700 48px sans-serif">Install</h1><p style="font:24px sans-serif">npm install the-thing</p>';
  const driftServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body style="margin:0;background:#ffffff">${pageBody}</body></html>`);
  });
  await new Promise((resolve) => driftServer.listen(0, "127.0.0.1", resolve));
  const driftUrl = `http://127.0.0.1:${driftServer.address().port}/`;
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-drift-test-"));

  try {
    // A real manifest, so the bindings can be inferred rather than handed over: the beat
    // already records the url it was captured from.
    const driftBeats = {
      fps: 30,
      title: "Drift",
      beats: [
        {
          id: "install",
          start: 0,
          duration: 90,
          vo: "The install page, captured straight from the docs.",
          visual: { captureMethod: "screenshot", url: driftUrl, interactions: [] },
        },
      ],
    };
    const driftWrite = runWriteBeatsFile({ projectRoot: driftRoot, videoName: "drift", beatsJson: driftBeats });
    check("the drift fixture passes validate_beats", driftWrite.written === true);

    await runCaptureScreenshot({ projectRoot: driftRoot, beatId: "install", url: driftUrl, viewport: { width: 800, height: 600 } });

    const clean = await runDocsDrift({ projectRoot: driftRoot, videoName: "drift" });
    check("a page that has not changed reports no drift", clean.ok === true && clean.checked === 1);
    check("...and says the clip still matches", clean.nextSteps.join(" ").includes("still match"));

    pageBody = '<h1 style="font:700 48px sans-serif">Install</h1><p style="font:24px sans-serif">pnpm add the-thing, the npm route is gone</p><div style="width:600px;height:300px;background:#c0392b"></div>';
    const drifted = await runDocsDrift({ projectRoot: driftRoot, videoName: "drift" });
    check("a changed page is caught", drifted.ok === false && drifted.driftedBeats.join(",") === "install");
    check("...with a diff image showing where", fs.existsSync(path.join(driftRoot, drifted.findings[0].diffPath)));
    // Knowing which beat is stale is only half of it; the point is that fixing it is now
    // one capture and one beat's worth of render, not a re-record.
    check("...and the next steps name the incremental re-render", drifted.nextSteps.join(" ").includes("incremental"));
  } finally {
    driftServer.close();
  }
} else {
  skip("Part 23: docs drift (entire section)", "real Chromium is not available in this environment");
}

console.log("\n== Part 39: docs_drift re-captures at the sidecar's own viewport, never the reference PNG's pixel size (A3) ==");

if (browserAvailable) {
  const http = await import("node:http");
  const { runDocsDrift } = require(path.join(distDir, "tools", "docsDrift.js"));
  const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));
  const sharpA3 = require("sharp");

  // A page whose look genuinely depends on the CSS viewport width, with the breakpoint
  // chosen so the bug and the fix disagree: captured at 800x600 CSS (dsf 2, the default),
  // the PNG on disk is 1600x1200. 800 is below the 1200px breakpoint (blue); 1600 is above
  // it (green). The old docs_drift read the PNG's pixel size (1600x1200) back as the
  // viewport to re-navigate to, which crosses the breakpoint on a page that never actually
  // changed -- exactly the shape of the real bug report (a 1440x900/dsf:2 capture, a
  // 2880x1800 PNG, re-navigated to a 2880-wide viewport, a completely different layout).
  const pageHtml = `<!doctype html><html><head><style>
    body { margin: 0; }
    #stage { width: 100vw; height: 100vh; background: #3355ff; }
    @media (min-width: 1200px) { #stage { background: #22aa55; } }
  </style></head><body><div id="stage"></div></body></html>`;
  const a3Server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(pageHtml);
  });
  await new Promise((resolve) => a3Server.listen(0, "127.0.0.1", resolve));
  const a3Url = `http://127.0.0.1:${a3Server.address().port}/`;
  const a3Root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a3-test-"));

  try {
    const a3Beats = {
      fps: 30,
      title: "A3",
      beats: [
        {
          id: "narrow",
          start: 0,
          duration: 90,
          vo: "The task board looks the same as before.",
          visual: { captureMethod: "screenshot", url: a3Url, interactions: [] },
        },
      ],
    };
    const a3Write = runWriteBeatsFile({ projectRoot: a3Root, videoName: "a3", beatsJson: a3Beats });
    check("the A3 fixture passes validate_beats", a3Write.written === true);

    const narrowCap = await runCaptureScreenshot({
      projectRoot: a3Root,
      beatId: "narrow",
      url: a3Url,
      viewport: { width: 800, height: 600 },
    });
    check(
      "captured at 800x600 CSS, 1600x1200 real pixels (dsf 2 default)",
      narrowCap.width === 800 && narrowCap.height === 600 && narrowCap.pixelWidth === 1600 && narrowCap.pixelHeight === 1200,
    );

    const narrowRefRel = path.join("public", "images", "narrow.png");
    const narrowSidecarPath = path.join(a3Root, `${narrowRefRel}.capture.json`);
    check("capture_screenshot wrote a .capture.json sidecar next to it", fs.existsSync(narrowSidecarPath));
    const narrowSidecar = JSON.parse(fs.readFileSync(narrowSidecarPath, "utf8"));
    check(
      "...recording the CSS viewport actually requested, not the pixel size, plus scale/url/capturedAt",
      narrowSidecar.viewport.width === 800 &&
        narrowSidecar.viewport.height === 600 &&
        narrowSidecar.deviceScaleFactor === 2 &&
        narrowSidecar.url === a3Url &&
        typeof narrowSidecar.capturedAt === "string",
    );

    // The regression pin: if docs_drift ever again read the reference PNG's pixel size as
    // the viewport instead of this sidecar, #stage would flip blue->green across the
    // breakpoint and this would report drift on a page that never changed.
    const a3Clean = await runDocsDrift({ projectRoot: a3Root, videoName: "a3" });
    check(
      "an unchanged page whose pixel size crosses a CSS breakpoint the real viewport doesn't reports no drift",
      a3Clean.ok === true && a3Clean.checked === 1 && a3Clean.findings[0].changedRatio === 0,
    );

    // Previously: an explicit viewport binding still failed with "different size than the
    // reference", because the recapture context never matched the reference's own scale.
    const a3Explicit = await runDocsDrift({
      projectRoot: a3Root,
      videoName: "a3",
      bindings: [{ beatId: "narrow", url: a3Url, viewport: { width: 800, height: 600 }, referencePath: narrowRefRel }],
    });
    check(
      "an explicit viewport binding now succeeds instead of 'different size than the reference'",
      a3Explicit.ok === true && a3Explicit.findings[0].reason === "within both thresholds",
    );

    // Legacy asset, no sidecar: falls back to the one narrow, checkable guess (the pixel
    // size is exactly double a common viewport -- 1600x1000, the tool's own default) rather
    // than refusing outright.
    const legacyRefRel = path.join("public", "images", "legacy.png");
    await runCaptureScreenshot({ projectRoot: a3Root, beatId: "narrow", url: a3Url, outPath: legacyRefRel });
    fs.rmSync(path.join(a3Root, `${legacyRefRel}.capture.json`)); // simulate a pre-sidecar asset
    const a3Legacy = await runDocsDrift({
      projectRoot: a3Root,
      videoName: "a3",
      bindings: [{ beatId: "legacy", url: a3Url, referencePath: legacyRefRel }],
    });
    check(
      "a legacy reference with no sidecar, at a common viewport's exact double, falls back cleanly",
      a3Legacy.ok === true && a3Legacy.findings[0].changedRatio === 0,
    );

    // An oddball legacy size the heuristic can't safely guess: refuses rather than guessing
    // wrong, same as the bug this binding exists to prevent.
    const oddballRefRel = path.join("public", "images", "oddball.png");
    await sharpA3({ create: { width: 777, height: 533, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toFile(path.join(a3Root, oddballRefRel));
    let a3Refusal = "";
    try {
      await runDocsDrift({ projectRoot: a3Root, videoName: "a3", bindings: [{ beatId: "oddball", url: a3Url, referencePath: oddballRefRel }] });
    } catch (err) {
      a3Refusal = String(err?.message ?? err);
    }
    check(
      "a legacy reference at an uncommon size refuses to guess rather than guessing wrong",
      a3Refusal.includes("no safe way to guess the viewport"),
    );
  } finally {
    a3Server.close();
    fs.rmSync(a3Root, { recursive: true, force: true });
  }
} else {
  skip("Part 39: docs_drift sidecar viewport binding (A3, entire section)", "real Chromium is not available in this environment");
}

finish();

#!/usr/bin/env node
// scaffold-vertical: scaffold_scene and its templates follow the project's frame size (#117).
//
// Before this, the starter scene hard-coded its camera at 960,540 and the templates laid
// themselves out on a 1920x1080 stage, so in a 1080x1920 project they rendered off centre and
// cropped, with nothing to say so. Two halves:
//   - landscape: every template and the starter, generated in a 1920x1080 project, is
//     byte-identical to the golden files in fixtures/scaffold-landscape/, which were generated
//     before the change. (OVS_WRITE_GOLDEN=1 rewrites them; do that only on purpose.)
//   - vertical: the same beats scaffolded into a 1080x1920 project are centred on 540,960, render
//     with no crop finding in validate_scenes render mode, and a rendered frame puts content on
//     the frame centre. A landscape-laid-out scene dropped into the same project is the control
//     that must fail.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { require, packageRoot, distDir, monorepoTemplateDir, check, skip, finish } from "./_harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(here, "fixtures", "scaffold-landscape");
const writeGolden = process.env.OVS_WRITE_GOLDEN === "1";
const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");

const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const { runScaffoldScene } = require(path.join(distDir, "tools", "scaffoldScene.js"));
const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
const { runValidateScenesFull } = require(path.join(distDir, "tools", "validateScenes.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));

// One beat per template. `kind` is the capture method; `template` forces a constructed template.
const BEATS = [
  { id: "cap-shot", kind: "real-screenshot", template: "browser-capture" },
  { id: "rec-clip", kind: "real-recording", template: "recording" },
  { id: "gen-clip", kind: "higgsfield-clip", template: "recording" },
  { id: "cast-run", kind: "terminal-cast", template: "terminal-cast" },
  { id: "old-asset", kind: "existing-asset", template: "existing-asset" },
  { id: "term-demo", kind: "dom-demo", template: "terminal" },
  { id: "split-demo", kind: "dom-demo", template: "split-panel" },
  { id: "list-demo", kind: "dom-demo", template: "checklist" },
  { id: "stat-demo", kind: "dom-demo", template: "stat" },
  { id: "code-demo", kind: "dom-demo", template: "code" },
  { id: "compare-demo", kind: "dom-demo", template: "comparison" },
  { id: "cta-demo", kind: "dom-demo", template: "cta" },
  { id: "title-demo", kind: "dom-demo", template: "title" },
  { id: "start-demo", kind: "dom-demo", mode: "starter" },
];
const DURATION = 90;

async function buildProject({ width, height }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ovs-scaffold-${width}x${height}-`));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "demo", projectRoot: root, videoConfig: { fps: 30, width, height } });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
  fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");

  const png = async (rel, w, h, rgb) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toFile(file);
    return file;
  };
  const sidecar = (assetFile, atMs) =>
    fs.writeFileSync(
      assetFile.replace(/\.[^.]+$/, "") + ".cursor.json",
      JSON.stringify({
        viewport: { width: 1440, height: 900 },
        points: [
          { type: "hover", x: 300, y: 200, atMs: atMs[0] },
          { type: "click", x: 900, y: 450, atMs: atMs[1] },
        ],
      }),
    );
  const capFile = await png("public/images/cap-shot.png", 1440, 900, { r: 40, g: 60, b: 90 });
  sidecar(capFile, [100, 400]);
  await png("public/images/old-asset.png", 1280, 720, { r: 90, g: 60, b: 40 });
  fs.mkdirSync(path.join(root, "public", "video"), { recursive: true });
  for (const id of ["rec-clip", "gen-clip"]) {
    // Not a decodable video: scaffold_scene only needs the file to exist (the duration probe
    // falls back when ffprobe cannot read it), and nothing here renders these two.
    const file = path.join(root, "public", "video", `${id}.mp4`);
    fs.writeFileSync(file, "not a real video");
    sidecar(file, [200, 800]);
  }
  fs.mkdirSync(path.join(root, "public", "terminal"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "public", "terminal", "cast-run.json"),
    JSON.stringify({ command: "npm test", cols: 80, rows: 24, durationMs: 1200, events: [[0, "o", "$ npm test\r\n"], [600, "o", "all 12 tests passed\r\n"]] }),
  );

  const videoDir = path.join(root, "src", "videos", "demo");
  const beats = BEATS.map((b, i) => ({
    id: b.id,
    start: i * DURATION,
    duration: DURATION,
    vo: `Narration for ${b.id.replace(/-/g, " ")}.`,
    visual: {
      captureMethod: { "real-screenshot": "screenshot", "real-recording": "recording", "higgsfield-clip": "higgsfield", "terminal-cast": "terminal", "existing-asset": "existing-asset", "dom-demo": "dom-demo" }[b.kind],
      description: `The ${b.id} beat`,
      url: "localhost:3000",
      ...(b.kind === "existing-asset" ? { assetPath: "public/images/old-asset.png", attribution: "from the project's own README" } : {}),
    },
  }));
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, narration: "none", beats }, null, 2));
  return { root, videoDir };
}

function scaffoldAll(project, dryRun) {
  const sources = {};
  for (const b of BEATS) {
    const r = runScaffoldScene({ projectRoot: project.root, videoName: "demo", beatId: b.id, kind: b.kind, template: b.template, mode: b.mode, dryRun, overwrite: true });
    sources[b.id] = dryRun ? r.source : fs.readFileSync(r.path, "utf8");
  }
  return sources;
}

console.log("\n== landscape: 1920x1080 output is byte-identical to the goldens ==");
const landscape = await buildProject({ width: 1920, height: 1080 });
const landscapeSources = scaffoldAll(landscape, true);
if (writeGolden) {
  fs.mkdirSync(goldenDir, { recursive: true });
  for (const [id, src] of Object.entries(landscapeSources)) fs.writeFileSync(path.join(goldenDir, `${id}.tsx`), src, "utf8");
  console.log(`  wrote ${Object.keys(landscapeSources).length} golden files to ${goldenDir}`);
}
for (const b of BEATS) {
  const goldenPath = path.join(goldenDir, `${b.id}.tsx`);
  const golden = fs.existsSync(goldenPath) ? fs.readFileSync(goldenPath, "utf8") : null;
  check(`${b.id} (${b.template ?? b.mode}) in a 1920x1080 project is byte-identical to the golden`, golden !== null && landscapeSources[b.id] === golden);
}
check("the set covers all 12 templates and the starter", new Set(BEATS.filter((b) => b.template).map((b) => b.template)).size === 12 && BEATS.some((b) => b.mode === "starter"));

console.log("\n== vertical: sources are generated from the 1080x1920 frame ==");
const vertical = await buildProject({ width: 1080, height: 1920 });
const verticalSources = scaffoldAll(vertical, false);
{
  const centred = (src) => /x: 540, y: (9[0-9]{2}|1[0-9]{3})\b/.test(src);
  const landscapeCentre = (src) => /x: 960, y: (4[0-9]{2}|5[0-9]{2}|6[0-9]{2})\b/.test(src);
  const cameraSources = BEATS.filter((b) => !["cta"].includes(b.template));
  for (const b of cameraSources) {
    const src = verticalSources[b.id];
    check(`${b.id}: the camera is centred on the frame, not on 960,540`, centred(src) && !landscapeCentre(src));
  }
  check("the starter's camera centre is exactly 540,960", /\{ frame: 0, x: 540, y: 960,/.test(verticalSources["start-demo"]));
  const framed = BEATS.filter((b) => /const LEFT = /.test(landscapeSources[b.id]));
  check("the frame-positioned templates (browser-capture, existing-asset) were found", framed.length === 2);
  check("their frame is centred on a 1080 wide, 1920 tall stage, not 1920 by 1080",
    framed.every((b) => /const LEFT = \(1080 - FRAME_W\) \/ 2;/.test(verticalSources[b.id]) && /const TOP = \(1920 - FRAME_H\) \/ 2;/.test(verticalSources[b.id])));
  check("the vertical output really differs from the landscape output (control)", BEATS.filter((b) => b.template !== "cta").every((b) => verticalSources[b.id] !== landscapeSources[b.id]));
}

const stitched = runStitchComposition({ projectRoot: vertical.root, videoName: "demo" });
// The two recording beats point at a placeholder file, not a decodable video, so only the rest render.
const renderable = BEATS.filter((b) => !["rec-clip", "gen-clip"].includes(b.id));
const rendered = await runValidateScenesFull({ projectRoot: vertical.root, videoName: "demo", render: true, beatIds: renderable.map((b) => b.id) });
const crops = rendered.findings.filter((f) => f.source === "render" && f.check === "crop");
console.log(`  render findings: ${JSON.stringify(rendered.findings.filter((f) => f.source === "render").map((f) => [f.beatId, f.check, f.severity]))}`);
for (const f of rendered.findings.filter((x) => x.severity === "error")) console.log(`  error: ${f.beatId} ${f.check}: ${f.message}`);
console.log("\n== vertical: validate_scenes render mode on every template ==");
check(`render mode measured all ${renderable.length} renderable beats`, rendered.render?.beatsMeasured === renderable.length && rendered.render.beatsSkipped.length === 0);
check("no crop finding of any severity on a vertical scene", crops.length === 0);

console.log("\n== control: a scene laid out for 1920x1080 does crop in the same project ==");
{
  const root = vertical.root;
  const dir = path.join(vertical.videoDir, "scenes");
  const file = path.join(dir, "SplitDemo.tsx");
  const keep = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, landscapeSources["split-demo"], "utf8");
  const control = await runValidateScenesFull({ projectRoot: root, videoName: "demo", render: true, beatIds: ["split-demo"] });
  const controlCrops = control.findings.filter((f) => f.source === "render" && f.check === "crop");
  check("the landscape split-panel in a 1080x1920 frame is reported as cropped", controlCrops.length > 0);
  fs.writeFileSync(file, keep, "utf8");
}

console.log("\n== vertical: a rendered frame is centred on the frame centre ==");
{
  const bridge = require(path.join(distDir, "remotionBridge.js"));
  const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
  const bundleDir = await bridge.bundleProject(vertical.root);
  const server = await bridge.serveBundleDirectory(bundleDir);
  const remotionBrowser = await bridge.openRenderBrowser();
  let browser = null;
  try {
    const comp = await bridge.resolveComposition(bundleDir, stitched.compositionId, remotionBrowser);
    check("the composition is 1080x1920", comp.width === 1080 && comp.height === 1920);
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
    await bridge.openSeekablePage({ page, bundleUrl: server.url, composition: comp, timeoutMs: 30000 });
    const startOf = (id) => BEATS.findIndex((b) => b.id === id) * DURATION;
    // The stat template centres its number-and-label block on the stage, so that block's centre is where the camera looks.
    const measureStat = async () => {
      await bridge.seekToFrame(page, comp.id, startOf("stat-demo") + 2, 30000);
      return page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span")).filter((s) => s.textContent?.trim() === "0");
        const r = spans[0]?.parentElement?.getBoundingClientRect();
        return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, found: true } : { found: false };
      });
    };
    const real = await measureStat();
    check("the stat number was found in the rendered frame", real.found === true);
    console.log(`  stat number centre: ${JSON.stringify(real)}`);
    check("the stat block's centre is the frame centre (540, 960) to within 6px", real.found && Math.abs(real.cx - 540) <= 6 && Math.abs(real.cy - 960) <= 6);

    // Control: the same scene with the old 960,540 camera centre must measure off the frame centre.
    const statFile = path.join(vertical.videoDir, "scenes", "StatDemo.tsx");
    const statKeep = fs.readFileSync(statFile, "utf8");
    fs.writeFileSync(statFile, statKeep.replace(/x: 540, y: 9\d\d/g, (m) => m.replace("x: 540", "x: 960").replace(/y: 9\d\d/, "y: 540")), "utf8");
    const bundle2 = await bridge.bundleProject(vertical.root);
    const server2 = await bridge.serveBundleDirectory(bundle2);
    try {
      const comp2 = await bridge.resolveComposition(bundle2, stitched.compositionId, remotionBrowser);
      const page2 = await browser.newPage({ viewport: { width: comp2.width, height: comp2.height }, deviceScaleFactor: 1 });
      await bridge.openSeekablePage({ page: page2, bundleUrl: server2.url, composition: comp2, timeoutMs: 30000 });
      await bridge.seekToFrame(page2, comp2.id, startOf("stat-demo") + 2, 30000);
      const off = await page2.evaluate(() => {
        const s = Array.from(document.querySelectorAll("span")).find((x) => x.textContent?.trim() === "0");
        const r = s?.parentElement?.getBoundingClientRect();
        return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null;
      });
      console.log(`  control (camera at 960,540): ${JSON.stringify(off)}`);
      check("control: with the landscape camera centre the block is more than 100px off the frame centre", off !== null && Math.hypot(off.cx - 540, off.cy - 960) > 100);
    } finally {
      await server2.close();
      fs.writeFileSync(statFile, statKeep, "utf8");
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await remotionBrowser.close({ silent: true });
    await server.close();
  }
}

console.log("\n== ChapterHud without a design follows the frame size ==");
{
  // ChapterHud falls back to the layout grid when no design is passed. That grid used to be the
  // 1920x1080 one in every project, so in a reel the rail sat 46px from the bottom, inside
  // Instagram's own interface. It now takes the grid for the composition's size.
  const HUD_SCENE = `import React from "react";
import { useVideoConfig } from "remotion";
import { CinematicScene, Layer, ChapterHud, E } from "@openvidstudio/core";

export const Hud: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <CinematicScene
      camera={[{ frame: 0, x: width / 2, y: height / 2, scale: 1 }, { frame: 30, x: width / 2, y: height / 2, scale: 1.02, easing: E.drift }]}
      overlay={<ChapterHud chapters={[{ label: "One" }, { label: "Two" }]} activeIndex={0} />}
    >
      <Layer depth={0}><div /></Layer>
    </CinematicScene>
  );
};
`;
  const bridge = require(path.join(distDir, "remotionBridge.js"));
  const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
  const railBottomGap = async (width, height) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `ovs-hud-${width}x${height}-`));
    runInitProject({ name: "demo", projectRoot: root, videoConfig: { fps: 30, width, height } });
    fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");
    const videoDir = path.join(root, "src", "videos", "demo");
    fs.mkdirSync(path.join(videoDir, "custom-scenes"), { recursive: true });
    fs.writeFileSync(path.join(videoDir, "custom-scenes", "Hud.tsx"), HUD_SCENE, "utf8");
    fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, narration: "none", beats: [{ id: "hud", start: 0, duration: 30, scene: "./custom-scenes/Hud.tsx" }] }));
    const stitchedHud = runStitchComposition({ projectRoot: root, videoName: "demo" });
    const bundleDir = await bridge.bundleProject(root);
    const server = await bridge.serveBundleDirectory(bundleDir);
    const remotionBrowser = await bridge.openRenderBrowser();
    let browser = null;
    try {
      const comp = await bridge.resolveComposition(bundleDir, stitchedHud.compositionId, remotionBrowser);
      browser = await launchChromium();
      const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
      await bridge.openSeekablePage({ page, bundleUrl: server.url, composition: comp, timeoutMs: 30000 });
      await bridge.seekToFrame(page, comp.id, 20, 30000);
      return await page.evaluate((frameHeight) => {
        const rail = document.querySelectorAll("[data-ovs-hud]")[1];
        return rail ? frameHeight - rail.getBoundingClientRect().bottom : null;
      }, comp.height);
    } finally {
      await browser?.close().catch(() => undefined);
      await remotionBrowser.close({ silent: true });
      await server.close();
    }
  };
  const wide = await railBottomGap(1920, 1080);
  const reel = await railBottomGap(1080, 1920);
  console.log(`  rail bottom gap: 1920x1080 ${wide}px, 1080x1920 ${reel}px`);
  check("1920x1080: the rail sits 46px up, exactly as before (110 margin minus the 64px footprint)", wide !== null && Math.abs(wide - 46) <= 1);
  check("1080x1920: the rail follows the reel's grid, 132px up (196 margin minus 64)", reel !== null && Math.abs(reel - 132) <= 1);
}

finish();

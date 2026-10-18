#!/usr/bin/env node
// vertical: native 9:16 (1080x1920) groundwork. A STEM lesson for Reels has to render natively
// vertical, not as a crop of a 16:9 render, so every primitive that assumed a 1920x1080 frame
// is checked here against a real 1080x1920 composition, and against 1920x1080 for the
// "landscape is unchanged" half. Frames are mounted in a real browser through the Remotion
// bridge and measured from the DOM and the pixels, the same way core-primitives does.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import {
  require,
  packageRoot,
  distDir,
  monorepoRoot,
  monorepoTemplateDir,
  check,
  skip,
  finish,
} from "./_harness.mjs";

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
const bridge = require(path.join(distDir, "remotionBridge.js"));
const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));

/**
 * A throwaway project at the given frame size with custom scenes, one beat per scene, stitched.
 * `scenes` maps a beat id to { source, duration }; beats are laid end to end.
 */
function scaffold({ prefix, videoName, width, height, scenes }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: videoName, projectRoot: root, videoConfig: { fps: 30, width, height } });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
  fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");
  const videoDir = path.join(root, "src", "videos", videoName);
  const customDir = path.join(videoDir, "custom-scenes");
  fs.mkdirSync(customDir, { recursive: true });
  const beats = [];
  let start = 0;
  for (const [id, { source, duration }] of Object.entries(scenes)) {
    const component = id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
    fs.writeFileSync(path.join(customDir, `${component}.tsx`), source, "utf8");
    beats.push({ id, start, duration, scene: `./custom-scenes/${component}.tsx` });
    start += duration;
  }
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, narration: "none", beats }));
  const stitched = runStitchComposition({ projectRoot: root, videoName });
  return { root, videoDir, stitched, beats, beatStart: Object.fromEntries(beats.map((b) => [b.id, b.start])) };
}

/** Bundles the project, mounts its composition in a real browser and hands `fn` a measuring kit. */
async function inBrowser(project, fn) {
  const bundleDir = await bridge.bundleProject(project.root);
  const server = await bridge.serveBundleDirectory(bundleDir);
  const remotionBrowser = await bridge.openRenderBrowser();
  let browser = null;
  try {
    const comp = await bridge.resolveComposition(bundleDir, project.stitched.compositionId, remotionBrowser);
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
    await bridge.openSeekablePage({ page, bundleUrl: server.url, composition: comp, timeoutMs: 30000 });
    const seek = (beatId, local) => bridge.seekToFrame(page, comp.id, project.beatStart[beatId] + local, 30000);
    const frame = async (beatId, local, name) => {
      await seek(beatId, local);
      const file = path.join(project.root, `${name ?? beatId}-${local}.png`);
      await page.screenshot({ path: file });
      const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height, channels: info.channels, file };
    };
    return await fn({ comp, page, seek, frame });
  } finally {
    await browser?.close().catch(() => undefined);
    await remotionBrowser.close({ silent: true });
    await server.close();
  }
}

/** Pixels in the block whose luma is above `threshold`: how many dots (or any bright mark) it holds. */
function brightPixels(img, x0, y0, w, h, threshold = 150) {
  let n = 0;
  for (let y = y0; y < Math.min(img.height, y0 + h); y++) {
    for (let x = x0; x < Math.min(img.width, x0 + w); x++) {
      const i = (y * img.width + x) * img.channels;
      if (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2] > threshold) n++;
    }
  }
  return n;
}

/** Rows from the top of column x that are black before the first non-black one. */
function blackRowsFromTop(img, x) {
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    const i = (y * img.width + x) * img.channels;
    if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 30) break;
    n++;
  }
  return n;
}
function blackRowsFromBottom(img, x) {
  let n = 0;
  for (let y = img.height - 1; y >= 0; y--) {
    const i = (y * img.width + x) * img.channels;
    if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 30) break;
    n++;
  }
  return n;
}

// ---- scenes shared by the vertical and landscape projects ----
// Camera centres come from the composition, the way an author targeting either frame writes them.
const CAMERA = `[{ frame: 0, x: width / 2, y: height / 2, scale: 1 }, { frame: 60, x: width / 2, y: height / 2, scale: 1.02, easing: E.drift }]`;

const DOTS_SCENE = (props = "", gridProps = "") => `import React from "react";
import { useVideoConfig } from "remotion";
import { CinematicScene, Layer, Atmosphere, DotGrid, E } from "@openvidstudio/core";

export const Dots: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <CinematicScene grain={0} vignette={0} ${props} camera={${CAMERA}}>
      <Layer depth={0}>
        <Atmosphere />
        <DotGrid opacity={1} ${gridProps} />
      </Layer>
    </CinematicScene>
  );
};
`;

// A white field under the bars so where a bar ends is unambiguous in the pixels.
const BARS_SCENE = `import React from "react";
import { useVideoConfig } from "remotion";
import { CinematicScene, Layer, Letterbox, E } from "@openvidstudio/core";

export const Bars: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <CinematicScene grain={0} vignette={0} camera={${CAMERA}} overlay={<div id="lb"><Letterbox /></div>}>
      <Layer depth={0}>
        <div style={{ position: "absolute", inset: 0, background: "#ffffff" }} />
      </Layer>
    </CinematicScene>
  );
};
`;

const CTA_SCENE = `import React from "react";
import { RepoCta } from "@openvidstudio/core";

export const Cta: React.FC = () => (
  <RepoCta owner="octo" name="lessons" description="Short STEM lessons, rendered natively for a phone." chips={["TypeScript", "MIT"]} titleText="Try it" />
);
`;

// Prints the layout grid defineDesignSystem builds for each stage, from inside the real bundle.
const DESIGN_SCENE = `import React from "react";
import { AbsoluteFill } from "remotion";
import { defineDesignSystem, DEFAULT_GRID } from "@openvidstudio/core";

export const Design: React.FC = () => {
  const reel = { width: 1080, height: 1920 };
  const wide = { width: 1920, height: 1080 };
  const grids = {
    defaults: DEFAULT_GRID,
    plain: defineDesignSystem().grid,
    wide: defineDesignSystem({ stage: wide }).grid,
    reel: defineDesignSystem({ stage: reel }).grid,
    custom: defineDesignSystem({ stage: reel, grid: { marginTop: 270 } }).grid,
  };
  return (
    <AbsoluteFill>
      <pre id="grids">{JSON.stringify(grids)}</pre>
    </AbsoluteFill>
  );
};
`;

/** What a page.evaluate reads off the dots scene: the camera stage the scene actually got. */
const readStage = () => {
  const stage = document.querySelector("[data-ovs-camera-stage]");
  const r = stage.getBoundingClientRect();
  return { styleW: stage.style.width, styleH: stage.style.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
};
const readBars = () =>
  Array.from(document.querySelectorAll("#lb > div")).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });
const readCard = () => {
  const card = document.querySelector("[data-ovs-repo-card]");
  if (!card) return null;
  const r = card.getBoundingClientRect();
  const glow = card.parentElement.previousElementSibling?.firstElementChild;
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, styleLeft: card.style.left, styleTop: card.style.top, glowLeft: glow?.style.left, glowTop: glow?.style.top };
};

const have = fs.existsSync(templateNodeModules);

console.log("\n== vertical 1: the core primitives follow the composition size, not a fixed 1920x1080 ==");
let vertical = null;
let landscape = null;
if (have) {
  vertical = scaffold({
    prefix: "ovs-vertical-",
    videoName: "reels",
    width: 1080,
    height: 1920,
    scenes: {
      dots: { source: DOTS_SCENE(), duration: 60 },
      bars: { source: BARS_SCENE, duration: 60 },
      cta: { source: CTA_SCENE, duration: 90 },
      design: { source: DESIGN_SCENE, duration: 30 },
    },
  });
  landscape = scaffold({
    prefix: "ovs-landscape-",
    videoName: "wide",
    width: 1920,
    height: 1080,
    scenes: {
      dots: { source: DOTS_SCENE(), duration: 60 },
      // The same scene with the pre-change literals written out: if the defaults moved, these differ.
      "dots-legacy": { source: DOTS_SCENE("stageWidth={1920} stageHeight={1080}", "w={1920} h={1080}").replace("export const Dots:", "export const DotsLegacy:"), duration: 60 },
      bars: { source: BARS_SCENE, duration: 60 },
      cta: { source: CTA_SCENE, duration: 90 },
    },
  });

  check("init_project videoConfig 1080x1920 reaches the registered composition", vertical.stitched.written === true && JSON.parse(fs.readFileSync(path.join(vertical.root, "src", "videos", ".registry.json"), "utf8")).some((e) => e.width === 1080 && e.height === 1920));

  await inBrowser(vertical, async ({ comp, page, seek, frame }) => {
    check(`the resolved composition is 1080x1920 (got ${comp.width}x${comp.height})`, comp.width === 1080 && comp.height === 1920);

    // CinematicScene: stage defaults to the composition
    const dotsImg = await frame("dots", 30);
    await seek("dots", 30);
    const stage = await page.evaluate(readStage);
    console.log(`  dots scene stage: ${stage.styleW} x ${stage.styleH}`);
    check("CinematicScene's stage defaults to the composition size, 1080x1920 (not a silent 1920x1080)", stage.styleW === "1080px" && stage.styleH === "1920px");
    check("...and a camera centred on the composition centre puts the stage centre on the frame centre", Math.abs(stage.cx - 540) < 1 && Math.abs(stage.cy - 960) < 1);

    // DotGrid: covers the whole frame
    const block = 160;
    const corners = {
      "top-left": brightPixels(dotsImg, 0, 0, block, block),
      "top-right": brightPixels(dotsImg, 1080 - block, 0, block, block),
      "bottom-left": brightPixels(dotsImg, 0, 1920 - block, block, block),
      "bottom-right": brightPixels(dotsImg, 1080 - block, 1920 - block, block, block),
    };
    const centre = brightPixels(dotsImg, 540 - block / 2, 960 - block / 2, block, block);
    console.log(`  bright pixels per ${block}x${block} block: ${JSON.stringify(corners)} centre=${centre}`);
    for (const [name, n] of Object.entries(corners)) {
      check(`DotGrid dots reach the ${name} corner of the 1080x1920 frame (${n} bright px, centre has ${centre})`, n >= 8 && n > centre * 0.5);
    }
    // Control meant to fail: the unfixed grid left everything below y=1080 empty.
    const lowerHalf = brightPixels(dotsImg, 0, 1100, 1080, 800);
    check(`control: the lower part of the frame (y 1100-1900) is dotted, which a 1080-tall grid would leave empty (${lowerHalf} px)`, lowerHalf > 800);

    // Letterbox: proportional to the frame height
    const barsImg = await frame("bars", 30);
    await seek("bars", 30);
    const bars = await page.evaluate(readBars);
    const expectedBar = (64 * 1920) / 1080;
    console.log(`  letterbox bars: ${bars.map((b) => b.height.toFixed(2)).join(", ")} (64/1080 of 1920 = ${expectedBar.toFixed(2)})`);
    check("Letterbox draws two bars", bars.length === 2);
    check(`each bar is 64/1080 of the frame height: ${expectedBar.toFixed(2)}px at 1920 tall (not 64px)`, bars.every((b) => Math.abs(b.height - expectedBar) < 0.05));
    const topRows = blackRowsFromTop(barsImg, 540);
    const bottomRows = blackRowsFromBottom(barsImg, 540);
    check(`the rendered pixels agree: ${topRows} black rows at the top, ${bottomRows} at the bottom (about 114)`, topRows >= 112 && topRows <= 115 && bottomRows >= 112 && bottomRows <= 115);

    // RepoCta: centred in the frame it is rendered into
    await seek("cta", 30);
    const ctaStage = await page.evaluate(readStage);
    const card = await page.evaluate(readCard);
    check("RepoCta renders its card (data-ovs-repo-card)", card !== null);
    if (card) {
      const cx = (card.left + card.right) / 2;
      const cy = (card.top + card.bottom) / 2;
      console.log(`  RepoCta stage ${ctaStage.styleW}x${ctaStage.styleH}, centre of stage on screen (${ctaStage.cx.toFixed(1)}, ${ctaStage.cy.toFixed(1)}), card centre (${cx.toFixed(1)}, ${cy.toFixed(1)}), card x ${card.left.toFixed(0)}-${card.right.toFixed(0)}`);
      check("RepoCta's stage is the composition size", ctaStage.styleW === "1080px" && ctaStage.styleH === "1920px");
      check("RepoCta's camera centre is the stage centre: it lands on the frame centre, not on 960,540 of a 1920x1080 stage", Math.abs(ctaStage.cx - 540) < 1 && Math.abs(ctaStage.cy - 960) < 14);
      check("the card is centred horizontally on the 1080-wide frame", Math.abs(cx - 540) < 1.5);
      check(`...vertically within 6% of the frame centre, sitting 190px above centre as it does in 16:9 (card top ${card.styleTop})`, Math.abs(cy - 960) < 1920 * 0.06 && card.styleTop === "770px");
      check("...and inside the frame with at least 80px to spare either side", card.left >= 80 && 1080 - card.right >= 80);
    }

    // designSystem: the grid follows the stage
    await seek("design", 5);
    const grids = JSON.parse(await page.evaluate(() => document.getElementById("grids")?.textContent ?? "{}"));
    console.log(`  grids: ${JSON.stringify(grids)}`);
    const same = (a, b) => a && b && a.marginX === b.marginX && a.marginTop === b.marginTop && a.marginBottom === b.marginBottom;
    check("DEFAULT_GRID is still 150 / 130 / 110", same(grids.defaults, { marginX: 150, marginTop: 130, marginBottom: 110 }));
    check("a design system with no stage keeps the 1920x1080 margins", same(grids.plain, grids.defaults));
    check("...and so does one built for a 1920x1080 stage", same(grids.wide, grids.defaults));
    check("a 1080x1920 stage scales the side margin with the width (150 of 1920 is 84 of 1080) and top and bottom with the height (130 of 1080 is 231 of 1920, 110 is 196)", same(grids.reel, { marginX: 84, marginTop: 231, marginBottom: 196 }));
    check("an explicit grid override still wins over the scaled one", same(grids.custom, { marginX: 84, marginTop: 270, marginBottom: 196 }));
  });

  await inBrowser(landscape, async ({ comp, page, seek, frame }) => {
    check(`landscape control: the composition is 1920x1080 (got ${comp.width}x${comp.height})`, comp.width === 1920 && comp.height === 1080);

    const a = await frame("dots", 30);
    await seek("dots", 30);
    const stage = await page.evaluate(readStage);
    check("landscape: CinematicScene's stage is still 1920x1080", stage.styleW === "1920px" && stage.styleH === "1080px");

    const legacy = await frame("dots-legacy", 30);
    let differing = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== legacy.data[i]) differing++;
    console.log(`  landscape dots, defaults vs the old literals (stage 1920x1080, DotGrid w=1920 h=1080): ${differing} differing bytes of ${a.data.length}`);
    check("landscape: a frame with the defaults is pixel-identical to one with the old hard-coded 1920x1080 written out", differing === 0 && a.width === legacy.width);
    const later = await frame("dots", 45);
    let moved = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== later.data[i]) moved++;
    check(`control: the same comparison does see a difference between two different frames (${moved} bytes), so identical is not vacuous`, moved > 0);

    await seek("bars", 30);
    const bars = await page.evaluate(readBars);
    check(`landscape: Letterbox bars are exactly 64px at 1080 (got ${bars.map((b) => b.height).join(", ")})`, bars.length === 2 && bars.every((b) => b.height === 64));
    const barsImg = await frame("bars", 30);
    check(`...and ${blackRowsFromTop(barsImg, 960)} black rows at the top in the pixels`, blackRowsFromTop(barsImg, 960) === 64 && blackRowsFromBottom(barsImg, 960) === 64);

    await seek("cta", 30);
    const ctaStage = await page.evaluate(readStage);
    const card = await page.evaluate(readCard);
    check("landscape: RepoCta's stage is 1920x1080 and its card keeps its old stage position (left 560, top 350, glow 560,180)", card !== null && ctaStage.styleW === "1920px" && card.styleLeft === "560px" && card.styleTop === "350px" && card.glowLeft === "560px" && card.glowTop === "180px");
    if (card) check("landscape: the card is centred horizontally on the 1920-wide frame", Math.abs((card.left + card.right) / 2 - 960) < 1.5);
  });
} else {
  skip("vertical 1: primitives at 1080x1920", "no resolvable node_modules to scaffold a renderable project from");
}


console.log("\n== vertical 2: validate_scenes reads the frame size from the project, static and render ==");
if (have) {
  const { runValidateScenes, runValidateScenesFull } = require(path.join(distDir, "tools", "validateScenes.js"));
  // Three scenes with a camera that moves (so nothing is "dead") and 1.04x at most, so the visible
  // box is the frame divided by 1.04: 1038x1846 in a 1080x1920 reel, 1846x1038 in 1920x1080.
  const camera = (cx, cy) => `[{ frame: 0, x: ${cx}, y: ${cy}, scale: 1 }, { frame: 90, x: ${cx}, y: ${cy}, scale: 1.04, easing: E.drift }]`;
  const scene = (name, cx, cy, body) => `import React from "react";
import { CinematicScene, E } from "@openvidstudio/core";

export const ${name}: React.FC = () => (
  <CinematicScene camera={${camera(cx, cy)}}>
${body}
  </CinematicScene>
);
`;
  const line = (style, text) => `    <div style={{ position: "absolute", color: "#fff", ${style} }}>${text}</div>`;
  const verticalScenes = {
    // Everything fits inside 1080 wide with room to spare.
    good: { duration: 120, source: scene("Good", 540, 960, [line("left: 120, top: 700, width: 840, fontSize: 72", "Ship the demo"), line("left: 120, top: 900, width: 840, fontSize: 40", "Ten tools, one pipeline.")].join("\n")) },
    // A 1500px wide block: fine in a 1920 frame, wider than a whole 1080 frame.
    wide: { duration: 90, source: scene("Wide", 540, 960, line("left: 60, top: 700, width: 1500, fontSize: 40", "This block is wider than the reel")) },
    // Placed at x=1500: outside a 1080 frame entirely. Only the render can see a position.
    offscreen: { duration: 90, source: scene("Offscreen", 540, 960, line('left: 1500, top: 800, fontSize: 40, whiteSpace: "nowrap"', "Placed beyond the right edge")) },
  };
  const vcheck = scaffold({ prefix: "ovs-vcheck-", videoName: "vcheck", width: 1080, height: 1920, scenes: verticalScenes });
  const wcheck = scaffold({
    prefix: "ovs-wcheck-",
    videoName: "wcheck",
    width: 1920,
    height: 1080,
    scenes: {
      good: { duration: 120, source: scene("Good", 960, 540, line("left: 300, top: 360, width: 1200, fontSize: 72", "Ship the demo")) },
      // The same 1500px block as the reel's "wide": fine here.
      wide: verticalScenes.wide,
      // 1900 wide against a 1846 visible box: still caught in landscape.
      toowide: { duration: 90, source: scene("Toowide", 960, 540, line("left: 10, top: 360, width: 1900, fontSize: 40", "Wider than the visible box")) },
    },
  });

  const framing = (res, beatId) => res.findings.filter((f) => f.source === "static" && f.beatId === beatId && /Content declares/.test(f.message));
  const vStatic = runValidateScenes({ projectRoot: vcheck.root, videoName: "vcheck" });
  const wStatic = runValidateScenes({ projectRoot: wcheck.root, videoName: "wcheck" });
  console.log(`  static, 1080x1920: ${JSON.stringify(vStatic.findings.filter((f) => /Content declares/.test(f.message)).map((f) => [f.beatId, f.message.slice(0, 96)]))}`);

  check("1080x1920: a block that fits the frame is not flagged", framing(vStatic, "good").length === 0);
  check("1080x1920: a 1500px block is flagged as an error, against the 1080x1920 frame (1038x1846 visible at 1.04x)", framing(vStatic, "wide").length === 1 && framing(vStatic, "wide")[0].severity === "error" && framing(vStatic, "wide")[0].message.includes("1038x1846"));
  check("1920x1080 control: the same 1500px block is fine", framing(wStatic, "wide").length === 0);
  check("1920x1080 control: a correct scene is not flagged", framing(wStatic, "good").length === 0);
  check("1920x1080 control: a 1900px block is still flagged, against 1846x1038", framing(wStatic, "toowide").length === 1 && framing(wStatic, "toowide")[0].message.includes("1846x1038"));

  // The render pass reads the real composition size, so a position the static pass cannot see is found.
  const rendered = await runValidateScenesFull({ projectRoot: vcheck.root, videoName: "vcheck", render: true });
  const crops = (beatId) => rendered.findings.filter((f) => f.source === "render" && f.beatId === beatId && f.check === "crop");
  const anyRender = (beatId) => rendered.findings.filter((f) => f.source === "render" && f.beatId === beatId);
  console.log(`  render, 1080x1920: ${JSON.stringify(rendered.findings.filter((f) => f.source === "render").map((f) => [f.beatId, f.check, f.severity]))}`);
  check("render mode on the reel measured all three beats", rendered.render?.beatsMeasured === 3 && rendered.render.beatsSkipped.length === 0);
  check("render: a correct vertical scene has no render findings at all", anyRender("good").length === 0);
  check("render: text placed at x=1500 in the 1080-wide frame is a crop error", crops("offscreen").length === 1 && crops("offscreen")[0].severity === "error" && crops("offscreen")[0].message.includes("Placed beyond"));
  check("render: the 1500px block holds only a short line that fits, so only the static pass reports it", crops("wide").length === 0);
  check("the overflow makes the result not ok", rendered.ok === false);
}


console.log("\n== vertical 4: export_rendition reels, measured with ffprobe on real files ==");
{
  const { runExportRendition, planReelsExport } = require(path.join(distDir, "tools", "exportRendition.js"));
  const ffOk = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
  if (!ffOk) {
    skip("vertical 4: export_rendition reels", "ffmpeg or ffprobe is not available");
  } else {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-reels-"));
    fs.mkdirSync(path.join(root, "output"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "videos", "lesson"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "videos", "lesson", "beats.json"), JSON.stringify({ fps: 30, beats: [{ id: "one", start: 0, duration: 60 }] }));

    const ff = (args) => {
      const r = spawnSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", ...args], { cwd: root, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed: ${r.stderr}`);
    };
    // A real source: moving test pattern plus a tone, 2 seconds. No faststart, so moov lands after mdat.
    const make = (name, { size = "1080x1920", rate = 30, audio = "aac" } = {}) => {
      const args = ["-f", "lavfi", "-i", `testsrc2=size=${size}:rate=${rate}:duration=2`];
      if (audio) args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2");
      args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
      if (audio) args.push("-c:a", audio);
      args.push(path.join("output", name));
      ff(args);
      return path.join("output", name);
    };
    const probe = (rel) => {
      const r = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path.join(root, rel)], { encoding: "utf8" });
      const doc = JSON.parse(r.stdout);
      return { video: doc.streams.find((st) => st.codec_type === "video"), audio: doc.streams.find((st) => st.codec_type === "audio"), duration: Number.parseFloat(doc.format.duration) };
    };
    // Top-level mp4 boxes in file order: faststart means moov comes before mdat.
    const boxOrder = (rel) => {
      const fd = fs.openSync(path.join(root, rel), "r");
      const size = fs.fstatSync(fd).size;
      const names = [];
      let pos = 0;
      const head = Buffer.alloc(16);
      while (pos + 8 <= size) {
        fs.readSync(fd, head, 0, 16, pos);
        let len = head.readUInt32BE(0);
        names.push(head.toString("latin1", 4, 8));
        if (len === 1) len = Number(head.readBigUInt64BE(8));
        if (len === 0) break;
        pos += len;
      }
      fs.closeSync(fd);
      return names;
    };
    const streamMd5 = (rel, map) => {
      const r = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-i", path.join(root, rel), "-map", map, "-c", "copy", "-f", "md5", "-"], { encoding: "utf8" });
      return r.stdout.trim();
    };
    const reels = (inPath, outName, extra = {}) => runExportRendition({ projectRoot: root, videoName: "lesson", format: "reels", inPath, outPath: path.join("output", outName), ...extra });
    const oneFrame = 1 / 30 + 1e-3;

    // 1. A native vertical H.264 + AAC 30fps source: nothing to re-encode, only the container to fix.
    const native = make("native.mp4");
    const nativeBoxes = boxOrder(native);
    check(`control: the fixture itself is not faststart (boxes ${nativeBoxes.join(",")})`, nativeBoxes.indexOf("moov") > nativeBoxes.indexOf("mdat"));
    const a = await reels(native, "native-reels.mp4");
    const pa = probe(a.files[0]);
    console.log(`  native source: ${pa.video.width}x${pa.video.height} ${pa.video.codec_name}/${pa.audio.codec_name} ${pa.video.r_frame_rate}, ${pa.duration.toFixed(3)}s, boxes ${boxOrder(a.files[0]).join(",")}, copy video=${!a.reels.videoReencoded} audio=${!a.reels.audioReencoded}`);
    check("reels from a native 1080x1920 source is 1080x1920 H.264 + AAC at 30fps", pa.video.width === 1080 && pa.video.height === 1920 && pa.video.codec_name === "h264" && pa.audio.codec_name === "aac" && pa.video.r_frame_rate === "30/1");
    check("...with the duration within one frame of the source", Math.abs(pa.duration - probe(native).duration) < oneFrame);
    check("...faststart: moov comes before mdat", boxOrder(a.files[0]).indexOf("moov") < boxOrder(a.files[0]).indexOf("mdat"));
    check("...and it re-encoded nothing: the video and audio streams are byte-identical to the source", a.reels.videoReencoded === false && a.reels.audioReencoded === false && streamMd5(a.files[0], "0:v:0") === streamMd5(native, "0:v:0") && streamMd5(a.files[0], "0:a:0") === streamMd5(native, "0:a:0"));
    check("...and the result reports what was measured on disk", a.reels.width === 1080 && a.reels.height === 1920 && a.reels.fps === 30 && a.reels.bytes === fs.statSync(path.join(root, a.files[0])).size);

    // 2. 60fps video with mp3 audio: both streams have to be re-encoded, and only they.
    const rough = make("rough.mp4", { rate: 60, audio: "libmp3lame" });
    const b = await reels(rough, "rough-reels.mp4");
    const pb = probe(b.files[0]);
    console.log(`  60fps + mp3 source: ${pb.video.width}x${pb.video.height} ${pb.video.codec_name}/${pb.audio.codec_name} ${pb.video.r_frame_rate}, ${pb.duration.toFixed(3)}s, re-encoded video=${b.reels.videoReencoded} audio=${b.reels.audioReencoded}`);
    check("a 60fps source comes out at 30fps H.264 with the mp3 audio turned into AAC", pb.video.r_frame_rate === "30/1" && pb.video.codec_name === "h264" && pb.audio.codec_name === "aac" && b.reels.videoReencoded === true && b.reels.audioReencoded === true);
    check("...duration within one frame, faststart", Math.abs(pb.duration - probe(rough).duration) < oneFrame && boxOrder(b.files[0]).indexOf("moov") < boxOrder(b.files[0]).indexOf("mdat"));

    // 3. A smaller 9:16 source is scaled up to the Reels frame; its AAC is still copied.
    const small = make("small.mp4", { size: "720x1280" });
    const c = await reels(small, "small-reels.mp4");
    const pc = probe(c.files[0]);
    check("a 720x1280 source is scaled to 1080x1920 (video re-encoded, AAC copied)", pc.video.width === 1080 && pc.video.height === 1920 && c.reels.videoReencoded === true && c.reels.audioReencoded === false);

    // 4. A silent vertical source stays silent; the video is still copied.
    const silent = make("silent.mp4", { audio: null });
    const d = await reels(silent, "silent-reels.mp4");
    const pd = probe(d.files[0]);
    check("a silent source gets no audio track made up, and says so", pd.audio === undefined && d.reels.audioCodec === null && d.notes.join(" ").includes("no audio") && d.reels.videoReencoded === false);

    // 5. Not vertical: refuse rather than crop. Nothing is written.
    const wide = make("wide.mp4", { size: "1920x1080" });
    let refusal = "";
    try { await reels(wide, "wide-reels.mp4"); } catch (err) { refusal = err instanceof Error ? err.message : String(err); }
    console.log(`  16:9 refusal: ${refusal.slice(0, 160)}`);
    check("a 1920x1080 source is refused, naming its size and pointing at reformat_vertical and a native render", refusal.includes("1920x1080") && refusal.includes("reformat_vertical") && refusal.includes("videoConfig"));
    check("...and no file is written for it", !fs.existsSync(path.join(root, "output", "wide-reels.mp4")));
    const feed = make("feed.mp4", { size: "1080x1350" });
    let feedRefusal = "";
    try { await reels(feed, "feed-reels.mp4"); } catch (err) { feedRefusal = err instanceof Error ? err.message : String(err); }
    check("control: a 4:5 feed-shaped 1080x1350 source is not 9:16 either and is refused", feedRefusal.includes("1080x1350") && !fs.existsSync(path.join(root, "output", "feed-reels.mp4")));

    // The plan is pure: the same decisions without touching ffmpeg.
    const base = { width: 1080, height: 1920, fps: 30, videoCodec: "h264", pixFmt: "yuv420p", audioCodec: "aac" };
    check("planReelsExport: the exact target needs no re-encode", (() => { const p = planReelsExport(base); return p.ok && !p.videoReencode && !p.audioReencode; })());
    check("planReelsExport: HEVC, a 4:2:2 pixel format or 24fps each force a video re-encode", [{ videoCodec: "hevc" }, { pixFmt: "yuv422p" }, { fps: 24 }].every((o) => planReelsExport({ ...base, ...o }).videoReencode === true));
    check("planReelsExport: 2160x3840 is 9:16 and gets scaled", (() => { const p = planReelsExport({ ...base, width: 2160, height: 3840 }); return p.ok && p.videoReencode && p.scale; })());
  }
}

console.log("\n== vertical 5: the docs and the tool descriptions say what the code does ==");
{
  const pipeline = fs.readFileSync(path.join(monorepoRoot, "packages", "docs", "PIPELINE.md"), "utf8").replace(/\r\n/g, "\n");
  const start = pipeline.indexOf("## Native vertical (9:16)");
  const end = start < 0 ? -1 : pipeline.indexOf("\n## ", start + 5);
  const section = start < 0 ? "" : pipeline.slice(start, end < 0 ? undefined : end);
  check("PIPELINE.md has a Native vertical (9:16) section", start >= 0);
  check("...which says to scaffold with init_project videoConfig 1080x1920 and why not reformat_vertical (a crop cuts diagrams)", /init_project/.test(section) && /videoConfig/.test(section) && /1080x1920/.test(section) && /reformat_vertical/.test(section) && /cropped|cut off/.test(section));

  // The 608x1080 slice the section quotes is the real crop reformat_vertical takes.
  const { cropRect } = require(path.join(distDir, "tools", "reformatVertical.js"));
  const slice = cropRect(1920, 1080, 1080, 1920, "center");
  check(`...and the slice it quotes is the real one (${slice.width}x${slice.height}, ${((slice.width / 1920) * 100).toFixed(1)}% of the width)`, section.includes(`${slice.width}x${slice.height}`) && slice.width / 1920 < 1 / 3 && section.includes("under a third"));

  // Safe zones: the percentages and the pixels they come to at 1080x1920.
  const px = { top: Math.round((1920 * 0.14) / 10) * 10, bottom: Math.round((1920 * 0.22) / 10) * 10, right: Math.round(1080 * 0.1) };
  console.log(`  safe zones at 1080x1920: top ${px.top}, bottom ${px.bottom}, right ${px.right}`);
  check("the safe zones are about 14% top, 22% bottom and 10% right, with the pixel values those make at 1080x1920 (270, 420, 108)", ["14%", "22%", "10%"].every((p) => section.includes(p)) && section.includes(String(px.top)) && section.includes(String(px.bottom)) && section.includes(String(px.right)) && px.top === 270 && px.bottom === 420 && px.right === 108);
  check("...and are labelled approximate, to be checked against Instagram's current guidance", /approximate/i.test(section) && section.includes("Instagram's current guidance"));
  check("the design.ts numbers it quotes are the ones defineDesignSystem produces for 1080x1920 (84 / 231 / 196)", section.includes("84 / 231 / 196") && section.includes("150 / 130 / 110"));
  check("it lists what follows the frame size", ["CinematicScene", "DotGrid", "Letterbox", "RepoCta", "defineDesignSystem", "validate_scenes", "export_rendition"].every((n) => section.includes(n)));
  check("the Other outputs list points at the new section from both reformat_vertical and the reels format", pipeline.slice(pipeline.indexOf("### Other outputs"), start).includes('format: "reels"') && /Native vertical \(9:16\)" below/.test(pipeline));
  check("the section has no em dashes", !section.includes(String.fromCharCode(0x2014)));

  const { createMcpServer } = require(path.join(distDir, "server.js"));
  const tools = createMcpServer(undefined)._registeredTools;
  check("reformat_vertical's description points at the native vertical section and the reels export", /Native vertical \(9:16\)/.test(tools.reformat_vertical.description) && tools.reformat_vertical.description.includes("export_rendition"));
  check("export_rendition's description documents the reels format and its refusal of a 16:9 render", tools.export_rendition.description.includes('format: "reels"') && /refuses a 16:9 render/.test(tools.export_rendition.description));
  const formatSchema = tools.export_rendition.inputSchema?.shape?.format;
  if (formatSchema) {
    check("export_rendition's input schema accepts reels and still rejects an unknown format", formatSchema.safeParse("reels").success && !formatSchema.safeParse("reelz").success);
  } else {
    skip("export_rendition's input schema accepts reels", "the registered tool does not expose a zod shape");
  }
}

finish();

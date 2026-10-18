#!/usr/bin/env node
// vertical: native 9:16 (1080x1920) groundwork. A STEM lesson for Reels has to render natively
// vertical, not as a crop of a 16:9 render, so every primitive that assumed a 1920x1080 frame
// is checked here against a real 1080x1920 composition, and against 1920x1080 for the
// "landscape is unchanged" half. Frames are mounted in a real browser through the Remotion
// bridge and measured from the DOM and the pixels, the same way core-primitives does.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  require,
  packageRoot,
  distDir,
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

finish();

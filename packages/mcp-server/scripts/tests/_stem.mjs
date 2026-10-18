// Shared helpers for the stem primitive tests (Spark, Nova, Axes, Equation ...): a throwaway
// supernova project at a given frame size, built from custom scenes, and a real browser mounted on
// its composition so a test can seek a frame, read the DOM and read the pixels. Not a test file
// (the runner only picks up *.test.mjs).

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { require, packageRoot, distDir, monorepoTemplateDir } from "./_harness.mjs";

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
const bridge = require(path.join(distDir, "remotionBridge.js"));
const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));

export const haveNodeModules = fs.existsSync(templateNodeModules);
export { sharp, bridge };

/**
 * A supernova project of `width` x `height` with one beat per scene. `scenes` maps a beat id to
 * { source, duration }; beats run end to end. Returns where each beat starts.
 */
export function lessonProject({ prefix = "ovs-stem-", width, height, scenes, extraFiles = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "lesson", projectRoot: root, mode: "supernova", videoConfig: { fps: 30, width, height } });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
  fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");
  const videoDir = path.join(root, "src", "videos", "lesson");
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
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, narration: "none", production: { mode: "supernova" }, beats }));
  for (const [rel, content] of Object.entries(extraFiles)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const stitched = runStitchComposition({ projectRoot: root, videoName: "lesson" });
  return { root, videoDir, stitched, beats, beatStart: Object.fromEntries(beats.map((b) => [b.id, b.start])), width, height };
}

/** Bundles the project, mounts its composition in a real browser and hands `fn` a measuring kit. */
export async function inBrowser(project, fn) {
  const bundleDir = await bridge.bundleProject(project.root);
  const server = await bridge.serveBundleDirectory(bundleDir);
  const remotionBrowser = await bridge.openRenderBrowser();
  let browser = null;
  try {
    const comp = await bridge.resolveComposition(bundleDir, project.stitched.compositionId, remotionBrowser);
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err && err.message ? err.message : err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await bridge.openSeekablePage({ page, bundleUrl: server.url, composition: comp, timeoutMs: 30000 });
    const seek = (beatId, local) => bridge.seekToFrame(page, comp.id, project.beatStart[beatId] + local, 30000);
    let shot = 0;
    /** Seeks to a frame of a beat and returns its pixels. */
    const frame = async (beatId, local) => {
      await seek(beatId, local);
      const file = path.join(project.root, `shot-${shot++}-${beatId}-${local}.png`);
      await page.screenshot({ path: file });
      const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height, channels: info.channels, file };
    };
    return await fn({ comp, page, seek, frame, errors });
  } finally {
    await browser?.close().catch(() => undefined);
    await remotionBrowser.close({ silent: true });
    await server.close();
  }
}

export const luma = (img, x, y) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * img.channels;
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
};
export const rgb = (img, x, y) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
/** Mean luma over the whole frame. */
export const meanLuma = (img) => {
  let sum = 0;
  for (let i = 0; i < img.data.length; i += img.channels) sum += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  return sum / (img.data.length / img.channels);
};
/** Centroid of the pixels whose luma is above `threshold`, inside an optional box. */
export function brightCentroid(img, threshold, box = { x: 0, y: 0, w: img.width, h: img.height }) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = Math.max(0, box.y); y < Math.min(img.height, box.y + box.h); y++) {
    for (let x = Math.max(0, box.x); x < Math.min(img.width, box.x + box.w); x++) {
      if (luma(img, x, y) > threshold) {
        n++;
        sx += x;
        sy += y;
      }
    }
  }
  return n === 0 ? null : { x: sx / n, y: sy / n, n };
}
export const sameBytes = (a, b) => a.data.length === b.data.length && Buffer.compare(a.data, b.data) === 0;

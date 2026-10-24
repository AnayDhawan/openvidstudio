// Runs the styles package in a real headless Chromium canvas. Used by scripts/build-styles-gallery.mjs and by
// the styles-*.test.mjs files in packages/mcp-server/scripts/tests/. The TypeScript is bundled with esbuild
// (already in the workspace) into one script that exposes everything as window.OVS.

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const stylesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(stylesRoot, "..", "..");

export async function bundleStyles() {
  const esbuild = require(path.join(stylesRoot, "node_modules", "esbuild"));
  const out = await esbuild.build({
    entryPoints: [path.join(stylesRoot, "src", "index.ts")],
    bundle: true,
    format: "iife",
    globalName: "OVS",
    target: "es2020",
    write: false,
  });
  return out.outputFiles[0].text;
}

/** Launches Chromium through the capture package and opens a page with the bundle loaded. Null when no browser is installed. */
export async function openStylesPage({ width = 720, height = 1280 } = {}) {
  const capture = path.join(repoRoot, "packages", "capture", "dist", "index.js");
  if (!fs.existsSync(capture)) return { error: "packages/capture is not built (pnpm --filter @openvidstudio/capture build)" };
  const { launchChromium } = require(capture);
  let browser;
  try {
    browser = await launchChromium();
  } catch (err) {
    return { error: String(err.message || err).split("\n")[0] };
  }
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0"><canvas id="c" width="${width}" height="${height}"></canvas></body>`);
  await page.addScriptTag({ content: await bundleStyles() });
  return { browser, page, close: () => browser.close() };
}

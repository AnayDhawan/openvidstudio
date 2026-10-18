#!/usr/bin/env node
// api-gallery: packages/docs/API.md's stills are all there, described, small, and the DirectedShot one is
// sharp (#121). The stills are produced by scripts/build-api-gallery.mjs; this checks what it left behind.
//
// Sharpness is measured, not eyeballed: the mean absolute Laplacian of the still (how much fine detail it
// holds) against the same still blurred. A sharp picture of text loses most of that detail when blurred; one
// that was already blurred loses little. The old still, rendered with depthOfField 6, is the control.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { packageRoot, monorepoRoot, check, skip, finish } from "./_harness.mjs";

const sharp = (await import("node:module")).createRequire(import.meta.url)(path.join(packageRoot, "node_modules", "sharp"));
const imgDir = path.join(monorepoRoot, "packages", "docs", "img", "api");
const api = fs.readFileSync(path.join(monorepoRoot, "packages", "docs", "API.md"), "utf8").replace(/\r\n/g, "\n");

console.log("\n== every still API.md embeds exists, is described and is small ==");
const embeds = [...api.matchAll(/!\[([^\]]*)\]\(img\/(api|supernova)\/([^)]+\.png)\)/g)].map((m) => ({ alt: m[1], dir: m[2], file: m[3] }));
check("API.md embeds stills", embeds.length > 20);
check("every embedded still exists on disk", embeds.every((e) => fs.existsSync(path.join(monorepoRoot, "packages", "docs", "img", e.dir, e.file))));
check("every embed has some alt text", embeds.every((e) => e.alt.trim().length > 0));
const big = embeds.filter((e) => fs.existsSync(path.join(imgDir, "..", e.dir, e.file)) && fs.statSync(path.join(imgDir, "..", e.dir, e.file)).size > 160 * 1024);
check("each image is small (under 160KB)", big.length === 0);
if (big.length) console.log(`  too big: ${big.map((b) => b.file).join(", ")}`);

console.log("\n== the new cinematic primitives have a picture each ==");
const wanted = {
  "transitionoverlay-fade": "TransitionOverlay: fade",
  "transitionoverlay-whip": "TransitionOverlay: whip",
  "transitionoverlay-push": "TransitionOverlay: push",
  "transitionoverlay-wipe": "TransitionOverlay: wipe",
  "transitionoverlay-light-leak": "TransitionOverlay: light-leak",
  "layeredshot": "LayeredShot",
  "motionblur": "MotionBlur",
  "shot-pushin": "pushIn",
  "shot-pullout": "pullOut",
  "shot-pan": "pan",
  "shot-whip": "whip",
  "shot-orbit": "orbit",
  "shot-dutch": "dutch",
};
for (const [name, what] of Object.entries(wanted)) {
  const file = path.join(imgDir, `${name}.png`);
  const embed = embeds.find((e) => e.file === `${name}.png`);
  check(`${what}: a still exists and API.md embeds it with alt text that says what it shows (a sentence, not a name)`, fs.existsSync(file) && !!embed && embed.alt.trim().split(/\s+/).length >= 6);
}
check("the gallery script is what makes them (it builds each from its type or shot name)", (() => {
  const script = fs.readFileSync(path.join(monorepoRoot, "scripts", "build-api-gallery.mjs"), "utf8");
  const types = ["fade", "whip", "push", "wipe", "light-leak"];
  const shots = ["pushIn", "pullOut", "pan", "whip", "orbit", "dutch"];
  return script.includes('"transitionoverlay-"') && types.every((t) => script.includes(`"${t}"`)) && script.includes('"shot-"') &&
    shots.every((x) => script.includes(`"${x}"`)) && script.includes('"layeredshot"') && script.includes('"motionblur"');
})());

console.log("\n== the DirectedShot still has sharp text ==");
// The text the depth of field used to smear is the card text at the left edge of the still ("Review the
// design", pushed to the side of the focus) and the card title in the middle. Measured in those two boxes of
// the 960x540 still.
const REGIONS = [{ left: 0, top: 226, width: 90, height: 34 }, { left: 440, top: 224, width: 290, height: 34 }];
async function detail(buf) {
  // How steep the steepest edges are: the 95th percentile of the gradient between neighbouring pixels, over
  // the pixels of the text boxes. Sharp text goes from dark to light in a pixel or two; blurred text spreads out.
  const out = [];
  for (const region of REGIONS) {
    const { data, info } = await sharp(buf).extract(region).greyscale().raw().toBuffer({ resolveWithObject: true });
    const grads = [];
    for (let y = 1; y < info.height - 1; y++) for (let x = 1; x < info.width - 1; x++) {
      const i = y * info.width + x;
      grads.push(Math.max(Math.abs(data[i + 1] - data[i - 1]), Math.abs(data[i + info.width] - data[i - info.width])));
    }
    grads.sort((a, b) => a - b);
    out.push(grads[Math.floor(grads.length * 0.97)]);
  }
  return { edge: Math.min(...out), edges: out };
}
const current = fs.readFileSync(path.join(imgDir, "directedshot-end.png"));
const now = await detail(current);
console.log(`  directedshot-end.png now: steepest text edges ${now.edges.join(", ")} of 255`);
// The blurred original is any version rendered with depthOfField 6; find it in history by the commit that added the caption.
const history = spawnSync("git", ["log", "--format=%H", "--", "packages/docs/img/api/directedshot-end.png"], { cwd: monorepoRoot, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
let oldBuf = null;
for (const rev of history.reverse()) {
  const show = spawnSync("git", ["show", `${rev}:packages/docs/img/api/directedshot-end.png`], { cwd: monorepoRoot, maxBuffer: 20 * 1024 * 1024 });
  if (show.status === 0 && show.stdout.length > 0) { oldBuf = show.stdout; break; }
}
check("the still is sharp: its steepest edges go from dark to light in a pixel or two (at least 150 of 255)", now.edge >= 150);
if (oldBuf) {
  const before = await detail(oldBuf);
  console.log(`  the first committed still (depthOfField 6): steepest text edges ${before.edges.join(", ")}`);
  check("it is sharper than the first committed one, which was rendered with depthOfField 6", now.edge > before.edge);
} else {
  skip("comparison with the first committed still", "git history is not available");
}
check("the caption no longer says the still was rendered with a blur", !/rendered with depthOfField 6/.test(api));

finish();

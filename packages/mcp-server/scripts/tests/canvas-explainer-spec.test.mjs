#!/usr/bin/env node
// canvas-explainer-spec: the skeleton in packages/docs/EXPLAINERS.md is a working explainer.
//
// The doc is the contract handed to people and generators, so its example must stay true. The first html block
// that starts with <!doctype html> is written to a temp folder and run through the real validator at both Reel
// sizes (no finding at all) and the real renderer at 720x1280 (frame count, size, an audio stream). It also checks
// that the doc names every promise the renderer refuses a file for, and that the voice-over path reads window.BEATS.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, monorepoRoot, check, skip, finish } from "./_harness.mjs";
import { haveMedia, tmpDir, writeExplainer, probe } from "./_canvas.mjs";

const doc = fs.readFileSync(path.join(monorepoRoot, "packages", "docs", "EXPLAINERS.md"), "utf8");

console.log("\n== the doc ==");
const block = /```html\r?\n(<!doctype html>[\s\S]*?)```/i.exec(doc);
check("it has an html skeleton that starts with a doctype", !!block);
for (const name of ["window.seek(t)", "window.DURATION", "window.scoreSound(kit)", "window.SOUND.renderOffline", "window.OVS", "window.BEATS", "window.CAPTIONS.draw"]) {
  check(`it names ${name}`, doc.includes(name));
}
check("it points at validate_canvas_explainer and render_canvas_explainer", doc.includes("validate_canvas_explainer") && doc.includes("render_canvas_explainer"));
check("it has the prompt for a generator", /```text\r?\nWrite ONE self-contained HTML file/.test(doc));
check("no em dash", !doc.includes("—"));

if (!block) {
  finish();
  process.exit(process.exitCode ?? 1);
}
const skeleton = block[1];
check("the skeleton calls the three promises and the sound kit", ["window.seek", "window.DURATION", "window.scoreSound", "window.SOUND"].every((n) => skeleton.includes(n)));
check("the skeleton never uses Math.random", !skeleton.includes("Math.random"));

const { validateCanvasExplainer } = require(path.join(distDir, "canvasValidate.js"));
const dir = tmpDir("ovs-canvas-spec-");
const file = writeExplainer(dir, "skeleton.html", skeleton);

console.log("\n== the validator ==");
for (const [w, h] of [[720, 1280], [1080, 1920]]) {
  const r = await validateCanvasExplainer({ htmlPath: file, width: w, height: h });
  console.log(`  ${w}x${h}: ${JSON.stringify(r.findings.map((f) => f.check))}`);
  check(`no finding at ${w}x${h}, and ok`, r.ok === true && r.findings.length === 0);
}

console.log("\n== the renderer ==");
if (!haveMedia) {
  skip("render the skeleton", "ffmpeg or ffprobe is not installed");
} else {
  const { runCanvasExplainer } = require(path.join(distDir, "canvasExplainer.js"));
  const out = path.join(dir, "skeleton.mp4");
  const r = await runCanvasExplainer({ htmlPath: file, outPath: out, width: 720, height: 1280, fps: 30 });
  const p = probe(out);
  console.log(`  ${p.frames} frames, ${p.duration.toFixed(2)}s, ${p.video.width}x${p.video.height}, audio ${p.audio?.codec_name}`);
  check("4 seconds at 30 fps is 120 frames", r.frames === 120 && p.frames === 120);
  check("720x1280, H.264, with an audio stream", p.video.width === 720 && p.video.height === 1280 && p.video.codec_name === "h264" && !!p.audio);
  check("the picture moves (first and last frame differ)", r.frameHashes.first !== r.frameHashes.last);
  check("no warnings from the renderer", (r.warnings ?? []).length === 0);
}

finish();

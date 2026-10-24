#!/usr/bin/env node
// render-canvas-explainer: an HTML canvas explainer becomes a video (#151).
//
// A small fixture explainer (a block that moves and a colour that changes with t, a short tone) goes through the
// real renderer, headless Chromium and ffmpeg, and the video is read back with ffprobe. Checks: the frame count,
// the duration, the audio stream, both sizes, the purity promise as frame hashes, the refusal of a file that
// lacks the promises, the Math.random warning, the pre-flight, silent video and the async job.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, check, skip, finish } from "./_harness.mjs";
import { haveMedia, tmpDir, explainer, writeExplainer, probe, audioSamples, amplitudeAt, TONE_SCORE } from "./_canvas.mjs";

if (!haveMedia) {
  skip("render_canvas_explainer", "ffmpeg or ffprobe is not installed");
  finish();
  process.exit(process.exitCode ?? 0);
}

const { runCanvasExplainer } = require(path.join(distDir, "canvasExplainer.js"));
const { createMcpServer } = require(path.join(distDir, "server.js"));
const { runJobStatus } = require(path.join(distDir, "tools", "jobStatus.js"));
const dir = tmpDir("ovs-canvas-render-");
const out = (name) => path.join(dir, name);

console.log("\n== a fixture renders at 1280x720 ==");
const clean = writeExplainer(dir, "clean.html", explainer({ duration: 2 }));
const wide = await runCanvasExplainer({ htmlPath: clean, outPath: out("wide.mp4"), fps: 30 });
{
  const p = probe(out("wide.mp4"));
  console.log(`  ${p.frames} frames, ${p.duration.toFixed(3)}s, ${p.video.width}x${p.video.height}, audio ${p.audio?.codec_name}`);
  check("the frame count is round(DURATION * fps) = 60", wide.frames === 60 && p.frames === 60);
  check("the duration is 2 seconds", Math.abs(p.duration - 2) < 0.05);
  check("1280x720 by default, H.264 in yuv420p", p.video.width === 1280 && p.video.height === 720 && p.video.codec_name === "h264" && p.video.pix_fmt === "yuv420p");
  check("there is an audio stream, with the score's tone in it", !!p.audio && amplitudeAt(audioSamples(out("wide.mp4")), 0.3, 1.7, 440) > 0.3);
  check("the result says what was rendered", wide.width === 1280 && wide.height === 720 && wide.fps === 30 && wide.audio.included === true && wide.audio.voiceover === false);
}

console.log("\n== the same file twice gives the same frames ==");
{
  const again = await runCanvasExplainer({ htmlPath: clean, outPath: out("wide2.mp4"), fps: 30 });
  check("first, middle and last frame hash the same on a second render", wide.frameHashes.first === again.frameHashes.first && wide.frameHashes.middle === again.frameHashes.middle && wide.frameHashes.last === again.frameHashes.last);
  check("the three hashes differ from each other (the picture moves)", new Set(Object.values(wide.frameHashes)).size === 3);
}

console.log("\n== a vertical canvas ==");
{
  const r = await runCanvasExplainer({ htmlPath: clean, outPath: out("tall.mp4"), width: 720, height: 1280 });
  const p = probe(out("tall.mp4"));
  check("720x1280 renders at that size", p.video.width === 720 && p.video.height === 1280 && r.frames === 60);
  check("and its first frame is not the 1280x720 one", r.frameHashes.first !== wide.frameHashes.first);
}

console.log("\n== a file without the promises is refused ==");
{
  const bare = writeExplainer(dir, "bare.html", `<!doctype html><canvas></canvas><script>window.seek = function () {};</script>`);
  let message = "";
  try {
    await runCanvasExplainer({ htmlPath: bare, outPath: out("bare.mp4"), validate: false });
  } catch (err) {
    message = String(err.message);
  }
  check("it is refused", message !== "");
  check("the message names DURATION and scoreSound as missing and seek as there", /DURATION/.test(message) && /scoreSound/.test(message) && !/window\.seek\(t\) \(a function/.test(message));
  check("nothing was written", !fs.existsSync(out("bare.mp4")));
  const noScore = writeExplainer(dir, "noscore.html", `<!doctype html><canvas></canvas><script>window.seek = function () {}; window.DURATION = 1;</script>`);
  let silentOk = true;
  try {
    await runCanvasExplainer({ htmlPath: noScore, outPath: out("noscore.mp4"), validate: false, audio: false });
  } catch {
    silentOk = false;
  }
  check("with audio: false the score is not required", silentOk && !probe(out("noscore.mp4")).audio);
  let tooOdd = "";
  try {
    await runCanvasExplainer({ htmlPath: clean, outPath: out("odd.mp4"), width: 721, height: 405 });
  } catch (err) {
    tooOdd = String(err.message);
  }
  check("an odd size is refused before anything runs", /even/.test(tooOdd));
}

console.log("\n== Math.random is flagged ==");
{
  const random = writeExplainer(dir, "random.html", explainer({ duration: 1, draw: `ctx.fillStyle = "#123"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#5CC8FF"; ctx.fillRect(40 + t * 300, 200, 200, 120); var unused = 0 && Math.random();` }));
  const r = await runCanvasExplainer({ htmlPath: random, outPath: out("random.mp4"), validate: false, audio: false });
  check("a file that calls Math.random draws a warning naming it", r.warnings.some((w) => /Math\.random/.test(w)));
  check("a clean file draws none", wide.warnings.length === 0);
}

console.log("\n== the pre-flight, silent video and the async job ==");
{
  const impure = writeExplainer(dir, "impure-pre.html", explainer({ duration: 1, extra: "var drawn = 0;", draw: `drawn++; ctx.fillStyle = "rgb(" + (drawn * 7 % 255) + ",40,90)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#5CC8FF"; ctx.fillRect(40 + t * 300, 200, 200, 120);` }));
  let refused = "";
  try {
    await runCanvasExplainer({ htmlPath: impure, outPath: out("refused.mp4") });
  } catch (err) {
    refused = String(err.message);
  }
  check("the pre-flight refuses to render an impure file and says why", /Pre-flight refused/.test(refused) && /purity/.test(refused) && !fs.existsSync(out("refused.mp4")));
  const forced = await runCanvasExplainer({ htmlPath: impure, outPath: out("forced.mp4"), validate: false, audio: false });
  check("validate: false renders it anyway", forced.success === true && fs.existsSync(out("forced.mp4")));
  check("control: the clean file's pre-flight findings are all warnings or none", wide.findings.every((f) => f.severity !== "error"));

  const silent = await runCanvasExplainer({ htmlPath: clean, outPath: out("silent.mp4"), audio: false });
  check("audio: false writes a video with no audio stream", !probe(out("silent.mp4")).audio && silent.audio.included === false);

  const tools = createMcpServer()._registeredTools;
  check("the tool is registered with a title", typeof tools["render_canvas_explainer"]?.title === "string" && typeof tools["validate_canvas_explainer"]?.title === "string");
  const started = await tools["render_canvas_explainer"].handler({ htmlPath: clean, outPath: out("async.mp4"), async: true }, {});
  const { jobId } = JSON.parse(started.content[0].text);
  check("async: true answers at once with a jobId", typeof jobId === "string" && jobId.startsWith("render_canvas_explainer-"));
  let job = runJobStatus({ jobId });
  for (let i = 0; i < 240 && job.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 500));
    job = runJobStatus({ jobId });
  }
  check("job_status reports done with the result, and the progress counted the frames", job.status === "done" && job.result?.frames === 60 && job.progress.framesRendered === 60 && job.progress.totalFrames === 60);
  const bad = await tools["render_canvas_explainer"].handler({ htmlPath: path.join(dir, "missing.html"), outPath: out("x.mp4"), async: true }, {});
  check("async: a bad call fails now, not with a jobId that errors later", bad.isError === true && /No explainer/.test(bad.content[0].text));
}

fs.rmSync(dir, { recursive: true, force: true });
finish();

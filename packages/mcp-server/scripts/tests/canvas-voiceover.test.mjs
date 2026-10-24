#!/usr/bin/env node
// canvas-voiceover: voice-over mode for canvas explainers (#152): beat times, narration mix, captions.
//
// A fixture with three beats and fake narration clips (sine tones at 1000 Hz) goes through the real renderer. The
// explainer reads window.BEATS instead of constants. Checks on the output file: each voice clip starts within one
// frame of its beat start, the score (440 Hz) sits at least 6 dB under the voice while it plays, captions appear
// and clear on sentence boundaries inside the safe area, and a narration: "none" project still renders with the
// full-mix sound.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, check, skip, finish } from "./_harness.mjs";
import { haveMedia, tmpDir, explainer, writeExplainer, probe, frameAt, audioSamples, amplitudeAt, sineClip, TONE_SCORE } from "./_canvas.mjs";

if (!haveMedia) {
  skip("canvas voice-over", "ffmpeg or ffprobe is not installed");
  finish();
  process.exit(process.exitCode ?? 0);
}

const { runCanvasExplainer, chunksForBeat, captionChunks, mixVoice, toStereo } = require(path.join(distDir, "canvasExplainer.js"));
const dir = tmpDir("ovs-canvas-vo-");
const FPS = 30;

const TEXT = [
  "Why does a ball keep moving? Because nothing pushes it back.",
  "Gravity pulls it down at nine point eight metres per second squared.",
  "So the path is a curve.",
];
const STARTS = [0, 2.0, 4.0];
const CLIPS = [1.2, 1.0, 1.4];

function project(name, narration = "voice") {
  const root = path.join(dir, name);
  fs.mkdirSync(path.join(root, "src", "videos", "lesson"), { recursive: true });
  fs.mkdirSync(path.join(root, "public", "audio", "vo"), { recursive: true });
  const beats = TEXT.map((vo, i) => ({ id: `b${i + 1}`, start: Math.round(STARTS[i] * FPS), duration: 60, vo, visual: { captureMethod: "dom-demo" } }));
  fs.writeFileSync(path.join(root, "src", "videos", "lesson", "beats.json"), JSON.stringify({ fps: FPS, narration, beats }));
  if (narration === "voice") beats.forEach((b, i) => sineClip(path.join(root, "public", "audio", "vo", `${b.id}.mp3`), 1000, CLIPS[i], 0.5));
  return root;
}

// The explainer reads window.BEATS: DURATION is the last beat's end and each beat shows its own colour.
const BEATS_EXPLAINER = explainer({
  duration: 1,
  extra: `var beats = window.BEATS || [{ id: "none", start: 0, end: 1, text: "" }]; window.DURATION = beats[beats.length - 1].end;`,
  draw: `
    var i = 0; for (var k = 0; k < beats.length; k++) if (t >= beats[k].start) i = k;
    ctx.fillStyle = "hsl(" + (i * 70 + 200) + ", 40%, 14%)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#5CC8FF"; ctx.fillRect(40 + t * 80, H * 0.2, 200, 120);`,
  score: TONE_SCORE(440),
});

const lightPixels = (img, y0, y1) => {
  let n = 0;
  for (let y = Math.floor(y0); y < Math.floor(y1); y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 3;
    if (img.data[i] > 200 && img.data[i + 1] > 200 && img.data[i + 2] > 190) n++;
  }
  return n;
};

console.log("\n== the pure parts ==");
{
  check("captionChunks breaks at sentence ends and at a comma after three words", JSON.stringify(captionChunks("Why does a ball keep moving? Because rise over run, we measure it.".split(" "))) === JSON.stringify([[0, 6], [6, 10], [10, 13]]));
  const beat = { id: "b", start: 2, end: 4, text: "One two three. Four five six." };
  const chunks = chunksForBeat(beat, 1.2);
  check("a beat with two sentences makes two captions, in order, inside the beat", chunks.length === 2 && chunks[0].text === "One two three." && chunks[1].text === "Four five six." && chunks[0].from >= 2 && chunks[1].to <= 4);
  check("the first clears no later than the second starts, and after its last word", chunks[0].to <= chunks[1].from + 1e-9 && chunks[0].to > chunks[0].from);
  const timed = chunksForBeat(beat, 1.2, [100, 400, 700, 1000, 1300, 1600].map((s, i) => ({ startMs: s, endMs: s + 250 })));
  check("with word times the captions follow them", Math.abs(timed[0].from - 2.1) < 1e-6 && Math.abs(timed[1].from - 3.0) < 1e-6);
  const score = { sampleRate: 48000, channels: 1, data: new Float32Array(48000).fill(0.5) };
  check("toStereo doubles a mono score", toStereo(score).channels === 2 && toStereo(score).data.length === 96000);
  void mixVoice;
}

console.log("\n== three beats with narration ==");
const root = project("voice");
const html = writeExplainer(dir, "beats.html", BEATS_EXPLAINER);
const vo = await runCanvasExplainer({ projectRoot: root, htmlPath: html, outPath: path.join(dir, "vo.mp4"), videoName: "lesson" });
{
  const p = probe(path.join(dir, "vo.mp4"));
  console.log(`  ${vo.frames} frames, ${p.duration.toFixed(3)}s, clips ${JSON.stringify(vo.audio.voiceClips.map((c) => [c.beatId, c.startSample]))}, ${vo.captions.chunks} captions`);
  check("DURATION is the last beat's end: 6 seconds, 180 frames", vo.frames === 180 && Math.abs(p.duration - 6) < 0.06);
  check("a voiceover render is used because the beats have narration", vo.audio.voiceover === true && vo.audio.voiceClips.length === 3);
  const samples = audioSamples(path.join(dir, "vo.mp4"));
  // The onset of each voice clip: the first 10 ms window with the 1000 Hz tone above half its level.
  const onset = (from, to) => {
    for (let t = from; t < to; t += 0.005) if (amplitudeAt(samples, t, t + 0.01, 1000) > 0.2) return t;
    return null;
  };
  STARTS.forEach((start, i) => {
    const found = onset(start - 0.15, start + 0.5);
    console.log(`  beat ${i + 1}: start ${start}s, voice heard at ${found === null ? "never" : found.toFixed(3)}s`);
    check(`beat ${i + 1}: the voice starts within one frame of the beat's start`, found !== null && Math.abs(found - start) <= 1 / FPS + 0.005);
    check(`beat ${i + 1}: the sample the mix put it at is the beat's start to the sample`, vo.audio.voiceClips[i].startSample === Math.round(start * 48000));
  });
  const duringVoice = amplitudeAt(samples, 2.15, 2.85, 440);
  const outsideVoice = amplitudeAt(samples, 3.3, 3.9, 440);
  const voiceLevel = amplitudeAt(samples, 2.15, 2.85, 1000);
  const dbDown = 20 * Math.log10(outsideVoice / duringVoice);
  const dbBelowVoice = 20 * Math.log10(voiceLevel / duringVoice);
  console.log(`  score ${dbDown.toFixed(1)} dB down while the voice plays; ${dbBelowVoice.toFixed(1)} dB below the voice; voice level ${voiceLevel.toFixed(3)}`);
  check("the score is ducked by at least 6 dB while a clip plays", dbDown >= 6);
  check("and sits at least 6 dB below the voice itself", dbBelowVoice >= 6);
  check("the score comes back up after the clip (its level outside is the voiceover-mix level, 0.2)", Math.abs(outsideVoice - 0.2) < 0.03);
  check("the voice is present at its own level (0.5)", Math.abs(voiceLevel - 0.5) < 0.06);
  check("control: with no voice playing (between the clips) no 1000 Hz is heard", amplitudeAt(samples, 3.3, 3.9, 1000) < 0.02);
}

console.log("\n== captions appear and clear on sentence boundaries ==");
{
  const file = path.join(dir, "vo.mp4");
  const chunks = [];
  // The same chunks the renderer used, from the project, so the test knows where the boundaries are.
  const beat = { id: "b1", start: 0, end: 2, text: TEXT[0] };
  chunks.push(...chunksForBeat(beat, CLIPS[0]));
  check("the first beat has two sentences, so two captions", chunks.length === 2 && vo.captions.burned === true && vo.captions.chunks >= 4);
  const H = 720;
  const band = [H * 0.55, H * 0.93];
  const inFirst = frameAt(file, chunks[0].from + 0.1, 1280, H);
  const inFirstLater = frameAt(file, (chunks[0].from + chunks[0].to) / 2, 1280, H);
  const inSecond = frameAt(file, (chunks[1].from + chunks[1].to) / 2, 1280, H);
  const afterAll = frameAt(file, 1.9, 1280, H);
  const lit = (img) => lightPixels(img, band[0], band[1]);
  console.log(`  light pixels in the caption band: first ${lit(inFirst)}, second ${lit(inSecond)}, after ${lit(afterAll)}`);
  check("a caption is on screen while the first sentence is said", lit(inFirst) > 300 && lit(inFirstLater) > 300);
  check("the second sentence shows a different caption", lit(inSecond) > 300 && Buffer.compare(inFirstLater.data, inSecond.data) !== 0);
  check("it clears after the last sentence of the beat", lit(afterAll) < 50);
  let above = 0;
  for (const img of [inFirst, inSecond]) above += lightPixels(img, H * 0.92, H);
  check("the captions stay out of the bottom 8% of a wide canvas", above === 0);
  const tallRoot = project("tall");
  const tall = await runCanvasExplainer({ projectRoot: tallRoot, htmlPath: html, outPath: path.join(dir, "tall.mp4"), videoName: "lesson", width: 720, height: 1280 });
  const t = frameAt(path.join(dir, "tall.mp4"), 0.3, 720, 1280);
  const bottomZone = lightPixels(t, 1280 * 0.78, 1280);
  const topZone = lightPixels(t, 0, 1280 * 0.14);
  const bodyZone = lightPixels(t, 1280 * 0.5, 1280 * 0.78);
  check("on a 720x1280 canvas the captions sit above the bottom 22% (and below the top 14%)", tall.captions.burned && bodyZone > 300 && bottomZone === 0 && topZone === 0);
  const off = await runCanvasExplainer({ projectRoot: root, htmlPath: html, outPath: path.join(dir, "nocap.mp4"), videoName: "lesson", captions: false });
  const nc = frameAt(path.join(dir, "nocap.mp4"), 0.3, 1280, H);
  check("control: with captions: false the same frame has no caption pixels", off.captions.burned === false && lightPixels(nc, band[0], band[1]) < 50);
}

console.log("\n== a window.CAPTIONS call in the explainer styles its own ==");
{
  const own = writeExplainer(dir, "own-captions.html", explainer({
    duration: 1,
    extra: `var beats = window.BEATS; window.DURATION = beats[beats.length - 1].end;`,
    draw: `ctx.fillStyle = "#101820"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#5CC8FF"; ctx.fillRect(40 + t * 80, H * 0.2, 200, 120); if (window.CAPTIONS) window.CAPTIONS.draw(ctx, t, { color: "#FFB347", background: "rgba(0,0,0,0.9)" });`,
    score: TONE_SCORE(440),
  }));
  await runCanvasExplainer({ projectRoot: root, htmlPath: own, outPath: path.join(dir, "own.mp4"), videoName: "lesson", validate: false });
  const img = frameAt(path.join(dir, "own.mp4"), 0.3, 1280, 720);
  let amber = 0;
  let white = 0;
  for (let y = 720 * 0.55; y < 720 * 0.93; y++) for (let x = 0; x < 1280; x++) {
    const i = (Math.floor(y) * 1280 + x) * 3;
    if (img.data[i] > 220 && img.data[i + 1] > 150 && img.data[i + 1] < 200 && img.data[i + 2] < 110) amber++;
    if (img.data[i] > 230 && img.data[i + 1] > 230 && img.data[i + 2] > 220) white++;
  }
  check("the explainer's own colours are used, and the renderer does not draw a second set over them", amber > 200 && white < 50);
}

console.log("\n== narration: none still renders with the full mix ==");
{
  const silentRoot = project("silent", "none");
  const r = await runCanvasExplainer({ projectRoot: silentRoot, htmlPath: html, outPath: path.join(dir, "none.mp4"), videoName: "lesson" });
  const samples = audioSamples(path.join(dir, "none.mp4"));
  console.log(`  voiceover ${r.audio.voiceover}, clips ${r.audio.voiceClips.length}, score level ${amplitudeAt(samples, 1, 2, 440).toFixed(2)}`);
  check("it renders, with an audio stream and no voice clips", r.success && probe(path.join(dir, "none.mp4")).audio !== undefined && r.audio.voiceClips.length === 0);
  check("the sound kit is asked for the full mix (voiceover false): the tone is at 0.4, not the voiceover mix's 0.2", r.audio.voiceover === false && Math.abs(amplitudeAt(samples, 1, 2, 440) - 0.4) < 0.04);
  check("no captions are burned for a silent lesson", r.captions.burned === false);
  check("control: the narrated render's score outside the voice was 0.2, so the two modes are told apart", Math.abs(amplitudeAt(audioSamples(path.join(dir, "vo.mp4")), 3.3, 3.9, 440) - 0.2) < 0.03);
}

fs.rmSync(dir, { recursive: true, force: true });
finish();

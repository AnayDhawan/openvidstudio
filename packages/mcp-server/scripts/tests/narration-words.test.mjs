#!/usr/bin/env node
// narration-words: generate_narration writes word timings, stitch_composition carries them to the
// composition, and useNarrationWords reads them in a scene (#114).
//
// The edge-tts part is real: it needs the `edge-tts` command, the edge_tts Python module and a route to
// Microsoft's service, and says so and skips when any of those is missing. Everything after the words file
// exists (stitch, the hook rendered in a real browser) needs none of them.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { require, packageRoot, distDir, monorepoTemplateDir, check, skip, finish } from "./_harness.mjs";

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const { runGenerateNarration } = require(path.join(distDir, "tools", "generateNarration.js"));
const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));

function project(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "lesson", projectRoot: root });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
  return root;
}
const writeBeats = (root, beats, extra = {}) =>
  fs.writeFileSync(path.join(root, "src", "videos", "lesson", "beats.json"), JSON.stringify({ fps: 30, ...extra, beats }));
const probe = (file) => Number.parseFloat(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" }).stdout.trim());

const haveEdge = spawnSync("edge-tts", ["--version"], { encoding: "utf8" }).status === 0;
const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

console.log("\n== edge-tts writes word timings beside each clip ==");
const LINE = "A slope is how steep a line is.";
const LONG = "Picture a ball rolling down a long hill, and ask how fast it is going at one exact moment, not on average.";
if (!haveEdge || !haveFfmpeg) {
  skip("edge-tts word timings", `${!haveEdge ? "the edge-tts command is not installed (pip install edge-tts)" : "ffmpeg/ffprobe is not installed"}; run again with it on PATH to exercise the real engine`);
} else {
  const root = project("ovs-words-");
  writeBeats(root, [
    { id: "short", start: 0, duration: 150, vo: LINE, visual: { captureMethod: "dom-demo" } },
    { id: "long", start: 150, duration: 270, vo: LONG, visual: { captureMethod: "dom-demo" } },
  ]);
  const result = runGenerateNarration({ projectRoot: root, videoName: "lesson", engine: "edge-tts" });
  if (result.written.length < 2) {
    skip("edge-tts word timings", `edge-tts did not return audio (no route to Microsoft's service?): ${result.warnings.join("; ").slice(0, 200)}`);
  } else {
    check("the result says word timings were written and for which files", result.wordTimings.supported === true && result.wordTimings.written.length === 2);
    for (const clip of result.written) {
      const wordsFile = path.join(root, "public", "audio", "vo", `${clip.beatId}.words.json`);
      check(`${clip.beatId}: the words file exists beside the clip`, fs.existsSync(wordsFile) && clip.wordsPath === wordsFile);
      const words = JSON.parse(fs.readFileSync(wordsFile, "utf8"));
      const line = clip.beatId === "short" ? LINE : LONG;
      check(`${clip.beatId}: it has one entry per word of the line (${line.split(/\s+/).length})`, words.length === line.split(/\s+/).length && clip.wordCount === words.length);
      check(`${clip.beatId}: every entry is { word, startMs, endMs } with whole milliseconds`, words.every((w) => typeof w.word === "string" && Number.isInteger(w.startMs) && Number.isInteger(w.endMs) && w.endMs >= w.startMs));
      check(`${clip.beatId}: times are monotonic (each word starts no earlier than the one before)`, words.every((w, i) => i === 0 || w.startMs >= words[i - 1].startMs) && words.every((w, i) => i === 0 || w.startMs >= words[i - 1].endMs - 1));
      const clipMs = probe(clip.path) * 1000;
      const last = words[words.length - 1].endMs;
      console.log(`  ${clip.beatId}: clip ${clipMs.toFixed(0)}ms (tempo ${clip.tempo}), last word ends at ${last}ms`);
      check(`${clip.beatId}: the last word ends inside the clip`, last <= clipMs + 33);
      // edge-tts leaves a short tail of silence after the last word, so this is not "within a frame"
      // of the clip length as the issue assumed: it is within the service's tail.
      check(`${clip.beatId}: ...and within 600ms of its end (edge-tts leaves a short tail after the last word)`, clipMs - last < 600);
      check(`${clip.beatId}: the first word starts near the start of the clip`, words[0].startMs < 400);
    }

    // The stretch: a clip fitted at tempo t is 1/t as long, so its words are too. Compare with the unscaled
    // timings straight from the helper.
    console.log("\n== a stretched clip scales its timings by the same factor ==");
    const stretched = result.written.find((c) => c.tempo !== 1) ?? result.written[0];
    const stretchedWords = JSON.parse(fs.readFileSync(stretched.wordsPath, "utf8"));
    const raw = path.join(root, ".openvidstudio", "narration", `${stretched.beatId}.raw.words.json`);
    check("the unscaled timings from the helper are kept beside the raw audio for comparison", fs.existsSync(raw));
    const rawWords = JSON.parse(fs.readFileSync(raw, "utf8"));
    console.log(`  ${stretched.beatId}: tempo ${stretched.tempo}; last word ${rawWords.at(-1).endMs}ms raw, ${stretchedWords.at(-1).endMs}ms written`);
    check(`tempo is not 1 for this clip (${stretched.tempo}), so the test is about a real stretch`, stretched.tempo !== 1);
    check("every written time is the raw time divided by the tempo, to the millisecond", rawWords.every((w, i) => Math.abs(stretchedWords[i].startMs - Math.round(w.startMs / stretched.tempo)) <= 1 && Math.abs(stretchedWords[i].endMs - Math.round(w.endMs / stretched.tempo)) <= 1));
    check("control: the written times are NOT the raw ones (the scaling was applied)", Math.abs(stretchedWords.at(-1).endMs - rawWords.at(-1).endMs) > 20);
  }
}

console.log("\n== other engines write nothing, and say so ==");
{
  const engine = spawnSync("say", ["-v", "?"], { encoding: "utf8" }).status === 0 ? "say" : spawnSync("espeak", ["--version"], { encoding: "utf8" }).status === 0 ? "espeak" : null;
  if (engine === null || !haveFfmpeg) {
    skip("a non-edge engine", "neither `say` nor `espeak` is installed, or ffmpeg is missing");
  } else {
    const root = project("ovs-words-other-");
    writeBeats(root, [{ id: "one", start: 0, duration: 120, vo: "A slope is how steep a line is.", visual: { captureMethod: "dom-demo" } }]);
    const r = runGenerateNarration({ projectRoot: root, videoName: "lesson", engine });
    // The report is made before anything is synthesized, so it holds even where this machine's engine
    // cannot write a clip (`say` here fails on the format flag); a clip, when there is one, has no timings.
    console.log(`  ${engine}: ${r.written.length} clip(s) written${r.written.length === 0 ? ` (${r.warnings.join("; ").slice(0, 80)})` : ""}`);
    check(`${engine}: no .words.json is written`, !fs.existsSync(path.join(root, "public", "audio", "vo", "one.words.json")) && r.written.every((c) => c.wordsPath === undefined));
    check(`${engine}: the result says so, naming the engine, rather than inventing timings`, r.wordTimings.supported === false && r.wordTimings.written.length === 0 && new RegExp(engine).test(r.wordTimings.note ?? "") && /no word boundaries/.test(r.wordTimings.note ?? ""));
  }
}

console.log("\n== stitch_composition copies the words next to the composition ==");
const WORDS = [
  { word: "Slopes", startMs: 100, endMs: 500 },
  { word: "are", startMs: 600, endMs: 800 },
  { word: "steep", startMs: 900, endMs: 1400 },
  { word: "lines", startMs: 1500, endMs: 2000 },
];
const root = project("ovs-words-stitch-");
{
  writeBeats(root, [{ id: "hook", start: 0, duration: 90, vo: "Slopes are steep lines.", visual: { captureMethod: "dom-demo" } }, { id: "tail", start: 90, duration: 60, vo: "The end.", visual: { captureMethod: "dom-demo" } }], { narration: "none" });
  const videoDir = path.join(root, "src", "videos", "lesson");
  const plain = runStitchComposition({ projectRoot: root, videoName: "lesson" });
  const plainSource = fs.readFileSync(path.join(videoDir, "LessonDemo.tsx"), "utf8");
  check("with no word timings the composition does not mention them and no file is written", !/NarrationWords/.test(plainSource) && !fs.existsSync(path.join(videoDir, "narration.words.json")));
  fs.mkdirSync(path.join(root, "public", "audio", "vo", "hi"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "audio", "vo", "hook.words.json"), JSON.stringify(WORDS));
  fs.writeFileSync(path.join(root, "public", "audio", "vo", "hi", "hook.words.json"), JSON.stringify([{ word: "ढलान", startMs: 0, endMs: 400 }]));
  runStitchComposition({ projectRoot: root, videoName: "lesson" });
  const copied = JSON.parse(fs.readFileSync(path.join(videoDir, "narration.words.json"), "utf8"));
  check("the base language's words are copied into src/videos/<video>/narration.words.json, keyed by language and beat", JSON.stringify(copied.en?.hook) === JSON.stringify(WORDS) && copied.en.tail === undefined);
  const source = fs.readFileSync(path.join(videoDir, "LessonDemo.tsx"), "utf8");
  check("the composition imports the JSON and wraps the scenes in NarrationWordsProvider", /import narrationWords from "\.\/narration\.words\.json"/.test(source) && /<NarrationWordsProvider words=\{NARRATION_WORDS\[language\] \?\? \{\}\}>/.test(source));
  check("removing the words files removes the copy and the provider again", (() => {
    fs.rmSync(path.join(root, "public", "audio", "vo", "hook.words.json"));
    fs.rmSync(path.join(root, "public", "audio", "vo", "hi"), { recursive: true });
    runStitchComposition({ projectRoot: root, videoName: "lesson" });
    return !fs.existsSync(path.join(videoDir, "narration.words.json")) && !/NarrationWords/.test(fs.readFileSync(path.join(videoDir, "LessonDemo.tsx"), "utf8"));
  })());
  void plain;
}

console.log("\n== useNarrationWords, rendered in a scene ==");
if (!fs.existsSync(templateNodeModules)) {
  skip("useNarrationWords render", "no resolvable node_modules to scaffold a renderable project from");
} else {
  const bridge = require(path.join(distDir, "remotionBridge.js"));
  const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
  const videoDir = path.join(root, "src", "videos", "lesson");
  fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");
  fs.mkdirSync(path.join(root, "public", "audio", "vo"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "audio", "vo", "hook.words.json"), JSON.stringify(WORDS));
  fs.mkdirSync(path.join(videoDir, "custom"), { recursive: true });
  // Prints the word at the current frame, whether it is being said, and where the fourth word starts.
  fs.writeFileSync(
    path.join(videoDir, "custom", "Hook.tsx"),
    `import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { useNarrationWords } from "@openvidstudio/core";

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const narration = useNarrationWords("hook");
  const at = narration.wordAt(frame);
  return (
    <AbsoluteFill>
      <pre id="out">{JSON.stringify({ frame, available: narration.available, word: at ? at.word.word : null, index: at ? at.index : null, speaking: at ? at.speaking : null, fourth: narration.frameOfWord(3), nope: narration.frameOfWord(9) })}</pre>
    </AbsoluteFill>
  );
};
`,
  );
  const Tail = `import React from "react";
import { AbsoluteFill } from "remotion";
import { useNarrationWords } from "@openvidstudio/core";
export const Tail: React.FC = () => {
  const narration = useNarrationWords("tail");
  return <AbsoluteFill><pre id="out">{JSON.stringify({ available: narration.available, word: narration.wordAt(10) })}</pre></AbsoluteFill>;
};
`;
  fs.writeFileSync(path.join(videoDir, "custom", "Tail.tsx"), Tail);
  writeBeats(root, [{ id: "hook", start: 0, duration: 90, scene: "./custom/Hook.tsx" }, { id: "tail", start: 90, duration: 60, scene: "./custom/Tail.tsx" }], { narration: "none" });
  const stitched = runStitchComposition({ projectRoot: root, videoName: "lesson" });
  const bundleDir = await bridge.bundleProject(root);
  const server = await bridge.serveBundleDirectory(bundleDir);
  const remotionBrowser = await bridge.openRenderBrowser();
  let browser = null;
  try {
    const comp = await bridge.resolveComposition(bundleDir, stitched.compositionId, remotionBrowser);
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
    await bridge.openSeekablePage({ page, bundleUrl: server.url, composition: comp, timeoutMs: 30000 });
    const at = async (frame) => {
      await bridge.seekToFrame(page, comp.id, frame, 30000);
      return JSON.parse(await page.evaluate(() => document.getElementById("out")?.textContent ?? "null"));
    };
    // fps 30: 100ms is frame 3, 600ms is 18, 900ms is 27, 1500ms is 45, 2000ms is 60.
    const f0 = await at(0);
    check("before the first word starts the hook answers null (frame 0)", f0.available === true && f0.word === null);
    check("frame 3 (100ms): the first word, Slopes, is being said", (await at(3)).word === "Slopes" && (await at(3)).speaking === true && (await at(3)).index === 0);
    const gap = await at(16);
    check("frame 16 (533ms): in the pause after Slopes the last word said is still Slopes, and it is not speaking", gap.word === "Slopes" && gap.speaking === false);
    check("frame 18 (600ms): are", (await at(18)).word === "are");
    check("frame 30 (1000ms): steep", (await at(30)).word === "steep" && (await at(30)).index === 2);
    check("frame 50 (1667ms): lines", (await at(50)).word === "lines" && (await at(50)).speaking === true);
    check("after the last word it holds on lines, not speaking (frame 85)", (await at(85)).word === "lines" && (await at(85)).speaking === false);
    const meta = await at(0);
    check("frameOfWord(3) is the frame the fourth word starts on (1500ms = frame 45)", meta.fourth === 45);
    check("frameOfWord of a word that is not there is null", meta.nope === null);
    const tail = await at(95);
    check("a beat with no word timings is available: false and answers null", tail.available === false && tail.word === null);
  } finally {
    await browser?.close().catch(() => undefined);
    await remotionBrowser.close({ silent: true });
    await server.close();
  }
}

finish();

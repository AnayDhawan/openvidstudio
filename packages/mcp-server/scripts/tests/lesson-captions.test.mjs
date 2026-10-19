#!/usr/bin/env node
// lesson-captions: LessonCaptions from @openvidstudio/stem (#134), measured in real frames at 1920x1080 and
// 1080x1920.
//
// The word timings carry bare words with no punctuation, so a caption that chunked on them would run one
// sentence into the next. LessonCaptions takes the text from the beat's `vo` and breaks at sentence ends, at a
// comma after three words, and at maxWords. These tests give it real .words.json files, let stitch_composition
// hand them to the scene, and read the captions the browser actually draws.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, luma, rgb, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const close = (c, target, tol) => c.every((v, i) => Math.abs(v - target[i]) <= tol);
const ACCENT = [92, 200, 255];
const TEXT = [243, 239, 230];

const TALK = "Slopes are steep lines. Why? Because rise over run, we measure it.";
const LONG = "one two three four five six seven eight nine ten";
// A word every 400 ms from `offsetMs`, each said for 300: word i starts on frame 12 * i (+ offset) at 30 fps.
const wordsOf = (text, offsetMs = 0) => text.split(/\s+/).map((w, i) => ({ word: w.replace(/[.,?!]/g, ""), startMs: offsetMs + i * 400, endMs: offsetMs + i * 400 + 300 }));

const scene = (name, beatId, text, props = "") => `import React from "react";
import { AbsoluteFill } from "remotion";
import { LessonCaptions } from "@openvidstudio/stem";

export const ${name}: React.FC = () => (
  <AbsoluteFill style={{ background: "#07060B" }}>
    <LessonCaptions beatId="${beatId}" text={${JSON.stringify(text)}} ${props} />
  </AbsoluteFill>
);
`;

const BEATS = {
  talk: { source: scene("Talk", "talk", TALK), duration: 200 },
  late: { source: scene("Late", "late", TALK), duration: 200 },
  long: { source: scene("Long", "long", LONG), duration: 200 },
  short: { source: scene("Short", "short", LONG, "maxWords={4}"), duration: 200 },
  bare: { source: scene("Bare", "bare", "alpha beta gamma delta epsilon"), duration: 120 },
  top: { source: scene("Top", "top", TALK, 'position="top"'), duration: 200 },
  silent: { source: scene("Silent", "silent", TALK), duration: 120 },
};
const VO = (id, words) => [`public/audio/vo/${id}.words.json`, JSON.stringify(words)];
const extraFiles = Object.fromEntries([
  VO("talk", wordsOf(TALK)),
  VO("late", wordsOf(TALK, 500)),
  VO("long", wordsOf(LONG)),
  VO("short", wordsOf(LONG)),
  // The text has five words, the timings three: the counts differ, so the captions fall back to the timings' words.
  VO("bare", [{ word: "uno", startMs: 0, endMs: 300 }, { word: "dos", startMs: 400, endMs: 700 }, { word: "tres", startMs: 800, endMs: 1100 }]),
  VO("top", wordsOf(TALK)),
]);

if (!haveNodeModules) {
  skip("lesson captions", "no resolvable node_modules to scaffold a renderable project from");
  finish();
}

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({ prefix: `ovs-captions-${width}x${height}-`, width, height, scenes: BEATS, extraFiles });
  await inBrowser(project, async ({ comp, page, seek, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    /** What the captions show at a scene-local frame: the chunk's text, which word is active, the block's box. */
    const shown = async (beatId, local) => {
      await seek(beatId, local);
      return page.evaluate(() => {
        const block = document.querySelector("[data-ovs-captions]");
        const caption = document.querySelector("[data-ovs-caption]");
        const r = block ? block.getBoundingClientRect() : null;
        const c = caption ? caption.getBoundingClientRect() : null;
        return {
          hasBlock: !!block,
          timing: block?.getAttribute("data-ovs-captions-timing") ?? null,
          text: caption ? Array.from(caption.querySelectorAll("[data-ovs-word]")).map((s) => s.textContent).join(" ") : null,
          active: Array.from(document.querySelectorAll('[data-ovs-word][data-active="true"]')).map((s) => s.textContent),
          block: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
          box: c ? { x: c.x, y: c.y, w: c.width, h: c.height } : null,
          glowing: Array.from(document.querySelectorAll("[data-ovs-glow]")).length,
        };
      });
    };

    console.log("-- where the chunks break");
    check("frame 0: the first sentence is one caption, with its punctuation, and the first word is active", (await shown("talk", 0)).text === "Slopes are steep lines." && (await shown("talk", 0)).active.join() === "Slopes");
    check("the word being said is the active one (word 3, 'lines.')", (await shown("talk", 12 * 3 + 2)).active.join() === "lines.");
    check("a sentence end breaks: the first caption does not run on into the next sentence", !(await shown("talk", 12 * 3 + 2)).text.includes("Why"));
    check("a one word sentence is a caption on its own", (await shown("talk", 12 * 4 + 2)).text === "Why?");
    check("a comma after at least three words breaks: 'Because rise over run,'", (await shown("talk", 12 * 6)).text === "Because rise over run,");
    check("then the last sentence follows it", (await shown("talk", 12 * 10)).text === "we measure it.");
    check("after the last word the last caption stays up", (await shown("talk", 190)).text === "we measure it.");
    check("maxWords defaults to 6: ten unpunctuated words are six and four", (await shown("long", 12 * 2)).text === "one two three four five six" && (await shown("long", 12 * 7)).text === "seven eight nine ten");
    check("maxWords={4} breaks every four words", (await shown("short", 12 * 2)).text === "one two three four" && (await shown("short", 12 * 5)).text === "five six seven eight" && (await shown("short", 12 * 9)).text === "nine ten");
    check("control: the default six-word caption holds the fifth word that maxWords 4 pushed to the next one", (await shown("long", 12 * 2)).text.includes("five"));

    console.log("-- timing");
    const early = await shown("late", 3);
    check("before the first word is said there is no caption, though the block is there", early.hasBlock && early.text === null);
    check("the first word at 500 ms (frame 15) brings the first caption", (await shown("late", 15)).text === "Slopes are steep lines.");
    const bare = await shown("bare", 12 * 4);
    check("when the word counts differ the captions fall back to the timings' bare words", bare.timing === "bare" && bare.text === "uno dos tres");
    check("and a matching count says so", (await shown("talk", 0)).timing === "matched");
    const silent = await shown("silent", 60);
    check("with no timings the words are spread over the scene and the block says they are estimated", silent.timing === "estimated" && typeof silent.text === "string" && silent.text.length > 0);

    console.log("-- where they sit");
    const insets = height > width ? { top: Math.round(height * 0.14), bottom: Math.round(height * 0.22) } : { top: Math.round(height * 0.08), bottom: Math.round(height * 0.08) };
    const bottom = await shown("talk", 0);
    check(`bottom captions end above the bottom ${height > width ? "22 percent" : "8 percent"} of the frame`, bottom.box.y + bottom.box.h <= height - insets.bottom + 1);
    check("and stay inside the frame's sides", bottom.box.x >= 0 && bottom.box.x + bottom.box.w <= width);
    const top = await shown("top", 0);
    check(`position="top" starts below the top ${height > width ? "14 percent" : "8 percent"}`, top.box.y >= insets.top - 1 && top.box.y < height / 2);
    check("the block is tagged data-ovs-captions, which validate_scenes masks", bottom.hasBlock);
    check("captions never glow", bottom.glowing === 0 && top.glowing === 0);

    console.log("-- pixels");
    const img = await frame("talk", 12 * 3 + 2);
    const inBox = (b, f) => {
      let n = 0;
      for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(img.height, Math.ceil(b.y + b.h)); y++) {
        for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(img.width, Math.ceil(b.x + b.w)); x++) if (f(rgb(img, x, y))) n++;
      }
      return n;
    };
    const shot = await shown("talk", 12 * 3 + 2);
    check("the caption's own box holds text-coloured pixels", inBox(shot.box, (c) => close(c, TEXT, 30)) > 100);
    check("and the word being said is in the accent", inBox(shot.box, (c) => close(c, ACCENT, 30)) > 50);
    const accentRect = await page.evaluate(() => {
      const r = document.querySelector('[data-ovs-word][data-active="true"]').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    check("the accent pixels sit on the active word, not elsewhere", inBox(accentRect, (c) => close(c, ACCENT, 30)) > 50 && inBox(accentRect, (c) => close(c, ACCENT, 30)) >= inBox(shot.box, (c) => close(c, ACCENT, 30)) * 0.95);
    let reserved = 0;
    for (let y = height - insets.bottom; y < height; y++) for (let x = 0; x < width; x++) if (luma(img, x, y) > 120) reserved++;
    check("no caption pixel is drawn in the reserved bottom zone", reserved === 0);
    let above = 0;
    for (let y = Math.max(0, height - insets.bottom - Math.ceil(shot.box.h) - 4); y < height - insets.bottom; y++) for (let x = 0; x < width; x++) if (luma(img, x, y) > 120) above++;
    check("control: the same scan just above the zone does find the text", above > 100);
    const again = await frame("talk", 12 * 3 + 2);
    await frame("talk", 12 * 6);
    const third = await frame("talk", 12 * 3 + 2);
    check("a pure function of the frame: the same frame twice, with another between, is byte for byte identical", sameBytes(img, again) && sameBytes(img, third));
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  ${errors.slice(0, 4).join(" | ")}`);
  });
}

await run(1080, 1920);
await run(1920, 1080);
finish();

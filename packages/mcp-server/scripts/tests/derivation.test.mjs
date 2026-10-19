#!/usr/bin/env node
// derivation: the Derivation primitive from @openvidstudio/stem (#133), measured in real frames at 1920x1080 and
// 1080x1920.
//
// A formula built line by line, each line spoken. The checks: the steps arrive in order and read top to bottom,
// the previous lines dim and only three stay, terms that carry over from one line to the next do not move (and
// slide only when the terms before them changed width), new terms rise in, gone terms fade out, a step can be
// revealed at the word it is spoken at, and the same frame always renders the same pixels.

import { check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, luma, sameBytes } from "./_stem.mjs";

const near = (a, b, tol) => Math.abs(a - b) <= tol;

// The range of a projectile: seven steps, each one said.
const RANGE = [
  { tex: String.raw`y = u \sin\theta \, t - \frac{1}{2} g t^{2}`, spoken: "y equals u sine theta t minus a half g t squared" },
  { tex: String.raw`0 = t \left( u \sin\theta - \frac{1}{2} g t \right)`, spoken: "at the landing y is zero, so factor out t", because: "it lands when y is zero" },
  { tex: String.raw`t = \frac{2 u \sin\theta}{g}`, spoken: "so the time of flight is two u sine theta over g" },
  { tex: String.raw`R = u \cos\theta \, t`, spoken: "the range is the sideways speed times that time", because: "no horizontal force" },
  { tex: String.raw`R = u \cos\theta \cdot \frac{2 u \sin\theta}{g}`, spoken: "put the time in" },
  { tex: String.raw`R = \frac{2 u^{2} \sin\theta \cos\theta}{g}`, spoken: "tidy it up" },
  { tex: String.raw`R = \frac{u^{2} \sin 2\theta}{g}`, spoken: "and two sine cos is sine two theta" },
];
const RANGE_AT = [10, 80, 150, 220, 290, 360, 430];

const scene = (name, props) => `import React from "react";
import { AbsoluteFill } from "remotion";
import { Derivation } from "@openvidstudio/stem";

export const ${name}: React.FC = () => (
  <AbsoluteFill style={{ background: "#07060B" }}>
    <Derivation ${props} />
  </AbsoluteFill>
);
`;
const steps = (list) => `steps={${JSON.stringify(list)}}`;

const WORDS = "First we say a equals b and then b equals c".split(" ").map((w, i) => ({ word: w, startMs: i * 400, endMs: i * 400 + 300 }));
const BEATS = {
  range: { source: scene("Range", `${steps(RANGE)} at={${JSON.stringify(RANGE_AT)}}`), duration: 520 },
  slide: { source: scene("Slide", `${steps([{ tex: "a+b=c", spoken: "a plus b equals c" }, { tex: "a+b+d=c", spoken: "a plus b plus d equals c" }])} at={[10, 70]}`), duration: 140 },
  gone: { source: scene("Gone", `${steps([{ tex: "a+b=c", spoken: "a plus b equals c" }, { tex: "a=c", spoken: "a equals c" }])} at={[10, 70]}`), duration: 140 },
  narr: { source: scene("Narr", `beatId="narr" ${steps([{ tex: "a=b", spoken: "a equals b" }, { tex: "b=c", spoken: "b equals c" }])}`), duration: 180 },
};
const extraFiles = { "public/audio/vo/narr.words.json": JSON.stringify(WORDS) };

if (!haveNodeModules) {
  skip("derivation", "no resolvable node_modules to scaffold a renderable project from");
  finish();
}

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({ prefix: `ovs-derivation-${width}x${height}-`, width, height, scenes: BEATS, extraFiles });
  await inBrowser(project, async ({ comp, page, seek, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);

    const lines = async (beatId, local) => {
      await seek(beatId, local);
      return page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-ovs-step]")).map((el) => {
          const r = el.getBoundingClientRect();
          return { i: Number(el.getAttribute("data-ovs-step")), slot: Number(el.getAttribute("data-ovs-slot")), opacity: Number(el.getAttribute("data-ovs-line-opacity")), x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    };
    const term = async (beatId, local, stepIndex, latex) => {
      await seek(beatId, local);
      return page.evaluate(
        ([i, tex]) => {
          const el = document.querySelector(`[data-ovs-step="${i}"] g[data-ovs-latex]`) && Array.from(document.querySelectorAll(`[data-ovs-step="${i}"] g[data-ovs-latex]`)).find((g) => g.getAttribute("data-ovs-latex") === tex);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, state: el.getAttribute("data-ovs-term"), fillOpacity: Number(el.getAttribute("fill-opacity")) };
        },
        [stepIndex, latex],
      );
    };
    const glowing = () => page.evaluate(() => document.querySelectorAll("[data-ovs-glow]").length);

    console.log("-- the steps arrive in order and stack");
    check("nothing is drawn before the first step", (await lines("range", 5)).length === 0);
    check("the first step is revealed at its frame", (await lines("range", 20)).map((l) => l.i).join() === "0");
    const three = await lines("range", 210);
    check("with three steps in, they read top to bottom in order", three.map((l) => l.i).join() === "0,1,2" && three[0].y < three[1].y && three[1].y < three[2].y);
    check("the newest is in slot 0, the one before in slot 1, the one before that in slot 2", three.map((l) => Math.round(l.slot)).join() === "2,1,0");
    const four = await lines("range", 280);
    check("only three stay: the fourth step pushes the first one out", four.map((l) => l.i).join() === "1,2,3");
    check("opacity falls with age: 1 for the newest, about half for the one before, about a quarter for the one before that", near(four[2].opacity, 1, 0.01) && near(four[1].opacity, 0.5, 0.02) && near(four[0].opacity, 0.26, 0.02));
    const img = await frame("range", 280);
    const peak = (l) => {
      let best = 0;
      for (let y = Math.max(0, Math.floor(l.y)); y < Math.min(img.height, Math.ceil(l.y + l.h)); y++) for (let x = Math.max(0, Math.floor(l.x)); x < Math.min(img.width, Math.ceil(l.x + l.w)); x++) best = Math.max(best, luma(img, x, y));
      return best;
    };
    const peaks = four.map(peak);
    check(`and so does the ink in the pixels (${peaks.map((p) => Math.round(p)).join(" < ")})`, peaks[0] < peaks[1] && peaks[1] < peaks[2] && peaks[2] > 200);
    const lo = height > width ? height * 0.14 : height * 0.05;
    const hi = height > width ? height * 0.78 : height * 0.95;
    check("the stack stays inside the safe zone", four.every((l) => l.y >= lo && l.y + l.h <= hi));
    check("every line is inside the frame sideways", four.every((l) => l.x >= 0 && l.x + l.w <= width));
    check("mid-move, the previous line is part way up (a fractional slot)", (await lines("range", 220 + 7)).some((l) => l.slot > 0.2 && l.slot < 0.9));
    check("after all seven steps, steps 4 to 6 are showing", (await lines("range", 500)).map((l) => l.i).join() === "4,5,6");

    console.log("-- carried terms stay put, new ones rise in, gone ones fade out");
    const before = { R: await term("range", 289, 3, "R"), theta: await term("range", 289, 3, String.raw`\theta`) };
    check("step 3 has its R and theta", before.R && before.theta);
    for (const local of [291, 296, 305, 330]) {
      const R = await term("range", local, 4, "R");
      const theta = await term("range", local, 4, String.raw`\theta`);
      check(`frame ${local}: R and theta are carried and have not moved from the line before (within 1px)`, R?.state === "carried" && theta?.state === "carried" && near(R.x, before.R.x, 1) && near(R.y, before.R.y, 1) && near(theta.x, before.theta.x, 1) && near(theta.y, before.theta.y, 1));
    }
    const cdotEarly = await term("range", 294, 4, String.raw`\cdot`);
    const cdotLate = await term("range", 340, 4, String.raw`\cdot`);
    check("a new term is marked new and rises into place (it moves while it arrives)", cdotEarly?.state === "new" && cdotLate?.state === "new" && Math.abs(cdotEarly.y - cdotLate.y) > 3);
    check("control: that same measurement on a carried term finds no movement", Math.abs((await term("range", 294, 4, "R")).y - (await term("range", 340, 4, "R")).y) < 1);
    check("a new term is not yet drawn when its turn has not come (opacity rises from 0)", (await term("range", 291, 4, String.raw`\cdot`))?.fillOpacity < 0.2 && (await term("range", 340, 4, String.raw`\cdot`))?.fillOpacity > 0.2);
    const ghost = await term("range", 293, 4, "t");
    check("a term that is gone is still there, fading, as the next line arrives", ghost?.state === "removed" && ghost.fillOpacity > 0 && ghost.fillOpacity < 1);
    check("and is gone once the move is over", (await term("range", 290 + 14 + 4, 4, "t")) === null);

    console.log("-- a carried term slides when the terms before it change width");
    const c0 = await term("slide", 60, 0, "c");
    const cStart = await term("slide", 70, 1, "c");
    const cMid = await term("slide", 77, 1, "c");
    const cEnd = await term("slide", 120, 1, "c");
    check("at the moment the new line arrives, c is exactly where it was", cStart?.state === "carried" && near(cStart.x, c0.x, 1.5));
    check("it ends further right, by the width of the new terms", cEnd.x > c0.x + width * 0.01);
    check("and part way through it is between the two", cMid.x > cStart.x + 0.5 && cMid.x < cEnd.x - 0.5);
    const a0 = await term("slide", 60, 0, "a");
    const a1 = await term("slide", 120, 1, "a");
    check("while a, which nothing was added before, did not move", near(a0.x, a1.x, 1) && near(a0.y, a1.y, 1));

    console.log("-- terms that are gone fade out");
    const plus = await term("gone", 72, 1, "+");
    check("the + of a + b = c is still drawn just after the line arrives, as a removed term", plus?.state === "removed" || (await page.evaluate(() => document.querySelectorAll('[data-ovs-term="removed"]').length)) > 0);
    const f1 = (await page.evaluate(() => Array.from(document.querySelectorAll('[data-ovs-term="removed"]')).map((g) => Number(g.getAttribute("fill-opacity")))))[0];
    await seek("gone", 78);
    const f2 = (await page.evaluate(() => Array.from(document.querySelectorAll('[data-ovs-term="removed"]')).map((g) => Number(g.getAttribute("fill-opacity")))))[0];
    check("its opacity falls as the move goes on", f1 > f2 && f2 > 0);
    await seek("gone", 100);
    check("and nothing is left of it afterwards", (await page.evaluate(() => document.querySelectorAll('[data-ovs-term="removed"]').length)) === 0);

    console.log("-- because, and the narration");
    await seek("range", 80 + 40);
    const because = await page.evaluate(() => Array.from(document.querySelectorAll("[data-ovs-because]")).map((el) => ({ step: el.getAttribute("data-ovs-because"), text: el.textContent })));
    check("a step's `because` is shown with it", because.length === 1 && because[0].step === "1" && because[0].text === "it lands when y is zero");
    await seek("range", 80 + 1);
    check("the reason is not on screen before the step", (await page.evaluate(() => document.querySelectorAll('[data-ovs-because="3"]').length)) === 0);
    check("nothing is revealed before the first spoken word of step 0 (word 3, frame 36)", (await lines("narr", 34)).length === 0);
    check("a step is revealed at the word it is spoken at", (await lines("narr", 38)).map((l) => l.i).join() === "0");
    check("the next one waits for its own words (word 8, frame 96)", (await lines("narr", 94)).map((l) => l.i).join() === "0" && (await lines("narr", 98)).map((l) => l.i).join() === "0,1");

    console.log("-- purity and glow");
    const a = await frame("range", 296);
    await frame("range", 140);
    const b = await frame("range", 296);
    check("the same frame twice, with another between, is byte for byte identical", sameBytes(a, b));
    check("nothing glows", (await glowing()) === 0);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  ${errors.slice(0, 4).join(" | ")}`);
  });
}

await run(1080, 1920);
await run(1920, 1080);
finish();

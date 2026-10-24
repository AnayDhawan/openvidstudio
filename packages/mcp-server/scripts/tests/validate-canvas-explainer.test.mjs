#!/usr/bin/env node
// validate-canvas-explainer: size, safe-area, purity, arc and sound checks for a canvas explainer (#155).
//
// A clean fixture draws no finding. For each rule a fixture breaks exactly that rule, and the finding that comes
// back is the intended one, with validate_scenes' shape. The pure helpers are checked on their own, and the run
// has to stay well under the 60 seconds CI allows.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, check, finish } from "./_harness.mjs";
import { tmpDir, explainer, writeExplainer } from "./_canvas.mjs";

const { validateCanvasExplainer, isKeyNumber, maxSimultaneous, judgeText } = require(path.join(distDir, "canvasValidate.js"));
const dir = tmpDir("ovs-canvas-validate-");

console.log("\n== the pure parts ==");
{
  check("a figure with a unit is a key number", ["42", "1,200", "73%", "9.8 m/s", "-5", "$40", "3.5x"].every(isKeyNumber));
  check("words are not", !["Slope", "rise over run", "2 sides of a coin", "x squared"].some(isKeyNumber));
  const src = (s, d, stop = null, bufferSeconds = null) => ({ start: s, stop, duration: d, bufferSeconds, loop: false });
  check("maxSimultaneous counts overlapping sources", maxSimultaneous([src(0, 2), src(1, 2), src(1.5, 2)], 10) === 3);
  check("what ends at an instant is not counted with what begins at it", maxSimultaneous([src(0, 1), src(1, 1)], 10) === 1);
  check("a source with no stop and no length plays to the end", maxSimultaneous([src(0, null), src(8, 1)], 10) === 2);
  check("a buffer plays for its length, and a stop cuts it short", maxSimultaneous([src(0, null, null, 1), src(2, null, null, 1)], 10) === 1 && maxSimultaneous([src(0, null, 0.5), src(0.6, null, 1)], 10) === 1);
  const text = (t, size, y = 300) => ({ text: t, size, x: 10, y, caption: false });
  const at720 = judgeText([text("rise over run", 20), text("tiny", 10), text("Slope", 36), text("42", 40), text("fine label", 30), text("Fine headline", 60)], 1280, 720, 1, "x.html");
  const by = Object.fromEntries(at720.map((f) => [f.message.match(/"([^"]+)"/)[1], f.severity]));
  check("a label under 28px is a warning, under 14px an error", by["rise over run"] === "warning" && by["tiny"] === "error");
  check("a headline under 44px is a warning, a key number under 64px is a warning", by["Slope"] === "warning" && by["42"] === "warning");
  check("text at the minimum draws nothing", !("fine label" in by) && !("Fine headline" in by) && at720.length === 4);
  check("the minimums scale with the canvas: 20px passes at textScale 0.6 and not at 1", judgeText([text("rise over run", 20)], 1280, 720, 0.6, "x").length === 0 && judgeText([text("rise over run", 20)], 1280, 720, 1, "x").length === 1);
  check("captions are exempt from size and safe area", judgeText([{ text: "a caption", size: 20, x: 0, y: 700, caption: true }], 720, 1280, 1, "x").length === 0);
  const tall = judgeText([text("top text", 30, 100), text("bottom text", 30, 1150), text("middle text", 30, 600)], 720, 1280, 1, "x");
  check("on a tall canvas text in the top 14% or the bottom 22% is a safe-area warning, the middle is fine", tall.length === 2 && tall.every((f) => f.check === "safe-area" && f.severity === "warning"));
  check("on a wide canvas there is no safe-area rule", judgeText([text("top text", 30, 20)], 1280, 720, 1, "x").length === 0);
  check("findings have validate_scenes' shape", at720.every((f) => f.beatId === "*" && f.scene === "x.html" && typeof f.check === "string" && f.source === "render"));
}

const run = async (name, html, opts = {}) => {
  const file = writeExplainer(dir, `${name}.html`, html);
  const started = Date.now();
  const r = await validateCanvasExplainer({ htmlPath: file, ...opts });
  return { ...r, wall: Date.now() - started };
};
const checks = (r) => [...new Set(r.findings.map((f) => f.check))].sort();
const hasOnly = (r, ...names) => JSON.stringify(checks(r)) === JSON.stringify([...names].sort());

console.log("\n== a clean fixture ==");
let slowest = 0;
{
  const r = await run("clean", explainer({ duration: 4 }));
  slowest = Math.max(slowest, r.wall);
  console.log(`  findings: ${JSON.stringify(r.findings.map((f) => f.check))}  (${r.wall} ms)`);
  check("no finding at all, and ok", r.findings.length === 0 && r.ok === true);
  check("it reports the length, the frames sampled, the smallest text and the sound", r.durationSeconds === 4 && r.framesSampled >= 8 && r.minTextSize === 30 && r.sound?.maxSimultaneous === 1 && r.sound.peakDb < 0);
  const tall = await run("clean-tall", explainer({ duration: 4 }), { width: 720, height: 1280 });
  check("the same file is clean at 720x1280 too", tall.findings.length === 0);
}

console.log("\n== each rule, broken once ==");
{
  const block = `ctx.fillStyle = "#5CC8FF"; ctx.fillRect(40 + (t / 4) * 600, H * 0.45, 200, 120);`;
  const bg = `ctx.fillStyle = "hsl(" + Math.round(t * 90) + ", 60%, 20%)"; ctx.fillRect(0, 0, W, H);`;
  const text = (font, s, y = "H * 0.3") => `ctx.fillStyle = "#F3EFE6"; ctx.font = "${font}"; ctx.fillText("${s}", 60, ${y});`;

  const impure = await run("impure", explainer({ duration: 4, extra: "var drawn = 0;", draw: `drawn++; ctx.fillStyle = "rgb(" + (drawn * 5 % 255) + ",40,90)"; ctx.fillRect(0, 0, W, H); ${block}` }));
  check("a frame that depends on the draw count is a purity error, and only that", hasOnly(impure, "purity") && impure.findings.every((f) => f.severity === "error") && impure.ok === false);

  const small = await run("small", explainer({ duration: 4, draw: `${bg} ${block} ${text("20px sans-serif", "rise over run")}` }));
  check("a 20px label is a text-size warning, and only that", hasOnly(small, "text-size") && small.findings[0].severity === "warning" && small.ok === true);
  const tiny = await run("tiny", explainer({ duration: 4, draw: `${bg} ${block} ${text("10px sans-serif", "rise over run")}` }));
  check("a 10px label is a text-size error", hasOnly(tiny, "text-size") && tiny.findings[0].severity === "error" && tiny.ok === false);
  const headline = await run("headline", explainer({ duration: 4, draw: `${bg} ${block} ${text("700 36px sans-serif", "A headline")}` }));
  check("a 36px headline is a text-size warning that names the headline minimum", hasOnly(headline, "text-size") && /headline/.test(headline.findings[0].message) && /44px/.test(headline.findings[0].message));
  const figure = await run("figure", explainer({ duration: 4, draw: `${bg} ${block} ${text("700 40px sans-serif", "1,200")}` }));
  check("a 40px key number is a text-size warning that names the number minimum", hasOnly(figure, "text-size") && /key number/.test(figure.findings[0].message) && /64px/.test(figure.findings[0].message));

  const unsafe = await run("unsafe", explainer({ duration: 4, draw: `${bg} ${block} ${text("700 64px sans-serif", "Too high", "H * 0.08")}` }), { width: 720, height: 1280 });
  check("text in the top 14% of a tall canvas is a safe-area warning", hasOnly(unsafe, "safe-area") && unsafe.findings[0].severity === "warning");
  const unsafeWide = await run("unsafe-wide", explainer({ duration: 4, draw: `${bg} ${block} ${text("700 64px sans-serif", "Too high", "H * 0.08")}` }));
  check("control: the same text on a wide canvas is fine", unsafeWide.findings.length === 0);

  const late = await run("late", explainer({ duration: 20, draw: `ctx.fillStyle = "hsl(220," + (30 + 20 * Math.sin(t * 2)) + "%," + (14 + 8 * Math.sin(t * 2.1)) + "%)"; ctx.fillRect(0, 0, W, H); if (t > 17) { ctx.fillStyle = "#5CC8FF"; ctx.fillRect(40 + (t - 17) * 100, H * 0.45, 200, 120); }` }));
  console.log(`  late: ${JSON.stringify(late.findings.map((f) => [f.check, f.severity]))}  (${late.wall} ms)`);
  slowest = Math.max(slowest, late.wall);
  check("a diagram that first appears at 17 s is a diagram-late warning, and only that", hasOnly(late, "diagram-late") && late.findings[0].severity === "warning");
  const lateError = await run("late2", explainer({ duration: 30, draw: `ctx.fillStyle = "hsl(220," + (30 + 20 * Math.sin(t * 2)) + "%," + (14 + 8 * Math.sin(t * 2.1)) + "%)"; ctx.fillRect(0, 0, W, H); if (t > 27) { ctx.fillStyle = "#5CC8FF"; ctx.fillRect(40 + (t - 27) * 100, H * 0.45, 200, 120); }` }));
  check("at 27 s it is an error", hasOnly(lateError, "diagram-late") && lateError.findings[0].severity === "error");
  const early = await run("early", explainer({ duration: 20, draw: `${bg} if (t > 6) { ${block} }` }));
  check("control: a diagram at 7 s is not late", early.findings.every((f) => f.check !== "diagram-late"));

  const still = await run("still", explainer({ duration: 20, draw: `ctx.fillStyle = "#1a1830"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#5CC8FF"; ctx.fillRect(100, 300, 200, 120); if (t > 14) { ctx.fillStyle = "#FFB347"; ctx.fillRect(100 + (t - 14) * 80, 500, 100, 100); }` }));
  console.log(`  still: ${JSON.stringify(still.findings.map((f) => [f.check, f.severity]))}  (${still.wall} ms)`);
  check("a drawing that sits still for 14 s is a static-stretch warning, and only that", hasOnly(still, "static-stretch") && still.findings[0].severity === "warning");
  const thresholds = await run("still2", explainer({ duration: 20, draw: `ctx.fillStyle = "#1a1830"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#5CC8FF"; ctx.fillRect(100, 300, 200, 120); if (t > 14) { ctx.fillStyle = "#FFB347"; ctx.fillRect(100 + (t - 14) * 80, 500, 100, 100); }` }), { staticSeconds: 20 });
  check("staticSeconds is an option", thresholds.findings.length === 0);

  const pile = await run("pile", explainer({ duration: 4, score: `window.scoreSound = function (kit) { for (var i = 0; i < 5; i++) { var o = kit.ctx.createOscillator(); var g = kit.ctx.createGain(); o.frequency.value = 220 * (i + 1); g.gain.value = 0.05; o.connect(g); g.connect(kit.ctx.destination); o.start(0); o.stop(3); } };` }));
  check("five sounds at once is a sound-polyphony warning, and only that", hasOnly(pile, "sound-polyphony") && /5 sounds/.test(pile.findings[0].message) && pile.sound.maxSimultaneous === 5);
  const loud = await run("loud", explainer({ duration: 4, score: `window.scoreSound = function (kit) { var o = kit.ctx.createOscillator(); var g = kit.ctx.createGain(); g.gain.value = 3; o.connect(g); g.connect(kit.ctx.destination); o.start(0); o.stop(2); };` }));
  check("a score that clips is a sound-peak warning", hasOnly(loud, "sound-peak"));
  const noKit = await run("nokit", explainer({ duration: 4, sound: "" }));
  check("a missing sound kit is an error that names renderOffline; audio: false skips the check", hasOnly(noKit, "sound-kit") && /renderOffline/.test(noKit.findings[0].message) && (await run("nokit2", explainer({ duration: 4, sound: "" }), { audio: false })).findings.length === 0);

  const random = await run("random", explainer({ duration: 4, draw: `${bg} ${block} var x = 0 && Math.random();` }));
  check("Math.random in the source is a randomness warning, and only that", hasOnly(random, "randomness") && random.findings[0].severity === "warning");
}

console.log("\n== the run stays short ==");
check(`the slowest fixture validated in ${slowest} ms, under the 60 s CI allows`, slowest < 60000);
{
  const { createMcpServer } = require(path.join(distDir, "server.js"));
  const tool = createMcpServer()._registeredTools["validate_canvas_explainer"];
  const r = await tool.handler({ htmlPath: path.join(dir, "clean.html") }, {});
  const body = JSON.parse(r.content[0].text);
  check("the tool runs through the server and returns the same result", body.ok === true && body.findings.length === 0);
}

fs.rmSync(dir, { recursive: true, force: true });
finish();

#!/usr/bin/env node
// check-script: the lesson script lint (#113). A good script draws no finding at all; a deliberately
// bad one makes each of the eight checks fire exactly once; and for each check, fixing that one thing
// in the bad script removes that check's finding and leaves the other seven alone.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { require, distDir, check, finish } from "./_harness.mjs";

const { checkScriptLogic, runCheckScript, spokenStrings, splitSentences, fleschKincaidGrade, syllables } = require(path.join(distDir, "tools", "checkScript.js"));
const { createMcpServer } = require(path.join(distDir, "server.js"));
const FPS = 30;
const words = (s) => s.trim().split(/\s+/).length;
/** A beat whose duration puts it at 2.6 words a second, the middle of SCRIPT.md's budget. */
const beat = (id, vo, frames) => ({ id, vo, start: 0, duration: frames ?? Math.round((words(vo) / 2.6) * FPS), visual: { captureMethod: "dom-demo" } });
const file = (beats) => {
  let start = 0;
  return { fps: FPS, narration: "voice", beats: beats.map((b) => { const out = { ...b, start }; start += b.duration; return out; }) };
};
const count = (result, name) => result.findings.filter((f) => f.check === name).length;
const CHECKS = ["sentence-length", "reading-level", "glossary", "new-terms", "spoken", "hook", "pace", "closing-question"];

console.log("\n== a good script draws no finding ==");
const GOOD_CARD = { goal: "tell why a derivative is a slope", terms: ["slope", "derivative"], example: "a ball rolling down a hill" };
const GOOD = file([
  beat("hook", "How fast is a ball moving at one exact moment? A slope can tell us. A slope is how steep a line is."),
  beat("picture", "Picture a ball rolling down a hill. At each point the hill has a steepness. That steepness changes as the ball moves."),
  beat("define", "The derivative is the slope at one single point. We write it as d y over d x."),
  beat("aha", "So the slope of a curve at a point is its derivative. It tells us how fast y changes."),
  beat("check", "Quick recap. The derivative is the slope at a point. Can you say what the derivative of x squared tells you?"),
]);
const goodScenes = { define: `export const Define = () => <Equation tex="\\\\frac{dy}{dx}" spoken="d y over d x" />;` };
const readGood = (b, id) => goodScenes[id] ?? null;
{
  const r = checkScriptLogic(GOOD, GOOD_CARD, readGood);
  console.log(`  findings: ${JSON.stringify(r.findings)}`);
  check("no findings of any severity, and ok", r.findings.length === 0 && r.ok === true && r.beatsChecked === 5);
}

console.log("\n== a deliberately bad script: each check fires once ==");
const BAD_CARD = { goal: "tell why a derivative is a slope", terms: ["tangent", "limit", "rate", "curve"], example: "a ball on a hill" };
const LONG = "We can look at the ball as it rolls and then see how far it went and how long it took.";
const HEAVY = "Instantaneous differentiation characterizes infinitesimal approximations. Mathematicians conceptualize extraordinarily complicated relationships.";
const badBeats = () => [
  beat("hook", "In this video we will look at slopes."),
  beat("tangent", "Think of a tangent touching a hill once. It just grazes the line."),
  beat("terms", "A limit is a value we get close to. A rate is how fast a thing grows. A curve is a smooth line."),
  beat("long", LONG),
  beat("heavy", HEAVY),
  beat("formula", "Here is the formula for the hill."),
  beat("slow", "Look at this.", 300),
  beat("end", "So that is the whole idea."),
];
const badScenes = { formula: `export const Formula = () => <Equation tex="x^2+1" spoken="x squared plus one" />;` };
const readBad = (b, id) => badScenes[id] ?? null;
const bad = checkScriptLogic(file(badBeats()), BAD_CARD, readBad);
console.log(`  ${bad.findings.map((f) => `${f.check}@${f.beatId}`).join("  ")}`);
for (const name of CHECKS) check(`${name} fires exactly once`, count(bad, name) === 1);
check("there are no other findings", bad.findings.length === CHECKS.length);
check("each finding points at the beat that caused it", (() => {
  const at = Object.fromEntries(bad.findings.map((f) => [f.check, f.beatId]));
  return at["hook"] === "hook" && at["glossary"] === "tangent" && at["new-terms"] === "terms" && at["sentence-length"] === "long" && at["reading-level"] === "heavy" && at["spoken"] === "formula" && at["pace"] === "slow" && at["closing-question"] === "end";
})());
check("the script is not ok (the errors fail it)", bad.ok === false);
check("severities: spoken, pace, closing-question and an \"in this video\" hook are errors; the rest do not fail it", (() => {
  const sev = Object.fromEntries(bad.findings.map((f) => [f.check, f.severity]));
  return sev["spoken"] === "error" && sev["pace"] === "error" && sev["closing-question"] === "error" && sev["hook"] === "error" &&
    sev["sentence-length"] === "warning" && sev["reading-level"] === "warning" && sev["new-terms"] === "warning" && sev["glossary"] === "note";
})());

console.log("\n== control: fixing one thing removes that finding and nothing else ==");
const fixes = {
  "sentence-length": (beats) => { beats[3] = beat("long", "We can look at the ball as it rolls. Then we look at it once more. We see how far it went. We see how long it took. So we know its speed."); },
  "reading-level": (beats) => { beats[4] = beat("heavy", "Slopes can change a lot. Think of a hill. Steep spots and flat spots."); },
  glossary: (beats) => { beats[1] = beat("tangent", "A tangent is a line that touches a hill once. It just grazes the line."); },
  "new-terms": (beats) => { beats[2] = beat("terms", "A limit is a value we get close to. A rate is how fast a thing grows."); },
  hook: (beats) => { beats[0] = beat("hook", "How steep is a hill at one exact spot?"); },
  pace: (beats) => { beats[6] = beat("slow", "Look at this."); },
  "closing-question": (beats) => { beats[7] = beat("end", "So that is the whole idea. Can you say it in your own words?"); },
};
for (const name of CHECKS.filter((c) => c !== "spoken")) {
  const beats = badBeats();
  fixes[name](beats);
  const fixed = checkScriptLogic(file(beats), BAD_CARD, readBad);
  const others = CHECKS.filter((c) => c !== name && c !== "new-terms" && c !== "glossary");
  check(`fixing ${name}: its finding is gone`, count(fixed, name) === 0);
  // the "new-terms" and "glossary" fixes also move which beat first uses a term, so only the others are held exactly
  check(`...and every other check still fires once`, others.every((c) => count(fixed, c) === 1));
}
{
  const fixedScene = { formula: `export const Formula = () => <Equation tex="x^2+1" spoken="the formula for the hill" />;` };
  const fixed = checkScriptLogic(file(badBeats()), BAD_CARD, (b, id) => fixedScene[id] ?? null);
  check("fixing spoken (the equation says what the voice says): its finding is gone, the other seven stay", count(fixed, "spoken") === 0 && CHECKS.filter((c) => c !== "spoken").every((c) => count(fixed, c) === 1));
}

console.log("\n== the pieces ==");
{
  check("spokenStrings reads the three ways a prop can be written", JSON.stringify(spokenStrings(`<Equation tex="a" spoken="one" /><Equation tex="b" spoken={"two"} /><Equation tex="c" spoken={\`three\`} />`)) === JSON.stringify(["one", "two", "three"]));
  check("spokenStrings reads an Equation whose props span several lines", spokenStrings(`<Equation\n  tex={String.raw\`\\frac{1}{2}\`}\n  at={4}\n  spoken="one half"\n/>`)[0] === "one half");
  check("spoken matching ignores case and punctuation", checkScriptLogic(file([beat("a", "Why? Because X squared, plus one!")]), { goal: "g", terms: [], example: "e" }, () => `<Equation tex="x" spoken="x squared plus one" />`).findings.every((f) => f.check !== "spoken"));
  check("sentences split on . ! ?", JSON.stringify(splitSentences("One. Two! Three? Four")) === JSON.stringify(["One.", "Two!", "Three?", "Four"]));
  check("syllables: a few known words", syllables("slope") === 1 && syllables("derivative") === 4 && syllables("the") === 1 && syllables("equation") >= 3);
  check("a plain sentence reads below grade 6, a heavy one above grade 14", fleschKincaidGrade("The ball rolls down the hill.") < 6 && fleschKincaidGrade(HEAVY) > 14);
  check("a hook with a number is fine without a question", checkScriptLogic(file([beat("a", "Nine out of ten balls roll downhill. Can you say why?")]), { goal: "g", terms: [], example: "e" }).findings.every((f) => f.check !== "hook"));
  check("a hook that is neither a question nor holds a number is a warning, not an error", (() => {
    const r = checkScriptLogic(file([beat("a", "Hills are steep. Can you say why?")]), { goal: "g", terms: [], example: "e" });
    return r.findings.some((f) => f.check === "hook" && f.severity === "warning") && r.ok === true;
  })());
}

console.log("\n== the tool reads beats.json, concept.json and the scene from disk ==");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-check-script-"));
  const videoDir = path.join(root, "src", "videos", "lesson");
  fs.mkdirSync(path.join(videoDir, "scenes"), { recursive: true });
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify(GOOD));
  fs.writeFileSync(path.join(videoDir, "concept.json"), JSON.stringify(GOOD_CARD));
  fs.writeFileSync(path.join(videoDir, "scenes", "Define.tsx"), goodScenes.define);
  const r = runCheckScript({ projectRoot: root, videoName: "lesson" });
  check("a good script on disk: no findings", r.findings.length === 0 && r.ok);
  fs.writeFileSync(path.join(videoDir, "scenes", "Define.tsx"), `export const Define = () => <Equation tex="x" spoken="completely different words" />;`);
  const mismatch = runCheckScript({ projectRoot: root, videoName: "lesson" });
  check("the scene file's spoken string is compared with the beat's narration", mismatch.findings.length === 1 && mismatch.findings[0].check === "spoken" && mismatch.findings[0].beatId === "define");
  fs.rmSync(path.join(videoDir, "concept.json"));
  let message = "";
  try { runCheckScript({ projectRoot: root, videoName: "lesson" }); } catch (err) { message = String(err.message); }
  check("with no concept card the error says what to write", /concept\.json/.test(message) && /goal, terms, example/.test(message));
  const custom = path.join(videoDir, "custom");
  fs.mkdirSync(custom, { recursive: true });
  fs.writeFileSync(path.join(custom, "Own.tsx"), `<Equation tex="x" spoken="d y over d x" />`);
  const withScenePath = file([beat("define", "We write it as d y over d x. Can you say it?")]);
  withScenePath.beats[0].scene = "./custom/Own.tsx";
  const viaScenePath = runCheckScript({ projectRoot: root, videoName: "lesson", beatsJson: withScenePath, conceptCard: GOOD_CARD });
  check("a beat's own `scene` path is read instead of scenes/<BeatId>.tsx", viaScenePath.findings.every((f) => f.check !== "spoken"));
}

console.log("\n== registered like the other tools ==");
{
  const tools = createMcpServer()._registeredTools;
  check("check_script is registered with a title", typeof tools["check_script"]?.title === "string" && tools["check_script"].title.length > 0);
  check("validate_beats still exports the pace budget it shares (the same message in both tools)", (() => {
    const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
    const v = validateBeatsLogic({ fps: 30, beats: [{ id: "a", start: 0, duration: 300, vo: "Look at this.", visual: { captureMethod: "dom-demo" } }] });
    const c = checkScriptLogic(file([beat("a", "Look at this.", 300)]), { goal: "g", terms: [], example: "e" });
    const vMsg = v.errors.find((e) => /VO pace/.test(e)) ?? "";
    const cMsg = c.findings.find((f) => f.check === "pace")?.message ?? "";
    return vMsg.endsWith(cMsg) && cMsg.length > 20;
  })());
}

finish();

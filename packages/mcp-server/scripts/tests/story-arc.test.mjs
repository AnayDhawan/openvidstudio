#!/usr/bin/env node
// story-arc: the story-first lesson arc in check_script (#154). A good story script draws no story finding;
// for each new check a failing script fires it exactly once and fixing that one thing clears it; the seven-beat
// arc (the default) gives the same findings with and without `arc: "seven-beat"`.

import * as path from "node:path";
import { require, distDir, check, finish } from "./_harness.mjs";

const { checkScriptLogic, runCheckScript } = require(path.join(distDir, "tools", "checkScript.js"));
const { createMcpServer } = require(path.join(distDir, "server.js"));
const FPS = 30;
const words = (s) => s.trim().split(/\s+/).length;
const beat = (id, vo, frames) => ({ id, vo, start: 0, duration: frames ?? Math.round((words(vo) / 2.6) * FPS), visual: { captureMethod: "dom-demo" } });
const file = (beats) => {
  let start = 0;
  return { fps: FPS, narration: "voice", beats: beats.map((b) => { const out = { ...b, start }; start += b.duration; return out; }) };
};
const count = (result, name) => result.findings.filter((f) => f.check === name).length;
const STORY_CHECKS = ["story-situation", "story-formula", "story-practice", "story-comment", "story-subscribe", "story-answer"];
const storyFindings = (r) => r.findings.filter((f) => STORY_CHECKS.includes(f.check));

const CARD = {
  goal: "find what a jar of money grows to with compound interest",
  terms: ["interest"],
  example: "1000 rupees at five percent for three years",
  arc: "story",
  situation: "Maya saves money in a jar at the market",
  character: "Pixel",
  formulas: [
    { tex: "A = P(1+r)^n", spoken: "A equals P times one plus r to the power n", source: "IB data booklet" },
    { tex: "I = A - P", spoken: "interest equals A minus P", source: "IB data booklet" },
  ],
  practiceQuestion: "How much is in a jar after three years at five percent?",
  answer: "1157.63",
};
const QUESTION = "How much is in a jar after three years at five percent?";
const storyBeats = () => [
  beat("situation", "Maya keeps 1000 rupees in a jar at the market. Will it grow if she leaves it alone?"),
  beat("idea", "Pixel the narrator says a bank pays interest. Interest is extra money paid each year."),
  beat("formulas", "Two formulas help. A equals P times one plus r to the power n. Then interest equals A minus P."),
  beat("apply", "Maya puts in 1000 at five percent for three years. Put those numbers in to find A."),
  beat("watch-out", "Watch out. Write five percent as zero point zero five."),
  beat("practice", `Now it is your turn. Put your answer in the comments. ${QUESTION}`),
];
const run = (beats, card = CARD) => checkScriptLogic(file(beats), card);

console.log("\n== a good story script draws no finding ==");
{
  const r = run(storyBeats());
  console.log(`  findings: ${JSON.stringify(r.findings)}`);
  check("no story finding and the script is ok", storyFindings(r).length === 0 && r.ok === true);
  check("the practice question does not need to end on a question mark for the story arc", (() => {
    const beats = storyBeats();
    beats[5] = beat("practice", "Put your answer in the comments. Find the total in the jar after three years at five percent.");
    return run(beats, { ...CARD, practiceQuestion: "Find the total in the jar after three years at five percent." }).findings.every((f) => f.check !== "closing-question" && f.check !== "story-practice");
  })());
  check("nothing hard-codes six or seven beats: nine beats and four beats both pass", (() => {
    const nine = storyBeats();
    nine.splice(3, 0, beat("more", "Pixel has a second look at the jar."), beat("more2", "The jar sits on a shelf."), beat("more3", "Years go by."));
    const four = [
      storyBeats()[0],
      beat("all", "Interest is extra money paid each year. A equals P times one plus r to the power n. Then interest equals A minus P. Maya puts in 1000 at five percent for three years."),
      storyBeats()[4],
      storyBeats()[5],
    ];
    return storyFindings(run(nine)).length === 0 && storyFindings(run(four)).length === 0;
  })());
}

console.log("\n== story-situation: the first beat names the situation (error) ==");
{
  const bad = storyBeats();
  bad[0] = beat("situation", "Will money grow if you leave it alone for a long time?");
  const r = run(bad);
  check("a first beat with no situation words fires once, as an error, on that beat", count(r, "story-situation") === 1 && r.findings.find((f) => f.check === "story-situation").severity === "error" && r.findings.find((f) => f.check === "story-situation").beatId === "situation" && r.ok === false);
  const one = storyBeats();
  one[0] = beat("situation", "Maya wonders if it will grow if she leaves it alone for a long time?");
  check("sharing only one content word (maya) still fires", count(run(one), "story-situation") === 1);
  check("fixing it clears it and the other story checks stay quiet", storyFindings(run(storyBeats())).length === 0);
  check("a card with no situation is a warning that it cannot be checked", (() => {
    const { situation, ...rest } = CARD;
    const w = run(storyBeats(), rest).findings.find((f) => f.check === "story-situation");
    return w?.severity === "warning";
  })());
}

console.log("\n== story-formula: each formula is said, in the order given (error) ==");
{
  const missing = storyBeats();
  missing[2] = beat("formulas", "Two formulas help. A equals P times one plus r to the power n.");
  const r1 = run(missing);
  check("a formula that is never said fires once, as an error", count(r1, "story-formula") === 1 && r1.findings.find((f) => f.check === "story-formula").severity === "error" && r1.ok === false);
  const swapped = storyBeats();
  swapped[2] = beat("formulas", "Two formulas help. Interest equals A minus P. Then A equals P times one plus r to the power n.");
  const r2 = run(swapped);
  check("formulas said in the wrong order fire once, naming the beat that says the late one", count(r2, "story-formula") === 1 && /before the formula above/.test(r2.findings.find((f) => f.check === "story-formula").message));
  const across = storyBeats();
  across[2] = beat("formulas", "Two formulas help. A equals P times one plus r to the power n.");
  across[3] = beat("apply", "Maya puts in 1000 at five percent for three years. Then interest equals A minus P.");
  check("formulas may be spread over beats, in order, with no finding", count(run(across), "story-formula") === 0);
  check("fixing it clears it", count(run(storyBeats()), "story-formula") === 0);
  check("case and punctuation are ignored, as for an Equation", count(run(storyBeats().map((b) => ({ ...b, vo: b.vo.replace("A equals P times", "A, equals P TIMES") }))), "story-formula") === 0);
}

console.log("\n== story-practice and story-comment: the last beat ends on the question and asks for a comment ==");
{
  const notEnd = storyBeats();
  notEnd[5] = beat("practice", `${QUESTION} Put your answer in the comments.`);
  const r1 = run(notEnd);
  check("a last beat that does not end with the practice question fires story-practice once (error), and not story-comment", count(r1, "story-practice") === 1 && r1.findings.find((f) => f.check === "story-practice").severity === "error" && count(r1, "story-comment") === 0 && r1.ok === false);
  const other = storyBeats();
  other[5] = beat("practice", "Now it is your turn. Put your answer in the comments. What is the total after one year?");
  check("a different question fires story-practice", count(run(other), "story-practice") === 1);
  const noPrompt = storyBeats();
  noPrompt[5] = beat("practice", `Now it is your turn. ${QUESTION}`);
  const r2 = run(noPrompt);
  check("a last beat with no comment prompt fires story-comment once (error)", count(r2, "story-comment") === 1 && r2.findings.find((f) => f.check === "story-comment").severity === "error" && count(r2, "story-practice") === 0 && r2.ok === false);
  check("a prompt that says Comments in any case passes", count(run(storyBeats().map((b) => ({ ...b, vo: b.vo.replace("comments", "COMMENTS") }))), "story-comment") === 0);
  check("fixing both clears both", count(run(storyBeats()), "story-practice") === 0 && count(run(storyBeats()), "story-comment") === 0);
  check("a comment prompt in an earlier beat does not count", (() => {
    const beats = storyBeats();
    beats[4] = beat("watch-out", "Watch out. Write five percent as zero point zero five. Say it in the comments.");
    beats[5] = beat("practice", `Now it is your turn. ${QUESTION}`);
    return count(run(beats), "story-comment") === 1;
  })());
  check("a card with no practiceQuestion is a warning that it cannot be checked", (() => {
    const { practiceQuestion, ...rest } = CARD;
    return run(storyBeats(), rest).findings.find((f) => f.check === "story-practice")?.severity === "warning";
  })());
}

console.log("\n== story-subscribe: \"like and subscribe\" is a warning ==");
{
  const bad = storyBeats();
  bad[4] = beat("watch-out", "Watch out. Write five percent as zero point zero five. Like and subscribe for more.");
  const r = run(bad);
  check("it fires once, as a warning that does not fail the script", count(r, "story-subscribe") === 1 && r.findings.find((f) => f.check === "story-subscribe").severity === "warning" && r.findings.find((f) => f.check === "story-subscribe").beatId === "watch-out" && r.ok === true);
  check("\"like, and subscribe\" and \"Like & subscribe\" fire too", count(run(storyBeats().map((b, i) => (i === 4 ? { ...b, vo: b.vo + " Like, and subscribe." } : b))), "story-subscribe") === 1 && count(run(storyBeats().map((b, i) => (i === 4 ? { ...b, vo: b.vo + " Like & subscribe." } : b))), "story-subscribe") === 1);
  check("fixing it clears it", count(run(storyBeats()), "story-subscribe") === 0);
}

console.log("\n== story-answer: the answer is not in the narration (warning) ==");
{
  const bad = storyBeats();
  bad[3] = beat("apply", "Maya puts in 1000 at five percent for three years. She gets 1157.63 rupees.");
  const r = run(bad);
  check("an answer in the narration fires once, as a warning on that beat, and does not fail the script", count(r, "story-answer") === 1 && r.findings.find((f) => f.check === "story-answer").severity === "warning" && r.findings.find((f) => f.check === "story-answer").beatId === "apply" && r.ok === true);
  check("punctuation and case are ignored when matching the answer", count(run(bad, { ...CARD, answer: "1157.63 Rupees!" }), "story-answer") === 1);
  check("a number that only contains the answer's digits does not match", count(run(storyBeats().map((b, i) => (i === 3 ? { ...b, vo: b.vo + " That is 11576 in all." } : b))), "story-answer") === 0);
  check("fixing it clears it", count(run(storyBeats()), "story-answer") === 0);
  check("a card with no answer draws no story-answer finding", count(run(bad, { ...CARD, answer: undefined }), "story-answer") === 0);
}

console.log("\n== the existing length and reference checks keep working in the story arc ==");
{
  const slow = storyBeats();
  slow[1] = { ...slow[1], duration: 130 * FPS };
  check("a story lesson over maxSeconds fires length (error)", count(run(slow), "length") === 1 && run(slow).ok === false);
  check("a story lesson within a raised maxSeconds does not", count(run(slow, { ...CARD, maxSeconds: 200 }), "length") === 0);
  const withRef = { ...CARD, reference: "IB Maths AA 1.4", referenceSpoken: "I B maths A A, topic one point four" };
  check("the reference must be said in the first beat", count(run(storyBeats(), withRef), "reference") === 1);
  const said = storyBeats();
  said[0] = beat("situation", "I B maths A A, topic one point four. Maya keeps 1000 rupees in a jar at the market. Will it grow?");
  check("and is fine when it is", count(run(said, withRef), "reference") === 0);
}

console.log("\n== the seven-beat arc is unchanged by the new fields ==");
{
  const CARD7 = { goal: "tell why a derivative is a slope", terms: ["slope", "derivative"], example: "a ball rolling down a hill" };
  const GOOD = file([
    beat("hook", "How fast is a ball moving at one exact moment? A slope can tell us. A slope is how steep a line is."),
    beat("picture", "Picture a ball rolling down a hill. At each point the hill has a steepness. That steepness changes as the ball moves."),
    beat("define", "The derivative is the slope at one single point. We write it as d y over d x."),
    beat("aha", "So the slope of a curve at a point is its derivative. It tells us how fast y changes."),
    beat("check", "Quick recap. The derivative is the slope at a point. Can you say what the derivative of x squared tells you?"),
  ]);
  const BAD = file([
    beat("hook", "In this video we will look at slopes."),
    beat("long", "We can look at the ball as it rolls and then see how far it went and how long it took."),
    beat("heavy", "Instantaneous differentiation characterizes infinitesimal approximations. Mathematicians conceptualize extraordinarily complicated relationships."),
    beat("slow", "Look at this.", 300),
    beat("end", "So that is the whole idea."),
  ]);
  const plain = (b) => JSON.stringify(checkScriptLogic(b, CARD7));
  const withArc = (b) => JSON.stringify(checkScriptLogic(b, { ...CARD7, arc: "seven-beat" }));
  check("a good seven-beat script: identical result with arc seven-beat", plain(GOOD) === withArc(GOOD));
  check("a bad seven-beat script: identical findings with arc seven-beat", plain(BAD) === withArc(BAD) && JSON.parse(plain(BAD)).findings.length >= 4);
  check("story fields on a seven-beat card are ignored", plain(BAD) === JSON.stringify(checkScriptLogic(BAD, { ...CARD7, situation: "a jar", practiceQuestion: "Why?", answer: "Because", formulas: [{ tex: "x", spoken: "never said", source: "s" }] })));
  check("a seven-beat script has no story finding, and its closing-question check still fires", (() => {
    const r = checkScriptLogic(BAD, CARD7);
    return storyFindings(r).length === 0 && count(r, "closing-question") === 1;
  })());
  check("control: the same bad script under the story arc does show story findings", storyFindings(checkScriptLogic(BAD, { ...CARD, terms: [] })).length > 0);
}

console.log("\n== the tool: schema, validation and the card on disk ==");
{
  const tools = createMcpServer()._registeredTools;
  const shape = tools["check_script"]?.inputSchema?.shape?.conceptCard?.unwrap?.()?.shape ?? tools["check_script"]?.inputSchema?.shape?.conceptCard?._def?.innerType?.shape;
  check("the concept card schema has the story fields", !!shape && ["arc", "situation", "character", "formulas", "practiceQuestion", "answer"].every((k) => k in shape));
  check("the description names the arc and every story check", /story/.test(tools["check_script"].description) && STORY_CHECKS.every((c) => tools["check_script"].description.includes(c)));
  let message = "";
  try { runCheckScript({ videoName: "x", beatsJson: file(storyBeats()), conceptCard: { ...CARD, arc: "saga" } }); } catch (err) { message = String(err.message); }
  check("an unknown arc is refused", /arc must be/.test(message));
  const r = runCheckScript({ videoName: "x", beatsJson: file(storyBeats()), conceptCard: CARD });
  check("runCheckScript passes the good story script", storyFindings(r).length === 0 && r.ok);
}

finish();

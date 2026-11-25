#!/usr/bin/env node
// generate_script (#178): one call from a brief to a skeleton, and a second call from a skeleton
// plus an agent-written draft to an approval-ready beats.json. The server never writes the
// narration and never writes beats.json: the human gate and write_beats_file are untouched.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { require, packageRoot, distDir, check, finish, listFilesRecursive } from "./_harness.mjs";

const { runGenerateScript, LEVEL_SCRIPT_DEFAULTS } = require(path.join(distDir, "tools", "generateScript.js"));
const { runPlanBeats } = require(path.join(distDir, "tools", "planBeats.js"));
const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
const { createMcpServer } = require(path.join(distDir, "server.js"));

const words = (n) => Array(n).fill("word").join(" ");
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The project holds a few files on purpose, including a beats.json, so "nothing was written"
// means nothing was created, changed or removed, which an empty folder could not show.
function makeProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-generate-script-"));
  fs.mkdirSync(path.join(root, "src", "videos", "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "videos", "demo", "beats.json"), '{"untouched":true}\n');
  fs.writeFileSync(path.join(root, "notes.txt"), "keep me\n");
  if (config) fs.writeFileSync(path.join(root, "openvidstudio.config.json"), JSON.stringify(config, null, 2));
  return root;
}
function snapshot(root) {
  return listFilesRecursive(root).map((f) => `${f}:${fs.readFileSync(path.join(root, f), "utf8")}`);
}

const writes = [];
// Runs one call and records whether the project changed. A throw is a result too, so the
// throwing paths are held to the same no-write rule.
function call(root, input) {
  const before = snapshot(root);
  let result;
  let error;
  try {
    result = runGenerateScript({ projectRoot: root, ...input });
  } catch (e) {
    error = e;
  }
  if (!sameJson(before, snapshot(root))) writes.push(JSON.stringify(input));
  return { result, error };
}
function draftFrom(skeleton, overrides = {}) {
  const narration = {};
  for (const beat of skeleton.plan.beats) narration[beat.id] = words(overrides[beat.id] ?? beat.wordBudget.suggested);
  return { narration };
}

const root = makeProject();
const brief = { targetDurationSeconds: 60, features: ["search", "share"] };

console.log("\n== LEVEL_SCRIPT_DEFAULTS ==");
{
  check("literal: arc literal, no visual overrides", LEVEL_SCRIPT_DEFAULTS.literal.arc === "literal" && LEVEL_SCRIPT_DEFAULTS.literal.allowVisualOverrides === false);
  check("mid: arc simple, visual overrides allowed", LEVEL_SCRIPT_DEFAULTS.mid.arc === "simple" && LEVEL_SCRIPT_DEFAULTS.mid.allowVisualOverrides === true);
  check("peak: arc packed, visual overrides allowed", LEVEL_SCRIPT_DEFAULTS.peak.arc === "packed" && LEVEL_SCRIPT_DEFAULTS.peak.allowVisualOverrides === true);
  check("every level has a one-sentence review string", Object.values(LEVEL_SCRIPT_DEFAULTS).every((d) => typeof d.review === "string" && d.review.length > 20 && /[.]$/.test(d.review) && !/[.]\s+\S/.test(d.review)));
  check("the table covers exactly the three creative levels", Object.keys(LEVEL_SCRIPT_DEFAULTS).sort().join(",") === "literal,mid,peak");
}

console.log("\n== skeleton stage (mid level, no draft) ==");
{
  const { result: r, error } = call(root, brief);
  check("a skeleton call does not throw", error === undefined);
  check("stage is skeleton", r.stage === "skeleton");
  check("the level defaults to mid when nothing sets one", r.creativeLevel === "mid" && r.defaults.arc === "simple");
  check("features search and share at 60 s give 6 beats", r.beatsJson.beats.length === 6 && r.plan.beats.length === 6);
  check("the plan is the plan_beats plan for the same brief", sameJson(r.plan, runPlanBeats({ projectRoot: root, targetDurationSeconds: 60, arc: "simple", features: ["search", "share"] })));
  check("no beat has vo", r.beatsJson.beats.every((b) => !("vo" in b)));
  check("each beat is exactly { id, start, duration, visual }", r.beatsJson.beats.every((b) => Object.keys(b).sort().join(",") === "duration,id,start,visual"));
  check("beat ids, starts and durations come from the plan", r.beatsJson.beats.every((b, i) => b.id === r.plan.beats[i].id && b.start === r.plan.beats[i].start && b.duration === r.plan.beats[i].duration));
  const shots = r.beatsJson.beats.filter((b) => b.visual.captureMethod === "screenshot");
  check("screenshot beats exist and every one carries the app url and an empty interactions array", shots.length === 3 && shots.every((b) => b.visual.url === "http://localhost:3000" && Array.isArray(b.visual.interactions) && b.visual.interactions.length === 0));
  const others = r.beatsJson.beats.filter((b) => b.visual.captureMethod !== "screenshot");
  check("any other capture method's visual is just { captureMethod }", others.length === 3 && others.every((b) => sameJson(b.visual, { captureMethod: "dom-demo" })));
  check("each beat's captureMethod matches the plan's", r.beatsJson.beats.every((b, i) => b.visual.captureMethod === r.plan.beats[i].captureMethod));
  check("beatsJson.production.creativeLevel is mid", r.beatsJson.production.creativeLevel === "mid");
  check("beatsJson.fps is the plan's fps", r.beatsJson.fps === r.plan.fps && r.beatsJson.fps === 30);
  check("interactions arrays are not shared between beats", shots[0].visual.interactions !== shots[1].visual.interactions);
  check("validation is absent at the skeleton stage", r.validation === undefined && !("validation" in r));
  check("defaults.allowVisualOverrides is true at mid", r.defaults.allowVisualOverrides === true);
  check("notes carry plan_beats' notes and the level's review line", r.plan.notes.every((n) => r.notes.includes(n)) && r.notes.includes(LEVEL_SCRIPT_DEFAULTS.mid.review));
  check("next tells the agent to write to wordBudget.suggested and call generate_script again with a draft", /wordBudget\.suggested/.test(r.next) && /generate_script/.test(r.next) && /draft/.test(r.next));

  const withUrl = call(root, { ...brief, appUrl: "http://localhost:5173" }).result;
  check("an appUrl input becomes every screenshot beat's url", withUrl.beatsJson.beats.filter((b) => b.visual.captureMethod === "screenshot").every((b) => b.visual.url === "http://localhost:5173"));
  const arcOverride = call(root, { ...brief, arc: "tutorial" }).result;
  check("an explicit arc overrides the level's arc at mid", arcOverride.plan.arc === "tutorial" && arcOverride.beatsJson.beats.some((b) => b.id === "install"));
  check("the skeleton's own beats pass the validator's structure checks apart from the missing vo lines", (() => {
    const v = validateBeatsLogic(r.beatsJson);
    return v.errors.length === r.beatsJson.beats.length && v.errors.every((e) => /missing or invalid "vo"/.test(e));
  })());
}

console.log("\n== validated stage (with a draft) ==");
{
  const skeleton = call(root, brief).result;
  const draft = draftFrom(skeleton);
  const { result: r, error } = call(root, { ...brief, draft });
  check("a full draft does not throw", error === undefined);
  check("stage is validated", r.stage === "validated");
  check("validation.valid is true for narration written to the suggested budget", r.validation && r.validation.valid === true && r.validation.errors.length === 0);
  check("each beat's vo equals the draft text", r.beatsJson.beats.every((b) => b.vo === draft.narration[b.id]));
  check("the beats keep the skeleton's timing and visuals", r.beatsJson.beats.every((b, i) => b.start === skeleton.beatsJson.beats[i].start && b.duration === skeleton.beatsJson.beats[i].duration && sameJson(b.visual, skeleton.beatsJson.beats[i].visual)));
  check("the validation is the validator's own answer for the returned beatsJson", sameJson(r.validation, validateBeatsLogic(r.beatsJson)));
  check("next, when valid, says to show beatsJson to the human and call write_beats_file only after approval", /human/i.test(r.next) && /write_beats_file/.test(r.next) && /approv/i.test(r.next));

  const search = skeleton.plan.beats.find((b) => b.id === "demo-search");
  const doubled = call(root, { ...brief, draft: draftFrom(skeleton, { "demo-search": search.wordBudget.suggested * 2 }) }).result;
  check("a beat at twice its budget makes validation.valid false without throwing", doubled.stage === "validated" && doubled.validation.valid === false);
  check("validation.errors deep-equals validateBeatsLogic(result.beatsJson).errors", sameJson(doubled.validation.errors, validateBeatsLogic(doubled.beatsJson).errors));
  check("the error names the over-long beat and its pace", doubled.validation.errors.some((e) => /beat "demo-search"/.test(e) && /VO pace/.test(e)));
  check("next, when invalid, says to fix the listed errors", /fix/i.test(doubled.next) && /validation\.errors/.test(doubled.next));

  const partial = { narration: { ...draft.narration } };
  delete partial.narration.cta;
  const missing = call(root, { ...brief, draft: partial });
  check("a draft missing one beat's narration does not throw", missing.error === undefined);
  check("...it returns valid: false with an error naming that beat", missing.result.validation.valid === false && missing.result.validation.errors.some((e) => /beat "cta"/.test(e) && /"vo"/.test(e)));
  check("...and the beat is left without vo, the others keep theirs", !("vo" in missing.result.beatsJson.beats.find((b) => b.id === "cta")) && missing.result.beatsJson.beats.filter((b) => b.id !== "cta").every((b) => typeof b.vo === "string"));

  const unknown = call(root, { ...brief, draft: { narration: { ...draft.narration, "demo-nonsense": words(20) } } });
  check("a draft naming a beat the skeleton lacks throws", unknown.error instanceof Error);
  check("...and the message contains that id", /demo-nonsense/.test(unknown.error.message));
  const unknownMany = call(root, { ...brief, draft: { narration: { ...draft.narration, ghost1: "a", ghost2: "b" } } });
  check("every unknown id is named, including the second and later ones", /ghost1/.test(unknownMany.error.message) && /ghost2/.test(unknownMany.error.message));
  check("the message lists the beat ids that do exist", /demo-search/.test(unknownMany.error.message) && /cta/.test(unknownMany.error.message));
  const unknownVisual = call(root, { ...brief, draft: { ...draft, visuals: { "no-such-beat": { colorScheme: "dark" } } } });
  check("an unknown id in draft.visuals throws and is named too", unknownVisual.error instanceof Error && /no-such-beat/.test(unknownVisual.error.message));

  const overridden = call(root, { ...brief, draft: { ...draft, visuals: { "demo-search": { colorScheme: "dark", url: "http://localhost:3000/search" } } } }).result;
  const searchBeat = overridden.beatsJson.beats.find((b) => b.id === "demo-search");
  check("draft.visuals is shallow-merged over the beat's default visual at mid", searchBeat.visual.captureMethod === "screenshot" && searchBeat.visual.colorScheme === "dark" && searchBeat.visual.url === "http://localhost:3000/search" && Array.isArray(searchBeat.visual.interactions));
  check("beats without an override keep the default visual", sameJson(overridden.beatsJson.beats.find((b) => b.id === "demo-share").visual, skeleton.beatsJson.beats.find((b) => b.id === "demo-share").visual));
  check("a draft with a visual override still validates", overridden.validation.valid === true);

  const badOverride = call(root, { ...brief, draft: { ...draft, visuals: { "demo-search": { colorScheme: "neon" } } } }).result;
  check("a bad visual override is reported by the validator, not thrown", badOverride.validation.valid === false && badOverride.validation.errors.some((e) => /beat "demo-search"/.test(e) && /colorScheme/.test(e)));

  const notObject = call(root, { ...brief, draft: { ...draft, visuals: { "demo-search": "dark" } } });
  check("a visual override that is not an object throws a message naming the beat", notObject.error instanceof Error && /demo-search/.test(notObject.error.message));
}

console.log("\n== creative level resolution ==");
{
  const peakRoot = makeProject({ production: { creativeLevel: "peak" }, capture: { appUrl: "http://localhost:4000" } });
  const peak = call(peakRoot, brief).result;
  check("the level comes from the project config when the input leaves it out", peak.creativeLevel === "peak" && peak.beatsJson.production.creativeLevel === "peak");
  check("peak plans the packed arc and allows visual overrides", peak.plan.arc === "packed" && peak.defaults.allowVisualOverrides === true);
  check("the config's capture.appUrl is used for screenshot beats", peak.beatsJson.beats.filter((b) => b.visual.captureMethod === "screenshot").every((b) => b.visual.url === "http://localhost:4000"));
  const explicit = call(peakRoot, { ...brief, creativeLevel: "mid" }).result;
  check("an explicit creativeLevel beats the config", explicit.creativeLevel === "mid" && explicit.plan.arc === "simple");
  const peakArc = call(peakRoot, { ...brief, arc: "tutorial" }).result;
  check("an explicit arc beats the peak default", peakArc.plan.arc === "tutorial");

  const typoRoot = makeProject({ production: { creativeLevel: "wild" } });
  const typo = call(typoRoot, brief);
  check("a creativeLevel typo in the config is a clear error naming the field, not a TypeError", typo.error instanceof Error && !(typo.error instanceof TypeError) && /production\.creativeLevel/.test(typo.error.message) && /wild/.test(typo.error.message));

  peak.defaults.arc = "tutorial";
  check("changing a result's defaults does not change the shared table", LEVEL_SCRIPT_DEFAULTS.peak.arc === "packed");
}

console.log("\n== literal level ==");
{
  const literal = call(root, { ...brief, creativeLevel: "literal" });
  const r = literal.result;
  check("literal plans the literal arc: one demo beat per feature and nothing else", literal.error === undefined && r.plan.arc === "literal" && r.beatsJson.beats.map((b) => b.id).join(",") === "demo-search,demo-share");
  check("defaults.allowVisualOverrides is false at literal", r.defaults.allowVisualOverrides === false && r.defaults.arc === "literal");
  check("beatsJson.production.creativeLevel is literal", r.beatsJson.production.creativeLevel === "literal");
  check("the literal review line is in the notes", r.notes.includes(LEVEL_SCRIPT_DEFAULTS.literal.review));

  const forced = call(root, { ...brief, creativeLevel: "literal", arc: "packed" }).result;
  check("an explicit arc is ignored at literal, which always plans the literal arc", forced.plan.arc === "literal" && forced.beatsJson.beats.length === 2);
  check("...and a note says the arc input was ignored", forced.notes.some((n) => /packed/.test(n) && /ignored/i.test(n)));

  const draft = draftFrom(r);
  const ok = call(root, { ...brief, creativeLevel: "literal", draft }).result;
  check("a narration-only draft validates at literal", ok.stage === "validated" && ok.validation.valid === true && ok.beatsJson.beats.every((b) => b.vo === draft.narration[b.id]));

  const withVisuals = call(root, { ...brief, creativeLevel: "literal", draft: { ...draft, visuals: { "demo-search": { colorScheme: "dark" } } } });
  check("a draft with visuals throws at literal", withVisuals.error instanceof Error);
  check("...saying visual overrides are not allowed at the literal level", /visual overrides are not allowed at the literal level/.test(withVisuals.error.message));
  const emptyVisuals = call(root, { ...brief, creativeLevel: "literal", draft: { ...draft, visuals: {} } });
  check("a draft that carries visuals at all throws at literal, even an empty object", emptyVisuals.error instanceof Error && /visual overrides are not allowed at the literal level/.test(emptyVisuals.error.message));
  const midDraft = draftFrom(call(root, { ...brief, creativeLevel: "mid" }).result);
  const emptyAtMid = call(root, { ...brief, creativeLevel: "mid", draft: { ...midDraft, visuals: {} } });
  check("...while an empty visuals object is harmless at mid, where overrides are allowed", emptyAtMid.error === undefined && emptyAtMid.result.validation.valid === true);

  const noFeatures = call(root, { targetDurationSeconds: 60, creativeLevel: "literal" });
  check("literal with no features fails with plan_beats' clear message", noFeatures.error instanceof Error && /literal arc needs at least one feature/.test(noFeatures.error.message));
}

console.log("\n== feature names that collide ==");
{
  // slug() cuts at 24 characters, so these two slug to the same text.
  const long = ["Export report as PDF with watermark", "Export report as PDF with signature"];
  const first = "demo-export-report-as-pdf-wit";
  const second = `${first}-2`;

  const skeleton = call(root, { targetDurationSeconds: 60, creativeLevel: "literal", features: long });
  check("two long feature names at literal give a skeleton with two distinct beat ids", skeleton.error === undefined && skeleton.result.beatsJson.beats.map((b) => b.id).join(",") === `${first},${second}`);
  const draft = { narration: { [first]: words(skeleton.result.plan.beats[0].wordBudget.suggested), [second]: words(skeleton.result.plan.beats[1].wordBudget.suggested) } };
  const validated = call(root, { targetDurationSeconds: 60, creativeLevel: "literal", features: long, draft });
  check("a draft keyed by those two ids is valid", validated.error === undefined && validated.result?.validation.valid === true);
  check("each beat gets its own line, not one line applied to both", validated.result?.beatsJson.beats[0].vo === draft.narration[first] && validated.result?.beatsJson.beats[1].vo === draft.narration[second] && validated.result?.validation.errors.every((e) => !/duplicate beat id/.test(e)));

  const sameSlug = call(root, { targetDurationSeconds: 60, features: ["Search", "search"] });
  check("Search and search at mid also get distinct ids", sameSlug.result.beatsJson.beats.map((b) => b.id).includes("demo-search") && sameSlug.result.beatsJson.beats.map((b) => b.id).includes("demo-search-2"));
  check("the second id is accepted in a draft (it is not an unknown id)", call(root, { targetDurationSeconds: 60, features: ["Search", "search"], draft: draftFrom(sameSlug.result) }).result.validation.valid === true);
}

console.log("\n== one brief at each creative level (#179) ==");
{
  // The same inputs at all three levels: features search and share, 60 s, 30 fps. Every call goes
  // through call(), so each one is also held to the no-write rule asserted in the section below.
  const fps = 30;
  const levelBrief = { targetDurationSeconds: 60, features: ["search", "share"], fps };
  const expectedIds = {
    peak: ["hook", "demo-search", "demo-share", "differentiator", "cta"],
    mid: ["hook", "problem", "demo-search", "demo-share", "differentiator", "cta"],
    literal: ["demo-search", "demo-share"],
  };
  const paceOf = (error) => Number(/VO pace ([\d.]+) words\/sec/.exec(error)?.[1]);

  for (const level of ["peak", "mid", "literal"]) {
    const tag = `${level}:`;
    const ids = expectedIds[level];
    const skeleton = call(root, { ...levelBrief, creativeLevel: level });
    check(`${tag} the skeleton call does not throw and reports the level`, skeleton.error === undefined && skeleton.result.stage === "skeleton" && skeleton.result.creativeLevel === level);
    if (skeleton.error) continue;
    const planned = skeleton.result.plan.beats;
    check(`${tag} the skeleton has ${ids.length} beats: ${ids.join(", ")}`, skeleton.result.beatsJson.beats.map((b) => b.id).join(",") === ids.join(",") && planned.map((b) => b.id).join(",") === ids.join(","));
    check(`${tag} the beats fill the whole 60 s, contiguous from frame 0`, planned.reduce((end, b) => (b.start === end ? end + b.duration : NaN), 0) === 60 * fps);
    check(`${tag} every beat's wordBudget is { min: ceil(2.3 * s), max: floor(2.9 * s) } for its own seconds`, planned.every((b) => {
      const s = b.duration / fps;
      return b.wordBudget.min === Math.ceil(2.3 * s) && b.wordBudget.max === Math.floor(2.9 * s) && b.wordBudget.min <= b.wordBudget.suggested && b.wordBudget.suggested <= b.wordBudget.max;
    }));

    // One beat far too fast and one far too sparse, the rest on budget.
    const fast = skeleton.result.plan.beats.find((b) => b.id === "demo-search");
    const sparse = skeleton.result.plan.beats.find((b) => b.id === "demo-share");
    const draft = draftFrom(skeleton.result, { "demo-search": fast.wordBudget.suggested * 2, "demo-share": Math.round(sparse.wordBudget.suggested / 2) });
    const bad = call(root, { ...levelBrief, creativeLevel: level, draft });
    check(`${tag} a beat at 2x budget and a beat at half budget do not throw: stage validated, valid false`, bad.error === undefined && bad.result.stage === "validated" && bad.result.validation.valid === false);
    if (bad.error) continue;
    check(`${tag} validation.errors deep-equals validateBeatsLogic(beatsJson).errors`, sameJson(bad.result.validation.errors, validateBeatsLogic(bad.result.beatsJson).errors));
    check(`${tag} there are exactly two errors and both contain words/sec`, bad.result.validation.errors.length === 2 && bad.result.validation.errors.every((e) => /words\/sec/.test(e)));
    const fastError = bad.result.validation.errors.find((e) => /beat "demo-search"/.test(e));
    const sparseError = bad.result.validation.errors.find((e) => /beat "demo-share"/.test(e));
    check(`${tag} the 2x beat reports a pace above 2.9 and the half beat a pace below 2.3`, paceOf(fastError) > 2.9 && paceOf(sparseError) < 2.3);
  }

  console.log("\n-- literal adds nothing of its own --");
  {
    const skeletonCall = call(root, { ...levelBrief, creativeLevel: "literal" });
    const validatedCall = skeletonCall.result ? call(root, { ...levelBrief, creativeLevel: "literal", draft: draftFrom(skeletonCall.result) }) : { error: skeletonCall.error };
    check("literal: the skeleton call and the narration-only draft call do not throw", skeletonCall.error === undefined && validatedCall.error === undefined);
    const wanted = levelBrief.features.map((f) => `demo-${f}`);
    if (!skeletonCall.error && !validatedCall.error) {
      for (const [stage, r] of [["skeleton", skeletonCall.result], ["validated", validatedCall.result]]) {
        check(`literal ${stage}: no beat uses the dom-demo capture method`, r.beatsJson.beats.every((b) => b.visual.captureMethod !== "dom-demo") && r.plan.beats.every((b) => b.captureMethod !== "dom-demo"));
        check(`literal ${stage}: no beat id falls outside the requested features`, r.beatsJson.beats.every((b) => wanted.includes(b.id)) && r.beatsJson.beats.length === wanted.length);
        check(`literal ${stage}: every beat is a screenshot of the app url`, r.beatsJson.beats.every((b) => b.visual.captureMethod === "screenshot" && b.visual.url === "http://localhost:3000"));
      }
      check("literal: two features at 60 s are two 30 s beats with a 69-87 word budget each", skeletonCall.result.plan.beats.every((b) => b.duration === 30 * fps && b.wordBudget.min === 69 && b.wordBudget.max === 87));
    }

    const none = call(root, { targetDurationSeconds: 60, creativeLevel: "literal", features: [] });
    check("literal with an empty features array fails with the same clear message as no features", none.error instanceof Error && /literal arc needs at least one feature/.test(none.error.message));
  }

  console.log("\n-- peak accepts visual overrides --");
  {
    const skeleton = call(root, { ...levelBrief, creativeLevel: "peak" }).result;
    const draft = { ...draftFrom(skeleton), visuals: { hook: { colorScheme: "dark", url: "http://localhost:3000/hero" } } };
    const { result: r, error } = call(root, { ...levelBrief, creativeLevel: "peak", draft });
    check("peak: a draft with visuals does not throw", error === undefined && r?.stage === "validated");
    const hook = r?.beatsJson.beats.find((b) => b.id === "hook");
    check("peak: the override is shallow-merged over the hook beat's default visual in beatsJson", hook?.visual.captureMethod === "screenshot" && hook.visual.colorScheme === "dark" && hook.visual.url === "http://localhost:3000/hero" && Array.isArray(hook.visual.interactions));
    check("peak: every other beat keeps its default visual", r?.beatsJson.beats.filter((b) => b.id !== "hook").every((b) => sameJson(b.visual, skeleton.beatsJson.beats.find((s) => s.id === b.id).visual)) === true);
    check("peak: the draft with the override still validates", r?.validation.valid === true);
  }
}

console.log("\n== the tool never writes ==");
{
  check("the project listing and file contents were identical before and after every call above", writes.length === 0);
  check("the project's own beats.json is untouched", fs.readFileSync(path.join(root, "src", "videos", "demo", "beats.json"), "utf8") === '{"untouched":true}\n');
}

console.log("\n== registration and the MCP surface ==");
{
  const registered = createMcpServer()._registeredTools;
  check("generate_script is registered", "generate_script" in registered);
  check("its title starts with 'Draft a script in one call'", typeof registered.generate_script?.title === "string" && registered.generate_script.title.startsWith("Draft a script in one call"));
  const description = registered.generate_script?.description ?? "";
  check("its description says it never writes and leaves the human gate and write_beats_file alone", /never writes/i.test(description) && /write_beats_file/.test(description) && /human/i.test(description));
  check("its description explains that visual defaults come from the level and arc, not plan_production", /plan_production/.test(description) && /creative level/i.test(description));
  check("its description lists all three levels' defaults", ["literal", "mid", "peak"].every((l) => description.includes(l)));

  const sdk = path.join(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  const { Client } = await import(pathToFileURL(path.join(sdk, "client", "index.js")).href);
  const { InMemoryTransport } = await import(pathToFileURL(path.join(sdk, "inMemory.js")).href);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  await server.connect(serverSide);
  const client = new Client({ name: "ovs-generate-script-test", version: "1.0.0" });
  await client.connect(clientSide);
  const over = async (args) => {
    try {
      const r = await client.callTool({ name: "generate_script", arguments: args });
      const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      return { isError: !!r.isError, text };
    } catch (err) {
      return { isError: true, text: String(err && err.message ? err.message : err) };
    }
  };

  const beforeMcp = snapshot(root);
  const literalPlan = await client.callTool({ name: "plan_beats", arguments: { projectRoot: root, targetDurationSeconds: 30, arc: "literal", features: ["search"] } });
  check("over MCP plan_beats accepts the literal arc", !literalPlan.isError && JSON.parse(literalPlan.content[0].text).arc === "literal");

  const skeleton = await over({ projectRoot: root, ...brief });
  const parsed = JSON.parse(skeleton.text);
  check("over MCP a skeleton call returns the JSON result", !skeleton.isError && parsed.stage === "skeleton" && parsed.beatsJson.beats.length === 6);
  const draft = { narration: Object.fromEntries(parsed.plan.beats.map((b) => [b.id, words(b.wordBudget.suggested)])) };
  const validated = await over({ projectRoot: root, ...brief, draft });
  check("over MCP a draft call returns a validated, valid result", !validated.isError && JSON.parse(validated.text).validation.valid === true);
  const badNarration = await over({ projectRoot: root, ...brief, draft: { narration: { hook: 42 } } });
  check("over MCP a non-string narration line is rejected by the schema", badNarration.isError === true);
  const unknownKey = await over({ projectRoot: root, ...brief, creativelevel: "peak" });
  check("over MCP an unknown input key is rejected by name", unknownKey.isError === true && /creativelevel/.test(unknownKey.text));
  const unknownId = await over({ projectRoot: root, ...brief, draft: { narration: { nope: "x" } } });
  check("over MCP an unknown beat id comes back as an error naming it", unknownId.isError === true && /nope/.test(unknownId.text));
  check("none of the MCP calls wrote anything either", sameJson(snapshot(root), beforeMcp));
  await client.close();
}

finish();

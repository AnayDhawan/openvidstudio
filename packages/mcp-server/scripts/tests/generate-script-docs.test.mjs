#!/usr/bin/env node
// generate_script docs (#182): the before and after example in PLANNING.md is real. The single
// documented call and the old plan_beats, merge, validate_beats route end in the same beatsJson,
// the example's JSON appears in the doc verbatim, and the tool docs name only inputs the server has.
// Reads packages/docs, never the gitignored packages/mcp-server/docs copy.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert/strict";
import { require, distDir, monorepoRoot, check, finish } from "./_harness.mjs";

const { runGenerateScript } = require(path.join(distDir, "tools", "generateScript.js"));
const { runPlanBeats } = require(path.join(distDir, "tools", "planBeats.js"));
const { validateBeatsLogic, wordCount } = require(path.join(distDir, "tools", "validateBeats.js"));
const { createMcpServer } = require(path.join(distDir, "server.js"));

const docsDir = path.join(monorepoRoot, "packages", "docs");
const readDoc = (name) => fs.readFileSync(path.join(docsDir, name), "utf8").replace(/\r\n/g, "\n");
const flat = (text) => text.replace(/\s+/g, " ");
const json = (value) => JSON.stringify(value, null, 2);
const same = (a, b) => {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

// ---- the example, exactly as PLANNING.md documents it ----
const brief = {
  targetDurationSeconds: 60,
  creativeLevel: "mid",
  features: ["review", "schedule"],
  appUrl: "https://app.loomcard.example/review",
};
const draft = {
  narration: {
    hook: "Loomcard turns your notes into spaced-repetition flashcards, and schedules every review so the answers are still there on interview day.",
    problem:
      "Most flashcard apps show every card on the same fixed timer, so you waste time on cards you know and meet the hard ones far too late.",
    "demo-review":
      "Flip a card, then rate how sure you were from one to five. Loomcard stores that confidence with the answer, and the next card appears as soon as you choose a rating.",
    "demo-schedule":
      "That confidence score sets your next review date straight away, so easy cards quietly fade into the background while hard ones come around sooner and keep coming back until they finally stick.",
    differentiator:
      "Nothing here needs setup. Paste your notes in, pick the topics you are interviewing for, and Loomcard builds the whole deck for you in seconds.",
    cta: "Loomcard is free and open source. Star it, try it, or send a pull request when you find something we should fix.",
  },
};
const oneCall = { ...brief, draft };
// The old route's first call: the same brief as plan_beats takes it, with the arc spelled out.
const planInput = { targetDurationSeconds: 60, arc: "simple", features: brief.features, appUrl: brief.appUrl };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-generate-script-docs-"));

console.log("\n== the single call and the old route end in the same beatsJson ==");
const skeleton = runGenerateScript({ projectRoot: root, ...brief });
const validated = runGenerateScript({ projectRoot: root, ...oneCall });
{
  check("the call without a draft is the skeleton stage", skeleton.stage === "skeleton" && skeleton.beatsJson.beats.every((b) => b.vo === undefined));
  check("the call with the draft is the validated stage and the draft passes", validated.stage === "validated" && validated.validation.valid === true && validated.validation.errors.length === 0);

  // The old route, written out by hand the way the docs describe it: plan_beats, copy each beat's
  // timing, add the line and the visual by hand, then validate_beats. Nothing here calls generateScript.
  const plan = runPlanBeats({ projectRoot: root, ...planInput });
  const byHand = {
    fps: plan.fps,
    production: { creativeLevel: "mid" },
    beats: plan.beats.map((b) => ({
      id: b.id,
      start: b.start,
      duration: b.duration,
      vo: draft.narration[b.id],
      visual:
        b.captureMethod === "screenshot"
          ? { captureMethod: "screenshot", url: brief.appUrl, interactions: [] }
          : { captureMethod: b.captureMethod },
    })),
  };
  const byHandResult = validateBeatsLogic(byHand);
  check("the by-hand beats.json passes validate_beats", byHandResult.valid === true && byHandResult.errors.length === 0);
  check("the old route's beatsJson deep-equals generate_script's", same(byHand, validated.beatsJson));
  check("both routes report the same validation", same(byHandResult, validated.validation));
  check("the plan generate_script returns is the plan_beats plan", same(plan, skeleton.plan));
  check("the skeleton's beatsJson is the validated one with no lines", same(skeleton.beatsJson.beats.map(({ vo, ...rest }) => rest), validated.beatsJson.beats.map(({ vo, ...rest }) => rest)));
}

console.log("\n== the example sits at the suggested budgets, in natural sentences ==");
{
  const beats = skeleton.plan.beats;
  check("the draft has a line for every beat and no other key", same(Object.keys(draft.narration).sort(), beats.map((b) => b.id).sort()));
  for (const b of beats) {
    const n = wordCount(draft.narration[b.id]);
    check(`${b.id}: ${n} words, the suggested ${b.wordBudget.suggested} (accepted ${b.wordBudget.min}-${b.wordBudget.max})`, n === b.wordBudget.suggested);
  }
  const lines = Object.values(draft.narration);
  check("no line repeats a word three times in a row, and no line reuses another's text", lines.every((l) => !/\b(\w+)(\s+\1\b){2,}/i.test(l)) && new Set(lines).size === lines.length);
  const dashes = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  check("no em dash or en dash in a line", lines.every((l) => dashes.every((d) => !l.includes(d))));
  check("the only warning is the rhythm note the arc's fixed lengths always draw", validated.validation.warnings.length === 1 && /^Shot lengths are nearly uniform/.test(validated.validation.warnings[0]));
}

console.log("\n== PLANNING.md shows that example, verbatim ==");
const planning = readDoc("PLANNING.md");
const section = (() => {
  const start = planning.search(/^## 4\.10\. /m);
  if (start < 0) return "";
  const rest = planning.slice(start + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? planning.slice(start) : planning.slice(start, start + 3 + end);
})();
{
  check("PLANNING.md has the section 4.10 on generate_script", section.length > 0 && /generate_script/.test(section.split("\n")[0]));
  check("the section sits before the worked example, whose first json fence other tests read", planning.indexOf(section) < planning.search(/^## \d+\. Worked example/m));
  check("the call without a draft appears verbatim", section.includes(json(brief)));
  check("the call with the draft appears verbatim", section.includes(json(oneCall)));
  check("the old route's plan_beats input appears verbatim", section.includes(json(planInput)));
  check("the beatsJson both routes end in appears verbatim", section.includes(json(validated.beatsJson)));
  check("the validation both routes return appears verbatim", section.includes(json(validated.validation)));
  for (const b of skeleton.plan.beats) {
    const row = `| ${b.id} | ${b.duration} | ${b.seconds} | ${b.wordBudget.min}-${b.wordBudget.max} | ${b.wordBudget.suggested} |`;
    check(`the budget table has the row for ${b.id}: ${row}`, section.includes(row));
  }
  check("it says the skeleton is the same plan_beats plan and that nothing is written", /plan_beats/.test(section) && /nothing is written|never writes/i.test(flat(section)));
}

console.log("\n== the docs state the facts the reviews asked for ==");
{
  const s = flat(section);
  const api = readDoc("API.md");
  const apiFlat = flat(api);
  const pipeline = flat(readDoc("PIPELINE.md"));
  const narration = flat(readDoc("NARRATION.md"));
  const readme = flat(fs.readFileSync(path.join(monorepoRoot, "README.md"), "utf8"));

  check("PLANNING.md and PIPELINE.md name all four arcs", ["simple", "packed", "tutorial", "literal"].every((a) => s.includes(`\`${a}\``) && pipeline.includes(`\`${a}\``)));
  check("PIPELINE.md recommends generate_script and keeps the manual route", /generate_script/.test(pipeline) && /manual route/i.test(pipeline) && /plan_beats/.test(pipeline));
  check("the id scheme: demo-<slug>, 24 characters, -2 and -3 for a repeat, the first keeps its id", /demo-<slug>/.test(apiFlat) && /24 characters/.test(apiFlat) && /-2/.test(apiFlat) && /-3/.test(apiFlat) && /first/i.test(apiFlat));
  check("the simple arc plans at most three demo beats and literal has no cap", /at most three demo beats/.test(s + apiFlat) && /no cap/.test(s + apiFlat));
  check("literal: draft.visuals refused, beats refined after write_beats_file", /draft\.visuals/.test(s) && /write_beats_file/.test(s) && /refine/i.test(s));
  check("the rhythm warning is said to be a note, and to fire for every arc's skeleton", /nearly uniform/.test(s) && /warn/i.test(s));
  check("the skeleton notes name a beat too short for any narration", /too short/.test(s + apiFlat));

  check("API.md says generate_narration does not read narration.engine or narration.voice", /does not read `?narration\.engine`? or `?narration\.voice`?/.test(apiFlat));
  check("PLANNING.md says the same and names the edge-tts and Microsoft consequence", /does not read/.test(s) && /narration\.engine/.test(s) && /Microsoft/.test(s));
  check("README says a config set to omnivoice also triggers the preflight check, with a warning", /config/.test(readme) && /also (runs|triggers)/i.test(readme) && /does not read the config/.test(readme));

  check("API.md puts the multilingual caption limit in the generate_narration and stitch_composition entries", ["generate_narration", "stitch_composition"].every((tool) => {
    const start = api.indexOf(`### \`${tool}\``);
    if (start < 0) return false;
    const rest = api.slice(start + 3);
    const end = rest.search(/^#{2,3} /m);
    const entry = flat(end < 0 ? api.slice(start) : api.slice(start, start + 3 + end));
    return /base-language `?vo`?/.test(entry) && /every language cut shows the base-language caption/.test(entry);
  }));
  check("API.md says a voices key is read only when the language it names is being generated", /`voices` \| A voice per language, keyed by the language tag/.test(apiFlat) && /read only when the language it names is being generated/.test(apiFlat));

  const pace = narration.slice(narration.indexOf("### Pace by language"), narration.indexOf("## Engines"));
  check("NARRATION.md ties the voices key to the language tag, read only when that language is generated", /A `voices` key is the language tag/.test(pace) && /read only when the language it names is being generated/.test(pace) && /`baseLanguage` is `hi` or `languages` includes `hi`/.test(pace));
  check("...no longer says fit_beats is 'what to trust over the table'", !/what to trust over the table/.test(pace));
  check("...says fit_beats still clamps into the band and lists unfittable lines", /still clamped into the language's band/.test(pace) && /`unfittable`/.test(pace));
  check("...says the English band falls back for the base language, and voTranslations lines for an unmeasured tag are not pace-checked", /Any other base language gets the English band/.test(pace) && /`voTranslations` lines for an unmeasured tag are not pace-checked/.test(pace));
  check("...says generate_narration reads neither narration.engine nor narration.voice", /does not read `narration\.engine` or `narration\.voice`/.test(narration));
}

console.log("\n== every tool the docs describe exists, and every input they list is real ==");
{
  const tools = createMcpServer()._registeredTools;
  const api = readDoc("API.md");
  const start = api.search(/^## MCP tools for the scripting flow/m);
  check("API.md has the section 'MCP tools for the scripting flow'", start >= 0);
  const body = start < 0 ? "" : api.slice(start);
  const entries = [...body.matchAll(/^### `([a-z_]+)`\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/gm)].map((m) => ({ name: m[1], text: m[2] }));
  const names = entries.map((e) => e.name);
  const wanted = ["generate_script", "plan_beats", "validate_beats", "fit_beats", "preflight", "generate_narration", "stitch_composition"];
  check("the section has an entry for each of the seven tools", wanted.every((n) => names.includes(n)));
  check("every entry names a registered tool", entries.every((e) => tools[e.name] !== undefined));
  const shapeKeys = (name) => Object.keys(tools[name].inputSchema.shape ?? tools[name].inputSchema._zod.def.shape);
  for (const e of entries) {
    if (tools[e.name] === undefined) continue;
    const inputs = [...e.text.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((m) => m[1]);
    const real = shapeKeys(e.name);
    const bad = inputs.filter((k) => !real.includes(k));
    check(`${e.name}: the ${inputs.length} listed inputs all exist in its schema${bad.length ? ` (not real: ${bad.join(", ")})` : ""}`, inputs.length > 0 && bad.length === 0);
  }
  const gs = entries.find((e) => e.name === "generate_script");
  if (gs && tools.generate_script) {
    const listed = [...gs.text.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((m) => m[1]);
    const missing = shapeKeys("generate_script").filter((k) => !listed.includes(k));
    check(`generate_script: every input is documented${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`, missing.length === 0);
  }
  for (const [tool, input] of [["preflight", "engine"], ["plan_beats", "language"], ["fit_beats", "language"], ["generate_narration", "engine"], ["generate_narration", "voices"]]) {
    const e = entries.find((x) => x.name === tool);
    check(`${tool}: \`${input}\` is listed`, !!e && new RegExp("^\\| `" + input + "` \\|", "m").test(e.text));
  }
}

console.log("\n== the AGENTS.md every scaffolded project gets names the scripting flow (#183) ==");
{
  const agents = fs.readFileSync(path.join(monorepoRoot, "templates", "default", "AGENTS.md"), "utf8").replace(/\r\n/g, "\n");
  const order = agents.match(/## The order\n\n```\n([\s\S]*?)\n```/);
  check("AGENTS.md has a fenced order block", order !== null);
  const flow = order ? flat(order[1]) : "";
  check("the order block plans the beats with generate_script", /generate_script/.test(flow));
  check("the order block does not send a first-time user to plan_beats", !/plan_beats/.test(flow));
  check("the order block still gets from the approval gate to write_beats_file", /APPROVAL GATE -> write_beats_file/.test(flow));
  check("AGENTS.md names plan_beats and validate_beats only as the manual route", /manual route/i.test(agents) && /plan_beats/.test(agents));
  check("the AGENTS.md order puts fit_beats before the scenes", flow.indexOf("fit_beats") >= 0 && flow.indexOf("fit_beats") < flow.indexOf("scenes"));
}

console.log("\n== the skills give the same narration order as AGENTS.md (#183) ==");
{
  const skills = path.join(monorepoRoot, ".claude", "skills");
  const read = (rel) => fs.readFileSync(path.join(skills, rel), "utf8").replace(/\r\n/g, "\n");
  const main = read(path.join("openvidstudio", "SKILL.md"));
  const order = main.match(/## The order\n\n```\n([\s\S]*?)\n```/);
  const flow = order ? flat(order[1]) : "";
  check("the openvidstudio skill has a fenced order block", order !== null);
  check("the skill order runs generate_narration then fit_beats then a regenerate before the scenes", /generate_narration -> fit_beats -> generate_narration \(overwrite\)/.test(flow) && flow.indexOf("fit_beats") < flow.indexOf("scenes"));
  check("the skill order no longer puts generate_narration after validate_scenes", !/validate_scenes[^>]*-> (\[plan_sound_effects\] -> )?generate_narration/.test(flow));
  const narration = main.slice(main.indexOf("## 6. Narration"), main.indexOf("## 6b."));
  check("section 6 says fit_beats runs before scaffolding because it changes the durations scenes bake in", /fit_beats/.test(narration) && /before[^.]*scaffold/i.test(narration) && /durations/.test(narration));
  const director = read(path.join("openvidstudio-director", "SKILL.md"));
  const scenesAt = director.indexOf("## 9. Scenes");
  const gatesAt = director.indexOf("## 10. Gates");
  const narrationAt = director.indexOf("generate_narration");
  check("the director skill runs generate_narration and fit_beats before section 9", narrationAt >= 0 && narrationAt < scenesAt && director.indexOf("fit_beats") < scenesAt);
  const planning = flat(readDoc("PLANNING.md"));
  check("PLANNING.md says how to change the lengths before approval and not to re-call generate_script", /edit `start` and `duration` in the `beatsJson`[^.]*contiguous/.test(planning) && /Do not call `generate_script` again/.test(planning));
  check("the director gates section no longer runs generate_narration", !/generate_narration/.test(director.slice(gatesAt, director.indexOf("## 11."))));
}

finish();

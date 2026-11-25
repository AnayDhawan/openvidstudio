#!/usr/bin/env node
// Language pace bands (#181 steps 1-3). SCRIPT.md's 2.3-2.9 words/sec is an English number. A voice in
// another language speaks a different number of whitespace words per second, so each measured language
// gets a band scaled by r = median(words/sec of the language) / median(words/sec of English), measured
// from real edge-tts audio over one parallel corpus (scripts/measure-language-pace.mjs). The numbers
// are pinned here, and the committed measurement file must agree with them.
//
// No network and no Python: the measurement itself is a maintainer script, not part of this suite.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { require, packageRoot, distDir, check, finish } from "./_harness.mjs";

const { paceBandFor } = require(path.join(distDir, "languagePace.js"));
const { runPlanBeats } = require(path.join(distDir, "tools", "planBeats.js"));
const { validateBeatsLogic, voPaceCheck } = require(path.join(distDir, "tools", "validateBeats.js"));
const { runFitBeats } = require(path.join(distDir, "tools", "fitBeats.js"));
const { runGenerateScript } = require(path.join(distDir, "tools", "generateScript.js"));

const words = (n) => Array(n).fill("word").join(" ");
const sameFields = (band, min, max, measured) => band.min === min && band.max === max && band.measured === measured;
const round1 = (n) => Math.round(n * 10) / 10;
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const throwsWith = (fn, pattern) => {
  try {
    fn();
  } catch (err) {
    return pattern.test(err instanceof Error ? err.message : String(err));
  }
  return false;
};

// What the measurement produced (scripts/fixtures/pace-measurements.json, 2026-11-25, edge-tts 7.3.1).
const PINNED = {
  hi: { r: 0.7929, min: 1.8, max: 2.3 },
  es: { r: 0.9367, min: 2.2, max: 2.7 },
  de: { r: 0.8033, min: 1.8, max: 2.3 },
};

console.log("\n== paceBandFor: English is untouched ==");
{
  for (const tag of [undefined, "en", "en-GB", "en-US", "EN", "en-gb"]) {
    check(`${tag === undefined ? "undefined" : `"${tag}"`} gives exactly 2.3-2.9, measured`, sameFields(paceBandFor(tag), 2.3, 2.9, true));
  }
  check("an English band has no note", paceBandFor("en").note === undefined);
  check("the band names its language", paceBandFor("en-GB").language === "en" && paceBandFor("hi-IN").language === "hi");
}

console.log("\n== paceBandFor: the measured languages ==");
{
  for (const [tag, want] of Object.entries(PINNED)) {
    const band = paceBandFor(tag);
    check(`${tag} is ${want.min}-${want.max}, measured`, sameFields(band, want.min, want.max, true));
    check(`${tag} has no note`, band.note === undefined);
  }
  check("hi-IN is the Hindi band (the primary subtag decides)", sameFields(paceBandFor("hi-IN"), 1.8, 2.3, true));
  check("a tag in capitals is read the same way", sameFields(paceBandFor("ES-es"), 2.2, 2.7, true) && sameFields(paceBandFor("DE"), 1.8, 2.3, true));
  check("de-AT and es-MX are the German and Spanish bands", sameFields(paceBandFor("de-AT"), 1.8, 2.3, true) && sameFields(paceBandFor("es-MX"), 2.2, 2.7, true));
  check("every measured band is slower than English, so its budget is lower", Object.keys(PINNED).every((t) => paceBandFor(t).max <= 2.9 && paceBandFor(t).min < 2.3));
}

console.log("\n== paceBandFor: a language with no measurement ==");
{
  for (const tag of ["fr", "pt-BR", "it", "ar"]) {
    const band = paceBandFor(tag);
    check(`${tag} falls back to the English band, not measured`, sameFields(band, 2.3, 2.9, false));
    check(`${tag} carries a note that says no measured band exists and names the tag`, typeof band.note === "string" && /no measured/i.test(band.note) && band.note.includes(`"${tag}"`));
  }
  check("a note points at where the measured languages are listed", /NARRATION\.md/.test(paceBandFor("fr").note));
}

console.log("\n== paceBandFor: scripts without spaces refuse ==");
{
  // The six two-letter codes, regional forms, and the three-letter codes of the same scripts (Cantonese has no two-letter tag).
  for (const tag of ["zh", "ja", "th", "km", "lo", "my", "zh-CN", "ja-JP", "th-TH", "ZH", "yue", "yue-HK", "cmn", "zho", "jpn", "tha", "khm", "lao", "mya"]) {
    check(`${tag} throws, because it counts characters, not words`, throwsWith(() => paceBandFor(tag), /counts characters, not words/));
  }
  check("the refusal says beat lengths must be planned by hand", throwsWith(() => paceBandFor("zh"), /planned by hand/));
  check("a value that is not a language tag throws", throwsWith(() => paceBandFor("not a tag"), /BCP-47/));
}

console.log("\n== the committed measurement agrees with the pinned bands ==");
{
  const measurements = JSON.parse(fs.readFileSync(path.join(packageRoot, "scripts", "fixtures", "pace-measurements.json"), "utf8"));
  const corpus = JSON.parse(fs.readFileSync(path.join(packageRoot, "scripts", "fixtures", "pace-corpus.json"), "utf8"));
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const langs = measurements.languages;

  check("the measurement covers English and the three measured languages", ["en", "hi", "es", "de"].every((l) => langs[l] !== undefined));
  check("the corpus has twelve parallel sentences, each 10 to 30 whitespace words in every language", corpus.sentences.length === 12 && corpus.sentences.every((s) => ["en", "hi", "es", "de"].every((l) => {
    const n = s[l].trim().split(/\s+/).length;
    return n >= 10 && n <= 30;
  })));
  check("every language was measured on all twelve sentences", Object.values(langs).every((l) => l.sentences.length === 12));
  check("the recorded word counts are the corpus's whitespace counts", Object.entries(langs).every(([l, data]) => data.sentences.every((s) => s.words === corpus.sentences.find((c) => c.id === s.id)[l].trim().split(/\s+/).length)));
  check("each voice is the one the corpus names", Object.entries(langs).every(([l, data]) => data.voice === corpus.voices[l]));
  check("English stays 2.3-2.9", measurements.english.min === 2.3 && measurements.english.max === 2.9);
  check("English's own ratio is 1", langs.en.r === 1);
  check("the edge-tts version and the date are recorded", /^\d+\.\d+\.\d+/.test(measurements.edgeTtsVersion) && /^\d{4}-\d{2}-\d{2}$/.test(measurements.measuredAt));

  for (const [l, data] of Object.entries(langs)) {
    const wps = data.sentences.map((s) => s.wordsPerSec);
    check(`${l}: the recorded median words/sec is the median of its sentences`, Math.abs(median(wps) - data.medianWordsPerSec) < 0.001);
    check(`${l}: every sentence's rate is its words over its seconds`, data.sentences.every((s) => Math.abs(s.words / s.seconds - s.wordsPerSec) < 0.002));
  }
  for (const [l, want] of Object.entries(PINNED)) {
    const data = langs[l];
    check(`${l}: r is the language's median over English's median`, Math.abs(data.medianWordsPerSec / langs.en.medianWordsPerSec - data.r) < 0.001);
    check(`${l}: the recorded r is the pinned ${want.r}`, data.r === want.r);
    check(`${l}: the band is [round1(2.3 r), round1(2.9 r)] = ${want.min}-${want.max}`, round1(2.3 * data.r) === want.min && round1(2.9 * data.r) === want.max && data.band.min === want.min && data.band.max === want.max);
    check(`${l}: paceBandFor returns what the measurement recorded`, sameFields(paceBandFor(l), data.band.min, data.band.max, true));
  }
}

console.log("\n== plan_beats takes a language ==");
{
  const root = tmp("ovs-lang-plan-");
  const brief = { projectRoot: root, targetDurationSeconds: 60, arc: "simple", features: ["search", "share"] };

  const english = runPlanBeats(brief);
  check("no language: the result says en and carries the English band", english.language === "en" && sameFields(english.paceBand, 2.3, 2.9, true));
  check("no language: budgets are ceil(2.3 s) and floor(2.9 s), as they always were", english.beats.every((b) => b.wordBudget.min === Math.ceil(2.3 * (b.duration / english.fps)) && b.wordBudget.max === Math.floor(2.9 * (b.duration / english.fps))));
  check("language en is the same plan as no language", JSON.stringify(runPlanBeats({ ...brief, language: "en" }).beats) === JSON.stringify(english.beats));
  check("no language adds no language note", !english.notes.some((n) => /pace band/i.test(n)));

  const german = runPlanBeats({ ...brief, language: "de" });
  check("de: the result carries the language and the German band", german.language === "de" && sameFields(german.paceBand, 1.8, 2.3, true));
  check("de: budgets are ceil(1.8 s) and floor(2.3 s) per beat", german.beats.every((b) => b.wordBudget.min === Math.ceil(1.8 * (b.duration / german.fps)) && b.wordBudget.max === Math.floor(2.3 * (b.duration / german.fps))));
  check("de: the timing is the English timing, only the budget moves", german.beats.every((b, i) => b.start === english.beats[i].start && b.duration === english.beats[i].duration));
  check("de: a German budget is smaller than the English one on every beat", german.beats.every((b, i) => b.wordBudget.max < english.beats[i].wordBudget.max));
  check("de: the notes say which band the budgets use", german.notes.some((n) => n.includes('"de"') && n.includes("1.8-2.3")));
  check("de: the suggested word count is the middle of the German budget", german.beats.every((b) => b.wordBudget.suggested === Math.round((b.wordBudget.min + b.wordBudget.max) / 2)));
  check("de: the total budget adds up the per-beat budgets", german.totalWordBudget.max === german.beats.reduce((a, b) => a + b.wordBudget.max, 0));

  const hindi = runPlanBeats({ ...brief, language: "hi-IN" });
  check("hi-IN plans with the Hindi band", sameFields(hindi.paceBand, 1.8, 2.3, true));

  const french = runPlanBeats({ ...brief, language: "fr" });
  check("fr: plans with the English band and says it is not measured", sameFields(french.paceBand, 2.3, 2.9, false));
  check("fr: a visible note says no measured band exists", french.notes.some((n) => /no measured/i.test(n) && n.includes('"fr"')));
  check("fr: the budgets are the English ones", french.beats.every((b, i) => JSON.stringify(b.wordBudget) === JSON.stringify(english.beats[i].wordBudget)));

  check("zh: refuses, because it counts characters, not words", throwsWith(() => runPlanBeats({ ...brief, language: "zh" }), /counts characters, not words/));
  check("a language that is not a tag is refused", throwsWith(() => runPlanBeats({ ...brief, language: "not a tag" }), /BCP-47/));
}

console.log("\n== validate_beats: the base language ==");
{
  const beat = (vo, extra = {}) => ({ id: "b", start: 0, duration: 60, vo, visual: { captureMethod: "dom-demo" }, ...extra });
  const doc = (language, vo, extra) => ({ fps: 30, ...(language === undefined ? {} : { language }), beats: [beat(vo, extra)] });
  // 4 words over 2.00 s is 2.0 words/sec: under the English floor, inside the German band.
  const four = words(4);
  const english = validateBeatsLogic(doc(undefined, four));
  check("English rejects 2.0 words/sec", !english.valid && english.errors.length === 1);
  check("the English message text is unchanged", english.errors[0] === 'beat "b": VO pace 2.00 words/sec is outside the 2.3-2.9 words/sec budget (4 words over 2.00s, per SCRIPT.md)');
  check("language en gives the same message", validateBeatsLogic(doc("en", four)).errors[0] === english.errors[0]);
  check("language en-GB gives the same message", validateBeatsLogic(doc("en-GB", four)).errors[0] === english.errors[0]);

  const german = validateBeatsLogic(doc("de", four));
  check("language de accepts the line the English band rejects", german.valid && german.errors.length === 0 && german.warnings.length === 0);
  check("language hi accepts it too (1.8-2.3)", validateBeatsLogic(doc("hi", four)).valid);
  check("language es rejects it (2.2-2.7 is above 2.0)", !validateBeatsLogic(doc("es", four)).valid);
  const tooMany = validateBeatsLogic(doc("de", words(8)));
  check("de still rejects too many words, with its own band in the message", !tooMany.valid && /4\.00 words\/sec is outside the 1\.8-2\.3/.test(tooMany.errors[0]) && /de/.test(tooMany.errors[0]));
  check("de rejects too few words as well", !validateBeatsLogic(doc("de", words(3))).valid);
  check("hi-IN is read as hi", validateBeatsLogic(doc("hi-IN", four)).valid);

  const unmeasured = validateBeatsLogic(doc("fr", words(5)));
  check("fr is checked against the English band: 2.5 words/sec passes", unmeasured.valid);
  check("fr carries one visible warning that no measured band exists", unmeasured.warnings.length === 1 && /no measured/i.test(unmeasured.warnings[0]) && unmeasured.warnings[0].includes('"fr"'));
  check("fr is still held to the English band: 2.0 words/sec fails", !validateBeatsLogic(doc("fr", four)).valid);

  const spaceless = validateBeatsLogic(doc("zh", "你好世界"));
  check("zh does not guess: the pace of vo is not checked", spaceless.valid && spaceless.errors.length === 0);
  check("zh carries a warning that says it counts characters, not words", spaceless.warnings.length === 1 && /counts characters, not words/.test(spaceless.warnings[0]));

  check("a language that is not a BCP-47 tag is an error", (() => {
    const r = validateBeatsLogic(doc("not a tag", words(5)));
    return !r.valid && r.errors.some((e) => /language/.test(e) && /BCP-47/.test(e));
  })());
  check("a language that is not a string is an error", !validateBeatsLogic(doc(42, words(5))).valid);
  check("an empty language is an error", !validateBeatsLogic(doc("", words(5))).valid);
  check("no language key at all validates as before", validateBeatsLogic(doc(undefined, words(5))).valid);

  check("voPaceCheck with no language keeps its message", voPaceCheck(four, 2).message === "VO pace 2.00 words/sec is outside the 2.3-2.9 words/sec budget (4 words over 2.00s, per SCRIPT.md)");
  check("voPaceCheck with a language reads that band", voPaceCheck(four, 2, "de").message === null && voPaceCheck(four, 2, "en").message !== null);
  check("voPaceCheck keeps its return shape", (() => {
    const r = voPaceCheck(four, 2, "de");
    return Object.keys(r).sort().join(",") === "message,pace,words" && r.words === 4 && r.pace === 2;
  })());
}

console.log("\n== validate_beats: voTranslations are checked as warnings ==");
{
  const beat = (id, start, vo, voTranslations) => ({ id, start, duration: 60, vo, voTranslations, visual: { captureMethod: "dom-demo" } });
  const one = (voTranslations) => validateBeatsLogic({ fps: 30, beats: [beat("b", 0, words(5), voTranslations)] });

  const outside = one({ hi: words(10) });
  check("a Hindi line outside the Hindi band is a warning", outside.warnings.length === 1 && /voTranslations\.hi/.test(outside.warnings[0]) && /1\.8-2\.3/.test(outside.warnings[0]) && /5\.00 words\/sec/.test(outside.warnings[0]));
  check("...and the beat stays valid", outside.valid === true && outside.errors.length === 0);
  check("the warning names the beat", outside.warnings[0].includes('beat "b"'));
  check("a Hindi line inside the Hindi band raises nothing", (() => {
    const r = one({ hi: words(4) });
    return r.valid && r.warnings.length === 0;
  })());
  check("a Hindi line too sparse for the band is a warning too", one({ hi: words(2) }).warnings.some((w) => /voTranslations\.hi/.test(w)));
  check("each tag is held to its own band: 4 words passes de, fails es", (() => {
    const r = one({ de: words(4), es: words(4) });
    return r.valid && r.warnings.length === 1 && /voTranslations\.es/.test(r.warnings[0]);
  })());
  check("hi-IN is held to the Hindi band", one({ "hi-IN": words(10) }).warnings.some((w) => /voTranslations\.hi-IN/.test(w) && /1\.8-2\.3/.test(w)));
  check("the old multilingual fixture still validates: a short hi line is not an error", one({ hi: "kuch shabd yahan" }).valid);

  const unmeasured = validateBeatsLogic({
    fps: 30,
    beats: [beat("a", 0, words(5), { fr: words(9) }), beat("b", 60, words(5), { fr: words(9) }), beat("c", 120, words(5), { fr: words(9), it: words(9) })],
  });
  const frWarnings = unmeasured.warnings.filter((w) => w.includes('"fr"'));
  const itWarnings = unmeasured.warnings.filter((w) => w.includes('"it"'));
  check("an unmeasured tag gets exactly one warning however many beats use it", frWarnings.length === 1 && /no measured/i.test(frWarnings[0]));
  check("a second unmeasured tag gets its own single warning", itWarnings.length === 1);
  // A translation line has no base-language stand-in to talk about: the warning says only that there is no band and no check.
  check("the unmeasured-tag warning is exactly that: no measured band, its lines are not pace-checked", frWarnings[0] === 'voTranslations.fr: no measured pace band for "fr", so its lines are not pace-checked.' && itWarnings[0] === 'voTranslations.it: no measured pace band for "it", so its lines are not pace-checked.');
  check("...and does not talk about an English stand-in, which would contradict 'not pace-checked'", !/stand-in|rough guide|English/.test(frWarnings[0]));
  check("the base-language note for the same tag still says the English band is the stand-in", /stand-in/.test(paceBandFor("fr").note));
  check("unmeasured lines are not pace-checked, so there are no per-beat pace warnings for them", unmeasured.warnings.every((w) => !/VO pace/.test(w)));
  check("unmeasured tags never make a draft invalid", unmeasured.valid);

  const spaceless = validateBeatsLogic({ fps: 30, beats: [beat("a", 0, words(5), { zh: "你好世界" }), beat("b", 60, words(5), { zh: "再见" })] });
  check("a spaceless tag gets one warning, not a throw", spaceless.valid && spaceless.warnings.filter((w) => /counts characters, not words/.test(w)).length === 1);

  check("a bad tag is still an error", !one({ "not a tag": "x" }).valid);
  check("an empty translation is still an error", !one({ hi: "  " }).valid);
  check("a measured language never raises the unmeasured warning", !one({ hi: words(4), es: words(5), de: words(4) }).warnings.some((w) => /no measured/i.test(w)));
}

console.log("\n== fit_beats reads the language ==");
{
  const FPS = 30;
  // 10 words spoken in 4.0 s, plus the 0.5 s pad, is 135 frames.
  const project = (language) => {
    const root = tmp("ovs-lang-fit-");
    const dir = path.join(root, "src", "videos", "lesson");
    fs.mkdirSync(dir, { recursive: true });
    const doc = { fps: FPS, ...(language === undefined ? {} : { language }), beats: [{ id: "a", start: 0, duration: 90, vo: words(10), visual: { captureMethod: "dom-demo" } }] };
    fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify(doc, null, 2) + "\n");
    return root;
  };
  const fit = (language, input = {}) => runFitBeats({ projectRoot: project(language), videoName: "lesson", spokenSeconds: { a: 4.0 }, dryRun: true, ...input });

  const english = fit(undefined);
  check("English: 135 frames is above the 130 ceiling for 10 words, so it is held at 130", english.beats[0].after === 130 && english.beats[0].clampedTo === "max");
  check("English result reports the English band", english.language === "en" && sameFields(english.paceBand, 2.3, 2.9, true));
  const german = fit("de");
  check("a beats.json language of de sizes from the German band: 135 frames fit", german.beats[0].after === 135 && german.beats[0].clampedTo === undefined);
  check("...and the result reports it", german.language === "de" && sameFields(german.paceBand, 1.8, 2.3, true));
  check("...and the fitted beats validate against the German band", german.validation.valid && german.beats[0].pace === Number((10 / 4.5).toFixed(2)));
  check("the input language overrides the file: en on a de file gives the English 130", fit("de", { language: "en" }).beats[0].after === 130);
  check("the input language applies when the file has none", fit(undefined, { language: "de" }).beats[0].after === 135);
  check("an override that the file does not carry is said in the notes", fit(undefined, { language: "de" }).notes.some((n) => /beats\.json/.test(n) && /de/.test(n)));
  check("no override and no mismatch means no notes", german.notes.length === 0 && english.notes.length === 0);
  // A file with no language already means English, so asking for en says nothing new.
  check("language en on a file with no language field adds no note", fit(undefined, { language: "en" }).notes.length === 0);
  check("language en-GB on a file with no language field adds no note either", fit(undefined, { language: "en-GB" }).notes.length === 0);
  check("language en on a file that says en adds no note", fit("en", { language: "en" }).notes.length === 0);
  check("the same language in another region adds no note (hi on a hi-IN file)", fit("hi-IN", { language: "hi" }).notes.length === 0);
  check("language en on a file that says de still says so: validate_beats would read de", fit("de", { language: "en" }).notes.some((n) => /beats\.json/.test(n) && /"de"/.test(n)));
  check("the override note says what to add", fit(undefined, { language: "de" }).notes.some((n) => n.includes('"language": "de"')));
  check("an unmeasured language says so in the result's validation", fit("fr").validation.warnings.some((w) => /no measured/i.test(w)));
  check("a spaceless language refuses", throwsWith(() => fit("zh"), /counts characters, not words/));
  check("a clamp note quotes the band it used", fit("de", { spokenSeconds: { a: 9 } }).beats[0].note.includes("1.8"));
}

console.log("\n== tool descriptions and docs say whose voice the bands are for ==");
{
  const { createMcpServer } = require(path.join(distDir, "server.js"));
  const tools = createMcpServer()._registeredTools;
  const fitDescription = tools.fit_beats.description;
  check("fit_beats' description no longer hard-codes the English window (words/2.9 to words/2.3)", !/words\/2\.9|words\/2\.3/.test(fitDescription));
  check("...it says the pace band is the language's, with English 2.3-2.9", /language's pace band/.test(fitDescription) && /English 2\.3-2\.9 words\/sec/.test(fitDescription));
  check("...and it no longer says the voice needs 'more than 2.3 words per second'", !/more than 2\.3 words per second/.test(fitDescription));
  for (const name of ["plan_beats", "generate_script", "fit_beats", "validate_beats"]) {
    check(`${name}'s description says the band is measured for one voice, not for any voice`, /one voice|that voice|voice in/.test(tools[name].description) && /voices/.test(tools[name].description));
  }

  const narration = fs.readFileSync(path.join(packageRoot, "..", "docs", "NARRATION.md"), "utf8");
  // One line, so a sentence the doc wraps is still matched.
  const section = narration.slice(narration.indexOf("### Pace by language"), narration.indexOf("## Engines")).replace(/\s+/g, " ");
  check("NARRATION.md says each band was measured on the voice in its row", /measured on the voice in its row/.test(section));
  check("...tells the user to pass voices for generate_narration, with an example", /`voices`/.test(section) && /hi-IN-MadhurNeural/.test(section.slice(section.indexOf("`voices`"))));
  check("...says another voice may read faster or slower", /another voice may read faster or slower/.test(section));
  check("...no longer claims baseLanguage picks the synthesis voice", !/so the clips are synthesized in the language the budgets were written for/.test(section));
  check("...describes the corpus as narration-style, with one number-heavy sentence", /narration-style/.test(section) && !/plain-prose/.test(section) && /number-heavy sentence/.test(section));
  check("...lists the three-letter codes of the spaceless scripts", ["yue", "cmn", "zho", "jpn", "tha", "khm", "lao", "mya"].every((c) => section.includes(`\`${c}\``)));
}

console.log("\n== generate_script takes a language ==");
{
  const root = tmp("ovs-lang-script-");
  const brief = { projectRoot: root, targetDurationSeconds: 60, features: ["search", "share"] };

  const skeleton = runGenerateScript({ ...brief, language: "es" });
  check("es: beatsJson.language is es", skeleton.beatsJson.language === "es");
  check("es: the plan carries the Spanish band and language", skeleton.plan.language === "es" && sameFields(skeleton.plan.paceBand, 2.2, 2.7, true));
  check("es: the word budgets are the Spanish ones", skeleton.plan.beats.every((b) => b.wordBudget.min === Math.ceil(2.2 * (b.duration / skeleton.plan.fps)) && b.wordBudget.max === Math.floor(2.7 * (b.duration / skeleton.plan.fps))));
  check("es: the skeleton's notes say which band the budgets use", skeleton.notes.some((n) => n.includes("2.2-2.7")));

  const narration = Object.fromEntries(skeleton.plan.beats.map((b) => [b.id, words(b.wordBudget.suggested)]));
  const validated = runGenerateScript({ ...brief, language: "es", draft: { narration } });
  check("es: a draft written to the suggested budget validates", validated.validation.valid === true);
  check("es: the validated beatsJson keeps language es", validated.beatsJson.language === "es");
  const english = runGenerateScript({ ...brief, draft: { narration } });
  const spanishOnly = skeleton.plan.beats.filter((b, i) => words(b.wordBudget.suggested) !== words(english.plan.beats[i].wordBudget.suggested));
  check("the Spanish budgets differ from the English ones, so the same draft is judged differently", spanishOnly.length > 0);

  const plain = runGenerateScript(brief);
  check("no language: beatsJson has no language key, as before", !("language" in plain.beatsJson) && plain.plan.language === "en" && sameFields(plain.plan.paceBand, 2.3, 2.9, true));
  check("no language: the key order of beatsJson is unchanged", Object.keys(plain.beatsJson).join(",") === "fps,production,beats");
  check("fr: the skeleton carries the not-measured note", runGenerateScript({ ...brief, language: "fr" }).notes.some((n) => /no measured/i.test(n)));
  check("zh: refuses, because it counts characters, not words", throwsWith(() => runGenerateScript({ ...brief, language: "zh" }), /counts characters, not words/));
}

finish();

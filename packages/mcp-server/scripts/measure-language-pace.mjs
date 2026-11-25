#!/usr/bin/env node
// Measures how fast each language's edge-tts voice speaks relative to English, from real audio,
// and writes scripts/fixtures/pace-measurements.json. src/languagePace.ts pins the resulting
// ratios and scripts/tests/language-pace.test.mjs checks the two agree.
//
//   node scripts/measure-language-pace.mjs
//
// It needs network access to Microsoft's speech service and the edge-tts Python package. It is a
// maintainer tool: nothing in the test suite runs it.
//
// Method:
//   1. For each language, synthesize every sentence of the parallel corpus with that language's
//      voice through py/edge-words.py, which returns one { word, startMs, endMs } per word.
//   2. Spoken span = last word's endMs minus first word's startMs, so the silence edge-tts puts at
//      the start and end of a clip does not bias the rate.
//   3. Words = whitespace-separated tokens (the rule validate_beats uses).
//   4. words/sec per sentence, then the median per language.
//   5. r = median(language) / median(English). Band = [round1(2.3 * r), round1(2.9 * r)], where
//      2.3-2.9 is the English band SCRIPT.md has always enforced.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, "..");
const corpusPath = path.join(here, "fixtures", "pace-corpus.json");
const outPath = path.join(here, "fixtures", "pace-measurements.json");
const edgeWords = path.join(packageRoot, "py", "edge-words.py");

const ENGLISH_MIN = 2.3;
const ENGLISH_MAX = 2.9;
const ATTEMPTS = 3;

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function findPython() {
  for (const candidate of ["python3", "python"]) {
    const r = spawnSync(candidate, ["-c", "import edge_tts, importlib.metadata as m; print(m.version('edge-tts'))"], { encoding: "utf8" });
    if (r.status === 0) return { command: candidate, edgeTtsVersion: r.stdout.trim() };
  }
  throw new Error("No python with the edge_tts package found. Install it with: pip install edge-tts");
}

function synthesize(python, voice, text, workDir) {
  const raw = path.join(workDir, "clip.raw");
  const words = path.join(workDir, "clip.words.json");
  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const r = spawnSync(python, [edgeWords, "--voice", voice, "--text", text, "--out", raw, "--words", words], { encoding: "utf8" });
    if (r.status === 0 && fs.existsSync(words)) {
      const timings = JSON.parse(fs.readFileSync(words, "utf8"));
      if (timings.length > 0) return timings;
      lastError = "no word boundaries came back";
    } else {
      lastError = (r.stderr || r.stdout || String(r.error)).trim();
    }
  }
  throw new Error(`edge-tts could not synthesize with ${voice} after ${ATTEMPTS} attempts: ${lastError}`);
}

const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const python = findPython();
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-pace-"));
const languages = {};

try {
  for (const [language, voice] of Object.entries(corpus.voices)) {
    const sentences = [];
    for (const entry of corpus.sentences) {
      const text = entry[language];
      const words = text.trim().split(/\s+/).length;
      if (words < 10 || words > 30) throw new Error(`${entry.id} (${language}) has ${words} words, the corpus wants 10-30.`);
      const timings = synthesize(python.command, voice, text, workDir);
      const seconds = (timings[timings.length - 1].endMs - timings[0].startMs) / 1000;
      sentences.push({ id: entry.id, words, seconds, wordsPerSec: words / seconds });
      process.stderr.write(`${language} ${entry.id}: ${words} words, ${seconds.toFixed(3)}s, ${(words / seconds).toFixed(3)} w/s\n`);
    }
    languages[language] = { voice, sentences, medianWordsPerSec: median(sentences.map((s) => s.wordsPerSec)) };
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

const english = languages.en.medianWordsPerSec;
const result = {
  measuredAt: new Date().toISOString().slice(0, 10),
  edgeTtsVersion: python.edgeTtsVersion,
  method:
    "Spoken span is the last word's endMs minus the first word's startMs from py/edge-words.py, words are whitespace " +
    "tokens, rate is words per second per sentence, median over the 12 corpus sentences. r is the language's median " +
    "divided by English's. Band is [round1(2.3 * r), round1(2.9 * r)].",
  english: { min: ENGLISH_MIN, max: ENGLISH_MAX },
  languages: {},
};
for (const [language, data] of Object.entries(languages)) {
  const r = round(data.medianWordsPerSec / english, 4);
  result.languages[language] = {
    voice: data.voice,
    sentences: data.sentences.map((s) => ({ id: s.id, words: s.words, seconds: round(s.seconds, 3), wordsPerSec: round(s.wordsPerSec, 3) })),
    medianWordsPerSec: round(data.medianWordsPerSec, 3),
    r,
    band: { min: round(ENGLISH_MIN * r, 1), max: round(ENGLISH_MAX * r, 1) },
  };
}

fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath}`);
for (const [language, data] of Object.entries(result.languages)) {
  console.log(`${language}  ${data.voice}  median ${data.medianWordsPerSec} w/s  r ${data.r}  band ${data.band.min}-${data.band.max}`);
}

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pascalCase, resolveProjectRoot, sanitizeSegment } from "../util";
import { runTool } from "./mcp";
import { voPaceCheck, wordCount } from "./validateBeats";

/**
 * A lint for a lesson script (Supernova mode). Mechanical only, no model call: it counts words and
 * matches patterns, so it can say a sentence is long or a term was never defined, and it cannot say
 * the explanation is good. A lesson is won or lost on its script, and nothing else in openvidstudio
 * looks at one; validate_beats checks pacing but not whether the script teaches.
 *
 * The rules are SCRIPT.md's lesson script rules: a hook in the first sentence, intuition before
 * formula, every term defined at first use with at most two new ones a beat, sentences of about 14
 * words or fewer, maths written as it is spoken, and a check question at the end.
 */

export interface ConceptCard {
  /** What the viewer can do afterwards: "tell why a derivative is a slope". */
  goal: string;
  /** The two or three terms that need defining. */
  terms: string[];
  /** The running example. */
  example: string;
  /**
   * Where the lesson sits in a syllabus or a series, as it is shown on screen: "IB Physics A.1 Kinematics",
   * "Part 2 of 4". When set, the opening beat has to say it (see `referenceSpoken`).
   */
  reference?: string;
  /** The reference as it is said aloud: "I B Physics, topic A one, kinematics". The first beat's narration must contain it. */
  referenceSpoken?: string;
  /** The longest the lesson may run, in seconds. Default 120. */
  maxSeconds?: number;
  /**
   * The lesson's shape. "seven-beat" (the default, and what a card without this field gets) is the arc in SCRIPT.md;
   * "story" is the story-first arc: a real situation told as a problem, a narrator, the key formulas, the formulas
   * applied to the story's numbers, one watch out, then a practice question. The story fields below are only read
   * for "story".
   */
  arc?: "seven-beat" | "story";
  /** Story arc: the one real-world scene the lesson opens on. The first beat has to name it. */
  situation?: string;
  /** Story arc: the narrator's name. */
  character?: string;
  /**
   * Story arc: the key formulas, in the order they are stated. `tex` is what is on screen, `spoken` how it is said
   * (it has to occur in the narration, in this order), `source` where it comes from (a syllabus booklet, a derivation).
   */
  formulas?: StoryFormula[];
  /** Story arc: the original practice question. The last beat ends with it. */
  practiceQuestion?: string;
  /** Story arc: the practice question's answer. It is withheld from the narration (it goes in the pinned comment). */
  answer?: string;
}

export interface StoryFormula {
  tex: string;
  spoken: string;
  source: string;
}

export type ScriptFindingSeverity = "error" | "warning" | "note";

export interface ScriptFinding {
  severity: ScriptFindingSeverity;
  /** Which check produced it. */
  check: "sentence-length" | "reading-level" | "glossary" | "new-terms" | "spoken" | "hook" | "pace" | "closing-question" | "length" | "reference" | "story-situation" | "story-formula" | "story-practice" | "story-comment" | "story-subscribe" | "story-answer";
  beatId: string;
  message: string;
}

export interface CheckScriptInput {
  projectRoot?: string;
  videoName: string;
  /** Overrides src/videos/<videoName>/beats.json. */
  beatsJson?: unknown;
  /** Overrides src/videos/<videoName>/concept.json. */
  conceptCard?: ConceptCard;
}

export interface CheckScriptResult {
  /** False when any finding is an error. Warnings and notes never fail it. */
  ok: boolean;
  beatsChecked: number;
  findings: ScriptFinding[];
}

/** Sentences longer than this on average draw a warning (the target is about 14). */
export const MAX_AVG_SENTENCE_WORDS = 16;
/** The longest a lesson may run, in seconds, unless its concept card says otherwise. */
export const DEFAULT_MAX_LESSON_SECONDS = 120;
/** A beat reading above this Flesch-Kincaid grade draws a warning. */
export const MAX_READING_GRADE = 9;
/** More new terms than this in one beat draws a warning. */
export const MAX_NEW_TERMS_PER_BEAT = 2;

interface BeatLike {
  id?: unknown;
  duration?: unknown;
  vo?: unknown;
  scene?: unknown;
}

export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A rough syllable count for English: vowel groups, less a silent final e. Good enough to rank a script, not to be exact. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch-Kincaid grade level of a passage. */
export function fleschKincaidGrade(text: string): number {
  const sentences = splitSentences(text);
  const words = text.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
  if (sentences.length === 0 || words.length === 0) return 0;
  const syl = words.reduce((n, w) => n + (/\d/.test(w) ? 2 : syllables(w)), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

const STOP_WORDS = new Set(
  "the and for with that this from have has had was were are but not you your his her its our their they them then than into onto over under about what when where which while will would could should can did does out off one all any too very just also more most some such only own same each both few other how why who whom".split(" "),
);

/** The distinct content words of a text: normalised, three letters or more, no stop words. */
function contentWords(text: string): Set<string> {
  return new Set(normalise(text).split(" ").filter((w) => w.length >= 3 && !STOP_WORDS.has(w)));
}

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|half|double|twice)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (term: string) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, "i");

/** A definition near the term: "a slope is...", "this is called a slope", "slope means...". */
function definedNear(term: string, sentences: string[], at: number): boolean {
  const t = escapeRe(term);
  const patterns = [
    new RegExp(`(?<![A-Za-z0-9])${t}(?![A-Za-z0-9])[^.!?]{0,30}\\b(is|are|means|mean|stands for)\\b`, "i"),
    new RegExp(`\\b(called|known as|named|we say|we call)\\b[^.!?]{0,20}(?<![A-Za-z0-9])${t}(?![A-Za-z0-9])`, "i"),
    new RegExp(`(?<![A-Za-z0-9])${t}(?![A-Za-z0-9])[^.!?]{0,6}[,(]\\s*(which|that|or)\\b`, "i"),
  ];
  const near = [sentences[at], sentences[at + 1]].filter((s): s is string => typeof s === "string");
  return near.some((s) => patterns.some((p) => p.test(s)));
}

/** The `spoken` strings of the Equations in a scene's source. */
export function spokenStrings(source: string): string[] {
  const out: string[] = [];
  const tag = /<Equation\b[\s\S]*?\bspoken\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g;
  for (const m of source.matchAll(tag)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}

/** The text between the bracket at `open` and its match, strings respected, or null if it never closes. */
function balanced(source: string, open: number): string | null {
  const pairs: Record<string, string> = { "[": "]", "{": "}", "(": ")" };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch in pairs) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * The `spoken` strings of each `<Derivation>` in a scene's source, in step order, one list per Derivation. The steps
 * may be written inline (`steps={[{ tex, spoken }, ...]}`) or as a constant in the same file (`steps={STEPS}`).
 */
export function derivationSpoken(source: string): string[][] {
  const out: string[][] = [];
  for (const tag of source.matchAll(/<Derivation\b/g)) {
    const open = tag.index ?? 0;
    const props = source.slice(open, open + 20000);
    const steps = /\bsteps\s*=\s*\{/.exec(props);
    if (!steps) continue;
    const braceAt = open + steps.index + steps[0].length - 1;
    const inner = balanced(source, braceAt);
    if (inner === null) continue;
    let list: string | null = inner;
    const ident = /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(inner);
    if (ident) {
      const decl = new RegExp(`\\b${ident[1]}\\b\\s*(?::[^=]+)?=\\s*\\[`).exec(source);
      list = decl ? balanced(source, decl.index + decl[0].length - 1) : null;
    }
    if (list === null) continue;
    const found: string[] = [];
    for (const m of list.matchAll(/\bspoken\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)) found.push(m[1] ?? m[2] ?? m[3] ?? "");
    out.push(found);
  }
  return out;
}

type AddFinding = (severity: ScriptFindingSeverity, check: ScriptFinding["check"], beatId: string, message: string) => void;

/**
 * The checks for the story arc. They look at the narration as a whole and at its first and last beat, and never
 * count beats, so a story lesson may take as many beats as it needs.
 */
function checkStoryArc(spoken: BeatLike[], card: ConceptCard, add: AddFinding): void {
  if (spoken.length === 0) return;
  const idOf = (beat: BeatLike, i: number) => String(beat.id ?? `beat ${i + 1}`);
  const first = spoken[0];
  const last = spoken[spoken.length - 1];
  const lastId = idOf(last, spoken.length - 1);

  // beat 1 names the situation: it shares at least two content words with it
  if (typeof card.situation !== "string" || card.situation.trim().length === 0) {
    add("warning", "story-situation", idOf(first, 0), `The story arc needs a situation on the concept card, so the first beat cannot be checked for naming it.`);
  } else {
    const wanted = contentWords(card.situation);
    const said = contentWords(first.vo as string);
    const shared = [...wanted].filter((w) => said.has(w));
    const need = Math.min(2, wanted.size);
    if (shared.length < need) {
      add("error", "story-situation", idOf(first, 0), `The first beat shares ${shared.length} content word${shared.length === 1 ? "" : "s"} with the situation "${card.situation}", and the story arc needs ${need}. Open on the situation, told as a problem.`);
    }
  }

  // each formula's spoken form is in the narration, in the order the card gives them
  const beatText = spoken.map((b) => normalise(b.vo as string));
  const heard = beatText.join(" ");
  const starts: number[] = [];
  beatText.reduce((at, t) => (starts.push(at), at + t.length + 1), 0);
  const beatAt = (pos: number) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= pos) k++;
    return idOf(spoken[k], k);
  };
  let cursor = 0;
  (card.formulas ?? []).forEach((f, k) => {
    if (typeof f?.spoken !== "string" || normalise(f.spoken).length === 0) return;
    const phrase = normalise(f.spoken);
    const at = heard.indexOf(phrase, cursor);
    if (at >= 0) {
      cursor = at + phrase.length;
    } else if (heard.includes(phrase)) {
      add("error", "story-formula", beatAt(heard.indexOf(phrase)), `Formula ${k + 1} ("${f.spoken}") is said before the formula above it. The card lists the formulas in the order they are stated, so the narration has to say them in that order.`);
    } else {
      add("error", "story-formula", idOf(first, 0), `Formula ${k + 1}, spoken as "${f.spoken}", is not in the narration. The voice has to say each key formula the way the card spells it.`);
    }
  });

  // the last beat ends with the practice question and asks for an answer in the comments
  if (typeof card.practiceQuestion !== "string" || normalise(card.practiceQuestion).length === 0) {
    add("warning", "story-practice", lastId, `The story arc needs a practiceQuestion on the concept card, so the last beat cannot be checked for ending with it.`);
  } else if (!normalise(last.vo as string).endsWith(normalise(card.practiceQuestion))) {
    add("error", "story-practice", lastId, `The last beat does not end with the practice question "${card.practiceQuestion}". End on the question and let the last frame hold.`);
  }
  if (!/comment/i.test(last.vo as string)) {
    add("error", "story-comment", lastId, `The last beat never asks the viewer to answer in the comments. Add a prompt such as "put your answer in the comments".`);
  }

  // "like and subscribe" anywhere is a warning
  spoken.forEach((b, i) => {
    if (/\blike\s*(?:,|and|&)?\s*(?:and\s+)?subscribe\b/i.test(b.vo as string)) {
      add("warning", "story-subscribe", idOf(b, i), `This beat says "like and subscribe". The lesson ends on its question and the prompt to comment, nothing else.`);
    }
  });

  // the answer is withheld until the pinned comment
  if (typeof card.answer === "string" && normalise(card.answer).length > 0) {
    const at = beatText.findIndex((t) => ` ${t} `.includes(` ${normalise(card.answer as string)} `));
    if (at >= 0) {
      add("warning", "story-answer", idOf(spoken[at], at), `The answer "${card.answer}" is in the narration. Withhold it: it belongs in the pinned comment, not in the video.`);
    }
  }
}

export function checkScriptLogic(
  beatsJson: unknown,
  card: ConceptCard,
  readScene: (beat: BeatLike, id: string) => string | null = () => null,
): CheckScriptResult {
  const findings: ScriptFinding[] = [];
  const root = (typeof beatsJson === "object" && beatsJson !== null ? beatsJson : {}) as { fps?: unknown; beats?: unknown };
  const fps = typeof root.fps === "number" && root.fps > 0 ? root.fps : 30;
  const beats = (Array.isArray(root.beats) ? root.beats : []) as BeatLike[];
  const add = (severity: ScriptFindingSeverity, check: ScriptFinding["check"], beatId: string, message: string) => findings.push({ severity, check, beatId, message });
  const story = card.arc === "story";

  const seen = new Set<string>();
  const spoken = beats.filter((b) => typeof b.vo === "string" && b.vo.length > 0);

  spoken.forEach((beat, index) => {
    const id = String(beat.id ?? `beat ${index + 1}`);
    const vo = beat.vo as string;
    const sentences = splitSentences(vo);

    // sentence length
    const avg = wordCount(vo) / Math.max(1, sentences.length);
    if (avg > MAX_AVG_SENTENCE_WORDS) {
      add("warning", "sentence-length", id, `Sentences average ${avg.toFixed(1)} words, over ${MAX_AVG_SENTENCE_WORDS}. A lesson is heard once; aim for about 14 or fewer and split the long ones.`);
    }

    // reading level
    const grade = fleschKincaidGrade(vo);
    if (grade > MAX_READING_GRADE) {
      add("warning", "reading-level", id, `Reads at about grade ${grade.toFixed(1)} (Flesch-Kincaid), above ${MAX_READING_GRADE}. Shorter words and shorter sentences.`);
    }

    // glossary: first use, a definition near it, and no more than two new terms a beat
    const introduced: string[] = [];
    for (const term of card.terms) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      const at = sentences.findIndex((s) => wordRe(term).test(s));
      if (at < 0) continue;
      seen.add(key);
      introduced.push(term);
      if (!definedNear(term, sentences, at)) {
        add("note", "glossary", id, `"${term}" is first used here with no definition beside it. Say what it is in plain words at first use ("a ${term} is ...").`);
      }
    }
    if (introduced.length > MAX_NEW_TERMS_PER_BEAT) {
      add("warning", "new-terms", id, `${introduced.length} new terms in one beat (${introduced.join(", ")}). At most ${MAX_NEW_TERMS_PER_BEAT}; spread them over the lesson.`);
    }

    // pace against the beat's length: the same budget validate_beats enforces
    if (typeof beat.duration === "number" && beat.duration > 0) {
      const pace = voPaceCheck(vo, beat.duration / fps);
      if (pace.message !== null) add("error", "pace", id, pace.message);
    }

    // every Equation's spoken string is in this beat's narration
    const source = readScene(beat, id);
    if (source !== null) {
      const heard = normalise(vo);
      for (const said of spokenStrings(source)) {
        if (!heard.includes(normalise(said))) {
          add("error", "spoken", id, `The equation's spoken form "${said}" is not in this beat's narration. The voice and the equation must say the same thing.`);
        }
      }
      // A Derivation's steps are said in order: each one after the one before it.
      for (const steps of derivationSpoken(source)) {
        let cursor = 0;
        steps.forEach((said, k) => {
          const phrase = normalise(said);
          const at = heard.indexOf(phrase, cursor);
          if (at >= 0) {
            cursor = at + phrase.length;
          } else if (heard.includes(phrase)) {
            add("error", "spoken", id, `The derivation's step ${k + 1} ("${said}") is said in this beat's narration, but before the step above it. The steps are revealed in order, so the voice has to say them in that order.`);
          } else {
            add("error", "spoken", id, `The derivation's step ${k + 1} spoken form "${said}" is not in this beat's narration. The voice and the formula must say the same thing.`);
          }
        });
      }
    }
  });

  // terms the card names that the narration never mentions
  for (const term of card.terms) {
    if (!seen.has(term.toLowerCase()) && spoken.length > 0) {
      add("warning", "glossary", String(spoken[0].id ?? "beat 1"), `The concept card names "${term}" but no beat's narration mentions it.`);
    }
  }

  // the length: a lesson explains one concept inside its budget (two minutes unless the card says otherwise)
  const budget = typeof card.maxSeconds === "number" && card.maxSeconds > 0 ? card.maxSeconds : DEFAULT_MAX_LESSON_SECONDS;
  const total = beats.reduce((n, b) => n + (typeof b.duration === "number" && b.duration > 0 ? b.duration : 0), 0) / fps;
  if (total > budget + 0.5) {
    add("error", "length", String(beats[beats.length - 1]?.id ?? "last beat"), `The lesson runs ${total.toFixed(1)} seconds, over its ${budget} second budget. Cut a beat, tighten the derivation, or move the second half to Part 2.`);
  }

  // the reference: the opening beat says where this lesson sits (a chapter code, a part number)
  if (typeof card.reference === "string" && card.reference.trim().length > 0 && spoken.length > 0) {
    const id = String(spoken[0].id ?? "beat 1");
    if (typeof card.referenceSpoken !== "string" || card.referenceSpoken.trim().length === 0) {
      add("warning", "reference", id, `The card gives the reference "${card.reference}" but not how it is said. Add referenceSpoken (for example "I B Physics, topic A one") so the script can be checked for it.`);
    } else if (!normalise(spoken[0].vo as string).includes(normalise(card.referenceSpoken))) {
      add("error", "reference", id, `The opening beat does not say the reference "${card.referenceSpoken}". Tell the viewer where this lesson sits in the first beat.`);
    }
  }

  // the hook: the first beat's first sentence
  if (spoken.length > 0) {
    const first = spoken[0];
    const id = String(first.id ?? "beat 1");
    const lead = splitSentences(first.vo as string)[0] ?? "";
    if (/^\s*in this video\b/i.test(lead)) {
      add("error", "hook", id, `The script opens "in this video". Open on a question or a surprising fact, not a promise of what is coming.`);
    } else if (!story && !lead.trim().endsWith("?") && !/\d/.test(lead) && !NUMBER_WORDS.test(lead)) {
      add("warning", "hook", id, `The first sentence is neither a question nor does it hold a number. The hook is a question or a surprising fact.`);
    }
  }

  // the end: a check question (a story lesson ends on its practice question instead, checked below)
  if (!story && spoken.length > 0) {
    const last = spoken[spoken.length - 1];
    const lastSentence = splitSentences(last.vo as string).slice(-1)[0] ?? "";
    if (!lastSentence.trim().endsWith("?")) {
      add("error", "closing-question", String(last.id ?? "last beat"), `The last beat does not end with a question. End with a one-line recap, then a check question the viewer can answer in their head.`);
    }
  }

  if (story) checkStoryArc(spoken, card, add);

  return { ok: !findings.some((f) => f.severity === "error"), beatsChecked: spoken.length, findings };
}

export function runCheckScript(input: CheckScriptInput): CheckScriptResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const videoDir = path.join(projectRoot, "src", "videos", videoName);

  let beatsJson = input.beatsJson;
  if (beatsJson === undefined) {
    const file = path.join(videoDir, "beats.json");
    if (!fs.existsSync(file)) throw new Error(`${file} not found. Write the beats first (write_beats_file), or pass beatsJson.`);
    beatsJson = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  let card = input.conceptCard;
  if (card === undefined) {
    const file = path.join(videoDir, "concept.json");
    if (!fs.existsSync(file)) {
      throw new Error(`${file} not found. A lesson script is checked against its concept card: write { goal, terms, example } next to beats.json, or pass conceptCard.`);
    }
    card = JSON.parse(fs.readFileSync(file, "utf8")) as ConceptCard;
  }
  if (typeof card !== "object" || card === null || typeof card.goal !== "string" || !Array.isArray(card.terms) || typeof card.example !== "string") {
    throw new Error("The concept card must be { goal: string, terms: string[], example: string } with the optional reference, referenceSpoken, maxSeconds and, for the story arc, arc, situation, character, formulas, practiceQuestion and answer.");
  }
  if (card.arc !== undefined && card.arc !== "seven-beat" && card.arc !== "story") {
    throw new Error(`The concept card's arc must be "seven-beat" or "story", not ${JSON.stringify(card.arc)}.`);
  }

  const readScene = (beat: BeatLike, id: string): string | null => {
    const rel = typeof beat.scene === "string" && beat.scene.length > 0 ? beat.scene : path.join("scenes", `${pascalCase(id)}.tsx`);
    const file = path.resolve(videoDir, rel);
    if (file !== videoDir && !file.startsWith(videoDir + path.sep)) return null;
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };
  return checkScriptLogic(beatsJson, card, readScene);
}

export function registerCheckScript(server: McpServer): void {
  server.registerTool(
    "check_script",
    {
      title: "Lint a lesson script against its concept card",
      description:
        "Mechanical lint for a Supernova lesson script, no model call: it counts and matches patterns, so it can " +
        "say a sentence is long or a term was never defined, not that the explanation is good. Reads " +
        "src/videos/<videoName>/beats.json and concept.json ({ goal, terms: string[], example, reference?, referenceSpoken?, maxSeconds?, arc?, situation?, character?, formulas?, practiceQuestion?, answer? }, next to it), or the " +
        "beatsJson and conceptCard inputs. Returns { ok, beatsChecked, findings } where each finding has a severity " +
        "(error, warning or note), the check, and the beat it points at. Checks: average sentence length per beat " +
        "(warning above 16 words), Flesch-Kincaid reading level per beat (warning above grade 9), each concept-card " +
        "term used with a definition beside it at first mention (note), more than two new terms in a beat (warning), " +
        "every Equation's `spoken` string present in its beat's narration, and every step of a Derivation present and in the order " +
        "the steps are given (error; the scene is read from the beat's " +
        "scene path or scenes/<BeatId>.tsx), a hook in the first sentence that is a question or holds a number and " +
        "does not open \"in this video\" (error for that opener, warning otherwise), words per second against the " +
        "beat length using validate_beats' own budget (error), a last beat that ends with a question (error), the " +
        "total length against the card's maxSeconds (default 120, error), and, when the card has a reference such as a " +
        "chapter code, that the first beat's narration says its referenceSpoken (error; warning if referenceSpoken is missing). " +
        "The card's `arc` is \"seven-beat\" (the default) or \"story\". For \"story\" (situation, character, formulas: [{ tex, spoken, source }], " +
        "practiceQuestion, answer), the closing-question check and the hook's warning give way to these, none of which count beats: " +
        "story-situation (the first beat shares at least two content words with the situation, error), story-formula (each formula's spoken form is in the " +
        "narration, in the order given, error), story-practice (the last beat ends with the practice question, error), story-comment (the last beat " +
        "contains a prompt matching /comment/i, error), story-subscribe (\"like and subscribe\" anywhere, warning) and story-answer (the answer is " +
        "in the narration, warning); a missing situation or practiceQuestion is a warning. Length, reference and the per-beat checks apply to both arcs. " +
        "ok is false only when a finding is an error. See SCRIPT.md's lesson script rules.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        beatsJson: z.unknown().optional().describe("The beats file as an object, instead of reading beats.json."),
        conceptCard: z
          .object({
            goal: z.string(),
            terms: z.array(z.string()),
            example: z.string(),
            reference: z.string().optional(),
            referenceSpoken: z.string().optional(),
            maxSeconds: z.number().positive().optional(),
            arc: z.enum(["seven-beat", "story"]).optional().describe('The lesson shape. Default "seven-beat".'),
            situation: z.string().optional().describe("Story arc: the real-world scene the first beat names."),
            character: z.string().optional().describe("Story arc: the narrator's name."),
            formulas: z
              .array(z.object({ tex: z.string(), spoken: z.string(), source: z.string() }))
              .optional()
              .describe("Story arc: the key formulas in the order they are stated; each spoken form must be in the narration, in order."),
            practiceQuestion: z.string().optional().describe("Story arc: the question the last beat ends with."),
            answer: z.string().optional().describe("Story arc: the answer, which must not be in the narration."),
          })
          .optional()
          .describe("The concept card, instead of reading concept.json."),
      },
    },
    async (input) => runTool("check_script", () => runCheckScript(input)),
  );
}

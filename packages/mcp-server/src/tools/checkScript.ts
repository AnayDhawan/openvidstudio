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
}

export type ScriptFindingSeverity = "error" | "warning" | "note";

export interface ScriptFinding {
  severity: ScriptFindingSeverity;
  /** Which check produced it. */
  check: "sentence-length" | "reading-level" | "glossary" | "new-terms" | "spoken" | "hook" | "pace" | "closing-question";
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
    }
  });

  // terms the card names that the narration never mentions
  for (const term of card.terms) {
    if (!seen.has(term.toLowerCase()) && spoken.length > 0) {
      add("warning", "glossary", String(spoken[0].id ?? "beat 1"), `The concept card names "${term}" but no beat's narration mentions it.`);
    }
  }

  // the hook: the first beat's first sentence
  if (spoken.length > 0) {
    const first = spoken[0];
    const id = String(first.id ?? "beat 1");
    const lead = splitSentences(first.vo as string)[0] ?? "";
    if (/^\s*in this video\b/i.test(lead)) {
      add("error", "hook", id, `The script opens "in this video". Open on a question or a surprising fact, not a promise of what is coming.`);
    } else if (!lead.trim().endsWith("?") && !/\d/.test(lead) && !NUMBER_WORDS.test(lead)) {
      add("warning", "hook", id, `The first sentence is neither a question nor does it hold a number. The hook is a question or a surprising fact.`);
    }
  }

  // the end: a check question
  if (spoken.length > 0) {
    const last = spoken[spoken.length - 1];
    const lastSentence = splitSentences(last.vo as string).slice(-1)[0] ?? "";
    if (!lastSentence.trim().endsWith("?")) {
      add("error", "closing-question", String(last.id ?? "last beat"), `The last beat does not end with a question. End with a one-line recap, then a check question the viewer can answer in their head.`);
    }
  }

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
    throw new Error("The concept card must be { goal: string, terms: string[], example: string }.");
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
        "src/videos/<videoName>/beats.json and concept.json ({ goal, terms: string[], example }, next to it), or the " +
        "beatsJson and conceptCard inputs. Returns { ok, beatsChecked, findings } where each finding has a severity " +
        "(error, warning or note), the check, and the beat it points at. Checks: average sentence length per beat " +
        "(warning above 16 words), Flesch-Kincaid reading level per beat (warning above grade 9), each concept-card " +
        "term used with a definition beside it at first mention (note), more than two new terms in a beat (warning), " +
        "every Equation's `spoken` string present in its beat's narration (error; the scene is read from the beat's " +
        "scene path or scenes/<BeatId>.tsx), a hook in the first sentence that is a question or holds a number and " +
        "does not open \"in this video\" (error for that opener, warning otherwise), words per second against the " +
        "beat length using validate_beats' own budget (error), and a last beat that ends with a question (error). " +
        "ok is false only when a finding is an error. See SCRIPT.md's lesson script rules.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        beatsJson: z.unknown().optional().describe("The beats file as an object, instead of reading beats.json."),
        conceptCard: z
          .object({ goal: z.string(), terms: z.array(z.string()), example: z.string() })
          .optional()
          .describe("The concept card, instead of reading concept.json."),
      },
    },
    async (input) => runTool("check_script", () => runCheckScript(input)),
  );
}

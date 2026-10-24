import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, pascalCase } from "../util";
import { loadConfig, productionMode } from "../config";
import { runTool } from "./mcp";
import { readExistingMusicLayer } from "./stitchComposition";

/**
 * write_brief (the real, now-registered tool) writes brief.json with a shotList, not a flat
 * sampleContent array: each shot carries `real` (boolean) plus `provenance` (which real
 * capture/tool's output, or what was constructed instead) and, when `real` is false,
 * `whyConstructed`. A shot with `real: false` is exactly the thing this tool must disclose.
 * write_brief's full shape (creativeLevel, storyDevice, arc, designSystem, music, and so on)
 * is validated by write_brief itself and is not re-validated here; readBrief below only pulls
 * beatId/real/provenance/whyConstructed off each shotList entry, the same way every other
 * tool in this package reads JSON off disk (cast to Record<string, unknown>, checked by hand).
 *
 * A disclosure-worthy shot: already filtered to real === false, with both strings confirmed present.
 */
interface ConstructedShot {
  beatId: string;
  provenance: string;
  whyConstructed: string;
}

export interface WriteDescriptionInput {
  projectRoot?: string;
  videoName: string;
}

export interface WriteDescriptionResult {
  written: true;
  path: string;
  /** beatIds whose sample-content disclosure was written and round-trip verified against the file on disk. */
  sampleContentDisclosed: string[];
  /** The YouTube chapter lines written ("0:00 Hook"), or [] when the video is too short to have chapters. */
  chapters: string[];
  /** Credit lines written, so a caller can show them without re-reading the file. */
  credits: string[];
  /** Lesson with a practiceQuestion and an answer: the ANSWER.md written next to the description (the pinned comment). Absent otherwise. */
  answerPath?: string;
  /** Lesson with a practiceQuestion and an answer: the question put in the description. Absent otherwise. */
  practiceQuestion?: string;
  /** The config's `disclaimers` appended to a lesson description, each once, in order. Absent when none were. */
  disclaimers?: string[];
}

/** A lesson's practice question, read from its concept card. The answer never goes into the description. */
interface PracticeQuestion {
  question: string;
  answer: string;
  /** One line of working for the pinned comment. Optional on the card. */
  working?: string;
}

/** YouTube lists chapters only when there are at least three and each is at least ten seconds. */
export const MIN_CHAPTERS = 3;
export const MIN_CHAPTER_SECONDS = 10;

interface BriefLike {
  logline?: string;
  audience?: string;
  feeling?: string;
  constructedShots: ConstructedShot[];
  /** True for a Supernova lesson's brief (`mode: "supernova"`). */
  lesson?: boolean;
}

interface BeatLike {
  id: string;
  duration: number;
  vo: string;
  /** An optional human title for the beat's chapter. Without it the beat id is made readable. */
  chapter?: string;
}

/**
 * Reads brief.json if present. Absence is normal, not an error: a literal/quick video can skip
 * write_brief entirely, and this tool must still work without it (just without logline/audience/
 * feeling/shot-disclosure framing).
 *
 * Presence with a malformed shotList entry is not tolerated the same way: silently skipping a
 * shot this tool can't classify as real or constructed would be exactly the silent-disclosure-
 * loss this tool exists to prevent, so a shape violation throws instead of being filtered out
 * quietly. Only shots with real === false are collected; a shot with real === true needs no
 * disclosure and its provenance/focalPoint are write_brief's concern, not read here.
 */
function readBrief(projectRoot: string, videoName: string): BriefLike | undefined {
  const briefPath = path.join(projectRoot, "src", "videos", videoName, "brief.json");
  if (!fs.existsSync(briefPath)) return undefined;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(briefPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse ${briefPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const logline = typeof raw.logline === "string" && raw.logline.trim().length > 0 ? raw.logline.trim() : undefined;
  const audience = typeof raw.audience === "string" && raw.audience.trim().length > 0 ? raw.audience.trim() : undefined;
  const feeling = typeof raw.feeling === "string" && raw.feeling.trim().length > 0 ? raw.feeling.trim() : undefined;

  const constructedShots: ConstructedShot[] = [];
  // A lesson is constructed on purpose, all of it: there is no real product being imitated, so there is
  // no per-shot disclosure to collect (the description carries one line saying so instead).
  const lesson = raw.mode === "supernova";
  if (!lesson && raw.shotList !== undefined) {
    if (!Array.isArray(raw.shotList)) {
      throw new Error(`${briefPath}: "shotList" must be an array if present.`);
    }
    const rawShots = raw.shotList as unknown[];
    rawShots.forEach((shot, i) => {
      if (typeof shot !== "object" || shot === null) {
        throw new Error(`${briefPath}: shotList[${i}] is not an object.`);
      }
      const s = shot as Record<string, unknown>;
      if (typeof s.beatId !== "string" || s.beatId.length === 0) {
        throw new Error(`${briefPath}: shotList[${i}] is missing a valid "beatId".`);
      }
      if (typeof s.real !== "boolean") {
        // Can't safely treat an unclassified shot as real (that would silently skip a
        // disclosure it might owe), so this is a hard error rather than a default.
        throw new Error(`${briefPath}: shotList[${i}] ("${s.beatId}") is missing a boolean "real".`);
      }
      if (s.real === true) return; // A real capture needs no disclosure.

      if (typeof s.provenance !== "string" || s.provenance.trim().length === 0) {
        throw new Error(`${briefPath}: shotList[${i}] ("${s.beatId}", real: false) is missing "provenance".`);
      }
      if (typeof s.whyConstructed !== "string" || s.whyConstructed.trim().length === 0) {
        throw new Error(`${briefPath}: shotList[${i}] ("${s.beatId}", real: false) is missing "whyConstructed".`);
      }
      constructedShots.push({
        beatId: s.beatId,
        provenance: s.provenance.trim(),
        whyConstructed: s.whyConstructed.trim(),
      });
    });
  }

  // sampleContent: beats whose real capture is of a sample app, dataset or repo built to be filmed.
  // write_brief documents these as surfacing in the description, so they are disclosed here exactly
  // like a constructed shot. A malformed entry throws for the same reason a malformed shot does.
  if (raw.sampleContent !== undefined) {
    if (!Array.isArray(raw.sampleContent)) {
      throw new Error(`${briefPath}: "sampleContent" must be an array if present.`);
    }
    (raw.sampleContent as unknown[]).forEach((entry, i) => {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`${briefPath}: sampleContent[${i}] is not an object.`);
      }
      const e = entry as Record<string, unknown>;
      for (const key of ["beatId", "whatItIs", "whyConstructed"] as const) {
        if (typeof e[key] !== "string" || (e[key] as string).trim().length === 0) {
          throw new Error(`${briefPath}: sampleContent[${i}] is missing "${key}".`);
        }
      }
      constructedShots.push({
        beatId: (e.beatId as string).trim(),
        provenance: (e.whatItIs as string).trim(),
        whyConstructed: (e.whyConstructed as string).trim(),
      });
    });
  }

  return { logline, audience, feeling, constructedShots, ...(lesson ? { lesson: true } : {}) };
}

/**
 * A lesson's concept card (src/videos/<video>/concept.json) gives the practice question and its answer. Absence is
 * normal: most lessons have no practice question, and then nothing here changes. It counts only when both the question
 * and the answer are there, because a question with no answer to withhold is just a line in the narration.
 */
function readPractice(projectRoot: string, videoName: string): PracticeQuestion | undefined {
  const file = path.join(projectRoot, "src", "videos", videoName, "concept.json");
  if (!fs.existsSync(file)) return undefined;
  let card: Record<string, unknown>;
  try {
    card = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = (v: unknown) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);
  const question = text(card.practiceQuestion);
  const answer = text(card.answer);
  if (!question || !answer) return undefined;
  return { question, answer, working: text(card.answerWorking) };
}

/** The pinned comment: the answer, and one line of working when the card has it. */
function buildAnswer(practice: PracticeQuestion): string {
  const lines = [`Answer: ${practice.answer}`];
  if (practice.working) lines.push(`Working: ${practice.working}`);
  return lines.join("\n") + "\n";
}

/**
 * Reads beats.json for the real beat list. Required, unlike brief.json: without it there is
 * nothing to ground the description in, which is the entire point of this tool.
 */
function readBeats(projectRoot: string, videoName: string): { fps: number; beats: BeatLike[] } {
  const beatsPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`No beats.json at ${beatsPath}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as { fps?: number; beats?: unknown };
  const fps = typeof doc.fps === "number" && doc.fps > 0 ? doc.fps : 30;
  if (!Array.isArray(doc.beats)) {
    throw new Error(`${beatsPath}: "beats" must be an array.`);
  }
  const rawBeats = doc.beats as unknown[];
  const beats: BeatLike[] = rawBeats.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`${beatsPath}: beat[${i}] is not an object.`);
    }
    const b = raw as Record<string, unknown>;
    return {
      id: typeof b.id === "string" && b.id.length > 0 ? b.id : `beat-${i}`,
      duration: typeof b.duration === "number" && b.duration > 0 ? b.duration : 0,
      vo: typeof b.vo === "string" ? b.vo : "",
      chapter: typeof b.chapter === "string" && b.chapter.trim().length > 0 ? b.chapter.trim() : undefined,
    };
  });
  return { fps, beats };
}

/** "demo-search" -> "Demo search". A beat id is a slug, not a title, but it is the only name a beat has by default. */
export function humanizeBeatId(id: string): string {
  const spaced = id.replace(/[-_]+/g, " ").trim();
  return spaced.length === 0 ? id : spaced[0]!.toUpperCase() + spaced.slice(1);
}

/** 75 -> "1:15", 3725 -> "1:02:05". YouTube reads m:ss, or h:mm:ss from an hour on. */
export function chapterTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export interface Chapter {
  seconds: number;
  label: string;
}

/**
 * Chapters from the real beats, in YouTube's terms: the first at 0:00, each at least ten seconds,
 * at least three of them. Beats are merged forward into one chapter until it reaches ten seconds
 * (named after its first beat), and a short tail folds into the chapter before it, so a video of
 * many two-second beats still gets sensible chapters. Fewer than three chapters means YouTube
 * would ignore the list, so none are written and the caller says why instead.
 */
export function buildChapters(beats: BeatLike[], fps: number): { chapters: Chapter[]; skippedBecause?: string } {
  const timed = beats.filter((b) => b.duration > 0);
  const groups: { start: number; length: number; label: string }[] = [];
  let cursor = 0;
  for (const beat of timed) {
    const seconds = beat.duration / fps;
    const open = groups[groups.length - 1];
    if (open && open.length < MIN_CHAPTER_SECONDS) {
      open.length += seconds;
    } else {
      groups.push({ start: cursor, length: seconds, label: beat.chapter ?? humanizeBeatId(beat.id) });
    }
    cursor += seconds;
  }
  const last = groups[groups.length - 1];
  if (groups.length > 1 && last && last.length < MIN_CHAPTER_SECONDS) {
    groups.pop();
    groups[groups.length - 1]!.length += last.length;
  }
  const totalSeconds = cursor;
  if (groups.length < MIN_CHAPTERS) {
    return {
      chapters: [],
      skippedBecause:
        `YouTube lists chapters only when there are at least ${MIN_CHAPTERS} and each is ${MIN_CHAPTER_SECONDS} seconds or more, and this ` +
        `${totalSeconds.toFixed(0)}-second video makes ${groups.length}.`,
    };
  }
  return { chapters: groups.map((g) => ({ seconds: g.start, label: g.label })) };
}

/**
 * The credit lines this video actually owes, read from what is on disk rather than assumed:
 * the tool, the music (generated, imported with its provenance, or built in), narration, and any
 * sound effect whose licence asks for a credit (ATTRIBUTION.md, which plan_sound_effects writes).
 */
function buildCredits(projectRoot: string, videoName: string, beats: BeatLike[]): string[] {
  const credits: string[] = [
    "Made with openvidstudio (https://github.com/AnayDhawan/openvidstudio), an open-source video pipeline for software projects.",
  ];

  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  const layer = readExistingMusicLayer(path.join(videoDir, `${pascalCase(videoName)}Demo.tsx`));
  if (layer) {
    const audioDir = path.join(projectRoot, "public", "audio");
    const stem = layer.file.replace(/\.[^.]+$/, "");
    const readJson = (file: string): Record<string, unknown> | null => {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const provenance = readJson(path.join(audioDir, `${layer.file}.source.json`));
    const cues = readJson(path.join(audioDir, `${stem}.cues.json`));
    if (provenance && typeof provenance.title === "string") {
      const repo = typeof provenance.sourceRepo === "string" ? ` from ${provenance.sourceRepo}` : "";
      const licence = typeof provenance.licence === "string" ? ` (${provenance.licence})` : "";
      credits.push(`Music: "${provenance.title}"${repo}${licence}.`);
    } else if (cues?.source === "generated") {
      credits.push("Music: an original score composed for this video with openvidstudio's compose_score. Pure synthesis, no samples, nothing to license.");
    } else if (layer.file === "music-bed.mp3") {
      credits.push("Music: a bed synthesized by openvidstudio's built-in generator. No samples, nothing to license.");
    } else {
      credits.push(`Music: ${layer.file} (its source was not recorded in this project, so add the credit by hand).`);
    }
  }

  if (beats.some((b) => b.vo.trim().length > 0)) {
    try {
      const { engine, voice } = loadConfig(projectRoot).narration;
      credits.push(`Narration: synthesized speech (${engine}, voice ${voice}).`);
    } catch {
      credits.push("Narration: synthesized speech.");
    }
  }

  const attribution = path.join(projectRoot, "public", "imported_audios", "ATTRIBUTION.md");
  if (fs.existsSync(attribution)) {
    const rows = fs
      .readFileSync(attribution, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("| ") && !l.startsWith("| File") && !/^\|[-| ]+\|$/.test(l))
      .map((l) => l.split("|").map((c) => c.trim()).filter(Boolean))
      .filter((cols) => cols.length >= 2);
    for (const cols of rows) {
      const [file, source, author, licence] = cols;
      credits.push(`Sound effect ${file}: ${[source, author, licence].filter(Boolean).join(", ")}. The licence asks for this credit.`);
    }
  }
  return credits;
}

/** ["a"] -> "a", ["a", "b"] -> "a and b", ["a", "b", "c"] -> "a, b and c". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function formatSeconds(frames: number, fps: number): string {
  const rounded = Math.round((frames / fps) * 10) / 10;
  return rounded % 1 === 0 ? `${rounded}s` : `${rounded.toFixed(1)}s`;
}

/**
 * Builds the markdown body. Pure string assembly, no LLM call: this server doesn't call one for
 * any tool, so "drafting" here means template logic over real facts (brief fields, real beats),
 * never invented content.
 */
function buildDescription(
  videoName: string,
  brief: BriefLike | undefined,
  beatsData: { fps: number; beats: BeatLike[] },
  chapters: { chapters: Chapter[]; skippedBecause?: string },
  credits: string[],
  lesson = false,
  practice?: PracticeQuestion,
  disclaimers: string[] = [],
): string {
  const { fps, beats } = beatsData;
  const totalFrames = beats.reduce((sum, b) => sum + b.duration, 0);
  const lines: string[] = [`# ${videoName}`, ""];

  const firstVo = beats.find((b) => b.vo.trim().length > 0)?.vo.trim();
  if (brief?.logline) {
    lines.push(brief.logline);
  } else if (firstVo) {
    lines.push(firstVo);
  } else {
    lines.push(`${videoName}: ${beats.length} beat${beats.length === 1 ? "" : "s"}, no narration recorded yet.`);
  }
  lines.push("");

  lines.push(
    `Length: ${formatSeconds(totalFrames, fps)} across ${beats.length} beat${beats.length === 1 ? "" : "s"}.`,
  );
  if (brief?.audience) {
    lines.push(`Made for: ${brief.audience}.`);
  }
  if (brief?.feeling) {
    lines.push(`Intended feeling: ${brief.feeling}.`);
  }
  lines.push("");

  if (chapters.chapters.length > 0) {
    lines.push("## Chapters");
    lines.push("");
    for (const c of chapters.chapters) lines.push(`${chapterTimestamp(c.seconds)} ${c.label}`);
    lines.push("");
  } else if (chapters.skippedBecause) {
    lines.push(`Chapters left out: ${chapters.skippedBecause}`);
    lines.push("");
  }

  if (beats.length > 0) {
    lines.push("## What this video shows");
    lines.push("");
    for (const beat of beats) {
      const narration = beat.vo.trim().length > 0 ? beat.vo.trim() : "(no narration recorded for this beat)";
      lines.push(`- **${beat.id}** (${formatSeconds(beat.duration, fps)}): ${narration}`);
    }
    lines.push("");
  }

  const constructedShots = brief?.constructedShots ?? [];
  if (lesson) {
    // Replaces the sample-content disclosure: everything in a lesson is drawn for it.
    lines.push("This video is a constructed explanation, not footage.");
    lines.push("");
    if (practice) {
      lines.push("## Practice question");
      lines.push("");
      lines.push(practice.question);
      lines.push("");
      lines.push("Drop your answer in the comments.");
      lines.push("");
    }
  } else if (constructedShots.length > 0) {
    lines.push("## Sample content used in this video");
    lines.push("");
    // One sentence per distinct disclosure: six beats filmed from the same sample app are one fact
    // told once, with every beat named, not the same sentence six times.
    const groups = new Map<string, { provenance: string; whyConstructed: string; beatIds: string[] }>();
    for (const shot of constructedShots) {
      const key = `${shot.provenance}\u0000${shot.whyConstructed}`;
      const group = groups.get(key) ?? { provenance: shot.provenance, whyConstructed: shot.whyConstructed, beatIds: [] };
      if (!group.beatIds.includes(shot.beatId)) group.beatIds.push(shot.beatId);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const names = group.beatIds.length === 1 ? `The ${group.beatIds[0]} segment` : `The ${joinNames(group.beatIds)} segments`;
      lines.push(
        `${names} ${group.beatIds.length === 1 ? "shows" : "show"} ${group.provenance}. It was built specifically for ` +
          `this video, not captured from the real product, because ${group.whyConstructed}.`,
      );
      lines.push("");
    }
  }

  lines.push("## Credits");
  lines.push("");
  for (const c of credits) lines.push(`- ${c}`);
  lines.push("");

  // Last, each line once: a line the description already carries on its own is not repeated.
  const body = new Set(lines.map((l) => l.trim()));
  const added = disclaimers.filter((d) => !body.has(d));
  for (const d of added) lines.push(d);
  if (added.length > 0) lines.push("");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Writes output/<videoName>-DESCRIPTION.md and refuses to report success if a constructed
 * shot's disclosure went missing from the file it just wrote (see the round-trip check below).
 * See ShotListEntry/readBrief above for the brief.json shape this reads.
 */
export function runWriteDescription(input: WriteDescriptionInput): WriteDescriptionResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const brief = readBrief(projectRoot, videoName);
  const beatsData = readBeats(projectRoot, videoName);

  const chapters = buildChapters(beatsData.beats, beatsData.fps);
  const credits = buildCredits(projectRoot, videoName, beatsData.beats);
  const lesson = brief?.lesson === true || productionMode(loadConfig(projectRoot)) === "supernova";
  const practice = lesson ? readPractice(projectRoot, videoName) : undefined;
  const disclaimers = lesson
    ? [...new Set((loadConfig(projectRoot).disclaimers ?? []).map((d) => d.trim()).filter((d) => d.length > 0))]
    : [];
  const content = buildDescription(videoName, brief, beatsData, chapters, credits, lesson, practice, disclaimers);

  const outPath = path.join(projectRoot, "output", `${videoName}-DESCRIPTION.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, "utf8");

  const constructedShots = lesson ? [] : (brief?.constructedShots ?? []);
  if (constructedShots.length > 0) {
    // Round-trip: read back what actually landed on disk and confirm every disclosure survived,
    // rather than trusting the string already held in memory. A dropped disclosure is a bug in
    // buildDescription, not a cosmetic gap, so it throws with the half-written file removed,
    // never a silently "successful" result.
    const writtenBack = fs.readFileSync(outPath, "utf8");
    const missing = constructedShots.filter(
      (shot) => !writtenBack.includes(shot.provenance) || !writtenBack.includes(shot.whyConstructed),
    );
    if (missing.length > 0) {
      try {
        fs.unlinkSync(outPath);
      } catch {
        // Best-effort cleanup only; the error below is the one that matters.
      }
      throw new Error(
        `write_description internal error: the disclosure for ${missing.map((s) => s.beatId).join(", ")} is ` +
          `missing from the file this call just wrote. This is a bug in the description template, not a ` +
          `passing result, so the incomplete file was removed instead of being reported as written.`,
      );
    }
  }

  let answerPath: string | undefined;
  if (practice) {
    answerPath = path.join(projectRoot, "output", `${videoName}-ANSWER.md`);
    fs.writeFileSync(answerPath, buildAnswer(practice), "utf8");
  }

  return {
    written: true,
    path: outPath,
    sampleContentDisclosed: constructedShots.map((s) => s.beatId),
    chapters: chapters.chapters.map((c) => `${chapterTimestamp(c.seconds)} ${c.label}`),
    credits,
    ...(practice && answerPath ? { answerPath, practiceQuestion: practice.question } : {}),
    ...(disclaimers.length > 0 ? { disclaimers } : {}),
  };
}

export function registerWriteDescription(server: McpServer): void {
  server.registerTool(
    "write_description",
    {
      title: "Write a video's description, with sample content disclosed",
      description:
        "Writes output/<videoName>-DESCRIPTION.md: a short description of the video grounded in its real " +
        "beats.json (beat list and narration, never invented), plus brief.json's logline/audience/feeling if " +
        "that file exists. brief.json is optional -- a literal/quick video that skipped write_brief works " +
        "fine without one -- but beats.json is required, since there is otherwise nothing to describe. " +
        "brief.json's shotList carries the real/constructed split: every shot with real: false is disclosed " +
        "in plain language in its own section, naming which beat it is, what was built instead of the real " +
        "product (provenance), and why (whyConstructed). That disclosure is never silently dropped: after " +
        "writing, the tool reads its own output back and throws rather than returning success if any " +
        "constructed shot's disclosure is missing from it, removing the incomplete file instead of leaving " +
        "it on disk. The file is YouTube-ready: a Chapters list built from the beats (first at 0:00, each at " +
        "least ten seconds, merging short beats forward; a beat may carry an optional `chapter` title, " +
        "otherwise its id is made readable; under three chapters it says why they were left out instead of " +
        "writing a list YouTube would ignore), and a Credits section read from what is on disk: the tool, " +
        "the music (an original compose_score track, an imported CC0 track with its source, or the built-in " +
        "bed), narration engine and voice, and any sound effect whose licence asks for a credit. " +
        "For a lesson (Supernova mode) whose concept card (src/videos/<videoName>/concept.json) has a practiceQuestion " +
        "and an answer, the description gains a Practice question section with the question and the line " +
        "\"Drop your answer in the comments.\", and the answer goes only to output/<videoName>-ANSWER.md (a ready-to-paste " +
        "pinned comment: the answer, plus a line of working from the card's optional answerWorking), returned as answerPath. " +
        "The `disclaimers` string array in openvidstudio.config.json is appended to every lesson description, each line " +
        "once, at the end. A project without these fields gets the same file as before. " +
        "finalize_video writes this file on every run, so a finished video always has one.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
      },
    },
    async (input) => runTool("write_description", () => runWriteDescription(input)),
  );
}

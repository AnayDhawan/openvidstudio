import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import { runTool } from "./mcp";
import { MAX_PACE, MIN_PACE, validateBeatsLogic, wordCount, type ValidateBeatsResult } from "./validateBeats";
import { probeDuration, TEMPO_CEIL } from "./generateNarration";

/**
 * Sizes each beat from the measured voice. A real voice does not read at the pace a word count predicts
 * (plain prose is about 3 words per second, number-heavy lines about 2.2), and validate_beats wants 2.3 to
 * 2.9 words per second over the beat, so a beat sized by words alone overruns or sits half empty. The fix
 * used to be a manual loop: provisional beats, generate_narration, read every spokenSeconds, compute new
 * lengths in a script, rewrite beats.json, generate again. This is that loop's middle.
 *
 * Only `duration` and, to keep the beats contiguous, `start` change. The `vo` is never touched.
 */

/** Silence kept after the voice, so a line does not end on the cut. */
export const DEFAULT_FIT_PAD_SECONDS = 0.5;

export interface FitBeatsInput {
  projectRoot?: string;
  videoName: string;
  /** Spoken length of each beat's clip in seconds, as generate_narration reports it. Overrides the clips on disk. */
  spokenSeconds?: Record<string, number>;
  /** generate_narration's result (only `written[].beatId` and `.spokenSeconds` are read). Same as spokenSeconds. */
  narration?: { written?: { beatId: string; spokenSeconds: number; language?: string }[] };
  /** Seconds of silence after the spoken line. Default 0.5. */
  padSeconds?: number;
  /** Return the proposed durations without writing beats.json. */
  dryRun?: boolean;
}

export interface FittedBeat {
  beatId: string;
  /** Duration in frames before and after. */
  before: number;
  after: number;
  words: number;
  /** The measured spoken length, and where it came from. */
  spokenSeconds: number | null;
  source: "report" | "raw-clip" | "final-clip" | null;
  /** Words per second over the new beat length. */
  pace: number | null;
  status: "fitted" | "unchanged" | "unfittable" | "skipped";
  /** "min" or "max" when the pace window, not the voice, decided the length. */
  clampedTo?: "min" | "max";
  note?: string;
}

export interface FitBeatsResult {
  videoName: string;
  dryRun: boolean;
  written: boolean;
  path: string;
  beats: FittedBeat[];
  /** Beats whose line cannot fit inside the pace window: shorten the sentence, or lengthen the beat past it. */
  unfittable: FittedBeat[];
  /** Total frames before and after. */
  framesBefore: number;
  framesAfter: number;
  /** validate_beats run on the fitted beats. */
  validation: ValidateBeatsResult;
}

interface BeatDoc {
  fps?: number;
  narration?: string;
  beats: { id: string; start: number; duration: number; vo?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

/** Pure: the frames a line of `words` words, said in `spoken` seconds, should get. */
export function fitFrames(words: number, spoken: number, fps: number, pad: number): { frames: number; clampedTo?: "min" | "max"; overruns: boolean } {
  const lo = Math.ceil((words / MAX_PACE) * fps - 1e-9);
  const hi = Math.floor((words / MIN_PACE) * fps + 1e-9);
  const wanted = Math.round((spoken + pad) * fps);
  let frames = wanted;
  let clampedTo: "min" | "max" | undefined;
  if (frames < lo) {
    frames = lo;
    clampedTo = "min";
  } else if (frames > hi && hi >= lo) {
    frames = hi;
    clampedTo = "max";
  }
  // The clip is stretched by at most TEMPO_CEIL, so a beat shorter than that cannot hold it.
  const overruns = frames / fps < spoken / TEMPO_CEIL - 1e-9;
  return { frames, clampedTo, overruns };
}

function spokenFromDisk(projectRoot: string, beatId: string): { seconds: number; source: "raw-clip" | "final-clip" } | null {
  const raw = path.join(projectRoot, ".openvidstudio", "narration", `${beatId}.raw`);
  if (fs.existsSync(raw)) {
    const s = probeDuration(raw);
    if (s > 0) return { seconds: s, source: "raw-clip" };
  }
  // The fitted clip has been stretched by an unknown tempo, so it is an estimate, and said to be one.
  const finalClip = path.join(projectRoot, "public", "audio", "vo", `${beatId}.mp3`);
  if (fs.existsSync(finalClip)) {
    const s = probeDuration(finalClip);
    if (s > 0) return { seconds: s, source: "final-clip" };
  }
  return null;
}

export function runFitBeats(input: FitBeatsInput): FitBeatsResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const beatsFile = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsFile)) throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as BeatDoc;
  const fps = doc.fps && doc.fps > 0 ? doc.fps : 30;
  const pad = input.padSeconds ?? DEFAULT_FIT_PAD_SECONDS;
  const silent = doc.narration === "none";

  const reported = new Map<string, number>();
  for (const clip of input.narration?.written ?? []) {
    if (clip.language === undefined || clip.language === "en" || !reported.has(clip.beatId)) reported.set(clip.beatId, clip.spokenSeconds);
  }
  for (const [id, seconds] of Object.entries(input.spokenSeconds ?? {})) reported.set(id, seconds);
  const unknown = [...reported.keys()].filter((id) => !doc.beats.some((b) => b.id === id));
  if (unknown.length > 0) throw new Error(`spokenSeconds names beats that are not in beats.json: ${unknown.join(", ")}.`);

  const fitted: FittedBeat[] = [];
  let shift = 0;
  const next = doc.beats.map((beat) => {
    const words = wordCount(beat.vo ?? "");
    const base: FittedBeat = { beatId: beat.id, before: beat.duration, after: beat.duration, words, spokenSeconds: null, source: null, pace: null, status: "skipped" };
    const moved = { ...beat, start: beat.start + shift };
    const skip = (note: string) => {
      fitted.push({ ...base, note });
      return moved;
    };
    if (silent) return skip(`narration is "none", so there is no voice to fit.`);
    if (words === 0) return skip("no vo on this beat.");

    let spoken: number | null = null;
    let source: FittedBeat["source"] = null;
    const given = reported.get(beat.id);
    if (given !== undefined) {
      spoken = given;
      source = "report";
    } else {
      const disk = spokenFromDisk(projectRoot, beat.id);
      if (disk) {
        spoken = disk.seconds;
        source = disk.source;
      }
    }
    if (spoken === null || !(spoken > 0)) return skip("no measured voice for this beat. Run generate_narration first, or pass spokenSeconds.");

    const fit = fitFrames(words, spoken, fps, pad);
    const entry: FittedBeat = {
      ...base,
      after: fit.frames,
      spokenSeconds: Number(spoken.toFixed(2)),
      source,
      pace: Number((words / (fit.frames / fps)).toFixed(2)),
      status: fit.frames === beat.duration ? "unchanged" : "fitted",
      ...(fit.clampedTo ? { clampedTo: fit.clampedTo } : {}),
    };
    if (source === "final-clip") {
      entry.note = "Measured from the fitted clip, which generate_narration has already stretched, so this is an estimate. Run generate_narration with overwrite to measure the raw voice.";
    }
    if (fit.overruns) {
      entry.status = "unfittable";
      const maxWords = Math.max(1, Math.floor(((fit.frames / fps) * TEMPO_CEIL * words) / spoken));
      const needSeconds = spoken / TEMPO_CEIL;
      entry.note =
        `The voice needs ${spoken.toFixed(2)}s (${needSeconds.toFixed(2)}s at the fastest natural stretch), but ${words} words only ` +
        `allow a beat of ${(fit.frames / fps).toFixed(2)}s at ${MIN_PACE} words/sec. Shorten this line to about ${maxWords} words or fewer, ` +
        `or lengthen the beat to ${Math.ceil(needSeconds * fps)} frames and accept a pace under ${MIN_PACE} words/sec (validate_beats will say so).`;
      // Closest legal length, so the rest of the lesson still lines up; the finding is the report.
    } else if (fit.clampedTo === "min") {
      entry.note = `The voice is quicker than ${MAX_PACE} words/sec, so the beat was held at ${(fit.frames / fps).toFixed(2)}s, the shortest the pace window allows. Add words to the line if the gap is noticeable.`;
    } else if (fit.clampedTo === "max") {
      entry.note = `The voice would take longer than the ${MIN_PACE} words/sec window, so the beat was held at ${(fit.frames / fps).toFixed(2)}s, the longest it allows.`;
    }
    fitted.push(entry);
    shift += fit.frames - beat.duration;
    return { ...moved, duration: fit.frames };
  });

  const fittedDoc: BeatDoc = { ...doc, beats: next };
  const validation = validateBeatsLogic(fittedDoc);
  const dryRun = input.dryRun === true;
  const framesBefore = doc.beats.reduce((n, b) => n + b.duration, 0);
  const framesAfter = next.reduce((n, b) => n + b.duration, 0);
  const changed = fitted.some((b) => b.after !== b.before);
  // A beats.json that would not change is left alone.
  let written = false;
  if (!dryRun && changed) {
    fs.writeFileSync(beatsFile, JSON.stringify(fittedDoc, null, 2) + "\n", "utf8");
    written = true;
  }
  return {
    videoName,
    dryRun,
    written,
    path: beatsFile,
    beats: fitted,
    unfittable: fitted.filter((b) => b.status === "unfittable"),
    framesBefore,
    framesAfter,
    validation,
  };
}

export function registerFitBeats(server: McpServer): void {
  server.registerTool(
    "fit_beats",
    {
      title: "Size the beats from the measured voice",
      description:
        "Sets each beat's duration to the length its narration actually takes, so validate_beats' 2.3 to 2.9 " +
        "words per second holds with a real voice. A voice reads plain prose at about 3 words per second and " +
        "number-heavy lines at about 2.2, so beats sized from word counts overrun or sit half empty; this replaces the " +
        "manual loop of reading generate_narration's spokenSeconds, computing new lengths and rewriting beats.json. " +
        "Run generate_narration on provisional beats first. Each beat becomes the spoken length plus a pad (padSeconds, " +
        "default 0.5), clamped into the pace window words/2.9 to words/2.3 and rounded to whole frames, and later " +
        "beats' start frames move so the beats stay contiguous. The spoken length comes from spokenSeconds or " +
        "generate_narration's result (narration), else the raw clips generate_narration keeps under " +
        ".openvidstudio/narration/, else the fitted clips. Beats whose line cannot fit even at the clamp (the voice " +
        "needs more than 2.3 words per second allows) are listed in unfittable with the number of words to cut or the " +
        "frames to lengthen the beat to; they are set to the longest legal length meanwhile. Never changes vo. dryRun " +
        "returns the proposed durations without writing beats.json. Re-runs validate_beats on the result and returns it as " +
        "validation. After fitting, run generate_narration again (overwrite: true) so the clips are stretched to the new lengths.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        spokenSeconds: z.record(z.string(), z.number().positive()).optional().describe("Beat id to the voice's spoken length in seconds."),
        narration: z
          .object({ written: z.array(z.object({ beatId: z.string(), spokenSeconds: z.number().positive(), language: z.string().optional() }).passthrough()).optional() })
          .passthrough()
          .optional()
          .describe("generate_narration's result, instead of spokenSeconds."),
        padSeconds: z.number().min(0).optional().describe("Silence after the spoken line. Default 0.5."),
        dryRun: z.boolean().optional().describe("Return the proposed durations without writing beats.json."),
      },
    },
    async (input) => runTool("fit_beats", () => runFitBeats(input)),
  );
}

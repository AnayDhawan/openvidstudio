import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import { PY_DIR } from "../paths";
import { runTool } from "./mcp";

/**
 * Narration used to be entirely the caller's problem: PIPELINE.md said "dev
 * provided", stitch_composition read the mp3s if they happened to exist, and that
 * was it. In practice that meant most videos shipped silent, because nobody is going
 * to hand-generate one correctly named clip per beat.
 *
 * Two things this gets right that a naive TTS loop does not.
 *
 * **Pacing.** Every engine reads at its own speed, so a clip rarely lands on its
 * beat. The obvious fix, time-stretching audio to fit, is what makes narration sound
 * artificial: a pitch-preserving stretch past roughly 10% is audible, and at 35% it
 * is the main reason generated voiceover sounds synthetic. So stretching is clamped
 * hard, and when a clip is still outside its beat the mismatch is reported as
 * something to fix in the script or the beat duration instead of being papered over.
 *
 * **Silence.** stitch_composition skips a missing clip with no error, so a half
 * generated narration renders successfully and plays silent in those beats. This
 * reports exactly which beats have audio and which do not.
 *
 * **Languages.** One manifest can ship the video in as many languages as it carries
 * lines for. The translated lines live in the beat, as `voTranslations`, because this
 * server does not call an LLM and does not draft content: a translation is content, it
 * goes through the same agent and the same human approval as the original script did.
 * The base language keeps writing to public/audio/vo/<beatId>.mp3 so nothing that
 * existed before changes; every other language gets its own subdirectory. With the
 * omnivoice engine and a reference clip, all of them are the same cloned voice, which
 * is the difference between a translated video and a dubbed one.
 */

export type NarrationEngine = "edge-tts" | "say" | "espeak" | "omnivoice";

export interface GenerateNarrationInput {
  projectRoot?: string;
  videoName: string;
  engine?: NarrationEngine;
  voice?: string;
  /** Seconds of silence left at the end of a beat so the cut does not clip the last word. */
  padSeconds?: number;
  /** Regenerate clips that already exist. */
  overwrite?: boolean;
  /** Only these beat ids. */
  beatIds?: string[];
  /**
   * Every language to produce. Defaults to the base language alone, which is what every
   * existing project gets without changing anything.
   */
  languages?: string[];
  /** The language `vo` is written in. Everything else comes from `voTranslations`. */
  baseLanguage?: string;
  /** Per-language voice override, for engines whose voices are language-specific. */
  voices?: Record<string, string>;
  /**
   * Fail rather than quietly producing a video that is narrated in one language and silent
   * in another. A half-translated video is worse than an untranslated one: it looks broken
   * to exactly the audience it was made for.
   */
  requireTranslations?: boolean;
  /** omnivoice only: a reference clip to clone, so every language is the same voice. */
  refAudio?: string;
  refText?: string;
  /** omnivoice only: voice design, when there is no clip to clone. */
  instruct?: string;
}

export interface NarrationClip {
  beatId: string;
  language: string;
  path: string;
  beatSeconds: number;
  spokenSeconds: number;
  finalSeconds: number;
  tempo: number;
  /** True when the clip could not be fitted inside its beat without an audible stretch. */
  needsAttention: boolean;
  note?: string;
  /** Where the word timings were written (public/audio/vo/<beatId>.words.json), when the engine gave any. */
  wordsPath?: string;
  wordCount?: number;
}

/** One spoken word and when it is said, in milliseconds from the start of the clip as written. */
export interface NarrationWord {
  word: string;
  startMs: number;
  endMs: number;
}

/**
 * What happened about word timings, said plainly rather than left for the caller to discover: only
 * edge-tts gives word boundaries, and nothing is invented for an engine that does not.
 */
export interface WordTimingsReport {
  /** True when the engine produces word boundaries (edge-tts, through the edge_tts Python module). */
  supported: boolean;
  /** The .words.json files written. */
  written: string[];
  note?: string;
}

export interface LanguageReport {
  language: string;
  voice: string;
  /** Where this language's clips live, relative to the project root. */
  dir: string;
  written: NarrationClip[];
  skipped: string[];
  missing: string[];
  warnings: string[];
}

export interface GenerateNarrationResult {
  engine: NarrationEngine;
  /** The base language's voice. Per-language voices are on each language report. */
  voice: string;
  /** The base language's clips, unchanged in meaning from before languages existed. */
  written: NarrationClip[];
  skipped: string[];
  missing: string[];
  warnings: string[];
  /** Every language produced, including the base. */
  languages: LanguageReport[];
  /** Word timings for scenes that point at the word being spoken (useNarrationWords). See NARRATION.md. */
  wordTimings: WordTimingsReport;
}

/** Beyond this, a pitch-preserving stretch starts to sound processed. */
const TEMPO_FLOOR = 0.9;
const TEMPO_CEIL = 1.12;

const DEFAULT_VOICE: Record<NarrationEngine, string> = {
  "edge-tts": "en-US-AndrewNeural",
  say: "Alex",
  espeak: "en-us",
  // omnivoice is zero-shot: the voice comes from a reference clip or a description, not
  // from a catalogue of named voices, which is exactly why it can cover 600 languages.
  omnivoice: "k2-fsa/OmniVoice",
};

interface BeatLike {
  id: string;
  duration: number;
  vo?: string;
  /** Translated lines, keyed by language tag. Drafted by the agent, approved like any script. */
  voTranslations?: Record<string, string>;
}

const LANGUAGE_TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/;

/** A language tag becomes a directory name, so it is checked before it is joined into a path. */
export function sanitizeLanguage(tag: string): string {
  if (!LANGUAGE_TAG.test(tag)) {
    throw new Error(
      `"${tag}" is not a language tag. Use a BCP-47 tag such as "en", "hi", "pt-BR", which is also what ` +
        `becomes the directory name under public/audio/vo/.`,
    );
  }
  return tag;
}

/** The line for one language: the original for the base, a translation for anything else. */
export function lineFor(beat: BeatLike, language: string, baseLanguage: string): string | undefined {
  if (language === baseLanguage) return beat.vo;
  return beat.voTranslations?.[language];
}

function probeDuration(file: string): number {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" },
  );
  const v = Number.parseFloat((r.stdout ?? "").trim());
  return Number.isFinite(v) ? v : 0;
}

interface OmnivoiceOptions {
  refAudio?: string;
  refText?: string;
  instruct?: string;
}

let edgePython: string | null | undefined;

/**
 * The interpreter that can import edge_tts: the one the `edge-tts` command was installed into (its
 * shebang, which is how pipx and a venv install it), then python3, then python. null when none can,
 * in which case audio still comes from the command line and no word timings are written.
 */
function edgePythonInterpreter(): string | null {
  if (edgePython !== undefined) return edgePython;
  const candidates: string[] = [];
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["edge-tts"], { encoding: "utf8" });
  const binary = which.status === 0 ? (which.stdout ?? "").split(/\r?\n/)[0]?.trim() : "";
  if (binary) {
    try {
      const head = fs.readFileSync(binary, "utf8").slice(0, 200).split("\n")[0] ?? "";
      const m = /^#!\s*(\S+)/.exec(head);
      if (m && !m[1].endsWith("/env")) candidates.push(m[1]);
    } catch {
      // a binary launcher (Windows .exe) has no shebang to read
    }
  }
  candidates.push("python3", "python");
  edgePython = candidates.find((py) => spawnSync(py, ["-c", "import edge_tts"], { encoding: "utf8" }).status === 0) ?? null;
  return edgePython;
}

function readWords(file: string): NarrationWord[] | null {
  try {
    const words = JSON.parse(fs.readFileSync(file, "utf8")) as NarrationWord[];
    return Array.isArray(words) && words.length > 0 ? words : null;
  } catch {
    return null;
  }
}

/** The last non-empty line of a process's stderr, trimmed to something a warning can carry. */
export function lastErrorLine(stderr: string | undefined | null): string {
  const lines = (stderr ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines[lines.length - 1] ?? "";
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

/** Runs the edge-tts command, or its Python module when the command is not on PATH. */
function runEdgeTts(args: string[]): SpawnSyncReturns<string> {
  const r = spawnSync("edge-tts", args, { encoding: "utf8" });
  return r.error ? spawnSync("python", ["-m", "edge_tts", ...args], { encoding: "utf8" }) : r;
}

export interface EdgeTtsProbe {
  ok: boolean;
  /** The installed version, when it could be read. */
  version?: string;
  /** Present when ok is false: the last stderr line from edge-tts. */
  error?: string;
}

/**
 * Asks edge-tts to speak one short word to a temp file. Microsoft's service refuses connections from
 * some versions of the client (a 403 from speech.platform.bing.com), and the only symptom otherwise is a
 * narration run that fails on every beat.
 */
export function probeEdgeTts(): EdgeTtsProbe {
  const versionRun = runEdgeTts(["--version"]);
  const version = versionRun.error || versionRun.status !== 0 ? undefined : (versionRun.stdout ?? "").trim().split(/\r?\n/)[0] || undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-edge-probe-"));
  const out = path.join(dir, "probe.mp3");
  try {
    const r = runEdgeTts(["--voice", "en-US-AndrewNeural", "--text", "Hello", "--write-media", out]);
    const produced = fs.existsSync(out) && fs.statSync(out).size > 0;
    if (!r.error && r.status === 0 && produced) return { ok: true, version };
    const error = r.error ? r.error.message : lastErrorLine(r.stderr) || `edge-tts exited with status ${r.status} and wrote no audio`;
    return { ok: false, version, error };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function synthesize(
  engine: NarrationEngine,
  voice: string,
  text: string,
  out: string,
  omni: OmnivoiceOptions = {},
  wordsOut?: string,
): { ok: boolean; error?: string; words?: NarrationWord[] } {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    fs.rmSync(out, { force: true });
    let r;
    if (engine === "edge-tts" && wordsOut !== undefined && edgePythonInterpreter() !== null) {
      fs.rmSync(wordsOut, { force: true });
      r = spawnSync(
        edgePythonInterpreter() as string,
        [path.join(PY_DIR, "edge-words.py"), "--voice", voice, "--text", text, "--out", out, "--words", wordsOut],
        { encoding: "utf8" },
      );
      if (!r.error && r.status === 0 && fs.existsSync(out) && probeDuration(out) > 0.3) {
        return { ok: true, words: readWords(wordsOut) ?? undefined };
      }
      lastError = lastErrorLine(r.stderr) || lastError;
      // fall through to the plain command line, which gives audio and no timings
    }
    if (engine === "edge-tts") {
      r = spawnSync("edge-tts", ["--voice", voice, "--text", text, "--write-media", out], {
        encoding: "utf8",
      });
      if (r.error) {
        // Not on PATH as a binary in every install; the module entrypoint always is.
        r = spawnSync(
          "python",
          ["-m", "edge_tts", "--voice", voice, "--text", text, "--write-media", out],
          { encoding: "utf8" },
        );
      }
    } else if (engine === "omnivoice") {
      // Zero-shot across 600+ languages, so the same call synthesizes every language with
      // no per-language voice to pick. With ref_audio it is the same cloned voice in all
      // of them, which is what makes a set of translations read as one narrator.
      const args = ["--model", voice, "--text", text, "--output", out];
      if (omni.refAudio) args.push("--ref_audio", omni.refAudio);
      if (omni.refText) args.push("--ref_text", omni.refText);
      if (omni.instruct) args.push("--instruct", omni.instruct);
      r = spawnSync("omnivoice-infer", args, { encoding: "utf8" });
      if (r.error) {
        r = spawnSync("python", ["-m", "omnivoice.cli.infer", ...args], { encoding: "utf8" });
      }
    } else if (engine === "say") {
      r = spawnSync("say", ["-v", voice, "-o", out, "--data-format=LEF32@22050", text], {
        encoding: "utf8",
      });
    } else {
      r = spawnSync("espeak", ["-v", voice, "-w", out, text], { encoding: "utf8" });
    }
    // A size check alone is not enough: a truncated download can clear it and still
    // be undecodable, so this validates by actually probing the file.
    if (!r.error && fs.existsSync(out) && probeDuration(out) > 0.3) return { ok: true };
    lastError = (r.error ? r.error.message : lastErrorLine(r.stderr)) || lastError;
  }
  const cause = lastError ? ` (${lastError})` : "";
  const hint = engine === "edge-tts" && lastError ? " Run preflight to check edge-tts; pip install -U edge-tts often fixes a refused connection." : "";
  return { ok: false, error: `no usable audio after 3 attempts${cause}.${hint}` };
}

export function runGenerateNarration(input: GenerateNarrationInput): GenerateNarrationResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const engine: NarrationEngine = input.engine ?? "edge-tts";
  const pad = input.padSeconds ?? 0.45;
  const baseLanguage = sanitizeLanguage(input.baseLanguage ?? "en");
  const languages = (input.languages?.length ? input.languages : [baseLanguage]).map(sanitizeLanguage);
  if (!languages.includes(baseLanguage)) languages.unshift(baseLanguage);

  const beatsFile = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsFile)) {
    throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { fps: number; beats: BeatLike[] };
  const fps = doc.fps || 30;

  const workDir = path.join(projectRoot, ".openvidstudio", "narration");
  fs.mkdirSync(workDir, { recursive: true });
  const omni: OmnivoiceOptions = { refAudio: input.refAudio, refText: input.refText, instruct: input.instruct };

  // Checked before anything is synthesized. Finding out that Hindi is missing three lines
  // after twenty minutes of TTS is worse than finding out immediately, and the fix (write
  // the lines) is the same either way.
  if (input.requireTranslations === true) {
    const gaps: string[] = [];
    for (const language of languages) {
      for (const beat of doc.beats) {
        if (input.beatIds && !input.beatIds.includes(beat.id)) continue;
        const line = lineFor(beat, language, baseLanguage);
        if (!line || !line.trim()) gaps.push(`${language}/${beat.id}`);
      }
    }
    if (gaps.length > 0) {
      throw new Error(
        `Missing narration lines for: ${gaps.join(", ")}. requireTranslations is on, so this fails rather ` +
          `than shipping a video narrated in one language and silent in another, which looks broken to ` +
          `exactly the audience it was made for.`,
      );
    }
  }

  const reports: LanguageReport[] = [];
  const wordTimings: WordTimingsReport = { supported: engine === "edge-tts", written: [] };
  if (engine !== "edge-tts") {
    wordTimings.note = `${engine} gives no word boundaries, so no .words.json files were written and none were invented. Only edge-tts does.`;
  } else if (edgePythonInterpreter() === null) {
    wordTimings.supported = false;
    wordTimings.note =
      "No Python interpreter that can import edge_tts was found, so the audio came from the edge-tts command line and no word timings " +
      "were written. Install it with pip (pip install edge-tts) into the interpreter python3 points at, or into the one the edge-tts command uses.";
  }

  for (const language of languages) {
    const isBase = language === baseLanguage;
    // The base language keeps its original path. Moving it into an "en" subdirectory would
    // break every project that already has narration, for no gain.
    const outDirRel = isBase
      ? path.join("public", "audio", "vo")
      : path.join("public", "audio", "vo", language);
    const outDir = path.join(projectRoot, outDirRel);
    fs.mkdirSync(outDir, { recursive: true });

    const voice = input.voices?.[language] ?? input.voice ?? DEFAULT_VOICE[engine];
    const written: NarrationClip[] = [];
    const skipped: string[] = [];
    const missing: string[] = [];
    const warnings: string[] = [];

    for (const beat of doc.beats) {
      if (input.beatIds && !input.beatIds.includes(beat.id)) continue;
      const finalPath = path.join(outDir, `${beat.id}.mp3`);
      const line = lineFor(beat, language, baseLanguage);

      if (!line || !line.trim()) {
        missing.push(beat.id);
        if (!isBase) {
          warnings.push(
            `${beat.id}: no ${language} line in voTranslations, so this beat would play silent in the ` +
              `${language} cut.`,
          );
        }
        continue;
      }
      if (fs.existsSync(finalPath) && !input.overwrite) {
        skipped.push(beat.id);
        continue;
      }

      const raw = path.join(workDir, isBase ? `${beat.id}.raw` : `${language}-${beat.id}.raw`);
      const res = synthesize(engine, voice, line, raw, omni, `${raw}.words.json`);
      if (!res.ok) {
        missing.push(beat.id);
        warnings.push(`${beat.id}: ${res.error}`);
        continue;
      }

      const spoken = probeDuration(raw);
      const beatSeconds = beat.duration / fps;
      const target = beatSeconds - pad;
      const wanted = spoken / target;
      const tempo = Math.min(TEMPO_CEIL, Math.max(TEMPO_FLOOR, wanted));

      const r = spawnSync(
        "ffmpeg",
        ["-v", "error", "-i", raw, "-filter:a", `atempo=${tempo.toFixed(4)}`,
         "-c:a", "libmp3lame", "-q:a", "3", finalPath, "-y"],
        { encoding: "utf8" },
      );
      if (r.status !== 0) {
        missing.push(beat.id);
        warnings.push(`${beat.id}: ffmpeg failed writing the fitted clip`);
        continue;
      }

      const finalSeconds = probeDuration(finalPath);
      const overruns = finalSeconds > beatSeconds;
      const clip: NarrationClip = {
        beatId: beat.id,
        language,
        path: finalPath,
        beatSeconds: Number(beatSeconds.toFixed(2)),
        spokenSeconds: Number(spoken.toFixed(2)),
        finalSeconds: Number(finalSeconds.toFixed(2)),
        tempo: Number(tempo.toFixed(3)),
        needsAttention: overruns || Math.abs(wanted - tempo) > 0.001,
      };

      if (overruns) {
        // Translations overrun far more often than the original does: the same sentence is
        // routinely 20 to 30 percent longer in German or Hindi than in English, and the fix
        // is a shorter translation, not a faster one.
        clip.note =
          `Runs ${(finalSeconds - beatSeconds).toFixed(2)}s past the beat. Shorten the line or ` +
          `lengthen the beat; stretching further would sound processed.`;
        warnings.push(`${beat.id}: narration overruns its beat by ${(finalSeconds - beatSeconds).toFixed(2)}s`);
      } else if (clip.needsAttention) {
        const slack = (target - finalSeconds).toFixed(2);
        clip.note =
          `Fits with ${slack}s of silence left over. Stretching was clamped to keep the voice ` +
          `natural; add a few words to the line if the gap is noticeable.`;
      }
      // Word timings, in the clip as written: the stretch speeds the audio up by `tempo`, so every time
      // is divided by it. The words file sits beside the clip so stitch_composition can find it.
      if (res.words) {
        const wordsPath = path.join(outDir, `${beat.id}.words.json`);
        const scaled = res.words.map((w) => ({ word: w.word, startMs: Math.round(w.startMs / tempo), endMs: Math.round(w.endMs / tempo) }));
        fs.writeFileSync(wordsPath, JSON.stringify(scaled, null, 2) + "\n", "utf8");
        clip.wordsPath = wordsPath;
        clip.wordCount = scaled.length;
        wordTimings.written.push(wordsPath);
      } else if (engine === "edge-tts" && wordTimings.supported) {
        warnings.push(`${beat.id}: the service sent no word boundaries for this line, so no .words.json was written.`);
      }
      written.push(clip);
    }

    reports.push({ language, voice, dir: outDirRel, written, skipped, missing, warnings });
  }

  const base = reports.find((r) => r.language === baseLanguage)!;
  return {
    engine,
    voice: base.voice,
    written: base.written,
    skipped: base.skipped,
    missing: base.missing,
    warnings: base.warnings,
    languages: reports,
    wordTimings,
  };
}

export function registerGenerateNarration(server: McpServer): void {
  server.registerTool(
    "generate_narration",
    {
      title: "Generate narration audio for every beat",
      description:
        "Reads beats.json and writes one narration mp3 per beat to public/audio/vo/<beatId>.mp3, which is " +
        "exactly where stitch_composition looks. Defaults to edge-tts; 'say' on macOS and 'espeak' also " +
        "work. Each clip is fitted to its beat, but stretching is clamped to a range that stays natural: a " +
        "pitch-preserving stretch past about ten percent is audible and is the main reason generated " +
        "voiceover sounds synthetic. When a line genuinely does not fit, the tool says so and names the beat " +
        "rather than stretching it into something processed, because the real fix is the script or the beat " +
        "duration. Reports which beats got audio, which were skipped as already present, and which are still " +
        "missing, so a partially generated narration cannot slip through and render silent. Resumable: pass " +
        "overwrite to redo clips that already exist. With edge-tts it also writes public/audio/vo/<beatId>.words.json, [{ word, startMs, endMs }] per beat, timed to the clip as written (scaled by the same stretch), which stitch_composition copies next to the composition for useNarrationWords(beatId); other engines write no timings and the result says so (wordTimings). Pass languages to ship the same manifest in several at once: the base language keeps writing to public/audio/vo/<beatId>.mp3 and every other language gets public/audio/vo/<lang>/<beatId>.mp3, read from each beat's voTranslations. Translated lines live in the manifest rather than being produced here, because a translation is content and goes through the same approval the original script did. The omnivoice engine covers 600+ languages zero-shot and, given a reference clip, uses one cloned voice across all of them, which is the difference between a translated video and a dubbed one. requireTranslations fails up front on a missing line rather than shipping a cut that is narrated in one language and silent in another.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        engine: z.enum(["edge-tts", "say", "espeak", "omnivoice"]).optional(),
        voice: z.string().optional(),
        padSeconds: z.number().positive().optional(),
        overwrite: z.boolean().optional(),
        beatIds: z.array(z.string()).optional(),
        languages: z.array(z.string()).optional().describe("BCP-47 tags. Defaults to the base language alone."),
        baseLanguage: z.string().optional().describe("The language `vo` is written in. Defaults to en."),
        voices: z.record(z.string(), z.string()).optional(),
        requireTranslations: z.boolean().optional(),
        refAudio: z.string().optional().describe("omnivoice only: a clip to clone, so every language is one voice."),
        refText: z.string().optional(),
        instruct: z.string().optional().describe("omnivoice only: voice design, when there is no clip to clone."),
      },
    },
    async (input) => runTool("generate_narration", () => runGenerateNarration(input)),
  );
}

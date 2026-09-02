import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
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
 */

export type NarrationEngine = "edge-tts" | "say" | "espeak";

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
}

export interface NarrationClip {
  beatId: string;
  path: string;
  beatSeconds: number;
  spokenSeconds: number;
  finalSeconds: number;
  tempo: number;
  /** True when the clip could not be fitted inside its beat without an audible stretch. */
  needsAttention: boolean;
  note?: string;
}

export interface GenerateNarrationResult {
  engine: NarrationEngine;
  voice: string;
  written: NarrationClip[];
  skipped: string[];
  missing: string[];
  warnings: string[];
}

/** Beyond this, a pitch-preserving stretch starts to sound processed. */
const TEMPO_FLOOR = 0.9;
const TEMPO_CEIL = 1.12;

const DEFAULT_VOICE: Record<NarrationEngine, string> = {
  "edge-tts": "en-US-AndrewNeural",
  say: "Alex",
  espeak: "en-us",
};

interface BeatLike {
  id: string;
  duration: number;
  vo?: string;
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

function synthesize(
  engine: NarrationEngine,
  voice: string,
  text: string,
  out: string,
): { ok: boolean; error?: string } {
  for (let attempt = 0; attempt < 3; attempt++) {
    fs.rmSync(out, { force: true });
    let r;
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
  }
  return { ok: false, error: `no usable audio after 3 attempts` };
}

export function runGenerateNarration(input: GenerateNarrationInput): GenerateNarrationResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const engine: NarrationEngine = input.engine ?? "edge-tts";
  const voice = input.voice ?? DEFAULT_VOICE[engine];
  const pad = input.padSeconds ?? 0.45;

  const beatsFile = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsFile)) {
    throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { fps: number; beats: BeatLike[] };
  const fps = doc.fps || 30;

  const outDir = path.join(projectRoot, "public", "audio", "vo");
  fs.mkdirSync(outDir, { recursive: true });
  const workDir = path.join(projectRoot, ".openvidstudio", "narration");
  fs.mkdirSync(workDir, { recursive: true });

  const written: NarrationClip[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const beat of doc.beats) {
    if (input.beatIds && !input.beatIds.includes(beat.id)) continue;
    const finalPath = path.join(outDir, `${beat.id}.mp3`);

    if (!beat.vo || !beat.vo.trim()) {
      missing.push(beat.id);
      continue;
    }
    if (fs.existsSync(finalPath) && !input.overwrite) {
      skipped.push(beat.id);
      continue;
    }

    const raw = path.join(workDir, `${beat.id}.raw`);
    const res = synthesize(engine, voice, beat.vo, raw);
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
      path: finalPath,
      beatSeconds: Number(beatSeconds.toFixed(2)),
      spokenSeconds: Number(spoken.toFixed(2)),
      finalSeconds: Number(finalSeconds.toFixed(2)),
      tempo: Number(tempo.toFixed(3)),
      needsAttention: overruns || Math.abs(wanted - tempo) > 0.001,
    };

    if (overruns) {
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
    written.push(clip);
  }

  return { engine, voice, written, skipped, missing, warnings };
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
        "overwrite to redo clips that already exist.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        engine: z.enum(["edge-tts", "say", "espeak"]).optional(),
        voice: z.string().optional(),
        padSeconds: z.number().positive().optional(),
        overwrite: z.boolean().optional(),
        beatIds: z.array(z.string()).optional(),
      },
    },
    async (input) => runTool("generate_narration", () => runGenerateNarration(input)),
  );
}

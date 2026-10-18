import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath } from "../util";
import { PY_DIR } from "../paths";
import { runTool } from "./mcp";

/**
 * compose_score builds an original, arc-matched score for a video: it turns the
 * music plan a brief already carries (or a direct override) into a spec.json, spawns
 * packages/mcp-server/py/compose-score.py to actually compose and master it, and wires
 * the result into the rest of the pipeline the same way every other music path does.
 * This file owns none of the DSP: key/harmony, the arrangement engine, mastering, and
 * the diagnostic checks all live in that script, per its own module docstring (read in
 * full before writing this). This is the glue around it: spec.json in, public/audio/
 * mp3 plus cues.json plus a spectrogram PNG out.
 *
 * The script's real spec.json contract (its field names, not inferred):
 *   bpm, key, sections: [{label, bars}], impacts: [{label, atBar, atBeat}],
 *   mode: "bed" | "music" (loudness target, -15 LUFS under narration vs -14 for
 *   music-only), trackName (the `track` field it records), outWav / outCues /
 *   outSpectrogram (absolute paths this tool chooses and the script writes to
 *   directly). The script already sets `source: "generated"` and `generatedBy` on
 *   its own cues object; this tool re-asserts both when it reads the file back
 *   anyway (see runComposeScore below), partly for certainty and partly because the
 *   script's own hardcoded generatedBy string says "scripts/compose-score.py", which
 *   is stale against its real location in py/ -- not this file's place to patch the
 *   .py source, but worth correcting in the file this tool actually ships.
 *
 * Progress lines go to the script's stdout as plain text (see its own print() calls
 * near the end of main()), never JSON; the only reporting channel of substance is
 * outCues, a file. There is nothing to parse from stdout here.
 *
 * The cues.json integration point (the part that matters most): a music track at
 * public/audio/<stem>.mp3 has a cues file next to it at public/audio/<stem>.cues.json,
 * shaped like MusicCuesResult (see musicCues.ts). `source: "generated"` means "exact by
 * construction", and plan_music_cues treats a generated cues file as ground truth,
 * returning it directly with no re-analysis. compose-score.py's own cues fields already
 * use matching names (beats, strongCues, bpm) for exactly this reason.
 *
 * WAV handling: compose-score.py masters to a 24-bit PCM wav, a transient intermediate,
 * not a shipped artifact. It is written to a temp path, transcoded to mp3 with ffmpeg,
 * then deleted. The diagnostic spectrogram PNG is kept permanently next to the mp3,
 * written there directly by the script (outSpectrogram points at its final home from
 * the start, no separate move step needed).
 */

export interface MusicSection {
  label: string;
  startBar: number;
  endBar: number;
}

export interface MusicImpactPoint {
  name: string;
  bar: number;
  note?: string;
}

/**
 * Matches brief.json's `music` field (writeBrief.ts's MusicPlan), reproduced here as a
 * local type rather than imported: packages/mcp-server/src/tools/writeBrief.ts does not
 * exist in this worktree (checked with `git log --all` across every branch, not just a
 * stale checkout, unlike compose-score.py which did exist uncommitted elsewhere and was
 * copied in as-is). If the real writeBrief.ts lands with different field names, this is
 * the one type to reconcile.
 */
export interface MusicPlan {
  bpm: number;
  key: string;
  sectionMap: MusicSection[];
  impactPoints?: MusicImpactPoint[];
}

export interface ComposeScoreInput {
  projectRoot?: string;
  videoName: string;
  /** Direct override. If omitted, read from src/videos/<videoName>/brief.json's `music` field. */
  music?: MusicPlan;
  /** Bare filename under public/audio/, ending in .mp3. Defaults to "music-bed.mp3". */
  outFile?: string;
  /**
   * "bed": -15 LUFS, mastered to sit under narration, matching MusicBed's own
   * quiet-by-design convention (see NARRATION.md). "music": -14 LUFS, for a music-only
   * video (narration: "none") where the score is the only thing on the audio track.
   */
  mode: "bed" | "music";
  /**
   * "none" (default): no kick, clap, hat or tick, and the bass and arp play uneven
   * rhythms with small timing and level variation, so nothing repeats identically on a
   * fixed grid. A perfectly even, short-decay hit reads as a ticking clock under a
   * voiceover. "full": the old drum-machine arrangement, kept as an opt-in.
   */
  percussion?: "none" | "full";
}

export interface ComposeScoreResult {
  /** Relative to projectRoot, forward slashes. */
  mp3Path: string;
  /** Relative to projectRoot, forward slashes. */
  cuesPath: string;
  /** Relative to projectRoot, forward slashes. */
  spectrogramPath: string;
  bpm: number;
  key: string;
  durationSeconds: number;
  /**
   * Populated from the script's own checks rather than left buried in the written cues
   * file: a band-balance verdict that is not "ok", any detected clicks, a true peak over
   * the limiter's ceiling, or an integrated loudness far from target all surface here.
   */
  warnings: string[];
  /** The full cues object exactly as written to cuesPath. */
  cues: Record<string, unknown>;
}

const OUT_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\.mp3$/i;

/** How far lufsIntegrated may sit from lufsTarget before it is worth flagging. */
const LUFS_DRIFT_WARNING_LU = 1;

function which(cmd: string): string | null {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").split(/\r?\n/)[0]?.trim() || null;
}

/** Same python-then-python3 fallback order preflight.ts's "compose-score-deps" check uses. */
export function resolvePythonCommand(): string | null {
  if (which("python")) return "python";
  if (which("python3")) return "python3";
  return null;
}

/**
 * brief's sectionMap: [{label, startBar, endBar}] becomes compose-score.py's
 * sections: [{label, bars}]. Validated contiguous and strictly in order first, so a
 * gap or overlap the brief didn't intend to have is caught here rather than silently
 * producing a score whose structure doesn't match what the brief actually described.
 */
export function sectionsToPythonSections(sectionMap: MusicSection[]): { label: string; bars: number }[] {
  if (!sectionMap || sectionMap.length === 0) {
    throw new Error("music.sectionMap is empty. At least one section is required.");
  }
  for (let i = 0; i < sectionMap.length; i++) {
    const s = sectionMap[i];
    if (s.endBar <= s.startBar) {
      throw new Error(
        `music.sectionMap's "${s.label}" section has endBar (${s.endBar}) at or before startBar (${s.startBar}).`,
      );
    }
    if (i > 0) {
      const prev = sectionMap[i - 1];
      if (prev.endBar !== s.startBar) {
        throw new Error(
          `music.sectionMap is not contiguous: "${prev.label}" ends at bar ${prev.endBar} but ` +
            `"${s.label}" starts at bar ${s.startBar}. Sections must connect exactly, ` +
            `each endBar equal to the next section's startBar.`,
        );
      }
    }
  }
  return sectionMap.map((s) => ({ label: s.label, bars: s.endBar - s.startBar }));
}

/**
 * impactPoints: [{name, bar, note}] to spec's impacts: [{label, atBar, atBeat}]. The
 * brief has no beat-level granularity, so atBeat is 0, which main() itself treats as
 * the default (`imp.get("atBeat", 0)`).
 */
export function impactPointsToPythonImpacts(
  impactPoints: MusicImpactPoint[] | undefined,
): { label: string; atBar: number; atBeat: number }[] {
  return (impactPoints ?? []).map((p) => ({ label: p.name, atBar: p.bar, atBeat: 0 }));
}

interface ComposeScoreSpec {
  bpm: number;
  key: string;
  sections: { label: string; bars: number }[];
  impacts: { label: string; atBar: number; atBeat: number }[];
  mode: "bed" | "music";
  percussion: "none" | "full";
  trackName: string;
  outWav: string;
  outCues: string;
  outSpectrogram: string;
}

export function buildComposeScoreSpec(
  music: MusicPlan,
  trackName: string,
  outWav: string,
  outCues: string,
  outSpectrogram: string,
  mode: "bed" | "music",
  percussion: "none" | "full" = "none",
): ComposeScoreSpec {
  return {
    bpm: music.bpm,
    key: music.key,
    sections: sectionsToPythonSections(music.sectionMap),
    impacts: impactPointsToPythonImpacts(music.impactPoints),
    mode,
    percussion,
    trackName,
    outWav,
    outCues,
    outSpectrogram,
  };
}

/**
 * Surfaces the script's own diagnostic checks as actionable warnings instead of leaving
 * them readable only by opening the written cues file. Any of: a band-balance verdict
 * that isn't "ok", a detected click, a true peak over the limiter's own ceiling, or an
 * integrated loudness far from the mastering target.
 */
export function computeWarnings(cues: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const checks = (cues.checks ?? {}) as Record<string, unknown>;

  const bandBalance = checks.bandBalance as Record<string, unknown> | undefined;
  const verdict = bandBalance?.verdict;
  if (typeof verdict === "string" && verdict !== "ok") {
    warnings.push(`Band energy balance verdict is "${verdict}", not "ok".`);
  }

  const clickCount = checks.clickCount;
  if (typeof clickCount === "number" && clickCount > 0) {
    warnings.push(`${clickCount} click${clickCount === 1 ? "" : "s"} detected in the mastered mix.`);
  }

  const tick = checks.percussionTick as Record<string, unknown> | undefined;
  if (tick && tick.verdict === "periodic") {
    warnings.push(
      `Periodic high-frequency transients every ~${tick.lagMs} ms (autocorrelation ${tick.peak}, threshold ` +
        `${tick.thresholdPeak}): this score will sound like a ticking clock. Use percussion "none" or vary the rhythm.`,
    );
  }

  const truePeakDbtp = cues.truePeakDbtp;
  const truePeakMaxDbtp = cues.truePeakMaxDbtp;
  if (typeof truePeakDbtp === "number" && typeof truePeakMaxDbtp === "number" && truePeakDbtp > truePeakMaxDbtp) {
    warnings.push(`True peak ${truePeakDbtp}dBTP exceeds the limiter's ${truePeakMaxDbtp}dBTP ceiling.`);
  }

  const lufsIntegrated = cues.lufsIntegrated;
  const lufsTarget = cues.lufsTarget;
  if (
    typeof lufsIntegrated === "number" &&
    typeof lufsTarget === "number" &&
    Math.abs(lufsIntegrated - lufsTarget) > LUFS_DRIFT_WARNING_LU
  ) {
    warnings.push(`Integrated loudness ${lufsIntegrated} LUFS is more than ${LUFS_DRIFT_WARNING_LU} LU from the ${lufsTarget} LUFS target.`);
  }

  return warnings;
}

function loadMusicPlan(projectRoot: string, videoName: string, override: MusicPlan | undefined): MusicPlan {
  if (override) return override;
  const briefPath = path.join(projectRoot, "src", "videos", videoName, "brief.json");
  if (!fs.existsSync(briefPath)) {
    throw new Error(
      `No music plan was given and no brief.json exists at ${briefPath}. Run write_brief first, or pass ` +
        `music directly.`,
    );
  }
  let brief: { music?: MusicPlan };
  try {
    brief = JSON.parse(fs.readFileSync(briefPath, "utf8")) as { music?: MusicPlan };
  } catch (err) {
    throw new Error(`Failed to parse ${briefPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!brief.music) {
    throw new Error(
      `${briefPath} has no "music" field and no music input was given. Run write_brief first, or pass ` +
        `music directly.`,
    );
  }
  return brief.music;
}

function probeDurationSeconds(mp3Abs: string): number {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", mp3Abs],
    { encoding: "utf8" },
  );
  const v = Number.parseFloat((r.stdout ?? "").trim());
  return Number.isFinite(v) ? Number(v.toFixed(3)) : 0;
}

export function runComposeScore(input: ComposeScoreInput): ComposeScoreResult {
  if (input.mode !== "bed" && input.mode !== "music") {
    throw new Error('mode is required: choose "bed" for narrated video (-15 LUFS) or "music" for music-only video (-14 LUFS).');
  }
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const music = loadMusicPlan(projectRoot, videoName, input.music);

  // Validated first, before any temp file, output directory or process: a brief whose
  // section arc doesn't connect should fail immediately, not after this has already
  // touched disk or spawned anything.
  sectionsToPythonSections(music.sectionMap);
  impactPointsToPythonImpacts(music.impactPoints);

  const outFile = input.outFile ?? "music-bed.mp3";
  if (!OUT_FILE_PATTERN.test(outFile)) {
    throw new Error(`outFile "${outFile}" must be a bare filename ending in .mp3 (letters, numbers, "-", "_").`);
  }
  const mp3Rel = path.join("public", "audio", outFile);
  sanitizeRelativeOutPath(projectRoot, mp3Rel, "outFile");
  const mp3Abs = path.join(projectRoot, mp3Rel);
  const trackName = mp3Rel.replace(/\\/g, "/");

  const stem = outFile.slice(0, -".mp3".length);
  const cuesAbs = path.join(path.dirname(mp3Abs), `${stem}.cues.json`);
  const spectrogramAbs = path.join(path.dirname(mp3Abs), `${stem}.spectrogram.png`);

  const scriptPath = path.join(PY_DIR, "compose-score.py");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `compose-score.py not found at ${scriptPath}. This package's py/ directory did not ship, or the DSP ` +
        `engine has not been added to this checkout yet.`,
    );
  }

  const pythonCmd = resolvePythonCommand();
  if (!pythonCmd) {
    throw new Error(
      `No python or python3 on PATH. compose_score needs a python with numpy, scipy, soundfile, ` +
        `pyloudnorm and matplotlib importable; run preflight to check.`,
    );
  }

  // outCues and outSpectrogram point straight at their final home (main() creates the
  // directory for each of outWav/outCues/outSpectrogram itself via os.makedirs), so
  // there is no separate move or merge step for either. outWav alone goes to a temp
  // path: the wav is a transient intermediate, transcoded to mp3 below, then deleted.
  fs.mkdirSync(path.dirname(mp3Abs), { recursive: true });
  const tmpWavAbs = path.join(os.tmpdir(), `ovs-compose-score-${process.pid}-${Date.now()}.wav`);
  const spec = buildComposeScoreSpec(
    music,
    trackName,
    tmpWavAbs,
    cuesAbs,
    spectrogramAbs,
    input.mode,
    input.percussion ?? "none",
  );
  const specAbs = path.join(os.tmpdir(), `ovs-compose-score-spec-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(specAbs, JSON.stringify(spec, null, 2), "utf8");

  let proc;
  try {
    proc = spawnSync(pythonCmd, [scriptPath, specAbs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } finally {
    fs.rmSync(specAbs, { force: true });
  }

  if (proc.error || proc.status !== 0) {
    // main()'s own except-block already removes any of outWav/outCues/outSpectrogram it
    // had written before failing, so there is nothing of its own left to clean up here.
    const tail = (proc.stderr || proc.stdout || String(proc.error ?? "")).slice(-2000);
    throw new Error(`compose-score.py failed (exit ${proc.status ?? "n/a"}):\n${tail}`);
  }

  if (!fs.existsSync(tmpWavAbs) || !fs.existsSync(cuesAbs)) {
    throw new Error(
      `compose-score.py exited 0 but did not write both outWav (${tmpWavAbs}) and outCues (${cuesAbs}).`,
    );
  }

  // The wav is a transient intermediate, not a shipped artifact: transcode to mp3, then
  // delete it. Matches generateNarration.ts's own libmp3lame/-q:a convention, one notch
  // higher quality since this is a full mix, not narration.
  const ffmpegRes = spawnSync(
    "ffmpeg",
    ["-y", "-i", tmpWavAbs, "-c:a", "libmp3lame", "-q:a", "2", "-ac", "2", mp3Abs],
    { encoding: "utf8" },
  );
  fs.rmSync(tmpWavAbs, { force: true });
  if (ffmpegRes.status !== 0) {
    throw new Error(`ffmpeg failed transcoding the mastered score to mp3:\n${(ffmpegRes.stderr ?? "").slice(-2000)}`);
  }

  const cuesFromScript = JSON.parse(fs.readFileSync(cuesAbs, "utf8")) as Record<string, unknown>;

  // durationSeconds is probed from the real written mp3 rather than trusted from the
  // script's own report: cheap, since ffmpeg already ran, and removes any dependence on
  // the wav-to-mp3 transcode preserving duration exactly.
  const durationSeconds = probeDurationSeconds(mp3Abs);

  const warnings = computeWarnings(cuesFromScript);

  // The script already sets track/source/generatedBy itself (given trackName above),
  // but this re-asserts all three plus the probed durationSeconds: certainty that the
  // MusicCuesResult-required fields are right regardless of what the script's own
  // internals happen to default to, and a chance to fix generatedBy's stale "scripts/"
  // path on the copy this tool actually ships (not the .py source itself).
  const finalCues: Record<string, unknown> = {
    ...cuesFromScript,
    durationSeconds,
    track: trackName,
    generatedBy: "packages/mcp-server/py/compose-score.py",
    source: "generated",
  };
  fs.writeFileSync(cuesAbs, JSON.stringify(finalCues, null, 2) + "\n", "utf8");

  const bpm = typeof finalCues.bpm === "number" ? finalCues.bpm : music.bpm;

  return {
    mp3Path: trackName,
    cuesPath: path.relative(projectRoot, cuesAbs).replace(/\\/g, "/"),
    spectrogramPath: path.relative(projectRoot, spectrogramAbs).replace(/\\/g, "/"),
    bpm,
    key: music.key,
    durationSeconds,
    warnings,
    cues: finalCues,
  };
}

const musicSectionSchema = z.object({
  // Not a closed enum: the 7-label vocabulary (intro/tension/reveal/groove/break/peak/
  // outro) is the documented convention and is what compose-score.py's RENDERERS table
  // actually keys on, but an unrecognized label is the script's own KeyError to raise,
  // not a validation this tool duplicates and risks getting out of sync with.
  label: z.string().min(1),
  startBar: z.number().int().nonnegative(),
  endBar: z.number().int().positive(),
});

const musicImpactSchema = z.object({
  name: z.string().min(1),
  bar: z.number().int().nonnegative(),
  note: z.string().optional(),
});

const musicPlanSchema = z.object({
  bpm: z.number().positive(),
  key: z.string().min(1),
  sectionMap: z.array(musicSectionSchema).min(1),
  impactPoints: z.array(musicImpactSchema).optional(),
});

export function registerComposeScore(server: McpServer): void {
  server.registerTool(
    "compose_score",
    {
      title: "Compose an original, arc-matched score",
      description:
        "Builds a spec.json from a video's music plan (brief.json's `music` field, or a direct override) " +
        "and spawns packages/mcp-server/py/compose-score.py to compose and master an original score that " +
        "follows the brief's section arc (intro/tension/reveal/groove/break/peak/outro) and lands its impact " +
        "points on the bar they were planned for. Writes the result to public/audio/music-bed.mp3 by default " +
        "(overridable via outFile, e.g. to A/B two tracks), which is exactly where stitch_composition's own " +
        "auto-detection already looks. Also writes public/audio/<stem>.cues.json with source: \"generated\", " +
        "so plan_music_cues treats it as ground truth and returns it directly rather than re-analyzing, and " +
        "keeps the script's diagnostic spectrogram PNG permanently at public/audio/<stem>.spectrogram.png. " +
        "mode is required: choose \"bed\" (-15 LUFS) for narrated videos, which most callers want, since it sits under " +
        "voiceover; choose \"music\" (-14 LUFS) only for a music-only video with no narration. No silent default. Validates that the " +
        "brief's sectionMap is contiguous (each section's endBar equal to the next section's startBar) " +
        "before composing anything, and throws naming exactly which two sections don't connect if not. " +
        "Surfaces the script's own mastering checks as a warnings array: a band-balance verdict other than " +
        "\"ok\", any detected click, a periodic high-frequency tick pattern, a true peak over the limiter's " +
        "ceiling, or an integrated loudness far from target. percussion defaults to \"none\": no kick, clap, " +
        "hat or tick, with uneven bass and arp rhythms, because evenly repeated short hits read as a ticking " +
        "clock under a voiceover. Pass percussion \"full\" only if you want the old drum-machine arrangement. " +
        "This is the highest-effort of the music options (the built-in ambient music-bed.mp3, a found CC0 " +
        "track via find_music_bed, or this), meant for peak creative level: an original score built to match " +
        "the video's own arc rather than a pre-made or found track.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        music: musicPlanSchema.optional().describe(
          "Direct override, shaped like brief.json's `music` field. If omitted, read from " +
            "src/videos/<videoName>/brief.json.",
        ),
        outFile: z.string().optional().describe('Bare filename under public/audio/, ending in .mp3. Defaults to "music-bed.mp3".'),
        mode: z.enum(["bed", "music"]).describe('Required: "bed" (-15 LUFS) for narrated videos (most common); "music" (-14 LUFS) for music-only videos. No default.'),
        percussion: z.enum(["none", "full"]).optional().describe(
          'Defaults to "none": no kick, clap, hat or tick, uneven bass and arp rhythms. "full" is the old drum-machine arrangement and is flagged by the periodic-tick check.',
        ),
      },
    },
    async (input) => runTool("compose_score", () => runComposeScore(input)),
  );
}

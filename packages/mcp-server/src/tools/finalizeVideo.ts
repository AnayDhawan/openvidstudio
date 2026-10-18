import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import { runExportRendition, type ExportRenditionResult } from "./exportRendition";
import { runWriteDescription, type WriteDescriptionResult } from "./writeDescription";
import { fileBytes, relToProject, writeFactRecord } from "../facts";
import { runTool } from "./mcp";

/**
 * The last pass over a finished render: a loudness target on the mix, a poster frame, and a
 * copy small enough to share.
 *
 * Loudness is where the earlier stages stop short. compose_score and generate_narration each
 * aim at a level for their own track (a bed sits at -15 LUFS under narration), but nothing
 * measures the two together after the mix, so a finished video's loudness is whatever the sum
 * happened to be. This measures it and moves it to a target, two-pass: the first pass reads
 * the real integrated loudness, true peak and range, and the second applies a linear gain
 * computed from those numbers rather than a guessed constant.
 *
 * The target is -14 LUFS integrated with a -1.5 dBTP ceiling. The bed's -15 is the music alone
 * under a voice, not the finished mix, and -14 is the level the large video platforms normalise
 * to, so a master at -14 is neither turned down (too loud) nor left quiet (too soft).
 */

export const DEFAULT_TARGET_LUFS = -14;
export const DEFAULT_TRUE_PEAK_DB = -1.5;
export const DEFAULT_LRA = 11;
/** How far the finished file's measured loudness may sit from the target before it is reported as a miss. */
export const LOUDNESS_TOLERANCE_LU = 1;

export interface LoudnessMeasurement {
  integratedLufs: number;
  truePeakDb: number;
  loudnessRange: number;
  threshold: number;
  /** The offset loudnorm itself suggests applying to reach the target. */
  targetOffset: number;
}

export interface LoudnormTarget {
  lufs: number;
  truePeakDb: number;
  lra: number;
}

export function buildLoudnormMeasureArgs(inPath: string, target: LoudnormTarget): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-i",
    inPath,
    "-map",
    "0:a:0",
    "-af",
    `loudnorm=I=${target.lufs}:TP=${target.truePeakDb}:LRA=${target.lra}:print_format=json`,
    "-f",
    "null",
    "-",
  ];
}

/**
 * Second pass. Feeding loudnorm the numbers the first pass measured is what makes this a
 * two-pass normalisation: with them it can apply one linear gain for the whole file (`linear=true`)
 * instead of the dynamic, moment-to-moment adjustment its single pass falls back on, which pumps
 * quiet narration against loud music. The video stream is copied, never re-encoded.
 */
export function buildLoudnormApplyArgs(
  inPath: string,
  outPath: string,
  target: LoudnormTarget,
  measured: LoudnessMeasurement,
  /**
   * The video's own duration in seconds. loudnorm's lookahead makes its output about 100 ms
   * longer than its input, which would leave the audio running three frames past the picture,
   * so the file is cut at the video's end. Omit to leave the output length to ffmpeg.
   */
  videoDurationSeconds?: number,
): string[] {
  const filter =
    `loudnorm=I=${target.lufs}:TP=${target.truePeakDb}:LRA=${target.lra}` +
    `:measured_I=${measured.integratedLufs}:measured_TP=${measured.truePeakDb}:measured_LRA=${measured.loudnessRange}` +
    `:measured_thresh=${measured.threshold}:offset=${measured.targetOffset}:linear=true:print_format=summary`;
  return [
    "-nostdin",
    "-y",
    "-i",
    inPath,
    "-map",
    "0:v",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-af",
    filter,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    ...(videoDurationSeconds !== undefined ? ["-t", videoDurationSeconds.toFixed(6)] : []),
    outPath,
  ];
}

/** Pulls the JSON block loudnorm prints to stderr after its progress output. */
export function parseLoudnormJson(stderr: string): LoudnessMeasurement {
  const end = stderr.lastIndexOf("}");
  const start = end === -1 ? -1 : stderr.lastIndexOf("{", end);
  if (start === -1) throw new Error(`No loudnorm measurement in ffmpeg's output:\n${stderr.slice(-600)}`);
  const raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  const num = (key: string): number => {
    const v = Number.parseFloat(raw[key]);
    if (!Number.isFinite(v)) throw new Error(`loudnorm reported "${raw[key]}" for ${key}. The audio may be silent.`);
    return v;
  };
  return {
    integratedLufs: num("input_i"),
    truePeakDb: num("input_tp"),
    loudnessRange: num("input_lra"),
    threshold: num("input_thresh"),
    targetOffset: num("target_offset"),
  };
}

/** The first video stream's duration, or null if ffprobe cannot read one. */
async function videoDurationSeconds(inPathRel: string, projectRoot: string): Promise<number | null> {
  const r = await spawnCapture(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", inPathRel],
    projectRoot,
  );
  if (r.code !== 0) return null;
  const value = Number.parseFloat(r.stdout.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function measure(inPathRel: string, projectRoot: string, target: LoudnormTarget): Promise<LoudnessMeasurement> {
  const r = await spawnCapture("ffmpeg", buildLoudnormMeasureArgs(inPathRel, target), projectRoot);
  if (r.code !== 0) throw new Error(`Loudness measurement failed:\n${r.stderr.slice(-800)}`);
  return parseLoudnormJson(r.stderr);
}

export interface FinalizeVideoInput {
  projectRoot?: string;
  videoName: string;
  /** The finished render. Defaults to output/<videoName>.mp4. */
  inPath?: string;
  /** Defaults to output/<videoName>-final.mp4. */
  outPath?: string;
  targetLufs?: number;
  truePeakDb?: number;
  /** Write a poster frame, picked with export_rendition's posterPick "auto". Defaults to true. */
  poster?: boolean;
  /** Write a size-capped copy. Defaults to true. */
  share?: boolean;
  /** Cap for the share copy in MB. Defaults to 10. */
  shareMaxMB?: number;
  /** Write output/<videoName>-DESCRIPTION.md (chapters, credits, sample disclosure). Defaults to true. */
  description?: boolean;
}

export interface FinalizeVideoResult {
  finalPath: string;
  loudness: {
    target: LoudnormTarget;
    before: LoudnessMeasurement;
    /** Measured again from the written file, not assumed from the filter arguments. */
    after: LoudnessMeasurement;
    withinTolerance: boolean;
    toleranceLu: number;
  } | null;
  poster?: ExportRenditionResult;
  share?: ExportRenditionResult;
  /** The YouTube-ready description written beside the video, unless description: false. */
  description?: WriteDescriptionResult;
  notes: string[];
}

export async function runFinalizeVideo(input: FinalizeVideoInput): Promise<FinalizeVideoResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const inRel = input.inPath ?? path.join("output", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, inRel, "inPath");
  if (!fs.existsSync(path.join(projectRoot, inRel))) {
    throw new Error(`${inRel} does not exist. Run render_video first.`);
  }
  const outRel = input.outPath ?? path.join(path.dirname(inRel), `${videoName}-final.mp4`);
  sanitizeRelativeOutPath(projectRoot, outRel, "outPath");
  if (path.resolve(projectRoot, outRel) === path.resolve(projectRoot, inRel)) {
    throw new Error("outPath is the same file as inPath. Pick a different outPath so the original render is kept.");
  }

  const target: LoudnormTarget = {
    lufs: input.targetLufs ?? DEFAULT_TARGET_LUFS,
    truePeakDb: input.truePeakDb ?? DEFAULT_TRUE_PEAK_DB,
    lra: DEFAULT_LRA,
  };
  const notes: string[] = [];
  fs.mkdirSync(path.dirname(path.join(projectRoot, outRel)), { recursive: true });

  const probe = await spawnCapture(
    "ffprobe",
    ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", inRel],
    projectRoot,
  );
  const hasAudio = probe.code === 0 && probe.stdout.trim().length > 0;

  let loudness: FinalizeVideoResult["loudness"] = null;
  if (hasAudio) {
    const before = await measure(inRel, projectRoot, target);
    const videoSeconds = await videoDurationSeconds(inRel, projectRoot);
    const apply = await spawnCapture(
      "ffmpeg",
      buildLoudnormApplyArgs(inRel, outRel, target, before, videoSeconds ?? undefined),
      projectRoot,
    );
    if (apply.code !== 0) throw new Error(`Loudness normalisation failed:\n${apply.stderr.slice(-1200)}`);
    const after = await measure(outRel, projectRoot, target);
    const withinTolerance = Math.abs(after.integratedLufs - target.lufs) <= LOUDNESS_TOLERANCE_LU;
    loudness = { target, before, after, withinTolerance, toleranceLu: LOUDNESS_TOLERANCE_LU };
    notes.push(
      `Loudness ${before.integratedLufs} LUFS -> ${after.integratedLufs} LUFS (target ${target.lufs}), ` +
        `true peak ${after.truePeakDb} dBTP.`,
    );
    if (!withinTolerance) {
      notes.push(
        `The result is more than ${LOUDNESS_TOLERANCE_LU} LU from the target. A very wide loudness range ` +
          `(${before.loudnessRange} LU in) can stop linear normalisation reaching it without clipping the peak ceiling.`,
      );
    }
  } else {
    // Nothing to normalise. The final file is still the video, unchanged, so the later steps have one name to read.
    fs.copyFileSync(path.join(projectRoot, inRel), path.join(projectRoot, outRel));
    notes.push("The render has no audio track, so there was nothing to loudness-normalise. The video was copied as is.");
  }

  const result: FinalizeVideoResult = { finalPath: outRel, loudness, notes };

  if (input.poster !== false) {
    result.poster = await runExportRendition({
      projectRoot,
      videoName,
      format: "poster",
      inPath: outRel,
      posterPick: "auto",
      bake: false,
    });
  }
  if (input.share !== false) {
    result.share = await runExportRendition({
      projectRoot,
      videoName,
      format: "share",
      inPath: outRel,
      maxMB: input.shareMaxMB,
    });
  }

  // The description is part of the finished video, not an extra: a launch video goes up with its
  // chapters, its credits and its sample-content disclosure, and one that was never written is
  // one that gets posted without them. Only a missing beats.json is tolerated (nothing to
  // describe); a malformed brief or a lost disclosure throws, because shipping those quietly
  // is the failure this file exists to prevent.
  if (input.description !== false) {
    if (fs.existsSync(path.join(projectRoot, "src", "videos", videoName, "beats.json"))) {
      result.description = runWriteDescription({ projectRoot, videoName });
    } else {
      notes.push(`No description written: src/videos/${videoName}/beats.json does not exist, so there is nothing to describe.`);
    }
  }

  writeFactRecord(projectRoot, {
    tool: "finalize_video",
    videoName,
    facts: {
      finalPath: relToProject(projectRoot, path.join(projectRoot, outRel)),
      bytes: fileBytes(path.join(projectRoot, outRel)),
      loudness: loudness && {
        targetLufs: target.lufs,
        beforeLufs: loudness.before.integratedLufs,
        afterLufs: loudness.after.integratedLufs,
        afterTruePeakDb: loudness.after.truePeakDb,
        withinTolerance: loudness.withinTolerance,
      },
      description: result.description ? relToProject(projectRoot, result.description.path) : null,
      poster: result.poster?.files[0] ?? null,
      posterBeat: result.poster?.posterPick?.beatId ?? null,
      share: result.share?.share ? { path: result.share.share.path, bytes: result.share.share.bytes, maxBytes: result.share.share.maxBytes, withinCap: result.share.share.withinCap } : null,
    },
  });

  return result;
}

export function registerFinalizeVideo(server: McpServer): void {
  server.registerTool(
    "finalize_video",
    {
      title: "Final assembly: loudness target, poster frame, size-capped share copy",
      description:
        "The last pass over a finished render (run render_video first). Measures the mix's real integrated " +
        "loudness, true peak and range, then normalises it two-pass with ffmpeg's loudnorm to a target " +
        "(default -14 LUFS, -1.5 dBTP): the first pass measures, the second applies a linear gain computed from " +
        "those numbers rather than a guessed constant, and the video stream is copied untouched. The written " +
        "file is measured again and the result reports before, after, and whether it landed within 1 LU of the " +
        "target, so the number is one that was measured, not one that was asked for. Writes " +
        "<videoName>-final.mp4 and leaves the original render in place. Also writes a poster frame (export_" +
        "rendition's poster with posterPick auto, so the thumbnail is the most representative beat rather " +
        "than the last one) and a share copy under a hard size cap (shareMaxMB, default 10). Pass poster: " +
        "false or share: false to skip either. Also writes output/<videoName>-DESCRIPTION.md (write_description: " +
        "chapters from the beats, credits, and the disclosure of any constructed sample content), because a " +
        "finished video is posted with it; pass description: false to skip. A render with no audio track skips " +
        "loudness and says so.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        inPath: z.string().optional().describe("The finished render. Defaults to output/<videoName>.mp4."),
        outPath: z.string().optional().describe("Defaults to output/<videoName>-final.mp4."),
        targetLufs: z.number().max(0).optional().describe("Integrated loudness target. Defaults to -14."),
        truePeakDb: z.number().max(0).optional().describe("True peak ceiling in dBTP. Defaults to -1.5."),
        poster: z.boolean().optional().describe("Defaults to true."),
        share: z.boolean().optional().describe("Defaults to true."),
        shareMaxMB: z.number().positive().optional().describe("Defaults to 10."),
        description: z.boolean().optional().describe("Write the DESCRIPTION.md file. Defaults to true."),
      },
    },
    async (input) => runTool("finalize_video", () => runFinalizeVideo(input)),
  );
}

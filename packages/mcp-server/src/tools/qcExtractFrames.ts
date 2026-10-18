import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import { runTool } from "./mcp";

export interface QcExtractFramesInput {
  projectRoot?: string;
  videoName: string;
  videoPath?: string;
}

export interface QcFrame {
  beatId: string;
  /** Absolute path to the extracted midpoint frame, or null if extraction produced no file. */
  midPath: string | null;
  /** Set only when midPath is null: why the extraction didn't produce a usable frame. */
  midError?: string;
  /** Absolute path to the extracted end frame, or null if extraction produced no file. */
  endPath: string | null;
  /** Set only when endPath is null: why the extraction didn't produce a usable frame. */
  endError?: string;
}

export interface QcExtractFramesResult {
  frames: QcFrame[];
  /** Plain-language entry per failed extraction (same beats as the null path fields above). */
  warnings?: string[];
}

interface BeatLike {
  id: string;
  start: number;
  duration: number;
}

/**
 * Pure argv builder, unit-testable without spawning ffmpeg.
 *
 * Extracts by frame INDEX, not by seeking to a timestamp. The previous version converted
 * a frame number to `frame/fps` seconds and asked ffmpeg's accurate-seek to land on "the
 * frame at or after time T" -- but any rounding that pushes T even a fraction of a
 * millisecond past the target frame's true PTS makes accurate-seek skip it and return the
 * NEXT frame instead (for the last frame in the whole file, there is no next frame to land
 * on, so ffmpeg writes nothing at all). Frame counting sidesteps this entirely: `-vf
 * select=eq(n,N)` asks for the Nth frame ffmpeg actually decodes, an integer comparison
 * with no rounding boundary to trip over.
 *
 * `-ss` (input-level, before `-i`) is still used, but only as a coarse, deliberately-early
 * jump to skip most of the file for speed, never as the thing that has to land exactly on
 * the target frame. `marginFrames` frames before the target (about a second's worth, or
 * fewer near the start of the file) is always FLOORED to microsecond precision, never
 * rounded to nearest, so the seek can only land at-or-before its own frame boundary, never
 * past it. `N` for the select filter is then the constant, exactly-known `marginFrames`,
 * never anything derived from comparing two timestamps.
 */
export function buildFfmpegFrameArgs(videoPath: string, targetFrame: number, fps: number, outFile: string): string[] {
  const marginFrames = Math.min(targetFrame, Math.max(1, Math.round(fps)));
  const seekFrame = targetFrame - marginFrames;
  // Floor (never round-to-nearest) so the requested seek time is never greater than the
  // seek frame's true PTS -- rounding up by even one ULP is what causes accurate-seek to
  // skip past the intended frame.
  const seekSeconds = Math.floor((seekFrame / fps) * 1e6) / 1e6;
  return [
    "-nostdin",
    "-ss",
    seekSeconds.toFixed(6),
    "-i",
    videoPath,
    "-vf",
    `select=eq(n\\,${marginFrames})`,
    "-vsync",
    "0",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outFile,
    "-y",
  ];
}

/**
 * Wraps PIPELINE.md's QC frame-extraction step. For every beat, computes both its
 * midpoint frame AND its end frame (a static crop that looks fine early can push
 * content off-frame once the camera has zoomed in, so the end matters too, not just
 * the midpoint), extracts each by frame index (see buildFfmpegFrameArgs), and shells out
 * to ffmpeg via spawn with an argv array. A beat whose extraction produced no real file
 * (ffmpeg can exit 0 while writing nothing, e.g. a seek that lands past the video's real
 * length) gets a null path and an explicit `*Error` entry instead of a phantom path that
 * looks like it exists but doesn't.
 */
export async function runQcExtractFrames(input: QcExtractFramesInput): Promise<QcExtractFramesResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  const beatsPath = path.join(videoDir, "beats.json");
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`${beatsPath} does not exist. Call write_beats_file for "${videoName}" first.`);
  }
  const beatsData = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as { fps?: number; beats?: BeatLike[] };
  const beats = beatsData.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error(`${beatsPath} has no beats.`);
  }
  const fps = beatsData.fps ?? 30;

  const videoPathRel = input.videoPath ?? path.join("output", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, videoPathRel, "videoPath");
  const videoPathAbs = path.join(projectRoot, videoPathRel);
  if (!fs.existsSync(videoPathAbs)) {
    throw new Error(`${videoPathAbs} does not exist. Call render_video first (or pass an explicit videoPath).`);
  }

  const outDirRel = path.join("output", "qc", videoName);
  sanitizeRelativeOutPath(projectRoot, outDirRel, "outDir");
  const outDirAbs = path.join(projectRoot, outDirRel);
  fs.mkdirSync(outDirAbs, { recursive: true });

  /**
   * Runs ffmpeg for one frame and verifies it actually produced a usable file. ffmpeg can
   * exit 0 having written nothing (or an empty file) if the requested frame doesn't exist
   * in the stream; a non-zero exit is caught the same way. Either way, this beat's field
   * gets `path: null` plus a plain-language reason instead of a path to a file that isn't
   * really there.
   */
  async function extractFrame(
    targetFrame: number,
    outFile: string,
    beatId: string,
    which: "mid" | "end",
  ): Promise<{ path: string | null; error?: string }> {
    const result = await spawnCapture("ffmpeg", buildFfmpegFrameArgs(videoPathAbs, targetFrame, fps, outFile), projectRoot);
    const wroteRealFile = fs.existsSync(outFile) && fs.statSync(outFile).size > 0;
    if (result.code === 0 && wroteRealFile) {
      return { path: outFile };
    }
    const reason =
      result.code !== 0
        ? `ffmpeg exited ${result.code}: ${result.stderr.slice(-500)}`
        : "ffmpeg exited 0 but wrote no usable frame (missing or empty output) -- the target frame may be past the video's real length";
    return { path: null, error: `${beatId} (${which}): ${reason}` };
  }

  const frames: QcFrame[] = [];
  const warnings: string[] = [];

  for (const beat of beats) {
    const midFrame = Math.round(beat.start + beat.duration / 2);
    const endFrame = Math.round(beat.start + beat.duration - 1);
    const midPath = path.join(outDirAbs, `${beat.id}-mid.jpg`);
    const endPath = path.join(outDirAbs, `${beat.id}-end.jpg`);

    const mid = await extractFrame(midFrame, midPath, beat.id, "mid");
    const end = await extractFrame(endFrame, endPath, beat.id, "end");
    if (mid.error) warnings.push(mid.error);
    if (end.error) warnings.push(end.error);

    frames.push({
      beatId: beat.id,
      midPath: mid.path,
      ...(mid.error ? { midError: mid.error } : {}),
      endPath: end.path,
      ...(end.error ? { endError: end.error } : {}),
    });
  }

  return warnings.length > 0 ? { frames, warnings } : { frames };
}

export function registerQcExtractFrames(server: McpServer): void {
  server.registerTool(
    "qc_extract_frames",
    {
      title: "Extract QC frames for every beat",
      description:
        "Wraps PIPELINE.md's QC frame-extraction step. Reads beats.json, and for every beat computes its " +
        "midpoint frame AND its end frame (PIPELINE.md's QC checklist specifically calls out checking the " +
        "end of every real-screenshot/recording beat, not just the midpoint), extracts each by frame index " +
        "(never by seeking to a timestamp, which is frame-inexact at the boundary) and shells out to ffmpeg " +
        "per beat via child_process.spawn with an argv array (never a shell string). Default videoPath is " +
        "output/<videoName>.mp4, default output dir is output/qc/<videoName>/. Returns " +
        "{ frames: [{ beatId, midPath, endPath }], warnings? }: a beat whose extraction produced no real " +
        "file gets midPath/endPath: null plus a matching midError/endError explaining why, never a path " +
        "that looks valid but points at nothing -- check warnings for a flat list of the same failures.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        videoPath: z.string().optional(),
      },
    },
    async (input) => runTool("qc_extract_frames", () => runQcExtractFrames(input)),
  );
}

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
  midPath: string;
  endPath: string;
}

export interface QcExtractFramesResult {
  frames: QcFrame[];
}

interface BeatLike {
  id: string;
  start: number;
  duration: number;
}

/** Pure argv builder, unit-testable without spawning ffmpeg. */
export function buildFfmpegFrameArgs(videoPath: string, timestampSeconds: number, outFile: string): string[] {
  return [
    "-nostdin",
    "-ss",
    timestampSeconds.toFixed(3),
    "-i",
    videoPath,
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
 * the midpoint), converts to timestamps using the beats file's fps, and shells out to
 * ffmpeg via spawn with an argv array.
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

  const videoPathRel = input.videoPath ?? path.join("out", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, videoPathRel, "videoPath");
  const videoPathAbs = path.join(projectRoot, videoPathRel);
  if (!fs.existsSync(videoPathAbs)) {
    throw new Error(`${videoPathAbs} does not exist. Call render_video first (or pass an explicit videoPath).`);
  }

  const outDirRel = path.join("out", "qc", videoName);
  sanitizeRelativeOutPath(projectRoot, outDirRel, "outDir");
  const outDirAbs = path.join(projectRoot, outDirRel);
  fs.mkdirSync(outDirAbs, { recursive: true });

  const frames: QcFrame[] = [];
  const failures: string[] = [];

  for (const beat of beats) {
    const midFrame = beat.start + beat.duration / 2;
    const endFrame = beat.start + beat.duration - 1;
    const midPath = path.join(outDirAbs, `${beat.id}-mid.jpg`);
    const endPath = path.join(outDirAbs, `${beat.id}-end.jpg`);

    const midResult = await spawnCapture(
      "ffmpeg",
      buildFfmpegFrameArgs(videoPathAbs, midFrame / fps, midPath),
      projectRoot,
    );
    if (midResult.code !== 0) {
      failures.push(`${beat.id} (mid): ffmpeg exited ${midResult.code}: ${midResult.stderr.slice(-500)}`);
    }
    const endResult = await spawnCapture(
      "ffmpeg",
      buildFfmpegFrameArgs(videoPathAbs, endFrame / fps, endPath),
      projectRoot,
    );
    if (endResult.code !== 0) {
      failures.push(`${beat.id} (end): ffmpeg exited ${endResult.code}: ${endResult.stderr.slice(-500)}`);
    }

    frames.push({ beatId: beat.id, midPath, endPath });
  }

  if (failures.length > 0) {
    throw new Error(`ffmpeg frame extraction failed for:\n${failures.join("\n")}`);
  }

  return { frames };
}

export function registerQcExtractFrames(server: McpServer): void {
  server.registerTool(
    "qc_extract_frames",
    {
      title: "Extract QC frames for every beat",
      description:
        "Wraps PIPELINE.md's QC frame-extraction step. Reads beats.json, and for every beat computes its " +
        "midpoint frame AND its end frame (PIPELINE.md's QC checklist specifically calls out checking the " +
        "end of every real-screenshot/recording beat, not just the midpoint), converts frame numbers to " +
        "timestamps using the beats file's fps, and shells out to ffmpeg per beat via child_process.spawn " +
        "with an argv array (never a shell string). Default videoPath is out/<videoName>.mp4, default " +
        "output dir is out/qc/<videoName>/. Returns { frames: [{ beatId, midPath, endPath }] } so the " +
        "calling agent knows exactly which paths to Read as images for its own visual QC pass.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        videoPath: z.string().optional(),
      },
    },
    async (input) => runTool("qc_extract_frames", () => runQcExtractFrames(input)),
  );
}

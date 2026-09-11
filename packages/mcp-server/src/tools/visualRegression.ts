import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import { compareFrames, judgeDrift, type FrameComparison } from "../frameDiff";
import { buildFrameArgs, beatMidpointSeconds } from "./exportRendition";
import { runTool } from "./mcp";

/**
 * A video diff of your own UI.
 *
 * Half of this already existed: qc_extract_frames pulls frames and contact_sheet lays them
 * out. What was missing was the comparison, the threshold, and something to report. Without
 * those, a render on every merge tells you only that the render still works, which is the
 * least interesting thing it could tell you.
 *
 * With them, a merge that changes what the product looks like says so, with the beat named
 * and a diff image showing where. That is the thing nothing else does well: plenty of tools
 * diff a screenshot, almost nothing diffs the moving picture of a product against the last
 * one that shipped.
 *
 * The first run has no baseline, so it writes one and says that is what it did. A tool that
 * fails its first run because nothing to compare against exists yet gets turned off.
 */

export interface VisualRegressionInput {
  projectRoot?: string;
  videoName: string;
  videoPath?: string;
  baselineDir?: string;
  outDir?: string;
  /** Fraction of pixels allowed to move before a beat counts as changed. Defaults to 0.02. */
  changedRatioThreshold?: number;
  meanDeltaThreshold?: number;
  /** Accept the current render as the new baseline. */
  updateBaseline?: boolean;
}

export interface BeatRegression {
  beatId: string;
  status: "unchanged" | "changed" | "new";
  reason: string;
  changedRatio: number;
  meanDelta: number;
  currentFrame: string;
  baselineFrame?: string;
  diffFrame?: string;
}

export interface VisualRegressionResult {
  ok: boolean;
  baselineCreated: boolean;
  baselineUpdated: boolean;
  beats: BeatRegression[];
  changedBeats: string[];
  /** Ready to post as a PR comment. */
  markdown: string;
}

interface BeatLike {
  id: string;
  start: number;
  duration: number;
}

/**
 * The PR comment.
 *
 * Written to be readable when nothing changed, which is most of the time: a check that
 * dumps a table of zeroes onto every pull request trains people to collapse it.
 */
export function buildRegressionMarkdown(result: {
  videoName: string;
  beats: BeatRegression[];
  baselineCreated: boolean;
}): string {
  if (result.baselineCreated) {
    return (
      `**Visual baseline created for \`${result.videoName}\`** (${result.beats.length} beats).\n\n` +
      `There was nothing to compare against yet. The next run diffs against this render.`
    );
  }

  const changed = result.beats.filter((b) => b.status !== "unchanged");
  if (changed.length === 0) {
    return `**No visual change in \`${result.videoName}\`** across ${result.beats.length} beats.`;
  }

  const rows = changed
    .map(
      (b) =>
        `| \`${b.beatId}\` | ${b.status} | ${(b.changedRatio * 100).toFixed(2)}% | ` +
        `${(b.meanDelta * 100).toFixed(2)}% | ${b.reason} |`,
    )
    .join("\n");

  return (
    `**${changed.length} of ${result.beats.length} beats changed visually in \`${result.videoName}\`.**\n\n` +
    `| beat | status | pixels moved | mean delta | why |\n| --- | --- | --- | --- | --- |\n${rows}\n\n` +
    `Diff images are in the run's artifacts. If the change is intended, re-run with ` +
    `\`updateBaseline\` to accept it.`
  );
}

export async function runVisualRegression(input: VisualRegressionInput): Promise<VisualRegressionResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const beatsPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsPath)) throw new Error(`${beatsPath} does not exist.`);
  const doc = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as { fps?: number; beats?: BeatLike[] };
  const beats = doc.beats;
  if (!Array.isArray(beats) || beats.length === 0) throw new Error(`${beatsPath} has no beats.`);
  const fps = doc.fps ?? 30;

  const videoRel = input.videoPath ?? path.join("output", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, videoRel, "videoPath");
  if (!fs.existsSync(path.join(projectRoot, videoRel))) {
    throw new Error(`${videoRel} does not exist. Render the video before diffing it.`);
  }

  const baselineRel = input.baselineDir ?? path.join("output", "visual-baseline", videoName);
  const outRel = input.outDir ?? path.join("output", "visual-diff", videoName);
  sanitizeRelativeOutPath(projectRoot, baselineRel, "baselineDir");
  sanitizeRelativeOutPath(projectRoot, outRel, "outDir");
  const baselineAbs = path.join(projectRoot, baselineRel);
  const outAbs = path.join(projectRoot, outRel);
  fs.mkdirSync(baselineAbs, { recursive: true });
  fs.mkdirSync(outAbs, { recursive: true });

  // Extract this render's frames first, whatever happens next: they become either the
  // comparison set or the new baseline.
  const current: { beat: BeatLike; rel: string }[] = [];
  for (const beat of beats) {
    const rel = path.join(outRel, `${beat.id}.png`);
    const shot = await spawnCapture("ffmpeg", buildFrameArgs(videoRel, beatMidpointSeconds(beat, fps), rel), projectRoot);
    if (shot.code !== 0) throw new Error(`frame extraction failed for "${beat.id}":\n${shot.stderr.slice(-800)}`);
    current.push({ beat, rel });
  }

  const baselineExists = beats.some((b) => fs.existsSync(path.join(baselineAbs, `${b.id}.png`)));
  const acceptAll = input.updateBaseline === true || !baselineExists;

  const results: BeatRegression[] = [];
  for (const { beat, rel } of current) {
    const baselineFileRel = path.join(baselineRel, `${beat.id}.png`);
    const baselineFileAbs = path.join(projectRoot, baselineFileRel);

    if (!fs.existsSync(baselineFileAbs)) {
      fs.copyFileSync(path.join(projectRoot, rel), baselineFileAbs);
      results.push({
        beatId: beat.id,
        status: baselineExists ? "new" : "unchanged",
        reason: baselineExists ? "this beat has no baseline yet, so one was written" : "baseline written",
        changedRatio: 0,
        meanDelta: 0,
        currentFrame: rel,
        baselineFrame: baselineFileRel,
      });
      continue;
    }

    const diffRel = path.join(outRel, `${beat.id}.diff.png`);
    const comparison: FrameComparison = await compareFrames(baselineFileAbs, path.join(projectRoot, rel), {
      diffPath: path.join(projectRoot, diffRel),
    });
    const verdict = judgeDrift(comparison, {
      changedRatio: input.changedRatioThreshold,
      meanDelta: input.meanDeltaThreshold,
    });

    results.push({
      beatId: beat.id,
      status: verdict.drifted ? "changed" : "unchanged",
      reason: verdict.reason,
      changedRatio: comparison.changedRatio,
      meanDelta: comparison.meanDelta,
      currentFrame: rel,
      baselineFrame: baselineFileRel,
      diffFrame: diffRel,
    });

    if (input.updateBaseline === true) {
      fs.copyFileSync(path.join(projectRoot, rel), baselineFileAbs);
    }
  }

  const changedBeats = results.filter((r) => r.status === "changed").map((r) => r.beatId);
  const baselineCreated = !baselineExists;

  return {
    ok: changedBeats.length === 0,
    baselineCreated,
    baselineUpdated: acceptAll && !baselineCreated,
    beats: results,
    changedBeats,
    markdown: buildRegressionMarkdown({ videoName, beats: results, baselineCreated }),
  };
}

export function registerVisualRegression(server: McpServer): void {
  server.registerTool(
    "visual_regression",
    {
      title: "Diff this render's beats against the last accepted one",
      description:
        "Extracts the midpoint frame of every beat from a finished render and compares it against a stored " +
        "baseline, so a merge that changes what the product looks like says so, with the beat named and a " +
        "diff image showing where. Two numbers, because they catch different changes: the fraction of pixels " +
        "that moved past a per-pixel threshold catches a local repaint (one button, one line of text) that " +
        "barely moves the average, and the mean delta catches a global shift (a palette change) that barely " +
        "moves the pixel count. Frames are downscaled before comparison, which is what makes the result " +
        "stable rather than flagging encoder noise and subpixel antialiasing on every run. The first run has " +
        "no baseline, so it writes one and says so instead of failing. Returns a per-beat verdict plus " +
        "markdown ready to post as a PR comment. Pass updateBaseline to accept the current render.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        videoPath: z.string().optional(),
        baselineDir: z.string().optional(),
        outDir: z.string().optional(),
        changedRatioThreshold: z.number().positive().optional(),
        meanDeltaThreshold: z.number().positive().optional(),
        updateBaseline: z.boolean().optional(),
      },
    },
    async (input) => runTool("visual_regression", () => runVisualRegression(input)),
  );
}

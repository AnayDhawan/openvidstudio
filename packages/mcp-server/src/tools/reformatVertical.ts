import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import { runTool } from "./mcp";

/**
 * Reformats a finished 16:9 composition to 9:16, with the crop decided per beat from the
 * manifest rather than by taking the middle of the frame.
 *
 * Automated reframing usually looks wrong for one reason: a fixed centre crop does not
 * know what is on screen. A terminal is text pinned to the left, so centring it cuts the
 * command in half. A phone recording is already portrait and needs no crop at all, only
 * padding. A constructed panel really is centred. The manifest already records which of
 * those each beat is, so the crop can follow the content instead of guessing at it.
 *
 * A beat can override the inference with `vertical.focus` or an explicit `vertical.crop`
 * rectangle, which is the escape hatch for the case where the content is off to one side
 * for a reason the manifest cannot see.
 *
 * Active speaker tracking, the full version of this, needs real face and audio analysis
 * and is deliberately out of scope. This is the manifest-driven crop, which is achievable
 * now and useful on its own.
 */

export type CropFocus = "left" | "center" | "right";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VerticalBeat {
  id: string;
  start: number;
  duration: number;
  visual?: { captureMethod?: string; source?: string };
  vertical?: { focus?: CropFocus; crop?: CropRect };
}

export interface ReformatVerticalInput {
  projectRoot?: string;
  videoName: string;
  inPath?: string;
  outPath?: string;
  /** Target frame. Defaults to 1080x1920, which every short-form platform accepts. */
  width?: number;
  height?: number;
}

export interface BeatCrop {
  beatId: string;
  focus: CropFocus;
  crop: CropRect;
  reason: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ReformatVerticalResult {
  outPath: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  beats: BeatCrop[];
  elapsedSeconds: number;
}

/**
 * What the manifest implies about where the content of a beat sits.
 *
 * These are defaults, not laws: every one of them is overridable per beat, and the reason
 * is reported back so a wrong guess is visible in the result rather than only in the file.
 */
export function inferFocus(beat: VerticalBeat): { focus: CropFocus; reason: string } {
  if (beat.vertical?.focus) {
    return { focus: beat.vertical.focus, reason: "the beat sets vertical.focus explicitly" };
  }
  const source = beat.visual?.source ?? "browser";
  if (source === "terminal") {
    return {
      focus: "left",
      reason: "a terminal is text pinned to the left margin, so a centre crop cuts the command in half",
    };
  }
  if (source === "mobile") {
    return { focus: "center", reason: "a phone recording is already portrait, so the crop is a no-op" };
  }
  if (beat.visual?.captureMethod === "dom-demo") {
    return { focus: "center", reason: "a constructed panel is laid out centred on the stage" };
  }
  return { focus: "center", reason: "a browser capture has no side the manifest knows to prefer" };
}

/**
 * Sizes and offsets round down to even, but a size may never round to zero: a 1px-wide
 * crop is useless and a 0px-wide one is an ffmpeg error, while a 0 offset is correct and
 * common (it is exactly what a left-focused crop wants).
 */
const evenSize = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);
const evenOffset = (n: number): number => Math.max(0, Math.floor(n / 2) * 2);

/**
 * The largest rectangle of the target aspect that fits in the source, positioned by focus.
 *
 * Even dimensions and even offsets throughout: h264 in yuv420p subsamples chroma 2x2, and
 * an odd crop fails at the encoder with an error that says nothing about the real cause.
 */
export function cropRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  focus: CropFocus,
): CropRect {
  const targetRatio = targetWidth / targetHeight;
  let width = evenSize(Math.round(sourceHeight * targetRatio));
  let height = evenSize(sourceHeight);

  if (width > sourceWidth) {
    width = evenSize(sourceWidth);
    height = evenSize(Math.round(sourceWidth / targetRatio));
  }

  const x =
    focus === "left"
      ? 0
      : focus === "right"
        ? evenOffset(sourceWidth - width)
        : evenOffset(Math.round((sourceWidth - width) / 2));
  const y = evenOffset(Math.round((sourceHeight - height) / 2));
  return { x, y, width, height };
}

export function planCrops(opts: {
  beats: VerticalBeat[];
  fps: number;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
}): BeatCrop[] {
  return opts.beats.map((beat) => {
    const { focus, reason } = inferFocus(beat);
    const crop =
      beat.vertical?.crop ??
      cropRect(opts.sourceWidth, opts.sourceHeight, opts.targetWidth, opts.targetHeight, focus);
    return {
      beatId: beat.id,
      focus,
      crop: beat.vertical?.crop
        ? {
            x: evenOffset(beat.vertical.crop.x),
            y: evenOffset(beat.vertical.crop.y),
            width: evenSize(beat.vertical.crop.width),
            height: evenSize(beat.vertical.crop.height),
          }
        : crop,
      reason: beat.vertical?.crop ? "the beat sets an explicit vertical.crop rectangle" : reason,
      startSeconds: beat.start / opts.fps,
      endSeconds: (beat.start + beat.duration) / opts.fps,
    };
  });
}

/**
 * One filter_complex that trims the source per beat, crops each slice on its own terms,
 * and concatenates the result.
 *
 * Done in a single pass rather than as N renders plus a join: the crop differs per beat but
 * the encode does not, so there is nothing to gain from writing intermediates and a
 * generation of quality to lose.
 *
 * `force_original_aspect_ratio=decrease` plus a pad is what handles a beat whose source is
 * already portrait (a phone recording): it fits rather than stretches, and the letterbox is
 * black instead of a distorted face.
 */
export function buildVerticalFilterGraph(
  crops: BeatCrop[],
  targetWidth: number,
  targetHeight: number,
  hasAudio: boolean,
): string {
  const parts: string[] = [];
  crops.forEach((c, i) => {
    parts.push(
      `[0:v]trim=start=${c.startSeconds.toFixed(4)}:end=${c.endSeconds.toFixed(4)},setpts=PTS-STARTPTS,` +
        `crop=${c.crop.width}:${c.crop.height}:${c.crop.x}:${c.crop.y},` +
        `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${i}]`,
    );
    if (hasAudio) {
      parts.push(
        `[0:a]atrim=start=${c.startSeconds.toFixed(4)}:end=${c.endSeconds.toFixed(4)},asetpts=PTS-STARTPTS[a${i}]`,
      );
    }
  });

  const streams = crops.map((_, i) => (hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
  parts.push(`${streams}concat=n=${crops.length}:v=1:a=${hasAudio ? 1 : 0}[vout]${hasAudio ? "[aout]" : ""}`);
  return parts.join(";");
}

export function buildReformatArgs(
  inPath: string,
  outPath: string,
  filterGraph: string,
  hasAudio: boolean,
): string[] {
  const args = ["-nostdin", "-i", inPath, "-filter_complex", filterGraph, "-map", "[vout]"];
  if (hasAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", outPath, "-y");
  return args;
}

export function buildProbeArgs(inPath: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height",
    "-of",
    "json",
    inPath,
  ];
}

interface ProbedStream {
  codec_type?: string;
  width?: number;
  height?: number;
}

export function parseProbe(stdout: string): { width: number; height: number; hasAudio: boolean } {
  const parsed = JSON.parse(stdout) as { streams?: ProbedStream[] };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video?.height) {
    throw new Error("ffprobe found no video stream in the input, so there is nothing to reformat.");
  }
  return { width: video.width, height: video.height, hasAudio: streams.some((s) => s.codec_type === "audio") };
}

export async function runReformatVertical(input: ReformatVerticalInput): Promise<ReformatVerticalResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const targetWidth = input.width ?? 1080;
  const targetHeight = input.height ?? 1920;

  const beatsPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`${beatsPath} does not exist. The crop is driven by the manifest, so it has to be there.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as { fps?: number; beats?: VerticalBeat[] };
  const beats = doc.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error(`${beatsPath} has no beats.`);
  }

  const inPathRel = input.inPath ?? path.join("output", `${videoName}.mp4`);
  const outPathRel = input.outPath ?? path.join("output", `${videoName}-${targetWidth}x${targetHeight}.mp4`);
  sanitizeRelativeOutPath(projectRoot, inPathRel, "inPath");
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const inPathAbs = path.join(projectRoot, inPathRel);
  if (!fs.existsSync(inPathAbs)) {
    throw new Error(`${inPathAbs} does not exist. Render the 16:9 video first, then reformat it.`);
  }
  fs.mkdirSync(path.dirname(path.join(projectRoot, outPathRel)), { recursive: true });

  const started = Date.now();
  const probe = await spawnCapture("ffprobe", buildProbeArgs(inPathRel), projectRoot);
  if (probe.code !== 0) {
    throw new Error(`ffprobe could not read ${inPathRel}:\n${probe.stderr.slice(-800)}`);
  }
  const { width: sourceWidth, height: sourceHeight, hasAudio } = parseProbe(probe.stdout);

  const crops = planCrops({
    beats,
    fps: doc.fps ?? 30,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
  });

  const graph = buildVerticalFilterGraph(crops, targetWidth, targetHeight, hasAudio);
  const result = await spawnCapture("ffmpeg", buildReformatArgs(inPathRel, outPathRel, graph, hasAudio), projectRoot);
  if (result.code !== 0 || !fs.existsSync(path.join(projectRoot, outPathRel))) {
    throw new Error(`ffmpeg reformat failed:\n${result.stderr.slice(-1500)}`);
  }

  return {
    outPath: path.join(projectRoot, outPathRel),
    width: targetWidth,
    height: targetHeight,
    sourceWidth,
    sourceHeight,
    beats: crops,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  };
}

export function registerReformatVertical(server: McpServer): void {
  server.registerTool(
    "reformat_vertical",
    {
      title: "Reformat a finished video to 9:16 using the manifest",
      description:
        "Turns a rendered 16:9 composition into a 9:16 cut for short-form platforms, deciding the crop per " +
        "beat from beats.json instead of taking the middle of every frame. That fixed centre crop is why most " +
        "automated reframing looks wrong: it does not know what is on screen. This does, because the manifest " +
        "already says. A terminal beat crops left, since a terminal is text pinned to the left margin and " +
        "centring it cuts the command in half. A mobile recording is already portrait, so it is fitted and " +
        "padded rather than cropped. A dom-demo panel really is centred. Any beat can override the inference " +
        "with vertical.focus (left, center, right) or an explicit vertical.crop rectangle, and the result " +
        "reports the crop chosen for every beat with the reason, so a wrong guess is visible rather than " +
        "silent. Runs as one ffmpeg pass (trim, crop, scale, pad, concat) rather than N renders and a join, " +
        "so there are no intermediates and no extra generation of quality lost. Active speaker tracking is " +
        "deliberately not in scope: it needs real face and audio analysis. Defaults to 1080x1920 written to " +
        "output/<videoName>-1080x1920.mp4.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        inPath: z.string().optional().describe("The finished 16:9 render. Defaults to output/<videoName>.mp4."),
        outPath: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      },
    },
    async (input) => runTool("reformat_vertical", () => runReformatVertical(input)),
  );
}

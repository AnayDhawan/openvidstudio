import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import { runTool } from "./mcp";

/**
 * Other renderers over the same beats.
 *
 * The capture engine and the manifest do not care that the output is a video. Video is one
 * consumer of them, and it is not always the one a project needs: the most requested
 * artefact in open source is a README GIF, docs want a numbered screenshot set that stays
 * current, and an app listing wants frames at dimensions the store will actually accept.
 * Each of those is a different renderer over the work already done, not a second pipeline.
 *
 * All three read the finished render plus beats.json rather than re-capturing, so the
 * screenshots in the docs are frames of the same footage the video shows. That is what
 * keeps them honest: a screenshot set assembled separately drifts from the video within a
 * release or two, which is the whole problem with hand-made docs images.
 */

export type Rendition = "gif" | "screenshots" | "store-frames" | "poster" | "share" | "reels";

export interface RenditionBeat {
  id: string;
  start: number;
  duration: number;
  vo?: string;
  visual?: { caption?: string; captureMethod?: string };
}

export interface ExportRenditionInput {
  projectRoot?: string;
  videoName: string;
  format: Rendition;
  inPath?: string;
  outDir?: string;
  outPath?: string;
  /** gif only. 12fps and 720px wide keeps a README GIF under a few megabytes. */
  fps?: number;
  width?: number;
  /** store-frames only. */
  device?: StoreDevice;
  /** store-frames only: beats to export. Defaults to every beat. */
  beatIds?: string[];
  /** poster only. Which beat's midpoint to use as the poster frame. Defaults to the last beat. */
  posterBeatId?: string;
  /** poster only. Exact timestamp in seconds, overriding posterBeatId. */
  posterAt?: number;
  /**
   * poster only, when neither posterAt nor posterBeatId is given. "auto" (the default) scores
   * every beat's midpoint frame and takes the one that looks most like a representative
   * picture: not blank, not flat, not near-black or blown out. See scoreFrameStats for exactly
   * what is measured. "last" takes the last beat's midpoint instead (what this tool always did
   * before auto scoring existed); pass it explicitly to keep that behavior.
   */
  posterPick?: "last" | "auto";
  /** share only. The file size cap in megabytes (1MB = 1,000,000 bytes). Defaults to 10. */
  maxMB?: number;
  /** share only. Audio bitrate in kbps when the render has audio. Defaults to 96. */
  audioKbps?: number;
  /**
   * poster only. Also write a copy of the render with the poster baked in as the file's
   * embedded thumbnail (an attached_pic stream, the same mechanism a podcast mp3's cover
   * art uses), so players and file browsers show it instead of a black or mid-motion first
   * frame. Defaults to true. The picture itself is untouched frame-for-frame; only a
   * thumbnail stream is added.
   */
  bake?: boolean;
}

export interface ExportRenditionResult {
  format: Rendition;
  files: string[];
  indexPath?: string;
  /** poster only, when bake was not disabled: the render with the poster baked in as its thumbnail. */
  bakedPath?: string;
  /** poster only, when posterPick was "auto": what was scored and which beat won. */
  posterPick?: { beatId: string; seconds: number; scores: { beatId: string; score: number }[] };
  /** share only: what was actually produced, measured from the file on disk. */
  share?: ShareResult;
  /** reels only: what was actually produced, measured from the file on disk. */
  reels?: ReelsResult;
  notes: string[];
}

export interface ReelsResult {
  path: string;
  bytes: number;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  videoCodec: string;
  /** Null when the source had no audio: none is made up. */
  audioCodec: string | null;
  /** False means the video stream was copied byte for byte and only the container was rewritten. */
  videoReencoded: boolean;
  audioReencoded: boolean;
}

export interface ShareResult {
  path: string;
  bytes: number;
  maxBytes: number;
  withinCap: boolean;
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
  /** Encode attempts it took to land under the cap (1 means the first try fit). */
  attempts: number;
}

/**
 * Exact pixel dimensions each store demands. These are the sizes the review process
 * rejects a submission over, which is precisely why doing this by hand is tedious and
 * doing it from a capture pipeline is nearly free.
 */
export const STORE_DEVICES = {
  "iphone-6.9": { width: 1290, height: 2796, label: "App Store, 6.9 inch iPhone" },
  "iphone-6.5": { width: 1242, height: 2688, label: "App Store, 6.5 inch iPhone" },
  "ipad-13": { width: 2064, height: 2752, label: "App Store, 13 inch iPad" },
  "android-phone": { width: 1080, height: 1920, label: "Play Store, phone" },
  "android-tablet": { width: 1600, height: 2560, label: "Play Store, 10 inch tablet" },
} as const;

export type StoreDevice = keyof typeof STORE_DEVICES;

/** Mid-beat, in seconds. The midpoint is past any transition in and before any transition out. */
export function beatMidpointSeconds(beat: RenditionBeat, fps: number): number {
  return (beat.start + beat.duration / 2) / fps;
}

/**
 * Two-pass GIF, because the one-pass version is why most README GIFs look like that.
 *
 * A GIF is limited to 256 colours. Without a generated palette ffmpeg falls back to a
 * fixed web-safe one and everything banding-dithers into mud, which is the difference
 * between a GIF that sells the product and one that makes it look like a 2003 screencast.
 */
export function buildPaletteArgs(inPath: string, palettePath: string, fps: number, width: number): string[] {
  return [
    "-nostdin",
    "-i",
    inPath,
    "-vf",
    `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    palettePath,
    "-y",
  ];
}

export function buildGifArgs(inPath: string, palettePath: string, outPath: string, fps: number, width: number): string[] {
  return [
    "-nostdin",
    "-i",
    inPath,
    "-i",
    palettePath,
    "-lavfi",
    // bayer dithering rather than the default: it keeps flat UI surfaces flat instead of
    // speckling them, and flat surfaces are most of what a product demo is.
    `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    "-loop",
    "0",
    outPath,
    "-y",
  ];
}

export function buildFrameArgs(inPath: string, seconds: number, outPath: string): string[] {
  // -ss before -i seeks on keyframes, which is fast and can land on the wrong frame. After
  // -i it decodes to the exact timestamp, which is what a documentation screenshot needs.
  return ["-nostdin", "-i", inPath, "-ss", seconds.toFixed(3), "-frames:v", "1", outPath, "-y"];
}

/**
 * One store frame: the shot fitted inside the device's exact canvas, with a dark surround
 * standing in for device chrome.
 *
 * Fitted rather than filled. A store frame that crops the product to fill the canvas
 * removes exactly the UI the screenshot existed to show.
 */
export function buildStoreFrameArgs(
  inPath: string,
  seconds: number,
  outPath: string,
  device: { width: number; height: number },
  bezel: number,
): string[] {
  const innerW = device.width - bezel * 2;
  const innerH = device.height - bezel * 2;
  return [
    "-nostdin",
    "-i",
    inPath,
    "-ss",
    seconds.toFixed(3),
    "-frames:v",
    "1",
    "-vf",
    `scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease,` +
      `pad=${device.width}:${device.height}:(ow-iw)/2:(oh-ih)/2:0x101014`,
    outPath,
    "-y",
  ];
}

/**
 * Attaches a still image to a video as its embedded thumbnail, the mechanism a podcast
 * mp3's cover art uses (an `attached_pic`-disposed stream), rather than by re-encoding the
 * first frame. `-c copy` on the picture stream means the original video and audio are
 * copied byte-for-byte, not re-encoded, so a poster bake never touches the render's actual
 * quality: only a thumbnail stream is added.
 */
export function buildAttachPosterArgs(inPath: string, posterPath: string, outPath: string): string[] {
  return [
    "-nostdin",
    "-i",
    inPath,
    "-i",
    posterPath,
    "-map",
    "0",
    "-map",
    "1",
    "-c",
    "copy",
    "-c:v:1",
    "mjpeg",
    "-disposition:v:1",
    "attached_pic",
    outPath,
    "-y",
  ];
}

/** The docs index. Pairs every shot with what the video says over it, which is already written. */
export function buildScreenshotIndex(videoName: string, entries: { file: string; beat: RenditionBeat }[]): string {
  const rows = entries
    .map(
      ({ file, beat }, i) =>
        `### ${i + 1}. ${beat.visual?.caption ?? beat.id}\n\n` +
        `![${beat.id}](./${file})\n\n` +
        `${beat.vo ?? ""}\n`,
    )
    .join("\n");
  return (
    `# ${videoName} screenshots\n\n` +
    `Generated by openvidstudio's export_rendition from the same render the demo video was cut from, so\n` +
    `these cannot drift from the video. Regenerate rather than editing: this file is overwritten.\n\n` +
    rows
  );
}


// ---------------------------------------------------------------------------------------
// Poster: picking a representative frame
// ---------------------------------------------------------------------------------------

export interface FrameStats {
  /** Mean luma, 0 to 255. */
  mean: number;
  /** Standard deviation of luma, 0 to 255: how much contrast the frame has. */
  stdev: number;
  /** Shannon entropy of the luma histogram, 0 to 8 bits: how much is going on in it. */
  entropy: number;
}

/**
 * Scores one frame as a poster candidate. A good poster is a picture with something in it, so
 * the score is the frame's luma entropy (a flat or empty frame has little, a UI full of text and
 * panels has a lot), scaled down when the frame has almost no contrast (stdev under 40) and cut
 * to 30% when it is near-black or blown out (mean outside 30..225), which is what a fade or a
 * transition frame looks like. It is a heuristic for "not a dud frame", not a taste judgement:
 * pass posterBeatId or posterAt when a specific frame is wanted.
 */
export function scoreFrameStats(stats: FrameStats): number {
  const contrast = Math.min(1, stats.stdev / 40);
  const exposure = stats.mean >= 30 && stats.mean <= 225 ? 1 : 0.3;
  return stats.entropy * contrast * exposure;
}

/** The highest score wins; a tie goes to the earlier beat, since an opening frame is the safer poster. */
export function pickBestScore(scores: { beatId: string; score: number }[]): string {
  let best = scores[0];
  for (const s of scores) if (s.score > best.score) best = s;
  return best.beatId;
}

async function frameStats(file: string): Promise<FrameStats> {
  const st = await sharp(file).greyscale().stats();
  return { mean: st.channels[0].mean, stdev: st.channels[0].stdev, entropy: st.entropy };
}

// ---------------------------------------------------------------------------------------
// Share: an export with a hard size cap
// ---------------------------------------------------------------------------------------

/** Rungs tried from the top, each no taller than the source. */
const SHARE_HEIGHTS = [1080, 720, 540, 480, 360, 240];
/** Bits per pixel per frame below which x264 starts to block and smear. Screen content is forgiving; this is not generous. */
const SHARE_MIN_BPP = 0.05;
/** Share of the cap the plan aims for, leaving room for container overhead and rate control that overshoots. */
const SHARE_BUDGET = 0.92;

export interface SharePlan {
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
  fps: number;
  /** True when even the smallest rung falls under SHARE_MIN_BPP: the cap is tight for this duration. */
  tight: boolean;
}

/**
 * Turns a size cap into an encode: the bitrate that fits (cap, minus the audio, over the
 * duration) and the largest resolution that bitrate can still carry without blocking. A fixed
 * preset cannot do this; it either blows a short clip's budget on nothing or starves a long
 * one. Pure, so the arithmetic is testable without encoding anything.
 */
export function planShareEncode(opts: {
  maxBytes: number;
  durationSec: number;
  srcWidth: number;
  srcHeight: number;
  fps: number;
  hasAudio: boolean;
  audioKbps?: number;
  /** Scales the video bitrate down on a retry after the first attempt landed over the cap. */
  bitrateScale?: number;
}): SharePlan {
  const audioKbps = opts.hasAudio ? (opts.audioKbps ?? 96) : 0;
  const totalKbps = (opts.maxBytes * SHARE_BUDGET * 8) / 1000 / opts.durationSec;
  const videoKbps = Math.max(50, Math.floor((totalKbps - audioKbps) * (opts.bitrateScale ?? 1)));
  const fps = Math.min(opts.fps, 30);

  const rungs = SHARE_HEIGHTS.filter((h) => h <= opts.srcHeight);
  if (rungs.length === 0) rungs.push(opts.srcHeight);
  const dims = (h: number) => ({ w: Math.max(2, Math.round((opts.srcWidth * h) / opts.srcHeight / 2) * 2), h: h - (h % 2) });
  let chosen = dims(rungs[rungs.length - 1]);
  let tight = true;
  for (const h of rungs) {
    const d = dims(h);
    if ((videoKbps * 1000) / (d.w * d.h * fps) >= SHARE_MIN_BPP) {
      chosen = d;
      tight = false;
      break;
    }
  }
  return { width: chosen.w, height: chosen.h, videoKbps, audioKbps, fps, tight };
}

export function buildSharePassArgs(opts: {
  inPath: string;
  outPath: string;
  plan: SharePlan;
  pass: 1 | 2;
  passLog: string;
  hasAudio: boolean;
}): string[] {
  const { plan, pass } = opts;
  const video = [
    "-vf",
    `scale=${plan.width}:${plan.height}:flags=lanczos,fps=${plan.fps}`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    `${plan.videoKbps}k`,
    // A ceiling just above the target and a buffer of two seconds keep rate control from
    // spiking on a scene cut and pushing the file past a cap that the average alone would meet.
    "-maxrate",
    `${Math.round(plan.videoKbps * 1.25)}k`,
    "-bufsize",
    `${plan.videoKbps * 2}k`,
    "-pass",
    String(pass),
    "-passlogfile",
    opts.passLog,
  ];
  if (pass === 1) return ["-nostdin", "-y", "-i", opts.inPath, ...video, "-an", "-f", "null", "-"];
  return [
    "-nostdin",
    "-y",
    "-i",
    opts.inPath,
    ...video,
    ...(opts.hasAudio ? ["-c:a", "aac", "-b:a", `${plan.audioKbps}k`, "-ar", "48000"] : ["-an"]),
    "-movflags",
    "+faststart",
    opts.outPath,
  ];
}

export interface ProbeInfo {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  hasAudio: boolean;
}

export async function probeMedia(inPath: string, cwd: string): Promise<ProbeInfo> {
  const r = await spawnCapture(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", inPath],
    cwd,
  );
  if (r.code !== 0) throw new Error(`ffprobe failed on ${inPath}:\n${r.stderr.slice(-600)}`);
  const doc = JSON.parse(r.stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number; r_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const video = doc.streams?.find((st) => st.codec_type === "video");
  if (!video?.width || !video.height) throw new Error(`${inPath} has no video stream.`);
  const [num, den] = (video.r_frame_rate ?? "30/1").split("/").map(Number);
  const durationSec = Number.parseFloat(doc.format?.duration ?? "");
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error(`${inPath} has no usable duration.`);
  return {
    width: video.width,
    height: video.height,
    fps: den ? num / den : 30,
    durationSec,
    hasAudio: doc.streams?.some((st) => st.codec_type === "audio") ?? false,
  };
}

async function exportShare(opts: {
  projectRoot: string;
  inPathRel: string;
  outRel: string;
  maxMB: number;
  audioKbps?: number;
  notes: string[];
}): Promise<ShareResult> {
  const { projectRoot, inPathRel, outRel, notes } = opts;
  const maxBytes = Math.round(opts.maxMB * 1_000_000);
  const probe = await probeMedia(inPathRel, projectRoot);
  fs.mkdirSync(path.dirname(path.join(projectRoot, outRel)), { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-share-"));
  try {
    const passLog = path.join(work, "pass");
    let scale = 1;
    let plan: SharePlan = planShareEncode({ maxBytes, durationSec: probe.durationSec, srcWidth: probe.width, srcHeight: probe.height, fps: probe.fps, hasAudio: probe.hasAudio, audioKbps: opts.audioKbps });
    if (plan.tight) {
      notes.push(
        `${opts.maxMB}MB is tight for ${probe.durationSec.toFixed(0)}s of video: even ${plan.width}x${plan.height} gets ` +
          `only ${plan.videoKbps}kbps, so expect visible blocking. Raise maxMB or export a shorter cut.`,
      );
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      plan = planShareEncode({ maxBytes, durationSec: probe.durationSec, srcWidth: probe.width, srcHeight: probe.height, fps: probe.fps, hasAudio: probe.hasAudio, audioKbps: opts.audioKbps, bitrateScale: scale });
      for (const pass of [1, 2] as const) {
        const args = buildSharePassArgs({ inPath: inPathRel, outPath: outRel, plan, pass, passLog, hasAudio: probe.hasAudio });
        const r = await spawnCapture("ffmpeg", args, projectRoot);
        if (r.code !== 0) throw new Error(`share encode pass ${pass} failed:\n${r.stderr.slice(-1200)}`);
      }
      const bytes = fs.statSync(path.join(projectRoot, outRel)).size;
      if (bytes <= maxBytes) {
        notes.push(`${(bytes / 1_000_000).toFixed(2)}MB, under the ${opts.maxMB}MB cap, at ${plan.width}x${plan.height}.`);
        return { path: outRel, bytes, maxBytes, withinCap: true, width: plan.width, height: plan.height, videoKbps: plan.videoKbps, audioKbps: plan.audioKbps, attempts: attempt };
      }
      // Over the cap: aim for 3% under it from the size this attempt actually produced.
      scale *= (maxBytes * 0.97) / bytes;
    }
    const bytes = fs.statSync(path.join(projectRoot, outRel)).size;
    notes.push(`Still ${(bytes / 1_000_000).toFixed(2)}MB after 3 attempts, over the ${opts.maxMB}MB cap. Raise maxMB or export a shorter cut.`);
    return { path: outRel, bytes, maxBytes, withinCap: false, width: plan.width, height: plan.height, videoKbps: plan.videoKbps, audioKbps: plan.audioKbps, attempts: 3 };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------
// Reels: a native 9:16 render, packaged for upload
// ---------------------------------------------------------------------------------------

/** The Reels frame: 1080x1920, 30fps, H.264 in yuv420p, AAC audio, moov atom first. */
const REELS = { width: 1080, height: 1920, fps: 30 } as const;
/** How far a source's aspect ratio may sit from 9:16 before it is not a vertical render at all. */
const REELS_ASPECT_TOLERANCE = 0.01;

export interface ReelsSource {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  pixFmt: string;
  audioCodec: string | null;
}

export type ReelsPlan =
  | { ok: false; reason: string }
  | { ok: true; videoReencode: boolean; audioReencode: boolean; scale: boolean; retime: boolean };

/**
 * Decides what a source needs to become a Reels file, and nothing more. A 9:16 source that is
 * already 1080x1920 H.264 yuv420p at 30fps keeps its video stream byte for byte, and AAC audio is
 * copied too; only the container is rewritten so the moov atom leads. A source that is not 9:16 is
 * refused: turning a 16:9 render into a vertical one means cropping or letterboxing it, which
 * cuts diagrams off or shrinks them to a strip, and that is a choice for reformat_vertical or a
 * native render, not something an export step should make silently. Pure, so the rules are
 * testable without encoding anything.
 */
export function planReelsExport(src: ReelsSource): ReelsPlan {
  const aspect = src.width / src.height;
  const target = REELS.width / REELS.height;
  if (Math.abs(aspect - target) / target > REELS_ASPECT_TOLERANCE) {
    return {
      ok: false,
      reason:
        `The source is ${src.width}x${src.height}, not 9:16. A reels export never crops or letterboxes a frame ` +
        `silently. For a finished 16:9 render, use reformat_vertical (it crops per beat from the manifest, and a ` +
        `crop can cut a diagram off). For a lesson with diagrams, render natively vertical instead: init_project ` +
        `with videoConfig { width: 1080, height: 1920 }, then render and export that. PIPELINE.md, "Native ` +
        `vertical (9:16)", says when to use which.`,
    };
  }
  const scale = src.width !== REELS.width || src.height !== REELS.height;
  const retime = Math.abs(src.fps - REELS.fps) > 0.01;
  const videoReencode = scale || retime || src.videoCodec !== "h264" || src.pixFmt !== "yuv420p";
  const audioReencode = src.audioCodec !== null && src.audioCodec !== "aac";
  return { ok: true, videoReencode, audioReencode, scale, retime };
}

export function buildReelsArgs(opts: { inPath: string; outPath: string; plan: Extract<ReelsPlan, { ok: true }>; hasAudio: boolean }): string[] {
  const { plan } = opts;
  const args = ["-nostdin", "-y", "-i", opts.inPath, "-map", "0:v:0"];
  if (opts.hasAudio) args.push("-map", "0:a:0");
  if (plan.videoReencode) {
    const filters = [
      ...(plan.scale ? [`scale=${REELS.width}:${REELS.height}:flags=lanczos`, "setsar=1"] : []),
      ...(plan.retime ? [`fps=${REELS.fps}`] : []),
    ];
    // crf 18 is close to visually lossless; Instagram re-encodes on upload, so the file it receives
    // should be the clean one, not one already compressed hard.
    args.push(...(filters.length ? ["-vf", filters.join(",")] : []), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p");
  } else {
    args.push("-c:v", "copy");
  }
  if (opts.hasAudio) {
    args.push(...(plan.audioReencode ? ["-c:a", "aac", "-b:a", "128k", "-ar", "48000"] : ["-c:a", "copy"]));
  }
  args.push("-movflags", "+faststart", opts.outPath);
  return args;
}

async function probeReelsSource(inPath: string, cwd: string): Promise<ReelsSource & { durationSec: number }> {
  const r = await spawnCapture("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", inPath], cwd);
  if (r.code !== 0) throw new Error(`ffprobe failed on ${inPath}:\n${r.stderr.slice(-600)}`);
  const doc = JSON.parse(r.stdout) as {
    streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; r_frame_rate?: string; disposition?: { attached_pic?: number } }[];
    format?: { duration?: string };
  };
  // A baked poster is a second, one-frame video stream; the picture is the first real one.
  const video = doc.streams?.find((st) => st.codec_type === "video" && !st.disposition?.attached_pic);
  if (!video?.width || !video.height) throw new Error(`${inPath} has no video stream.`);
  const [num, den] = (video.r_frame_rate ?? "30/1").split("/").map(Number);
  const durationSec = Number.parseFloat(doc.format?.duration ?? "");
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error(`${inPath} has no usable duration.`);
  return {
    width: video.width,
    height: video.height,
    fps: den ? num / den : 30,
    videoCodec: video.codec_name ?? "",
    pixFmt: video.pix_fmt ?? "",
    audioCodec: doc.streams?.find((st) => st.codec_type === "audio")?.codec_name ?? null,
    durationSec,
  };
}

async function exportReels(opts: { projectRoot: string; inPathRel: string; outRel: string; notes: string[] }): Promise<ReelsResult> {
  const { projectRoot, inPathRel, outRel, notes } = opts;
  const src = await probeReelsSource(inPathRel, projectRoot);
  const plan = planReelsExport(src);
  if (!plan.ok) throw new Error(plan.reason);
  fs.mkdirSync(path.dirname(path.join(projectRoot, outRel)), { recursive: true });
  const r = await spawnCapture("ffmpeg", buildReelsArgs({ inPath: inPathRel, outPath: outRel, plan, hasAudio: src.audioCodec !== null }), projectRoot);
  if (r.code !== 0) throw new Error(`reels export failed:\n${r.stderr.slice(-1200)}`);

  // Measured from the file on disk, not assumed from the plan.
  const out = await probeReelsSource(outRel, projectRoot);
  const bytes = fs.statSync(path.join(projectRoot, outRel)).size;
  const video = plan.videoReencode ? "re-encoded (the source was not already 1080x1920 H.264 yuv420p at 30fps)" : "copied unchanged";
  const audio =
    src.audioCodec === null
      ? "no audio in the source and none added"
      : plan.audioReencode
        ? `audio ${src.audioCodec} re-encoded to AAC`
        : "audio AAC copied unchanged";
  notes.push(`${out.width}x${out.height} at ${out.fps}fps, ${(bytes / 1_000_000).toFixed(2)}MB. Video ${video}, ${audio}, moov atom first.`);
  if (src.audioCodec === null) {
    notes.push("The source has no audio, so the file has none. Reels accept a silent video; add a music bed first if the reel should have sound.");
  }
  notes.push('Instagram\'s own interface covers part of the top, bottom and right edge of a reel. PIPELINE.md, "Native vertical (9:16)", lists approximate safe zones.');
  return {
    path: outRel,
    bytes,
    width: out.width,
    height: out.height,
    fps: out.fps,
    durationSec: out.durationSec,
    videoCodec: out.videoCodec,
    audioCodec: out.audioCodec,
    videoReencoded: plan.videoReencode,
    audioReencoded: plan.audioReencode,
  };
}

function readBeats(projectRoot: string, videoName: string): { fps: number; beats: RenditionBeat[] } {
  const beatsPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`${beatsPath} does not exist. Every rendition is driven by the manifest.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as { fps?: number; beats?: RenditionBeat[] };
  if (!Array.isArray(doc.beats) || doc.beats.length === 0) throw new Error(`${beatsPath} has no beats.`);
  return { fps: doc.fps ?? 30, beats: doc.beats };
}

export async function runExportRendition(input: ExportRenditionInput): Promise<ExportRenditionResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const { fps, beats } = readBeats(projectRoot, videoName);

  const inPathRel = input.inPath ?? path.join("output", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, inPathRel, "inPath");
  if (!fs.existsSync(path.join(projectRoot, inPathRel))) {
    throw new Error(
      `${inPathRel} does not exist. Every rendition is cut from the finished render, which is what keeps ` +
        `them in step with the video. Run render_video first.`,
    );
  }

  const notes: string[] = [];
  const files: string[] = [];

  if (input.format === "gif") {
    const outRel = input.outPath ?? path.join("output", `${videoName}.gif`);
    sanitizeRelativeOutPath(projectRoot, outRel, "outPath");
    fs.mkdirSync(path.dirname(path.join(projectRoot, outRel)), { recursive: true });
    const gifFps = input.fps ?? 12;
    const gifWidth = input.width ?? 720;
    // Beside the gif, not in a fixed directory: the palette is an intermediate and it gets
    // deleted, but if a run dies between the two passes the leftover should be findable.
    const paletteRel = path.join(path.dirname(outRel), `${videoName}-palette.png`);

    const palette = await spawnCapture("ffmpeg", buildPaletteArgs(inPathRel, paletteRel, gifFps, gifWidth), projectRoot);
    if (palette.code !== 0) throw new Error(`palettegen failed:\n${palette.stderr.slice(-1200)}`);
    const gif = await spawnCapture("ffmpeg", buildGifArgs(inPathRel, paletteRel, outRel, gifFps, gifWidth), projectRoot);
    if (gif.code !== 0) throw new Error(`GIF encode failed:\n${gif.stderr.slice(-1200)}`);
    fs.rmSync(path.join(projectRoot, paletteRel), { force: true });

    const bytes = fs.statSync(path.join(projectRoot, outRel)).size;
    files.push(outRel);
    notes.push(`${(bytes / 1_000_000).toFixed(2)}MB at ${gifWidth}px wide and ${gifFps}fps.`);
    if (bytes > 10_000_000) {
      notes.push(
        "GitHub will render this but it is large for a README. Drop the width or the fps, or export a " +
          "shorter cut, before committing it.",
      );
    }
    return { format: "gif", files, notes };
  }

  if (input.format === "screenshots") {
    const dirRel = input.outDir ?? path.join("docs", "screenshots", videoName);
    sanitizeRelativeOutPath(projectRoot, dirRel, "outDir");
    fs.mkdirSync(path.join(projectRoot, dirRel), { recursive: true });

    const entries: { file: string; beat: RenditionBeat }[] = [];
    for (const [i, beat] of beats.entries()) {
      const name = `${String(i + 1).padStart(2, "0")}-${beat.id}.png`;
      const rel = path.join(dirRel, name);
      const shot = await spawnCapture(
        "ffmpeg",
        buildFrameArgs(inPathRel, beatMidpointSeconds(beat, fps), rel),
        projectRoot,
      );
      if (shot.code !== 0) throw new Error(`frame extraction failed for beat "${beat.id}":\n${shot.stderr.slice(-800)}`);
      files.push(rel);
      entries.push({ file: name, beat });
    }

    const indexRel = path.join(dirRel, "README.md");
    fs.writeFileSync(path.join(projectRoot, indexRel), buildScreenshotIndex(videoName, entries), "utf8");
    notes.push(
      "These are frames of the video itself, so they cannot drift from it. Re-export after a re-render " +
        "rather than editing them.",
    );
    return { format: "screenshots", files, indexPath: indexRel, notes };
  }

  if (input.format === "poster") {
    let atSeconds: number;
    let pickInfo: ExportRenditionResult["posterPick"];
    if (typeof input.posterAt === "number") {
      atSeconds = input.posterAt;
    } else if (!input.posterBeatId && input.posterPick !== "last") {
      // Score every beat's midpoint frame and take the best. Frames go to a temp dir: they are
      // an intermediate, and the winner is re-extracted below like any other poster.
      const work = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-poster-"));
      try {
        const scores: { beatId: string; score: number }[] = [];
        for (const beat of beats) {
          const probeFile = path.join(work, `${beat.id}.png`);
          const r = await spawnCapture("ffmpeg", buildFrameArgs(inPathRel, beatMidpointSeconds(beat, fps), probeFile), projectRoot);
          if (r.code !== 0 || !fs.existsSync(probeFile)) throw new Error(`poster scoring: frame extraction failed for beat "${beat.id}":\n${r.stderr.slice(-600)}`);
          scores.push({ beatId: beat.id, score: Number(scoreFrameStats(await frameStats(probeFile)).toFixed(3)) });
        }
        const winner = beats.find((b) => b.id === pickBestScore(scores))!;
        atSeconds = beatMidpointSeconds(winner, fps);
        pickInfo = { beatId: winner.id, seconds: atSeconds, scores };
        notes.push(`posterPick auto chose beat "${winner.id}" (score ${scores.find((x) => x.beatId === winner.id)!.score}).`);
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    } else {
      const beatId = input.posterBeatId ?? beats[beats.length - 1].id;
      const beat = beats.find((b) => b.id === beatId);
      if (!beat) throw new Error(`No beat "${beatId}" in this video's manifest.`);
      atSeconds = beatMidpointSeconds(beat, fps);
    }

    const posterRel = input.outPath ?? path.join("output", `${videoName}-poster.jpg`);
    sanitizeRelativeOutPath(projectRoot, posterRel, "outPath");
    fs.mkdirSync(path.dirname(path.join(projectRoot, posterRel)), { recursive: true });
    const frame = await spawnCapture(
      "ffmpeg",
      buildFrameArgs(inPathRel, atSeconds, posterRel),
      projectRoot,
    );
    if (frame.code !== 0) throw new Error(`poster frame extraction failed:\n${frame.stderr.slice(-800)}`);
    files.push(posterRel);
    notes.push(`Poster taken at ${atSeconds.toFixed(2)}s.`);

    let bakedPath: string | undefined;
    if (input.bake !== false) {
      const bakedRel = path.join(path.dirname(inPathRel), `${videoName}-poster.mp4`);
      const bake = await spawnCapture(
        "ffmpeg",
        buildAttachPosterArgs(inPathRel, posterRel, bakedRel),
        projectRoot,
      );
      if (bake.code !== 0) throw new Error(`baking the poster into the video failed:\n${bake.stderr.slice(-800)}`);
      files.push(bakedRel);
      bakedPath = bakedRel;
      notes.push(
        `${bakedRel} is the same render with the poster baked in as its embedded thumbnail, video and ` +
          `audio copied unchanged. Swap it in for ${inPathRel} once you are happy with the frame.`,
      );
    }

    return { format: "poster", files, notes, ...(bakedPath ? { bakedPath } : {}), ...(pickInfo ? { posterPick: pickInfo } : {}) };
  }

  if (input.format === "share") {
    const outRel = input.outPath ?? path.join(path.dirname(inPathRel), `${videoName}-share.mp4`);
    sanitizeRelativeOutPath(projectRoot, outRel, "outPath");
    if (path.resolve(projectRoot, outRel) === path.resolve(projectRoot, inPathRel)) {
      throw new Error("outPath is the same file as the input render. Pick a different outPath.");
    }
    const maxMB = input.maxMB ?? 10;
    if (!(maxMB > 0)) throw new Error("maxMB must be a positive number.");
    const share = await exportShare({ projectRoot, inPathRel, outRel, maxMB, audioKbps: input.audioKbps, notes });
    files.push(outRel);
    return { format: "share", files, notes, share };
  }

  if (input.format === "reels") {
    const outRel = input.outPath ?? path.join(path.dirname(inPathRel), `${videoName}-reels.mp4`);
    sanitizeRelativeOutPath(projectRoot, outRel, "outPath");
    if (path.resolve(projectRoot, outRel) === path.resolve(projectRoot, inPathRel)) {
      throw new Error("outPath is the same file as the input render. Pick a different outPath.");
    }
    const reels = await exportReels({ projectRoot, inPathRel, outRel, notes });
    files.push(outRel);
    return { format: "reels", files, notes, reels };
  }

  if (input.format !== "store-frames") {
    throw new Error(`Unknown format "${String(input.format)}". Known: gif, screenshots, store-frames, poster, share, reels.`);
  }
  const deviceKey = input.device ?? "iphone-6.9";
  const device = STORE_DEVICES[deviceKey];
  if (!device) throw new Error(`Unknown device "${deviceKey}". Known: ${Object.keys(STORE_DEVICES).join(", ")}.`);
  const dirRel = input.outDir ?? path.join("output", "store", deviceKey);
  sanitizeRelativeOutPath(projectRoot, dirRel, "outDir");
  fs.mkdirSync(path.join(projectRoot, dirRel), { recursive: true });

  const wanted = input.beatIds?.length ? beats.filter((b) => input.beatIds!.includes(b.id)) : beats;
  if (wanted.length === 0) throw new Error(`None of the requested beatIds exist in this video's manifest.`);

  const bezel = Math.round(device.width * 0.03);
  for (const [i, beat] of wanted.entries()) {
    const rel = path.join(dirRel, `${String(i + 1).padStart(2, "0")}-${beat.id}.png`);
    const shot = await spawnCapture(
      "ffmpeg",
      buildStoreFrameArgs(inPathRel, beatMidpointSeconds(beat, fps), rel, device, bezel),
      projectRoot,
    );
    if (shot.code !== 0) throw new Error(`store frame failed for beat "${beat.id}":\n${shot.stderr.slice(-800)}`);
    files.push(rel);
  }

  notes.push(
    `${device.label}: exactly ${device.width}x${device.height}, which is the dimension the review process ` +
      `rejects a submission over.`,
  );
  notes.push(
    "The shot is fitted inside the canvas rather than filling it. Filling would crop away the UI the " +
      "screenshot exists to show.",
  );
  return { format: "store-frames", files, notes };
}

export function registerExportRendition(server: McpServer): void {
  server.registerTool(
    "export_rendition",
    {
      title: "Export the same beats as a GIF, a docs screenshot set, or store frames",
      description:
        "Video is one consumer of the capture engine and the manifest, not the only one. This renders the " +
        "same finished video into the other artefacts a project actually needs. format: \"gif\" produces a " +
        "README GIF through a real two-pass palette (a one-pass GIF falls back to a fixed 256 colour palette " +
        "and bands flat UI into mud, which is why most README GIFs look the way they do), defaulting to 720px " +
        "at 12fps and warning when the result is too large to commit. format: \"screenshots\" pulls one frame " +
        "per beat at its midpoint into docs/screenshots/<videoName>/ and writes a README.md pairing each shot " +
        "with that beat's narration, so the docs images are frames of the same footage the video shows and " +
        "cannot drift from it. format: \"store-frames\" produces App Store and Play Store images at the exact " +
        "pixel dimensions each store demands (6.9 and 6.5 inch iPhone, 13 inch iPad, Play Store phone and " +
        "tablet), fitting the shot inside the canvas rather than filling it, because filling crops away the " +
        "UI the screenshot exists to show. format: \"poster\" picks one frame (a beat's midpoint, or an exact " +
        "posterAt timestamp) and writes it as <videoName>-poster.jpg, then, unless bake is set to false, also " +
        "writes <videoName>-poster.mp4: the same render with that frame baked in as the file's embedded " +
        "thumbnail (an attached_pic stream, the same mechanism a podcast mp3's cover art uses), copied not " +
        "re-encoded, so video and audio quality are untouched. Skipping this step is why a shared video's idle " +
        "thumbnail is so often a black frame or a mid-motion blur instead of the frame that was actually chosen " +
        "to represent it. By default the frame is chosen by scoring every beat's midpoint (luma entropy and " +
        "contrast, penalising near-black and blown-out frames), posterPick: \"last\" reverts to always taking " +
        "the last beat's midpoint instead. format: \"share\" encodes a copy under a hard size cap " +
        "(maxMB, default 10): the bitrate is computed from the cap and the duration, the largest resolution " +
        "that bitrate can carry is chosen, it is encoded two-pass H.264 with +faststart, and the file on disk " +
        "is measured and re-encoded smaller if it came out over the cap. format: \"reels\" packages a render " +
        "that is already native 9:16 (init_project videoConfig 1080x1920) as an Instagram Reels file: 1080x1920 " +
        "H.264 + AAC at 30fps with the moov atom first, re-encoding only what the source is not already (a " +
        "1080x1920 H.264 AAC 30fps source keeps its streams byte for byte; a 60fps one, or an mp3 track, is " +
        "converted, and a smaller 9:16 one is scaled). It refuses a 16:9 render instead of cropping it, and " +
        "points at reformat_vertical or a native render, since a crop can cut a diagram off. All six formats " +
        "read the finished render plus beats.json rather than re-capturing, so run render_video first.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        format: z.enum(["gif", "screenshots", "store-frames", "poster", "share", "reels"]),
        inPath: z.string().optional().describe("The finished render. Defaults to output/<videoName>.mp4."),
        outDir: z.string().optional(),
        outPath: z.string().optional().describe("gif, poster, share and reels. Reels defaults to output/<videoName>-reels.mp4."),
        fps: z.number().int().positive().optional().describe("gif only. Defaults to 12."),
        width: z.number().int().positive().optional().describe("gif only. Defaults to 720."),
        device: z
          .enum(["iphone-6.9", "iphone-6.5", "ipad-13", "android-phone", "android-tablet"])
          .optional()
          .describe("store-frames only. Defaults to iphone-6.9."),
        beatIds: z.array(z.string()).optional().describe("store-frames only. Defaults to every beat."),
        posterBeatId: z.string().optional().describe("poster only. An exact beat to use instead of letting posterPick choose."),
        posterAt: z.number().optional().describe("poster only. Exact seconds, overriding posterBeatId."),
        bake: z.boolean().optional().describe("poster only. Defaults to true."),
        posterPick: z
          .enum(["last", "auto"])
          .optional()
          .describe('poster only. "auto" (default) scores every beat\'s midpoint and takes the most representative frame; "last" always takes the last beat\'s midpoint instead.'),
        maxMB: z.number().positive().optional().describe("share only. Size cap in megabytes (1MB = 1,000,000 bytes). Defaults to 10."),
        audioKbps: z.number().int().positive().optional().describe("share only. Defaults to 96."),
      },
    },
    async (input) => runTool("export_rendition", () => runExportRendition(input)),
  );
}

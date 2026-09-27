import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { pascalCase } from "./util";

/**
 * Per-beat render caching, so changing one caption does not cost a full re-render.
 *
 * diff_beats can already tell you that exactly one beat changed. Until now the only
 * available response was render_video, which re-renders the whole composition, because
 * Remotion has no partial-render mode. On a five minute video that is 9000 frames for a
 * one word edit, which is slow enough that nobody edits.
 *
 * The way around it is that Remotion does support rendering a frame RANGE. A beat owns a
 * contiguous range (`start` to `start + duration - 1`), so each beat can be rendered to
 * its own segment and the segments concatenated with ffmpeg's concat demuxer under stream
 * copy: no re-encode, no generation loss, and the result is the same bytes the encoder
 * would have produced for that range in one pass.
 *
 * What makes it safe is hashing the real inputs. A segment is reused only when the beat's
 * own JSON, its scene source, every artifact it references, its narration file, and the
 * project-wide inputs that affect every frame (brand tokens, the generated composition,
 * the music bed) are all byte-identical to when that segment was rendered. Anything this
 * cannot see is a correctness bug, so the hash deliberately errs toward including too much:
 * a false cache miss costs one segment render, a false cache hit ships a wrong video.
 */

export const CACHE_VERSION = 2;

export interface CachedSegment {
  hash: string;
  /** Project-relative path, so a cache written on one machine is readable on another. */
  file: string;
  start: number;
  duration: number;
  renderedAt: string;
}

export interface RenderCacheManifest {
  version: number;
  compositionId: string;
  /** Render settings that change every frame, so a draft segment is never reused for a final. */
  renderKey: string;
  segments: Record<string, CachedSegment>;
}

export interface BeatLike {
  id: string;
  start: number;
  duration: number;
  visual?: { assetPath?: string };
  artifacts?: Record<string, string | undefined>;
}

const EMPTY = "0".repeat(64);

function sha256(data: crypto.BinaryLike): string {
  const input = typeof data === "string" || ArrayBuffer.isView(data) ? data : Buffer.from(data);
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Hash of a file's contents, or a fixed sentinel when it does not exist.
 *
 * Absence is hashed rather than skipped: a beat whose screenshot was deleted has genuinely
 * changed, and skipping a missing file would make the deletion invisible to the cache.
 */
export function hashFile(absPath: string): string {
  if (!fs.existsSync(absPath)) return EMPTY;
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) return EMPTY;
  return sha256(fs.readFileSync(absPath));
}

/**
 * Inputs shared by every beat: change any of them and no segment is reusable.
 *
 * brand.ts is here because applyBrand mutates the token objects every scene reads, so a
 * brand change repaints frames whose own scene file never moved. The generated composition
 * is here because it owns the audio layout and the sequence boundaries.
 */
export function globalInputsHash(projectRoot: string, videoName: string, compositionId: string): string {
  const files = [
    path.join(projectRoot, "src", "brand.ts"),
    path.join(projectRoot, "src", "videos", videoName, `${compositionId}.tsx`),
    path.join(projectRoot, "public", "audio", "music-bed.mp3"),
    path.join(projectRoot, "openvidstudio.config.json"),
  ];
  return sha256(files.map(hashFile).join(":"));
}

/** Every file on disk a single beat's frames are drawn from. */
export function beatInputFiles(projectRoot: string, videoName: string, beat: BeatLike): string[] {
  const files: string[] = [
    path.join(projectRoot, "src", "videos", videoName, "scenes", `${pascalCase(beat.id)}.tsx`),
    path.join(projectRoot, "public", "audio", "vo", `${beat.id}.mp3`),
    // Convention paths for each capture kind. Hashing all of them regardless of this
    // beat's captureMethod costs nothing (a missing file hashes to the sentinel) and means
    // a beat that switches from a screenshot to a recording is not mistaken for unchanged.
    path.join(projectRoot, "public", "images", `${beat.id}.png`),
    path.join(projectRoot, "public", "video", `${beat.id}.mp4`),
    path.join(projectRoot, "public", "terminal", `${beat.id}.json`),
  ];
  for (const rel of Object.values(beat.artifacts ?? {})) {
    if (typeof rel === "string" && rel.length > 0) files.push(path.join(projectRoot, rel));
  }
  if (beat.visual?.assetPath) files.push(path.join(projectRoot, beat.visual.assetPath));
  return files;
}

export function beatHash(
  projectRoot: string,
  videoName: string,
  beat: BeatLike,
  globalHash: string,
): string {
  const parts = [
    String(CACHE_VERSION),
    globalHash,
    JSON.stringify(beat),
    ...beatInputFiles(projectRoot, videoName, beat).map(hashFile),
  ];
  return sha256(parts.join(":"));
}

/**
 * Settings that change the pixels of every frame. Kept separate from the per-beat hash so
 * a switch between draft and final invalidates the whole cache in one comparison rather
 * than looking like every beat changed at once.
 */
export function renderKey(opts: { draft?: boolean; width: number; height: number; fps: number }): string {
  return `${opts.draft ? "draft" : "final"}-${opts.width}x${opts.height}@${opts.fps}`;
}

export function cachePath(projectRoot: string, videoName: string): string {
  return path.join(projectRoot, "output", "segments", videoName, "cache.json");
}

export function segmentsDir(projectRoot: string, videoName: string): string {
  return path.join(projectRoot, "output", "segments", videoName);
}

export function readCache(projectRoot: string, videoName: string): RenderCacheManifest | null {
  const p = cachePath(projectRoot, videoName);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as RenderCacheManifest;
    return parsed.version === CACHE_VERSION ? parsed : null;
  } catch {
    // A half-written manifest is a reason to re-render everything, not to fail the render.
    return null;
  }
}

export function writeCache(projectRoot: string, videoName: string, manifest: RenderCacheManifest): void {
  const p = cachePath(projectRoot, videoName);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

export interface SegmentPlan {
  beatId: string;
  hash: string;
  /** Project-relative. */
  file: string;
  firstFrame: number;
  lastFrame: number;
  reused: boolean;
}

/**
 * Decides, per beat, whether the existing segment can be reused.
 *
 * A cache entry is trusted only if the hash matches, the render settings match, AND the
 * segment file is still on disk: a manifest that outlived its own output is the commonest
 * way a cache lies.
 */
export function planSegments(opts: {
  projectRoot: string;
  videoName: string;
  compositionId: string;
  beats: BeatLike[];
  renderKey: string;
  cache: RenderCacheManifest | null;
}): { plan: SegmentPlan[]; globalHash: string } {
  const { projectRoot, videoName, compositionId, beats, cache } = opts;
  const globalHash = globalInputsHash(projectRoot, videoName, compositionId);
  const usable = cache && cache.renderKey === opts.renderKey && cache.compositionId === compositionId ? cache : null;

  const plan = beats.map((beat) => {
    const hash = beatHash(projectRoot, videoName, beat, globalHash);
    // Posix separators, deliberately: this string is written into a manifest that should
    // still read correctly if the project is opened on another platform.
    const file = `output/segments/${videoName}/${beat.id}.mp4`;
    const cached = usable?.segments[beat.id];
    const reused =
      Boolean(cached) &&
      cached!.hash === hash &&
      cached!.start === beat.start &&
      cached!.duration === beat.duration &&
      fs.existsSync(path.join(projectRoot, file));
    return {
      beatId: beat.id,
      hash,
      file,
      firstFrame: beat.start,
      lastFrame: beat.start + beat.duration - 1,
      reused,
    };
  });

  return { plan, globalHash };
}

/**
 * Remotion's frame-range render, for one beat.
 *
 * `--enforce-audio-track` is not optional here. A beat with no narration renders with no
 * audio stream at all, and the concat demuxer under stream copy cannot join a segment that
 * has an audio track to one that does not: it either fails or silently drops the audio for
 * the rest of the file. Forcing a silent track onto every segment costs nothing and makes
 * the streams uniform, which is the precondition for copying rather than re-encoding.
 */
export function buildSegmentRenderArgs(
  compositionId: string,
  outPath: string,
  firstFrame: number,
  lastFrame: number,
  opts: { draft?: boolean; concurrency?: number } = {},
): { command: string; args: string[] } {
  const args = ["remotion", "render", compositionId, outPath, `--frames=${firstFrame}-${lastFrame}`, "--enforce-audio-track"];
  if (opts.draft) args.push("--scale=0.5", "--crf=32", "--x264-preset=veryfast");
  if (opts.concurrency && opts.concurrency > 0) args.push(`--concurrency=${Math.floor(opts.concurrency)}`);
  args.push("--log=verbose");
  return { command: process.platform === "win32" ? "npx.cmd" : "npx", args };
}

/**
 * concat demuxer list. Paths are single-quoted with embedded quotes escaped per ffmpeg's
 * own rules, and written relative to the list file's directory so the list is portable.
 */
export function buildConcatList(segmentFiles: string[]): string {
  return segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

export function buildConcatArgs(listPath: string, outPath: string): string[] {
  return [
    "-nostdin",
    "-f",
    "concat",
    // The list holds relative names; -safe 0 is what allows anything but a bare basename.
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outPath,
    "-y",
  ];
}

/**
 * Sample-exact audio join for the incremental render's concat step.
 *
 * Each per-beat segment is rendered separately and its AAC track ends up a little longer
 * than its video: the encoder pads to a full AAC frame (1024 samples), typically tens of ms
 * per segment. Stream-copying every segment's audio track under the same concat demuxer that
 * joins the video stacks that padding beat over beat, so a 16-beat video can end with its
 * audio visibly behind its video even though every individual segment looks fine in
 * isolation. The fix joins video and audio through two different paths: video stays a
 * gapless stream copy (no per-segment padding on the video side), audio is decoded to raw
 * PCM per segment, trimmed or padded to exactly `duration/fps` seconds, concatenated as raw
 * samples, and encoded to AAC once at the end -- so the only rounding that can happen is
 * inside a single final encode, not once per beat.
 */
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // s16le

export function pcmFileName(beatId: string): string {
  return `${beatId}.pcm`;
}

/** ffmpeg args to decode one segment's audio to raw interleaved s16le PCM. */
export function buildExtractPcmArgs(segmentFile: string, pcmOutPath: string): string[] {
  return [
    "-nostdin",
    "-i",
    segmentFile,
    "-vn",
    "-ar",
    String(AUDIO_SAMPLE_RATE),
    "-ac",
    String(AUDIO_CHANNELS),
    "-f",
    "s16le",
    "-y",
    pcmOutPath,
  ];
}

/** Exact PCM byte length for a beat of `durationFrames` at `fps`, at the canonical rate above. */
export function expectedPcmBytes(durationFrames: number, fps: number): number {
  const samples = Math.round((durationFrames / fps) * AUDIO_SAMPLE_RATE);
  return samples * AUDIO_CHANNELS * BYTES_PER_SAMPLE;
}

/**
 * Trims or zero-pads (silence) a PCM buffer to exactly `expectedBytes`. Pure and
 * frame-count-based, so this is what makes the join sample-exact rather than
 * "close, rounded to whatever the codec happened to produce."
 */
export function fitPcmLength(buf: Buffer, expectedBytes: number): Buffer {
  if (buf.length === expectedBytes) return buf;
  if (buf.length > expectedBytes) return buf.subarray(0, expectedBytes);
  const out = Buffer.alloc(expectedBytes);
  buf.copy(out);
  return out;
}

/**
 * Strips a segment's audio into its own fresh container.
 *
 * This has to happen before concatenation, not as an `-an` flag on the concat step itself:
 * each beat's segment is muxed with audio deliberately longer than its video (the padding
 * this whole join exists to defeat), so the segment's own container-level duration reflects
 * that longer audio track, not the true video length. The concat demuxer trusts each input's
 * container duration to place the next file's start, so concatenating the original segments
 * with `-an` still leaves a gap at every join equal to that segment's audio overrun -- the
 * video track ends up gapful, just silent instead of desynced. Re-muxing video-only into its
 * own container first drops that stale duration along with the audio, so the isolated file's
 * own duration is the true one and concatenation is actually gapless.
 */
export function buildIsolateVideoArgs(segmentFile: string, videoOnlyOutPath: string): string[] {
  return ["-nostdin", "-i", segmentFile, "-an", "-c:v", "copy", "-y", videoOnlyOutPath];
}

export function videoOnlyFileName(beatId: string): string {
  return `_vo-${beatId}.mp4`;
}

/** Video-only stream copy over already-isolated per-segment files: gapless picture track. */
export function buildVideoOnlyConcatArgs(listPath: string, outPath: string): string[] {
  return ["-nostdin", "-f", "concat", "-safe", "0", "-i", listPath, "-an", "-c", "copy", "-y", outPath];
}

/**
 * Final mux: the gapless video-only file plus one raw-PCM audio input (already the exact
 * concatenation of every beat's trimmed/padded PCM), encoded to AAC exactly once.
 */
export function buildFinalMuxArgs(videoOnlyPath: string, concatPcmPath: string, outPath: string): string[] {
  return [
    "-nostdin",
    "-i",
    videoOnlyPath,
    "-f",
    "s16le",
    "-ar",
    String(AUDIO_SAMPLE_RATE),
    "-ac",
    String(AUDIO_CHANNELS),
    "-i",
    concatPcmPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-y",
    outPath,
  ];
}

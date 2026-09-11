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
  return crypto.createHash("sha256").update(data).digest("hex");
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

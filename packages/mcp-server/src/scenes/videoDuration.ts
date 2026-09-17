import { execFileSync } from "node:child_process";

/**
 * Real duration of a video file on disk, in whole frames at `fps`, via ffprobe.
 *
 * scaffold_scene runs synchronously (like pngSize, a plain fs read), so this shells out
 * with execFileSync rather than the async spawnCapture the capture tools use -- there is
 * no concurrent work here for an async call to overlap with. ffprobe is not a new
 * dependency: capture_screen_recording already requires it alongside ffmpeg for the same
 * best-effort duration lookup (see its own probeDurationMs).
 *
 * Returns null (never throws) when ffprobe is missing or the file can't be probed, so a
 * beat scaffolded before capture_screen_recording ran, or on a machine without ffmpeg
 * installed yet, degrades to the old "no hold" behaviour instead of failing scaffold_scene
 * outright.
 */
export function probeVideoDurationFrames(filePath: string, fps: number): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const seconds = Number.parseFloat(out.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.round(seconds * fps);
  } catch {
    return null;
  }
}

/**
 * Capture backends that do not involve a browser.
 *
 * Playwright is the right tool for a web app and the wrong tool for everything else.
 * A desktop application, a mobile app, a terminal, or an OS itself has no URL to
 * navigate to, and until this module existed every beat about one of them degraded to
 * `dom-demo`: a hand-drawn panel standing in for software the pipeline could not film.
 * The Day 3 validation test made the cost concrete, producing shot plans for Omarchy
 * (a Linux distribution) and Hermes Agent (a terminal agent) in which 100% of beats
 * were reconstructions, against a product whose entire pitch is that nothing on screen
 * is generated.
 *
 * Everything here is an argv builder plus a thin spawn wrapper. ffmpeg and adb are
 * real executables, never shell shims, so `spawnCapture` runs them with shell:false and
 * an argv array; no argument is ever concatenated into a command line. That is why a
 * window title containing spaces or quotes is safe to pass through verbatim.
 */

import { spawn } from "node:child_process";
import type { SpawnResult } from "./util";

export type DesktopPlatform = "win32" | "darwin" | "linux";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopCaptureOptions {
  /** Omit to capture the whole display. On win32 this maps to gdigrab's `title=` selector. */
  window?: string;
  region?: Region;
  /** Display index. win32 ignores this (gdigrab captures the virtual desktop). */
  display?: number;
  framerate: number;
  durationSeconds: number;
  outPath: string;
  platform: DesktopPlatform;
}

/**
 * h264 in yuv420p requires even dimensions, and a hand-picked region is very often
 * odd on one axis. Without this filter a 1365-wide capture fails at the encoder with
 * an error that says nothing about the real cause.
 */
const EVEN_DIMENSIONS = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

/** Shared output encoding: matches buildFfmpegTranscodeArgs so Remotion's OffthreadVideo can seek the result. */
function encodeArgs(outPath: string, extraFilter?: string): string[] {
  const filter = extraFilter ? `${extraFilter},${EVEN_DIMENSIONS}` : EVEN_DIMENSIONS;
  return ["-vf", filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath, "-y"];
}

/**
 * Pure argv builder for a native screen/window recording, per platform.
 *
 * win32   gdigrab, which can address a window by title without it being focused
 * darwin  avfoundation, which can only grab a whole display, so a region becomes a crop
 * linux   x11grab, which takes the region directly in its input spec
 */
export function buildDesktopCaptureArgs(opts: DesktopCaptureOptions): string[] {
  const { platform, framerate, durationSeconds, outPath, region, window, display = 0 } = opts;
  const args = ["-nostdin", "-f"];

  if (platform === "win32") {
    args.push("gdigrab", "-framerate", String(framerate));
    if (region && !window) {
      args.push(
        "-offset_x", String(region.x),
        "-offset_y", String(region.y),
        "-video_size", `${region.width}x${region.height}`,
      );
    }
    args.push("-i", window ? `title=${window}` : "desktop");
    args.push("-t", String(durationSeconds));
    // A window capture plus a region means "crop within the window", which gdigrab
    // cannot express in its input spec, so it becomes a filter instead.
    return args.concat(
      encodeArgs(outPath, window && region ? `crop=${region.width}:${region.height}:${region.x}:${region.y}` : undefined),
    );
  }

  if (platform === "darwin") {
    args.push("avfoundation", "-framerate", String(framerate), "-i", `${display}:none`, "-t", String(durationSeconds));
    return args.concat(
      encodeArgs(outPath, region ? `crop=${region.width}:${region.height}:${region.x}:${region.y}` : undefined),
    );
  }

  args.push("x11grab", "-framerate", String(framerate));
  if (region) {
    args.push("-video_size", `${region.width}x${region.height}`, "-i", `:${display}.0+${region.x},${region.y}`);
  } else {
    args.push("-i", `:${display}.0`);
  }
  args.push("-t", String(durationSeconds));
  return args.concat(encodeArgs(outPath));
}

/**
 * Android capture runs on the device and writes there, because `adb exec-out` streaming
 * is unreliable across OEM builds in a way that silently truncates recordings.
 * `screenrecord` self-terminates at --time-limit, so nothing here needs to kill a process.
 */
export function buildAdbRecordArgs(devicePath: string, durationSeconds: number, deviceId?: string): string[] {
  const prefix = deviceId ? ["-s", deviceId] : [];
  return [...prefix, "shell", "screenrecord", "--time-limit", String(durationSeconds), devicePath];
}

export function buildAdbPullArgs(devicePath: string, localPath: string, deviceId?: string): string[] {
  const prefix = deviceId ? ["-s", deviceId] : [];
  return [...prefix, "pull", devicePath, localPath];
}

export function buildAdbCleanupArgs(devicePath: string, deviceId?: string): string[] {
  const prefix = deviceId ? ["-s", deviceId] : [];
  return [...prefix, "shell", "rm", "-f", devicePath];
}

/** iOS Simulator. `simctl recordVideo` runs until interrupted, so the caller stops it on a timer. */
export function buildSimctlRecordArgs(outPath: string, udid = "booted"): string[] {
  return ["simctl", "io", udid, "recordVideo", "--codec", "h264", "--force", outPath];
}

/**
 * screenrecord and simctl both emit mp4 already, but neither writes a faststart atom,
 * so Remotion can decode them and cannot seek them. This is a remux, not a re-encode:
 * no quality is lost and it takes about a second.
 */
export function buildRemuxArgs(inputPath: string, outputPath: string): string[] {
  return ["-nostdin", "-i", inputPath, "-c", "copy", "-movflags", "+faststart", outputPath, "-y"];
}

/**
 * Spawn that stops the child after `timeoutMs` and treats that stop as success.
 * `simctl recordVideo` has no duration flag: it records until it receives a signal, so
 * "ran the full duration and was then stopped" is the normal, expected path here rather
 * than a failure.
 */
export function spawnForDuration(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<SpawnResult & { stoppedByTimer: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    let stoppedByTimer = false;

    const timer = setTimeout(() => {
      stoppedByTimer = true;
      // SIGINT, not SIGKILL: simctl finalizes the mp4 container on interrupt, and a
      // hard kill leaves an unplayable file.
      child.kill("SIGINT");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref?.();
    }, timeoutMs);

    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, stoppedByTimer });
    });
  });
}

const SAFE_DEVICE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function sanitizeDeviceId(value: string): string {
  if (!SAFE_DEVICE_ID.test(value)) {
    throw new Error(
      `deviceId "${value}" is not a valid device identifier. Expected an adb serial or a simulator UDID ` +
        `(letters, numbers, ".", "_", ":", "-").`,
    );
  }
  return value;
}

/**
 * gdigrab parses its input as `title=<everything after the equals sign>`, so a title
 * containing a newline or a NUL truncates the selector and silently captures the wrong
 * thing. Spaces and quotes are fine: shell:false means the argv entry is passed intact.
 */
export function sanitizeWindowTitle(value: string): string {
  if (value.length === 0 || value.length > 256 || /[\r\n\0]/.test(value)) {
    throw new Error(`window title is invalid: it must be 1-256 characters and contain no newlines.`);
  }
  return value;
}

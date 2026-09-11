import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import {
  buildDesktopCaptureArgs,
  sanitizeWindowTitle,
  type DesktopPlatform,
  type Region,
} from "@openvidstudio/capture";
import { runTool } from "./mcp";

export interface CaptureDesktopInput {
  projectRoot?: string;
  beatId: string;
  window?: string;
  region?: Region;
  display?: number;
  durationSeconds: number;
  framerate?: number;
  outPath?: string;
}

export interface CaptureDesktopResult {
  outPath: string;
  platform: DesktopPlatform;
  durationSeconds: number;
  framerate: number;
  window?: string;
  region?: Region;
}

const regionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

function currentPlatform(): DesktopPlatform {
  const p = process.platform;
  if (p === "win32" || p === "darwin" || p === "linux") return p;
  throw new Error(
    `capture_desktop does not support platform "${p}". Supported: win32 (gdigrab), darwin (avfoundation), linux (x11grab).`,
  );
}

/**
 * The failure modes here are all environmental and all have specific fixes, so they get
 * specific messages. A generic "ffmpeg exited 1" sends the caller to read an ffmpeg log
 * for a problem that is usually a permissions dialog or a mistyped window title.
 */
function explainFailure(platform: DesktopPlatform, stderr: string, window?: string): string {
  const tail = stderr.slice(-1200);
  if (platform === "win32" && window && /Could not find window|gdigrab/i.test(tail)) {
    return (
      `No window matched the title "${window}". gdigrab matches the FULL window title exactly, not a substring, ` +
      `and the window must not be minimized. List candidates with: powershell "Get-Process | Where-Object ` +
      `{$_.MainWindowTitle} | Select-Object MainWindowTitle". Original ffmpeg output:\n${tail}`
    );
  }
  if (platform === "darwin" && /Operation not permitted|not authorized|avfoundation/i.test(tail)) {
    return (
      `macOS refused the screen capture. Grant Screen Recording permission to the terminal or agent process in ` +
      `System Settings > Privacy & Security > Screen Recording, then restart that process (the permission is ` +
      `only re-read at launch). Original ffmpeg output:\n${tail}`
    );
  }
  if (platform === "linux" && /Cannot open display|x11grab/i.test(tail)) {
    return (
      `x11grab could not open the display. Check that DISPLAY is set, and note that a Wayland session needs ` +
      `XWayland or a pipewire-based capture instead, which this tool does not yet implement. ` +
      `Original ffmpeg output:\n${tail}`
    );
  }
  return `ffmpeg desktop capture failed:\n${tail}`;
}

export async function runCaptureDesktop(input: CaptureDesktopInput): Promise<CaptureDesktopResult> {
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const platform = currentPlatform();
  const framerate = input.framerate ?? 30;
  const window = input.window ? sanitizeWindowTitle(input.window) : undefined;

  if (!(input.durationSeconds > 0)) {
    throw new Error("durationSeconds must be a positive number: a desktop capture has no natural end to detect.");
  }

  const outPathRel = input.outPath ?? path.join("public", "video", `${beatId}.mp4`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const outPathAbs = path.join(projectRoot, outPathRel);
  fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });

  const args = buildDesktopCaptureArgs({
    platform,
    window,
    region: input.region,
    display: input.display,
    framerate,
    durationSeconds: input.durationSeconds,
    outPath: outPathAbs,
  });

  const result = await spawnCapture("ffmpeg", args, projectRoot);
  if (result.code !== 0 || !fs.existsSync(outPathAbs)) {
    throw new Error(explainFailure(platform, result.stderr, window));
  }

  return {
    outPath: outPathAbs,
    platform,
    durationSeconds: input.durationSeconds,
    framerate,
    ...(window ? { window } : {}),
    ...(input.region ? { region: input.region } : {}),
  };
}

export function registerCaptureDesktop(server: McpServer): void {
  server.registerTool(
    "capture_desktop",
    {
      title: "Record a desktop application, window, or whole screen",
      description:
        "Records real software that has no URL: a desktop app, a native window, an editor, a game, an OS shell. " +
        "This is the non-browser sibling of capture_screen_recording, and it exists because Playwright can only " +
        "drive a web page, which meant every beat about a CLI tool or desktop application previously degraded to " +
        "a hand-authored dom-demo panel. Drives ffmpeg directly (already a dependency) with the right capture " +
        "device per platform: gdigrab on Windows, avfoundation on macOS, x11grab on Linux. Pass `window` to " +
        "record a single window by its title (Windows matches the FULL title exactly and the window must not be " +
        "minimized), `region` to capture or crop to a rectangle, or neither to record the whole display. " +
        "`durationSeconds` is required because a screen has no natural end to detect. Output is h264/yuv420p " +
        "with +faststart and forced-even dimensions, so Remotion's OffthreadVideo can seek it, written by " +
        "default to public/video/<beatId>.mp4 matching scaffold_scene's real-recording convention. Permission " +
        "and window-not-found failures return the specific fix for this platform rather than a raw ffmpeg dump. " +
        "For a terminal session prefer capture_terminal, which produces a themeable, resolution-independent " +
        "recording rather than pixels.",
      inputSchema: {
        projectRoot: z.string().optional(),
        beatId: z.string().min(1),
        window: z.string().optional().describe("Window title. Windows matches the full title exactly, not a substring."),
        region: regionSchema.optional().describe("Rectangle to capture, or to crop to when combined with `window`."),
        display: z.number().int().min(0).optional().describe("Display index. Ignored on Windows."),
        durationSeconds: z.number().positive(),
        framerate: z.number().int().positive().optional(),
        outPath: z.string().optional(),
      },
    },
    async (input) => runTool("capture_desktop", () => runCaptureDesktop(input)),
  );
}

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import {
  DEFAULT_VIEWPORT,
  detectAndCompensateZoom,
  interactionSchema,
  launchChromium,
  replayInteractions,
  viewportSchema,
  type Interaction,
  type Viewport,
} from "../capture";
import { runTool } from "./mcp";

export interface CaptureScreenRecordingInput {
  projectRoot?: string;
  beatId: string;
  url: string;
  viewport?: Viewport;
  interactions?: Interaction[];
  outPath?: string;
}

export interface CaptureScreenRecordingResult {
  outPath: string;
  width: number;
  height: number;
  zoom: number;
  durationMs?: number;
}

/**
 * Pure argv builder, unit-testable without spawning ffmpeg. Remotion's
 * OffthreadVideo needs a seekable format, so Playwright's webm output gets
 * transcoded to mp4 (h264/yuv420p, +faststart) -- same spawn/argv-array
 * discipline as render_video/qc_extract_frames.
 */
export function buildFfmpegTranscodeArgs(inputPath: string, outputPath: string): string[] {
  return ["-nostdin", "-i", inputPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath, "-y"];
}

/** Pure argv builder for the best-effort ffprobe duration lookup. */
export function buildFfprobeDurationArgs(filePath: string): string[] {
  return ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath];
}

/**
 * Best-effort duration via ffprobe. Not a new dependency (ffprobe ships
 * alongside the ffmpeg this tool already requires for the transcode); if it's
 * missing or fails, this silently returns undefined rather than failing the
 * whole capture over a nice-to-have field.
 */
async function probeDurationMs(filePath: string, cwd: string): Promise<number | undefined> {
  try {
    const result = await spawnCapture("ffprobe", buildFfprobeDurationArgs(filePath), cwd);
    if (result.code !== 0) return undefined;
    const seconds = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
  } catch {
    return undefined;
  }
}

export async function runCaptureScreenRecording(
  input: CaptureScreenRecordingInput,
): Promise<CaptureScreenRecordingResult> {
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const target = input.viewport ?? DEFAULT_VIEWPORT;

  const outPathRel = input.outPath ?? path.join("public", "video", `${beatId}.mp4`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const outPathAbs = path.join(projectRoot, outPathRel);

  const browser = await launchChromium();
  try {
    // Phase 1: a throwaway context/page to detect+compensate zoom (steps 1-2 of
    // CAPTURE.md, via the shared helper). Playwright's recordVideo.size can only be set
    // at context creation, before any page exists, so the compensated size has to be
    // known before the real recording context is opened -- this probe pass is what
    // makes that possible without guessing.
    const probeContext = await browser.newContext();
    let zoom: number;
    let compensatedViewport: Viewport;
    try {
      const probePage = await probeContext.newPage();
      await probePage.setViewportSize(target);
      await probePage.goto(input.url, { waitUntil: "load" });
      const compensation = await detectAndCompensateZoom(probePage, target);
      zoom = compensation.zoom;
      compensatedViewport = compensation.viewport;
    } finally {
      await probeContext.close();
    }

    // Phase 2: the real recording context, sized at the compensated (not originally
    // requested) viewport -- same reasoning as capture_screenshot.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-capture-"));
    let webmPath: string;
    try {
      const recordContext = await browser.newContext({
        viewport: compensatedViewport,
        recordVideo: { dir: tmpDir, size: compensatedViewport },
      });
      try {
        const page = await recordContext.newPage();
        await page.goto(input.url, { waitUntil: "load" });
        await replayInteractions(page, input.interactions);
        const video = page.video();
        if (!video) {
          throw new Error("Playwright did not attach a Video to this page -- recordVideo may not be active.");
        }
        // Closing the context is what flushes the recorded video to disk; it doesn't
        // exist as a real file before this.
        await recordContext.close();
        webmPath = await video.path();
      } catch (err) {
        await recordContext.close().catch(() => {});
        throw err;
      }

      fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });
      const transcodeResult = await spawnCapture(
        "ffmpeg",
        buildFfmpegTranscodeArgs(webmPath, outPathAbs),
        projectRoot,
      );
      if (transcodeResult.code !== 0) {
        throw new Error(`ffmpeg webm->mp4 transcode failed (exit ${transcodeResult.code}): ${transcodeResult.stderr.slice(-1000)}`);
      }

      const durationMs = await probeDurationMs(outPathAbs, projectRoot);

      return {
        outPath: outPathAbs,
        width: compensatedViewport.width,
        height: compensatedViewport.height,
        zoom,
        ...(durationMs !== undefined ? { durationMs } : {}),
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
  }
}

export function registerCaptureScreenRecording(server: McpServer): void {
  server.registerTool(
    "capture_screen_recording",
    {
      title: "Capture a zoom-compensated, full-viewport screen recording",
      description:
        "Internalizes CAPTURE.md's recording protocol as one atomic call, driving a real headless Chromium " +
        "directly via the `playwright` package (not a separate Playwright MCP server). Runs the same " +
        "zoom-desync detection/compensation as capture_screenshot on a throwaway probe page first (Playwright's " +
        "recordVideo.size can only be set when the context is created, so the compensated size must be known " +
        "before recording starts), then opens the real recording context at that compensated size, navigates, " +
        "and replays `interactions` in array order. v1 scope is fixed full-viewport recordings only -- no " +
        "post-hoc DOM-rect cropping of a moving recording, that's future work. Closing the context flushes " +
        "Playwright's webm to disk, which is then transcoded to mp4 via ffmpeg (spawn, argv array, same " +
        "discipline as render_video/qc_extract_frames) since Remotion's OffthreadVideo needs a seekable " +
        "format; the intermediate webm and temp recording dir are cleaned up after. Default outPath is " +
        "public/video/<beatId>.mp4 under projectRoot, matching scaffold_scene's real-recording convention. " +
        "Returns { outPath, width, height, zoom, durationMs? } -- durationMs is a best-effort ffprobe lookup, " +
        "omitted (not failed) if ffprobe isn't available. Requires Chromium to be installed for Playwright " +
        "first: run \"npx playwright install chromium\" once wherever this package is installed; a missing " +
        "browser fails with a message telling you to do exactly that, not a cryptic native error.",
      inputSchema: {
        projectRoot: z.string().optional(),
        beatId: z.string().min(1),
        url: z.string().min(1),
        viewport: viewportSchema.optional(),
        interactions: z.array(interactionSchema).optional(),
        outPath: z.string().optional(),
      },
    },
    async (input) => runTool("capture_screen_recording", () => runCaptureScreenRecording(input)),
  );
}

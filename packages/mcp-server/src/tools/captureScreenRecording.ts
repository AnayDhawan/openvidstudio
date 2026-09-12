import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import {
  DEFAULT_DEVICE_SCALE,
  DEFAULT_VIEWPORT,
  screenEncodeArgs,
  settlePage,
  detectAndCompensateZoom,
  interactionSchema,
  launchChromium,
  replayInteractions,
  viewportSchema,
  type Interaction,
  type Viewport,
} from "@openvidstudio/capture";
import { runTool } from "./mcp";

export interface CaptureScreenRecordingInput {
  projectRoot?: string;
  beatId: string;
  url: string;
  viewport?: Viewport;
  /** Pixels recorded per CSS pixel. Defaults to 2, same reasoning as capture_screenshot. */
  deviceScaleFactor?: number;
  /**
   * Settle the page before the recording starts. Defaults to true.
   *
   * Without it the first second of every clip is the page still assembling itself: fonts
   * swapping, images popping in, the hero animating from nothing. That is the second a
   * viewer decides whether the product looks finished.
   */
  settle?: boolean;
  settleTimeoutMs?: number;
  /**
   * Replay rate. 2 is twice as fast, 0.5 is half speed. Defaults to 1.
   *
   * Real interaction is often too slow to watch and occasionally too fast to follow. A
   * form being filled wants speeding up; a state change worth noticing wants slowing down.
   * Applied at transcode with setpts, so the recording itself is untouched and the beat's
   * duration in the manifest is the duration after the change.
   */
  speed?: number;
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
export function buildFfmpegTranscodeArgs(inputPath: string, outputPath: string, speed = 1): string[] {
  // Screen-tuned, not film-tuned. x264's defaults (crf 23, film psy settings) spend bitrate
  // on grain this footage does not have and starve the hard edges it is entirely made of,
  // which reads as ringing around text. Shared with the native backends so every capture in
  // the pipeline is encoded identically.
  // setpts scales presentation timestamps: 2x faster means each frame is shown at half its
  // original time, so the multiplier is the reciprocal. Captures are silent, so there is no
  // audio track to keep in step.
  const retime = speed !== 1 ? ["-vf", `setpts=${(1 / speed).toFixed(6)}*PTS`] : [];
  return [
    "-nostdin",
    "-i",
    inputPath,
    ...retime,
    ...screenEncodeArgs(),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
    "-y",
  ];
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
  const deviceScaleFactor = input.deviceScaleFactor ?? DEFAULT_DEVICE_SCALE;
  const speed = input.speed ?? 1;
  if (!(speed > 0)) throw new Error("speed must be greater than 0. 2 is twice as fast, 0.5 is half speed.");

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
      // recordVideo.size is in real pixels while the viewport is in CSS pixels, so the
      // recording size has to be scaled by hand. Leaving it at the CSS size would record a
      // 2x page into a 1x film, throwing the extra resolution away at the exact point it
      // was supposed to be captured.
      const recordContext = await browser.newContext({
        viewport: compensatedViewport,
        deviceScaleFactor,
        recordVideo: {
          dir: tmpDir,
          size: {
            width: Math.round(compensatedViewport.width * deviceScaleFactor),
            height: Math.round(compensatedViewport.height * deviceScaleFactor),
          },
        },
      });
      try {
        const page = await recordContext.newPage();
        await page.goto(input.url, { waitUntil: "load" });
        // Settle BEFORE the interactions, not after: the recording is already running, so
        // this is what keeps the opening seconds of the clip from being the page still
        // loading rather than the product working.
        if (input.settle !== false) await settlePage(page, { timeoutMs: input.settleTimeoutMs });
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
        buildFfmpegTranscodeArgs(webmPath, outPathAbs, speed),
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
        settle: z
          .boolean()
          .optional()
          .describe("Settle the page before recording starts, so the opening second is the product working rather than the page still loading. Defaults to true."),
        settleTimeoutMs: z.number().int().positive().optional(),
        speed: z
          .number()
          .positive()
          .optional()
          .describe("Replay rate. 2 is twice as fast, 0.5 is half speed. Defaults to 1. Use it when real interaction is too slow to watch or too quick to follow."),
        deviceScaleFactor: z
          .number()
          .positive()
          .optional()
          .describe("Pixels recorded per CSS pixel. Defaults to 2, which keeps the footage sharp once the camera pushes in."),
        interactions: z.array(interactionSchema).optional(),
        outPath: z.string().optional(),
      },
    },
    async (input) => runTool("capture_screen_recording", () => runCaptureScreenRecording(input)),
  );
}

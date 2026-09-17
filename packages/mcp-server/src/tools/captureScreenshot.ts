import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath } from "../util";
import {
  DEFAULT_DEVICE_SCALE,
  DEFAULT_VIEWPORT,
  detectAndCompensateZoom,
  interactionSchema,
  launchChromium,
  replayInteractions,
  settlePage,
  viewportSchema,
  writeCursorSidecar,
  writeSettleSidecar,
  type CursorPoint,
  type Interaction,
  type SettleReport,
  type Viewport,
} from "@openvidstudio/capture";
import { runTool } from "./mcp";

export interface CaptureScreenshotInput {
  projectRoot?: string;
  beatId: string;
  url: string;
  viewport?: Viewport;
  interactions?: Interaction[];
  cropSelector?: string;
  outPath?: string;
  /**
   * Wait for fonts, images and finite animations before the shot. Defaults to true.
   *
   * Off only when the point of the beat is to catch a page mid-transition deliberately.
   */
  settle?: boolean;
  /** How long to allow for that, in ms. Defaults to 5000. */
  settleTimeoutMs?: number;
  /**
   * Navigation wait condition. Defaults to "load".
   *
   * "load" has to stay the default: a dev server with an open websocket (HMR, a live
   * status poll) never reaches "networkidle" at all, and a beat pointed at one would hang
   * for the full navigation timeout. Pass "networkidle" only for the beat that specifically
   * needs it, e.g. a page whose real content arrives from a delayed fetch after "load" has
   * already fired and would otherwise settlePage() against a still-loading skeleton.
   */
  waitUntil?: "load" | "networkidle";
  /**
   * Pixels captured per CSS pixel. Defaults to 2; 1 restores the old behaviour.
   *
   * The video puts this image on a 1920x1080 stage and then pushes a camera into it, so a
   * 1x capture is being upscaled twice over and looks it.
   */
  deviceScaleFactor?: number;
  /**
   * Emulate a color scheme for this capture. Omit to use the page's own default (almost
   * always "light" unless the OS/browser default is overridden some other way).
   *
   * Set at context creation, not via a later emulateMedia call, so prefers-color-scheme CSS
   * is already correct on the very first paint the settle/screenshot logic observes -- an
   * emulateMedia call after navigation would race a page that reads the media query once at
   * load and caches the result.
   */
  colorScheme?: "light" | "dark";
  /**
   * Emulate prefers-reduced-motion: reduce. Off by default, since most beats want the
   * product's real, designed motion. Turn it on for a beat that specifically needs to catch
   * a page's reduced-motion fallback state (a11y QA, or a page whose entrance transition
   * would otherwise burn the whole settle budget under prefers-reduced-motion: no-preference).
   */
  reducedMotion?: boolean;
}

export interface CaptureScreenshotResult {
  outPath: string;
  /** CSS pixels, which is what the layout was measured in. */
  width: number;
  height: number;
  /** Real pixels on disk, which is `width * deviceScaleFactor`. */
  pixelWidth: number;
  pixelHeight: number;
  deviceScaleFactor: number;
  zoom: number;
  /** What the pre-capture wait actually waited for. Absent when settling was disabled. */
  settle?: SettleReport;
  /**
   * Real click/hover/fill/select target centers measured during interaction replay, in
   * replay order. Empty/absent when there were no such interactions. Also written to
   * `<outPath>.cursor.json` (see @openvidstudio/capture's writeCursorSidecar) so
   * scaffold_scene can build a cursor overlay from real coordinates instead of a guess.
   */
  cursorPoints?: CursorPoint[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Port of `vidstudio/scripts/crop-shot.py` (see CAPTURE.md step 6): crops the
 * physical screenshot at `rect * zoom`, then upscales the crop back to
 * `rect`'s own (w, h) with Lanczos resampling, landing on a pixel-accurate,
 * unshrunk capture. Pure function of the screenshot buffer, the DOM rect
 * measured in effective CSS space, and the zoom ratio -- no I/O, unit-testable
 * without a real browser.
 */
export async function cropAndUpscale(
  screenshotBuffer: Buffer,
  rect: CropRect,
  zoom: number,
  outputScale = 1,
): Promise<Buffer> {
  // `zoom` maps CSS pixels to buffer pixels, so when the buffer was captured at a device
  // scale the caller folds that into `zoom` and passes the same factor as `outputScale`.
  // Without the second parameter the crop would be taken at full resolution and then
  // immediately resized back down to CSS size, throwing away exactly the pixels the device
  // scale was raised to obtain.
  const left = Math.round(rect.x * zoom);
  const top = Math.round(rect.y * zoom);
  const right = Math.round((rect.x + rect.width) * zoom);
  const bottom = Math.round((rect.y + rect.height) * zoom);
  const finalWidth = Math.round(rect.width * outputScale);
  const finalHeight = Math.round(rect.height * outputScale);

  return sharp(screenshotBuffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize(finalWidth, finalHeight, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

export async function runCaptureScreenshot(input: CaptureScreenshotInput): Promise<CaptureScreenshotResult> {
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const target = input.viewport ?? DEFAULT_VIEWPORT;

  const outPathRel = input.outPath ?? path.join("public", "images", `${beatId}.png`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const outPathAbs = path.join(projectRoot, outPathRel);

  const deviceScaleFactor = input.deviceScaleFactor ?? DEFAULT_DEVICE_SCALE;

  const browser = await launchChromium();
  try {
    const context = await browser.newContext({
      deviceScaleFactor,
      ...(input.colorScheme ? { colorScheme: input.colorScheme } : {}),
      ...(input.reducedMotion ? { reducedMotion: "reduce" as const } : {}),
    });
    try {
      const page = await context.newPage();
      await page.setViewportSize(target);
      // "load" (not "networkidle") by default: CAPTURE.md's protocol is resize -> navigate
      // -> measure, and this package targets arbitrary dev-server pages, some of which
      // poll/keep a websocket open and would never hit networkidle at all. waitUntil is an
      // explicit opt-in override for the beat that actually needs it.
      await page.goto(input.url, { waitUntil: input.waitUntil ?? "load" });

      const { zoom, viewport: compensatedViewport } = await detectAndCompensateZoom(page, target);

      const cursorPoints = await replayInteractions(page, input.interactions);

      // Nothing is captured until the page has finished becoming itself: webfonts swapped
      // in, images decoded, entrance transitions driven to their end. Capturing before that
      // produces a frame no real user ever sees, which is the opposite of the point.
      const settleReport =
        input.settle === false ? null : await settlePage(page, { timeoutMs: input.settleTimeoutMs });

      // Full-viewport screenshot, no fullPage, no element target: CAPTURE.md explains why
      // element-scoped locator().screenshot() is wrong (it re-measures/auto-scrolls at shot
      // time, independent of what was measured a moment earlier). Buffered in memory; only
      // written to disk after an optional crop below.
      // "device", not "css": the whole point of raising deviceScaleFactor is to keep those
      // pixels, and `scale: "css"` would resample them straight back down to the CSS size.
      const screenshotBuffer = await page.screenshot({ scale: "device" });

      let finalBuffer: Buffer;
      if (input.cropSelector) {
        const rect = await page.$eval(input.cropSelector, (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        finalBuffer = await cropAndUpscale(screenshotBuffer, rect, zoom * deviceScaleFactor, deviceScaleFactor);
      } else {
        finalBuffer = screenshotBuffer;
      }

      const meta = await sharp(finalBuffer).metadata();
      const pixelWidth = meta.width ?? compensatedViewport.width * deviceScaleFactor;
      const pixelHeight = meta.height ?? compensatedViewport.height * deviceScaleFactor;
      // Reported in CSS pixels as well as real ones: the scene templates lay content out in
      // CSS space and only the aspect ratio matters to them, but anyone checking whether a
      // capture is sharp enough wants the real number.
      const width = Math.round(pixelWidth / deviceScaleFactor);
      const height = Math.round(pixelHeight / deviceScaleFactor);

      fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });
      fs.writeFileSync(outPathAbs, finalBuffer);
      // Otherwise settleReport is only a field in this return value, which nothing
      // downstream keeps: a beat that timed out mid-transition has no evidence of it left
      // once this call returns. The sidecar is what validate_scenes checks statically.
      if (settleReport) writeSettleSidecar(outPathAbs, settleReport);
      // Same reasoning as the settle sidecar: without this, the real coordinates measured
      // during replay only ever live in this call's return value, and scaffold_scene (run
      // afterwards, in a separate tool call) would have no real coordinates to build a
      // cursor overlay from.
      writeCursorSidecar(outPathAbs, compensatedViewport, cursorPoints);

      return {
        outPath: outPathAbs,
        width,
        height,
        pixelWidth,
        pixelHeight,
        deviceScaleFactor,
        zoom,
        ...(settleReport ? { settle: settleReport } : {}),
        ...(cursorPoints.length ? { cursorPoints } : {}),
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

export function registerCaptureScreenshot(server: McpServer): void {
  server.registerTool(
    "capture_screenshot",
    {
      title: "Capture a zoom-compensated, DOM-rect-cropped screenshot",
      description:
        "Internalizes CAPTURE.md's full screenshot protocol as one atomic call, driving a real headless " +
        "Chromium directly via the `playwright` package (not a separate Playwright MCP server): navigate " +
        "(waitUntil: \"load\" by default, since a dev server with an open websocket never reaches " +
        "networkidle; pass waitUntil: \"networkidle\" for a beat whose real content arrives from a delayed " +
        "fetch after load), " +
        "measure window.innerWidth/innerHeight against the requested viewport to detect a per-origin zoom " +
        "desync (never hardcoded, measured live every call), re-request a compensated viewport and re-verify " +
        "once if needed (a real 'protocol didn't converge' case fails with a structured error rather than " +
        "proceeding with a wrong crop), replay `interactions` in array order, wait for the page to settle " +
        "(fonts swapped, images decoded, finite animations landed -- an infinite one like a spinner is " +
        "excluded from the wait rather than polled forever; `settle` default true, `settleTimeoutMs` default " +
        "5000, settle:false skips it and catches the page mid-transition on purpose; the report is both " +
        "returned and written to `<outPath>.settle.json` so validate_scenes can flag a timed-out beat " +
        "without a browser), then take a full-viewport screenshot at `deviceScaleFactor` pixels per CSS " +
        "pixel (default 2, since the video pushes a camera into this image and a 1x capture would be " +
        "upscaled twice over; scale: device, not css, no fullPage, no element target -- see CAPTURE.md for " +
        "why element-scoped screenshots bleed in neighboring content), then if `cropSelector` is given, " +
        "measure its DOM rect and run a TypeScript/sharp port of vidstudio/scripts/crop-shot.py (crop at " +
        "rect*zoom*deviceScaleFactor, upscale back to rect's own size at that same scale with Lanczos) so " +
        "the result is pixel-accurate with no bleed. colorScheme (\"light\"/\"dark\") and reducedMotion " +
        "(boolean) are opt-in context-level emulation, set before navigation so prefers-color-scheme/" +
        "prefers-reduced-motion CSS is correct from the first paint -- omit both for the page's own default. " +
        "Default outPath is " +
        "public/images/<beatId>.png under projectRoot, matching scaffold_scene's real-screenshot convention. " +
        "Every click/hover/fill/select interaction's real target center is also measured (scrolled into view " +
        "first, same rect-measurement style as cropSelector) and written to `<outPath>.cursor.json`, so " +
        "scaffold_scene can build a cursor overlay from real coordinates instead of a hand-drawn guess. " +
        "Returns { outPath, width, height, pixelWidth, pixelHeight, deviceScaleFactor, zoom, settle?, " +
        "cursorPoints? } -- " +
        "width/height are CSS pixels, pixelWidth/pixelHeight the real pixels on disk, zoom the measured " +
        "desync ratio for STYLE.md's frame-sizing formula, settle the report (omitted when settle:false), " +
        "cursorPoints the same real coordinates written to the sidecar (omitted when there were none). " +
        "Requires Chromium to be installed for " +
        "Playwright first: run \"npx playwright install chromium\" once wherever this package is installed; " +
        "a missing browser fails with a message telling you to do exactly that, not a cryptic native error.",
      inputSchema: {
        projectRoot: z.string().optional(),
        beatId: z.string().min(1),
        url: z.string().min(1),
        viewport: viewportSchema.optional(),
        interactions: z.array(interactionSchema).optional(),
        cropSelector: z.string().optional(),
        outPath: z.string().optional(),
        settle: z
          .boolean()
          .optional()
          .describe("Wait for fonts, images and finite animations before the shot. Defaults to true. Turn it off only to catch a page mid-transition on purpose."),
        settleTimeoutMs: z.number().int().positive().optional(),
        waitUntil: z
          .enum(["load", "networkidle"])
          .optional()
          .describe(
            "Navigation wait condition. Defaults to \"load\", which has to stay the default since a dev " +
              "server with an open websocket never reaches networkidle. Pass \"networkidle\" only for a beat " +
              "whose real content arrives from a delayed fetch after load already fired.",
          ),
        deviceScaleFactor: z
          .number()
          .positive()
          .optional()
          .describe("Pixels captured per CSS pixel. Defaults to 2, which is what keeps text sharp once the camera pushes in. Pass 1 for the old behaviour."),
        colorScheme: z
          .enum(["light", "dark"])
          .optional()
          .describe("Emulate a color scheme, set at context creation so prefers-color-scheme CSS is already correct on first paint. Omit for the page's own default."),
        reducedMotion: z
          .boolean()
          .optional()
          .describe("Emulate prefers-reduced-motion: reduce. Off by default; turn on to catch a page's reduced-motion fallback state."),
      },
    },
    async (input) => runTool("capture_screenshot", () => runCaptureScreenshot(input)),
  );
}

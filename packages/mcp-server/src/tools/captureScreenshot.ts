import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import sharp from "sharp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath } from "../util";
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

export interface CaptureScreenshotInput {
  projectRoot?: string;
  beatId: string;
  url: string;
  viewport?: Viewport;
  interactions?: Interaction[];
  cropSelector?: string;
  outPath?: string;
}

export interface CaptureScreenshotResult {
  outPath: string;
  width: number;
  height: number;
  zoom: number;
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
export async function cropAndUpscale(screenshotBuffer: Buffer, rect: CropRect, zoom: number): Promise<Buffer> {
  const left = Math.round(rect.x * zoom);
  const top = Math.round(rect.y * zoom);
  const right = Math.round((rect.x + rect.width) * zoom);
  const bottom = Math.round((rect.y + rect.height) * zoom);
  const finalWidth = Math.round(rect.width);
  const finalHeight = Math.round(rect.height);

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

  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.setViewportSize(target);
      // "load" (not "networkidle"): CAPTURE.md's protocol is resize -> navigate -> measure,
      // and this package targets arbitrary dev-server pages, some of which poll/keep a
      // websocket open and would never hit networkidle at all.
      await page.goto(input.url, { waitUntil: "load" });

      const { zoom, viewport: compensatedViewport } = await detectAndCompensateZoom(page, target);

      await replayInteractions(page, input.interactions);

      // Full-viewport screenshot, no fullPage, no element target: CAPTURE.md explains why
      // element-scoped locator().screenshot() is wrong (it re-measures/auto-scrolls at shot
      // time, independent of what was measured a moment earlier). Buffered in memory; only
      // written to disk after an optional crop below.
      const screenshotBuffer = await page.screenshot({ scale: "css" });

      let finalBuffer: Buffer;
      if (input.cropSelector) {
        const rect = await page.$eval(input.cropSelector, (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        finalBuffer = await cropAndUpscale(screenshotBuffer, rect, zoom);
      } else {
        finalBuffer = screenshotBuffer;
      }

      const meta = await sharp(finalBuffer).metadata();
      const width = meta.width ?? compensatedViewport.width;
      const height = meta.height ?? compensatedViewport.height;

      fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });
      fs.writeFileSync(outPathAbs, finalBuffer);

      return { outPath: outPathAbs, width, height, zoom };
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
        "Chromium directly via the `playwright` package (not a separate Playwright MCP server): navigate, " +
        "measure window.innerWidth/innerHeight against the requested viewport to detect a per-origin zoom " +
        "desync (never hardcoded, measured live every call), re-request a compensated viewport and re-verify " +
        "once if needed (a real 'protocol didn't converge' case fails with a structured error rather than " +
        "proceeding with a wrong crop), replay `interactions` in array order, take a full-viewport screenshot " +
        "(scale: css, no fullPage, no element target -- see CAPTURE.md for why element-scoped screenshots " +
        "bleed in neighboring content), then if `cropSelector` is given, measure its DOM rect and run a " +
        "TypeScript/sharp port of vidstudio/scripts/crop-shot.py (crop at rect*zoom, upscale back to rect's " +
        "own size with Lanczos) so the result is pixel-accurate with no bleed. Default outPath is " +
        "public/images/<beatId>.png under projectRoot, matching scaffold_scene's real-screenshot convention. " +
        "Returns { outPath, width, height, zoom } -- the saved image's actual pixel dimensions and the " +
        "measured zoom ratio, for STYLE.md's frame-sizing formula. Requires Chromium to be installed for " +
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
      },
    },
    async (input) => runTool("capture_screenshot", () => runCaptureScreenshot(input)),
  );
}

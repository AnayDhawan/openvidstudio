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
  hideAllLayers,
  installDeterminism,
  interactionSchema,
  launchChromium,
  pauseAnimations,
  replayInteractions,
  restoreLayers,
  showOnlyLayer,
  tagLayerElements,
  settlePage,
  viewportSchema,
  writeCaptureSidecar,
  writeCursorSidecar,
  writeSettleSidecar,
  type CursorPoint,
  type Interaction,
  type LayerElement,
  type SettleReport,
  type Viewport,
} from "@openvidstudio/capture";
import { runTool } from "./mcp";
import { fileBytes, relToProject, writeFactRecord } from "../facts";

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
  /**
   * Freeze Date.now()/new Date() and seed Math.random() before the page ever runs, so a
   * page whose content depends on either (a timestamp-based id, a randomly ordered list, a
   * "today" string) captures identically on every run. Off by default: most beats want the
   * page's own real behaviour. This does not force a CSS/JS animation to a specific phase --
   * that is a separate, harder problem -- so a page whose only nondeterminism is animation
   * timing still needs `settle` (or `reducedMotion`) to land on a repeatable frame.
   */
  deterministic?: boolean;
  /**
   * Split the capture into a background and one transparent PNG per matched element, so a
   * camera can move the layers at different rates (parallax) instead of sliding one flat image.
   * Written next to the screenshot; see CaptureLayersResult.
   */
  layers?: CaptureLayer[];
}

/** One layer request: every element `selector` matches becomes its own transparent image. */
export interface CaptureLayer {
  selector: string;
  /** File-name stem for the layer (hook-layer-<name>.png). Defaults to one derived from the selector. */
  name?: string;
  /**
   * How far from the background the layer sits: 0 moves with it, larger moves more under a
   * camera pan. Defaults to a 0.5 spread in order (0.5, 1, 1.5, ...).
   */
  depth?: number;
}

/** One layer as written to the manifest, plus where it came from. */
export interface CapturedLayer {
  name: string;
  selector: string;
  /** Absolute path of the layer PNG. */
  path: string;
  /** Path relative to public/ (or the project root when outPath is outside it), as the manifest has it. */
  src: string;
  /** In capture pixels: the same space as the screenshot on disk. */
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface CaptureLayersResult {
  /** `<outPath without extension>.layers.json`: {width, height, background, layers: [{src, x, y, width, height, depth}]}. */
  manifestPath: string;
  /** `<outPath without extension>-bg.png`: the page with every layer element hidden. */
  backgroundPath: string;
  layers: CapturedLayer[];
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
  /** Present when `layers` was given. */
  layers?: CaptureLayersResult;
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

const LAYER_EPSILON = 1e-6;
/**
 * Pixels a layer's rectangle grows past the element's own box on every side. Chrome snaps what it
 * paints to the pixel grid and antialiases rounded edges, and measured on a real page it draws a
 * whole column of pixels past getBoundingClientRect (a card at x 420.5 css, 260 wide, at 2x). A
 * layer cut exactly at the box lost that column and the reassembly was off there.
 */
const LAYER_BLEED = 1;

/**
 * Where an element's rectangle lands in the saved image, in whole pixels, grown outward to cover
 * every partly-covered pixel plus LAYER_BLEED more, and clamped to the image. Null when none of it
 * is inside.
 *
 * Without a crop the image is the compensated viewport, so one effective CSS pixel is
 * `zoom * deviceScaleFactor` image pixels (the same factor cropAndUpscale uses). With a crop the
 * image is the crop rectangle resampled to `deviceScaleFactor` pixels per CSS pixel, so the zoom
 * cancels and the crop's own origin is subtracted. Pure, so the desync case is testable without a
 * browser that can produce one.
 */
export function layerPixelRect(
  rect: CropRect,
  frame: { zoom: number; deviceScaleFactor: number; crop?: CropRect; imageWidth: number; imageHeight: number },
): CropRect | null {
  const scale = frame.crop ? frame.deviceScaleFactor : frame.zoom * frame.deviceScaleFactor;
  const ox = frame.crop?.x ?? 0;
  const oy = frame.crop?.y ?? 0;
  const left = Math.max(0, Math.floor((rect.x - ox) * scale + LAYER_EPSILON) - LAYER_BLEED);
  const top = Math.max(0, Math.floor((rect.y - oy) * scale + LAYER_EPSILON) - LAYER_BLEED);
  const right = Math.min(frame.imageWidth, Math.ceil((rect.x + rect.width - ox) * scale - LAYER_EPSILON) + LAYER_BLEED);
  const bottom = Math.min(frame.imageHeight, Math.ceil((rect.y + rect.height - oy) * scale - LAYER_EPSILON) + LAYER_BLEED);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The path as the manifest carries it: relative to public/ like staticFile, else to the project root. */
function manifestRelative(projectRoot: string, absolute: string): string {
  const fromPublic = path.relative(path.join(projectRoot, "public"), absolute);
  const rel = fromPublic.startsWith("..") || path.isAbsolute(fromPublic) ? path.relative(projectRoot, absolute) : fromPublic;
  return rel.split(path.sep).join("/");
}

/** A name per layer request, checked for safety up front so a bad one fails before a browser opens. */
function layerBaseNames(layers: CaptureLayer[]): string[] {
  const used = new Set<string>();
  return layers.map((layer, i) => {
    const wanted = layer.name !== undefined ? sanitizeSegment(layer.name, `layers[${i}].name`) : slug(layer.selector) || `layer-${i + 1}`;
    let name = wanted;
    for (let n = 2; used.has(name); n++) name = `${wanted}-${n}`;
    used.add(name);
    return name;
  });
}

export async function runCaptureScreenshot(
  input: CaptureScreenshotInput
): Promise<CaptureScreenshotResult> {
  const result = await captureScreenshot(input);
  const projectRoot = resolveProjectRoot(input.projectRoot);
  writeFactRecord(projectRoot, {
    tool: "capture_screenshot",
    beatId: sanitizeSegment(input.beatId, "beatId"),
    facts: {
      kind: "real-capture",
      outPath: relToProject(projectRoot, result.outPath),
      bytes: fileBytes(result.outPath),
      url: input.url,
      viewport: { width: result.width, height: result.height },
      pixelWidth: result.pixelWidth,
      pixelHeight: result.pixelHeight,
      deviceScaleFactor: result.deviceScaleFactor,
      interactions: input.interactions?.length ?? 0,
      settled: result.settle?.settled ?? null,
      settleWaitedMs: result.settle?.waitedMs ?? null,
      ...(result.layers ? { layers: result.layers.layers.length } : {}),
    },
  });
  return result;
}

async function captureScreenshot(input: CaptureScreenshotInput): Promise<CaptureScreenshotResult> {
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const target = input.viewport ?? DEFAULT_VIEWPORT;

  const outPathRel = input.outPath ?? path.join("public", "images", `${beatId}.png`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const outPathAbs = path.join(projectRoot, outPathRel);

  const deviceScaleFactor = input.deviceScaleFactor ?? DEFAULT_DEVICE_SCALE;
  const layerRequests = input.layers ?? [];
  const layerNames = layerBaseNames(layerRequests);

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
      // Before navigation, same timing rule as colorScheme/reducedMotion: applied after the
      // first paint, this would race a page that reads Math.random()/Date.now() once at load
      // and caches the result.
      if (input.deterministic) await installDeterminism(page);
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

      // Layers are looked up now, while the page is exactly as the main shot will see it. A
      // selector that matches nothing is an error here, before anything is written: a silently
      // missing layer would look like a working parallax with one element stuck to the background.
      const tagged: { request: CaptureLayer; name: string; depth: number; elements: LayerElement[] }[] = [];
      for (let i = 0; i < layerRequests.length; i++) {
        const request = layerRequests[i]!;
        const elements = await tagLayerElements(page, request.selector, i);
        if (elements.length === 0) {
          throw new Error(`layers: selector "${request.selector}" matched no element on ${input.url}. Check it against the page after the interactions have run.`);
        }
        if (elements.some((e) => !(e.width > 0 && e.height > 0))) {
          throw new Error(`layers: selector "${request.selector}" matched an element with no size (display: none, or collapsed). Pick a visible one.`);
        }
        tagged.push({ request, name: layerNames[i]!, depth: request.depth ?? 0.5 * (i + 1), elements });
      }
      // A spinner or a drifting gradient would be at a different phase in each of the shots below.
      if (tagged.length > 0) await pauseAnimations(page);

      // Full-viewport screenshot, no fullPage, no element target: CAPTURE.md explains why
      // element-scoped locator().screenshot() is wrong (it re-measures/auto-scrolls at shot
      // time, independent of what was measured a moment earlier). Buffered in memory; only
      // written to disk after an optional crop below.
      // "device", not "css": the whole point of raising deviceScaleFactor is to keep those
      // pixels, and `scale: "css"` would resample them straight back down to the CSS size.
      const screenshotBuffer = await page.screenshot({ scale: "device" });

      let finalBuffer: Buffer;
      let cropRect: CropRect | undefined;
      if (input.cropSelector) {
        cropRect = await page.$eval(input.cropSelector, (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        finalBuffer = await cropAndUpscale(screenshotBuffer, cropRect, zoom * deviceScaleFactor, deviceScaleFactor);
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

      // Every layer is built in memory first so a refusal (an element outside the crop) leaves the
      // directory untouched.
      const layerFiles: { name: string; selector: string; depth: number; rect: CropRect; png: Buffer }[] = [];
      let backgroundPng: Buffer | null = null;
      if (tagged.length > 0) {
        // One transform takes any full-viewport shot to the saved image's space, so each layer is
        // cut from the same pixels the main image is.
        const toImageSpace = (buffer: Buffer) =>
          cropRect ? cropAndUpscale(buffer, cropRect, zoom * deviceScaleFactor, deviceScaleFactor) : Promise.resolve(buffer);
        const plan: { name: string; selector: string; depth: number; id: string; rect: CropRect }[] = [];
        for (const t of tagged) {
          t.elements.forEach((element, n) => {
            const rect = layerPixelRect(element, { zoom, deviceScaleFactor, crop: cropRect, imageWidth: pixelWidth, imageHeight: pixelHeight });
            if (!rect) {
              throw new Error(
                `layers: selector "${t.request.selector}" matched an element outside the captured area ` +
                  `(${cropRect ? `the cropSelector "${input.cropSelector}" box` : "the viewport"}), so there is nothing to cut. Scroll it into view or widen the capture.`,
              );
            }
            plan.push({ name: t.elements.length > 1 ? `${t.name}-${n + 1}` : t.name, selector: t.request.selector, depth: t.depth, id: element.id, rect });
          });
        }
        for (const item of plan) {
          await showOnlyLayer(page, item.id);
          const shot = await page.screenshot({ scale: "device", omitBackground: true });
          const full = await toImageSpace(shot);
          const png = await sharp(full)
            .extract({ left: item.rect.x, top: item.rect.y, width: item.rect.width, height: item.rect.height })
            .png()
            .toBuffer();
          layerFiles.push({ name: item.name, selector: item.selector, depth: item.depth, rect: item.rect, png });
          await restoreLayers(page);
        }
        await hideAllLayers(page);
        backgroundPng = await toImageSpace(await page.screenshot({ scale: "device" }));
        await restoreLayers(page);
      }

      fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });
      fs.writeFileSync(outPathAbs, finalBuffer);
      let layersResult: CaptureLayersResult | undefined;
      if (backgroundPng) {
        const stem = path.join(path.dirname(outPathAbs), path.parse(outPathAbs).name);
        const backgroundPath = `${stem}-bg.png`;
        fs.writeFileSync(backgroundPath, backgroundPng);
        const captured: CapturedLayer[] = layerFiles.map((l) => {
          const file = `${stem}-layer-${l.name}.png`;
          fs.writeFileSync(file, l.png);
          return { name: l.name, selector: l.selector, path: file, src: manifestRelative(projectRoot, file), x: l.rect.x, y: l.rect.y, width: l.rect.width, height: l.rect.height, depth: l.depth };
        });
        const manifestPath = `${stem}.layers.json`;
        // The shape LayeredShot reads: sizes in capture pixels, paths relative to public/ like the main image.
        fs.writeFileSync(
          manifestPath,
          JSON.stringify(
            {
              width: pixelWidth,
              height: pixelHeight,
              background: manifestRelative(projectRoot, backgroundPath),
              layers: captured.map((l) => ({ src: l.src, x: l.x, y: l.y, width: l.width, height: l.height, depth: l.depth })),
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );
        layersResult = { manifestPath, backgroundPath, layers: captured };
      }
      // Otherwise settleReport is only a field in this return value, which nothing
      // downstream keeps: a beat that timed out mid-transition has no evidence of it left
      // once this call returns. The sidecar is what validate_scenes checks statically.
      if (settleReport) writeSettleSidecar(outPathAbs, settleReport);
      // Same reasoning as the settle sidecar: without this, the real coordinates measured
      // during replay only ever live in this call's return value, and scaffold_scene (run
      // afterwards, in a separate tool call) would have no real coordinates to build a
      // cursor overlay from.
      writeCursorSidecar(outPathAbs, compensatedViewport, cursorPoints);
      // docs_drift/release_diff's binding to re-capture this exact page: the CSS viewport
      // actually requested (not the reference PNG's pixel size, which a different, wider
      // layout can also produce), the scale it was captured at, and the interactions that
      // got it into this state. Without this, a re-capture has nothing but the pixel
      // dimensions of the PNG on disk to guess a viewport from -- see captureSidecar.ts.
      writeCaptureSidecar(outPathAbs, {
        url: input.url,
        viewport: target,
        deviceScaleFactor,
        zoom,
        ...(input.interactions?.length ? { interactions: input.interactions } : {}),
        capturedAt: new Date().toISOString(),
      });

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
        ...(layersResult ? { layers: layersResult } : {}),
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
        "deterministic (boolean, default false) freezes Date.now()/new Date() and seeds Math.random() before " +
        "the page's own scripts run, so a page whose content depends on either (a timestamp-based id, a " +
        "randomly ordered list) captures the same way twice; it does not fix animation-phase nondeterminism, " +
        "which settle/reducedMotion already cover. Default outPath is " +
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
        deterministic: z
          .boolean()
          .optional()
          .describe(
            "Freeze Date.now()/new Date() and seed Math.random() before the page runs, so a page whose " +
              "content depends on either captures identically every run. Off by default. Does not force a " +
              "CSS/JS animation to a specific phase -- pair with settle/reducedMotion for that.",
          ),
        layers: z
          .array(
            z.object({
              selector: z.string().min(1),
              name: z.string().min(1).optional(),
              depth: z.number().min(0).optional(),
            }),
          )
          .optional()
          .describe(
            "Split the capture for parallax. For every element each selector matches, writes a transparent " +
              "PNG of just that element next to the screenshot (<out>-layer-<name>.png), plus <out>-bg.png (the " +
              "page with those elements hidden) and <out>.layers.json: {width, height, background, layers: " +
              "[{src, x, y, width, height, depth}]} in capture pixels, paths relative to public/. depth defaults " +
              "to a 0.5 spread in request order (0.5, 1, 1.5...): bigger moves more under a camera pan. A " +
              "selector that matches nothing, matches an element with no size, or lies outside the captured " +
              "area is an error naming it, never a silent skip. Layers are cut from the same screenshot " +
              "pipeline as the main image (zoom-compensated, cropSelector-aware), with animations paused " +
              "so every piece is the same instant. Each layer is the element's box plus one capture pixel of " +
              "bleed (Chrome paints a pixel past the measured box); shadows and overflow further out are not " +
              "part of its layer.",
          ),
      },
    },
    async (input) => runTool("capture_screenshot", () => runCaptureScreenshot(input)),
  );
}

import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { settlePage } from "./settle";
import type { CursorPoint, CursorPointType } from "./cursor";
import { z } from "zod";

/**
 * Shared building blocks for capture_screenshot and capture_screen_recording:
 * the Interaction type both replay identically, and CAPTURE.md's zoom-desync
 * detection/compensation math, extracted once so the two tools' protocols
 * cannot silently drift apart from each other.
 */

export interface Viewport {
  width: number;
  height: number;
}

/** CAPTURE.md's worked example. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1600, height: 1000 };

/**
 * Capture at twice the CSS resolution by default.
 *
 * This is the single biggest quality lever in the pipeline and it used to be missing.
 * A capture taken at 1x is exactly as many pixels as the viewport, and the video then
 * puts it on a 1920x1080 stage and pushes a camera into it. Every one of those steps
 * is an upscale, so a 1440x900 capture shown at a 1.33 camera scale is being asked for
 * roughly 1.8x the pixels it has, and the result is the soft, slightly smeared text
 * that makes a demo look cheap.
 *
 * At 2x there are pixels to spare for both the stage and the push-in, so the frame stays
 * sharp all the way through. The cost is memory and file size during capture, which is
 * the right trade for an asset that gets rendered once and watched many times.
 */
export const DEFAULT_DEVICE_SCALE = 2;

export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type Interaction =
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "select"; selector: string; value: string }
  | { type: "hover"; selector: string }
  | { type: "scroll"; selector?: string; x?: number; y?: number; durationMs?: number }
  | { type: "wait"; ms?: number; selector?: string }
  | { type: "settle"; ms?: number }
  | { type: "navigate"; url: string };

export const interactionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), selector: z.string().min(1) }),
  z.object({ type: z.literal("fill"), selector: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal("select"), selector: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal("hover"), selector: z.string().min(1) }),
  z.object({
    type: z.literal("scroll"),
    selector: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    // Undefined/0 keeps the old instant scrollTo -- an unrequested behaviour change would
    // silently retime every beat that already has a scroll interaction. Positive is an
    // eased scroll (see easedScrollInPage below) driven by requestAnimationFrame, since
    // CSS's `behavior: "smooth"` gives no control over duration or curve and browsers are
    // free to shorten or skip it, neither of which is acceptable for video timing.
    durationMs: z.number().positive().optional(),
  }),
  z.object({ type: z.literal("wait"), ms: z.number().optional(), selector: z.string().optional() }),
  // Not a timed guess. "settle" drives whatever the previous step started (a modal
  // transition, a route change, a lazily loaded image) to completion before the next step
  // runs, which is what stops a capture landing halfway through a fade.
  z.object({ type: z.literal("settle"), ms: z.number().optional() }),
  // Go to another page mid-path. A relative url resolves against the page the replay is on.
  z.object({ type: z.literal("navigate"), url: z.string().min(1) }),
]);

/**
 * Runs in the page against a scrollable element. `behavior: "smooth"` was rejected on
 * purpose: it has no duration/easing parameters, a page can override its own
 * scroll-behavior CSS out from under it, and browsers are free to shorten or skip a smooth
 * scroll under reduced-motion or heavy load -- none of which is acceptable when the
 * duration has to match the video's timeline exactly. Driven by requestAnimationFrame
 * instead, resolving its own promise so replayInteractions can await the real end of the
 * animation rather than a fixed sleep.
 */
/* c8 ignore start -- executes in the browser, covered by the real-browser E2E */
function easedScrollElementInPage(el: Element, args: { x?: number; y?: number; durationMs: number }): Promise<void> {
  const target = el as Element & { scrollLeft: number; scrollTop: number; scrollTo: (x: number, y: number) => void };
  const startX = target.scrollLeft;
  const startY = target.scrollTop;
  const endX = args.x ?? startX;
  const endY = args.y ?? startY;
  const duration = args.durationMs;
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Cubic ease-in-out: slow away from the start, fast through the middle, slow into
      // the landing point -- a linear scroll reads as mechanical on camera in a way an
      // eased one does not.
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      target.scrollTo(startX + (endX - startX) * eased, startY + (endY - startY) * eased);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}
/* c8 ignore stop */

/** Same easing as easedScrollElementInPage, against the window instead of an element. */
/* c8 ignore start -- executes in the browser, covered by the real-browser E2E */
function easedScrollWindowInPage(args: { x?: number; y?: number; durationMs: number }): Promise<void> {
  const startX = window.scrollX;
  const startY = window.scrollY;
  const endX = args.x ?? startX;
  const endY = args.y ?? startY;
  const duration = args.durationMs;
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      window.scrollTo(startX + (endX - startX) * eased, startY + (endY - startY) * eased);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}
/* c8 ignore stop */

/**
 * Measures a click/hover/fill/select target's real on-screen center right before the
 * action runs -- same rect-measurement style as captureScreenshot.ts's cropSelector code.
 * Scrolls the target into view first, matching the auto-scroll every one of these
 * Playwright actions already does internally, so the coordinate lands in the same
 * effective viewport space the final screenshot/recording is captured in rather than
 * wherever the element happened to sit before the action's own scroll would have moved it.
 *
 * Best-effort and silent on failure: a selector that doesn't resolve here is about to make
 * the action itself throw a real, clearer error a moment later, and this is not the call
 * that should report it first.
 */
/* c8 ignore start -- executes in the browser, covered by the real-browser E2E */
async function recordCursorPoint(
  page: Page,
  points: CursorPoint[],
  index: number,
  type: CursorPointType,
  selector: string,
  replayStartedAt: number,
): Promise<void> {
  try {
    const center = await page.$eval(selector, (el) => {
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    points.push({ index, type, selector, x: center.x, y: center.y, atMs: Date.now() - replayStartedAt });
  } catch {
    // Selector didn't resolve or wasn't measurable -- not this function's job to report.
  }
}
/* c8 ignore stop */

/**
 * Replays a beat's interactions in array order. Shared verbatim by both capture
 * tools so their replay semantics never drift apart -- called after navigation
 * and (for both tools) after the zoom-desync compensation below, in the same
 * effective CSS-pixel viewport CAPTURE.md measured.
 *
 * Returns every click/hover/fill/select target's real measured center, in replay order,
 * for capture_screenshot/capture_screen_recording to persist as a cursor sidecar (see
 * cursor.ts) -- this is what lets scaffold_scene's cursor overlay land on real coordinates
 * instead of a hand-authored guess.
 */
export async function replayInteractions(page: Page, interactions: Interaction[] | undefined): Promise<CursorPoint[]> {
  const points: CursorPoint[] = [];
  const replayStartedAt = Date.now();
  let index = 0;
  for (const interaction of interactions ?? []) {
    switch (interaction.type) {
      case "click":
        await recordCursorPoint(page, points, index, "click", interaction.selector, replayStartedAt);
        await page.click(interaction.selector);
        break;
      case "fill":
        await recordCursorPoint(page, points, index, "fill", interaction.selector, replayStartedAt);
        await page.fill(interaction.selector, interaction.value);
        break;
      case "select":
        await recordCursorPoint(page, points, index, "select", interaction.selector, replayStartedAt);
        await page.selectOption(interaction.selector, interaction.value);
        break;
      case "hover":
        await recordCursorPoint(page, points, index, "hover", interaction.selector, replayStartedAt);
        await page.hover(interaction.selector);
        break;
      case "scroll":
        if (interaction.durationMs && interaction.durationMs > 0) {
          const args = { x: interaction.x, y: interaction.y, durationMs: interaction.durationMs };
          if (interaction.selector) {
            await page.$eval(interaction.selector, easedScrollElementInPage, args);
          } else {
            await page.evaluate(easedScrollWindowInPage, args);
          }
        } else if (interaction.selector) {
          await page.$eval(
            interaction.selector,
            (el, coords) => el.scrollTo(coords.x ?? 0, coords.y ?? 0),
            { x: interaction.x, y: interaction.y },
          );
        } else {
          await page.evaluate(
            (coords) => window.scrollTo(coords.x ?? 0, coords.y ?? 0),
            { x: interaction.x, y: interaction.y },
          );
        }
        break;
      case "wait":
        if (interaction.selector) {
          await page.waitForSelector(interaction.selector, { timeout: interaction.ms });
        } else {
          await page.waitForTimeout(interaction.ms ?? 500);
        }
        break;
      case "settle":
        await settlePage(page, { timeoutMs: interaction.ms });
        break;
      case "navigate":
        await page.goto(new URL(interaction.url, page.url()).toString(), { waitUntil: "load" });
        break;
    }
    index++;
  }
  return points;
}

export const ZOOM_EPSILON = 0.01;

export interface ZoomCompensation {
  /** The viewport actually in effect for capture: `target` unchanged, or the compensated size. */
  viewport: Viewport;
  /** Measured zoom = target.width / (effective width before compensation). 1 means no desync. */
  zoom: number;
  /** The last-measured `[window.innerWidth, window.innerHeight]`. */
  effective: Viewport;
  /** `window.devicePixelRatio` as read before compensation. Only present when a device scale factor was given. */
  devicePixelRatio?: number;
}

export interface ZoomCheckOptions {
  /**
   * The device scale factor the page's context was created with. When given, `window.devicePixelRatio`
   * is read too and has to agree with `innerWidth` about the zoom: a page that reports a different
   * zoom from its width than from its pixel ratio is not one a frame can be trusted from.
   */
  deviceScaleFactor?: number;
}

/**
 * Thrown before anything is captured when what the page reports (`innerWidth`, `devicePixelRatio`)
 * does not fit what was requested and cannot be explained as a consistent zoom. Carries the
 * measurements so a caller can show them.
 */
export class ViewportDesyncError extends Error {
  constructor(
    message: string,
    public readonly target: Viewport,
    public readonly measured: { innerWidth: number; innerHeight: number; devicePixelRatio: number },
    public readonly deviceScaleFactor: number,
  ) {
    super(message);
    this.name = "ViewportDesyncError";
  }
}

/**
 * Thrown when a single compensation attempt doesn't converge -- CAPTURE.md
 * doesn't explicitly cover this case (it assumes the desync ratio is
 * consistent), so this is surfaced as a real error rather than silently
 * proceeding with a crop rect measured against the wrong effective viewport.
 */
export class ZoomCompensationError extends Error {
  constructor(
    public readonly target: Viewport,
    public readonly zoom: number,
    public readonly effective: Viewport,
  ) {
    super(
      `Zoom-desync compensation did not converge: requested ${target.width}x${target.height}, measured zoom ` +
        `${zoom.toFixed(4)} (per CAPTURE.md, this ratio is not hardcoded, it can differ per machine/profile), ` +
        `but after one compensation attempt the effective viewport was ${effective.width}x${effective.height}, ` +
        `not ${target.width}x${target.height} within ${(ZOOM_EPSILON * 100).toFixed(0)}%. Refusing to proceed ` +
        `with a screenshot/crop measured against the wrong effective viewport -- see packages/docs/CAPTURE.md.`,
    );
    this.name = "ZoomCompensationError";
  }
}

async function measureEffectiveViewport(page: Page): Promise<Viewport> {
  const [width, height] = await page.evaluate(
    () => [window.innerWidth, window.innerHeight] as [number, number],
  );
  return { width, height };
}

async function readDevicePixelRatio(page: Page): Promise<number> {
  return page.evaluate(() => window.devicePixelRatio);
}

function describeReading(
  target: Viewport,
  deviceScaleFactor: number,
  m: { innerWidth: number; innerHeight: number; devicePixelRatio: number },
): string {
  return (
    `requested ${target.width}x${target.height} at device scale ${deviceScaleFactor}, but the page reports ` +
    `innerWidth ${m.innerWidth}, innerHeight ${m.innerHeight} and devicePixelRatio ${m.devicePixelRatio}`
  );
}

/**
 * Before any compensation: `innerWidth` and `devicePixelRatio` are two independent readings of the
 * same browser zoom. A real per-origin zoom of z shows as `target / innerWidth = z` and
 * `devicePixelRatio / deviceScaleFactor = z` together. When they disagree the page is in a state
 * compensating the viewport cannot fix (an emulated device scale that was not applied, a forced
 * scale factor on the browser), and every pixel measurement after it would be wrong.
 */
export function judgeZoomSignals(opts: {
  target: Viewport;
  deviceScaleFactor: number;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}): string | null {
  const zoomByWidth = opts.target.width / opts.innerWidth;
  const zoomByDpr = opts.devicePixelRatio / opts.deviceScaleFactor;
  if (Math.abs(zoomByWidth - zoomByDpr) <= ZOOM_EPSILON * Math.max(zoomByWidth, zoomByDpr)) return null;
  const m = { innerWidth: opts.innerWidth, innerHeight: opts.innerHeight, devicePixelRatio: opts.devicePixelRatio };
  return (
    `Viewport desync before capture: ${describeReading(opts.target, opts.deviceScaleFactor, m)}. innerWidth ` +
    `implies a zoom of ${zoomByWidth.toFixed(3)} but devicePixelRatio implies ${zoomByDpr.toFixed(3)}. A ` +
    `browser zoom moves both by the same factor, so this is something else (a device scale factor that was ` +
    `not applied, or a scale factor forced on the browser) and shrinking or growing the viewport cannot ` +
    `correct it. Frames from this page would not be the size the request asked for -- see ` +
    `packages/docs/CAPTURE.md, "The zoom-desync bug".`
  );
}

/**
 * After compensation, against a page that is about to be captured: the compensated viewport has
 * to put `innerWidth`/`innerHeight` back on the request, and `devicePixelRatio` has to still sit at
 * `deviceScaleFactor * zoom`, the zoom measured earlier. Anything else means the page the capture
 * is about to run on is not the page that was probed.
 */
export function judgeCompensatedViewport(opts: {
  target: Viewport;
  deviceScaleFactor: number;
  zoom: number;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}): string | null {
  const m = { innerWidth: opts.innerWidth, innerHeight: opts.innerHeight, devicePixelRatio: opts.devicePixelRatio };
  const problems: string[] = [];
  if (
    relativeDiff(opts.innerWidth, opts.target.width) > ZOOM_EPSILON ||
    relativeDiff(opts.innerHeight, opts.target.height) > ZOOM_EPSILON
  ) {
    problems.push(`innerWidth x innerHeight is ${opts.innerWidth}x${opts.innerHeight}, not the requested ${opts.target.width}x${opts.target.height}`);
  }
  const expectedDpr = opts.deviceScaleFactor * opts.zoom;
  if (Math.abs(opts.devicePixelRatio - expectedDpr) > ZOOM_EPSILON * expectedDpr) {
    problems.push(
      `devicePixelRatio is ${opts.devicePixelRatio}, but device scale ${opts.deviceScaleFactor} at the measured zoom ` +
        `${opts.zoom.toFixed(3)} should give ${expectedDpr.toFixed(3)}`,
    );
  }
  if (problems.length === 0) return null;
  return (
    `Viewport desync at the start of recording: ${describeReading(opts.target, opts.deviceScaleFactor, m)}. ` +
    `${problems.join("; ")}. The recording would not be the size the request asked for, so it was not started -- ` +
    `see packages/docs/CAPTURE.md, "The zoom-desync bug".`
  );
}

/**
 * Reads `innerWidth`, `innerHeight` and `devicePixelRatio` from the page that is about to be recorded
 * and throws ViewportDesyncError if they do not match the compensated request. Call it after
 * navigation and before the recording does anything, so a desync costs a clear error and not a clip.
 */
export async function assertViewportBeforeRecording(
  page: Page,
  target: Viewport,
  opts: { deviceScaleFactor: number; zoom: number },
): Promise<void> {
  const [innerWidth, innerHeight] = await page.evaluate(() => [window.innerWidth, window.innerHeight] as [number, number]);
  const devicePixelRatio = await readDevicePixelRatio(page);
  const problem = judgeCompensatedViewport({ target, ...opts, innerWidth, innerHeight, devicePixelRatio });
  if (problem) throw new ViewportDesyncError(problem, target, { innerWidth, innerHeight, devicePixelRatio }, opts.deviceScaleFactor);
}

function relativeDiff(actual: number, target: number): number {
  return Math.abs(actual - target) / target;
}

/**
 * CAPTURE.md's zoom-desync detection + compensation (protocol steps 1-2).
 * Assumes the caller already called `page.setViewportSize(target)` and
 * `page.goto(...)` -- this only measures and, if needed, re-requests a
 * compensated viewport and re-verifies once.
 *
 * Never hardcodes a zoom constant (CAPTURE.md is explicit the ratio "can
 * differ per machine/profile") -- it is measured live on every call. If the
 * one compensation attempt doesn't bring the effective viewport back to
 * `target` within `ZOOM_EPSILON`, throws `ZoomCompensationError` rather than
 * silently proceeding.
 */
export async function detectAndCompensateZoom(
  page: Page,
  target: Viewport,
  opts: ZoomCheckOptions = {},
): Promise<ZoomCompensation> {
  const firstMeasurement = await measureEffectiveViewport(page);
  const zoom = target.width / firstMeasurement.width;

  let devicePixelRatio: number | undefined;
  if (opts.deviceScaleFactor !== undefined) {
    devicePixelRatio = await readDevicePixelRatio(page);
    const problem = judgeZoomSignals({
      target,
      deviceScaleFactor: opts.deviceScaleFactor,
      innerWidth: firstMeasurement.width,
      innerHeight: firstMeasurement.height,
      devicePixelRatio,
    });
    if (problem) {
      throw new ViewportDesyncError(
        problem,
        target,
        { innerWidth: firstMeasurement.width, innerHeight: firstMeasurement.height, devicePixelRatio },
        opts.deviceScaleFactor,
      );
    }
  }

  if (Math.abs(zoom - 1) <= ZOOM_EPSILON) {
    return { viewport: target, zoom, effective: firstMeasurement, ...(devicePixelRatio !== undefined ? { devicePixelRatio } : {}) };
  }

  const compensated: Viewport = {
    width: Math.round(target.width * zoom),
    height: Math.round(target.height * zoom),
  };
  await page.setViewportSize(compensated);
  const secondMeasurement = await measureEffectiveViewport(page);

  const converged =
    relativeDiff(secondMeasurement.width, target.width) <= ZOOM_EPSILON &&
    relativeDiff(secondMeasurement.height, target.height) <= ZOOM_EPSILON;

  if (!converged) {
    throw new ZoomCompensationError(target, zoom, secondMeasurement);
  }

  return { viewport: compensated, zoom, effective: secondMeasurement, ...(devicePixelRatio !== undefined ? { devicePixelRatio } : {}) };
}

const BROWSER_NOT_INSTALLED_RE = /Executable doesn't exist at/;

/**
 * Playwright's bundled browser binary is not installed by a plain `npm
 * install`/`pnpm install` (it needs a separate `npx playwright install
 * chromium`, deliberately not wired as a postinstall script -- see this
 * package's README/tool descriptions). Rather than let that surface as a
 * cryptic native-binary launch error, catch it here and return a clear,
 * actionable message.
 */
export async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (BROWSER_NOT_INSTALLED_RE.test(message)) {
      throw new Error(
        `Playwright's Chromium browser is not installed. Run "npx playwright install chromium" (in the ` +
          `project, or wherever @openvidstudio/mcp-server is installed) and retry. Original error: ${message}`,
      );
    }
    throw err;
  }
}

/**
 * Re-exports the exact `chromium` BrowserType this file already imports from "playwright"
 * above (the one launchChromium calls .launch() on), so preflight.ts's environment check can
 * call chromium.executablePath() on the literal same resolution real capture uses, instead of
 * a second "import playwright" of its own that could resolve a different installed copy
 * (a different node_modules nesting, or a different PLAYWRIGHT_BROWSERS_PATH-relative build)
 * and pass preflight while real capture still fails, or the reverse.
 */
export { chromium };

/**
 * The version of the `chromium` BrowserType re-exported above, read from that same resolved
 * package rather than a fresh "playwright" lookup, so a report naming this version can never
 * name a different install than the one executablePath() below actually resolved against.
 */
export function resolvedPlaywrightVersion(): string {
  // A plain require for one field off a package.json, not a code import -- this package's
  // commonjs target has no resolveJsonModule story that would make `import ... from
  // "playwright/package.json"` resolve the same way `import { chromium } from "playwright"`
  // above already does.
  return (require("playwright/package.json") as { version: string }).version;
}

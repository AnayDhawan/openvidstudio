import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
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

export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type Interaction =
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "select"; selector: string; value: string }
  | { type: "hover"; selector: string }
  | { type: "scroll"; selector?: string; x?: number; y?: number }
  | { type: "wait"; ms?: number; selector?: string };

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
  }),
  z.object({ type: z.literal("wait"), ms: z.number().optional(), selector: z.string().optional() }),
]);

/**
 * Replays a beat's interactions in array order. Shared verbatim by both capture
 * tools so their replay semantics never drift apart -- called after navigation
 * and (for both tools) after the zoom-desync compensation below, in the same
 * effective CSS-pixel viewport CAPTURE.md measured.
 */
export async function replayInteractions(page: Page, interactions: Interaction[] | undefined): Promise<void> {
  for (const interaction of interactions ?? []) {
    switch (interaction.type) {
      case "click":
        await page.click(interaction.selector);
        break;
      case "fill":
        await page.fill(interaction.selector, interaction.value);
        break;
      case "select":
        await page.selectOption(interaction.selector, interaction.value);
        break;
      case "hover":
        await page.hover(interaction.selector);
        break;
      case "scroll":
        if (interaction.selector) {
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
    }
  }
}

export const ZOOM_EPSILON = 0.01;

export interface ZoomCompensation {
  /** The viewport actually in effect for capture: `target` unchanged, or the compensated size. */
  viewport: Viewport;
  /** Measured zoom = target.width / (effective width before compensation). 1 means no desync. */
  zoom: number;
  /** The last-measured `[window.innerWidth, window.innerHeight]`. */
  effective: Viewport;
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
export async function detectAndCompensateZoom(page: Page, target: Viewport): Promise<ZoomCompensation> {
  const firstMeasurement = await measureEffectiveViewport(page);
  const zoom = target.width / firstMeasurement.width;

  if (Math.abs(zoom - 1) <= ZOOM_EPSILON) {
    return { viewport: target, zoom, effective: firstMeasurement };
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

  return { viewport: compensated, zoom, effective: secondMeasurement };
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

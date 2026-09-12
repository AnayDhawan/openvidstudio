import type { Page } from "playwright";

/**
 * Waits for a page to finish becoming itself before anything is captured.
 *
 * This is the difference between a demo that looks deliberate and one that looks broken.
 * A modern page is not finished when `load` fires: webfonts are still swapping, images are
 * still decoding, and any entrance transition is mid-flight. Capture at that moment and you
 * get a frame nobody ever sees in real use, with fallback type, a blank hero, and a panel
 * frozen at 40% opacity halfway through its fade. The page was fine. The capture was early.
 *
 * Three waits, in the order they resolve in a real browser:
 *
 * 1. **Fonts.** `document.fonts.ready` resolves once every font actually used has loaded.
 *    Skipping it is the single commonest cause of a capture rendered in Times New Roman.
 * 2. **Images.** Decoded, not merely fetched. A fetched-but-undecoded image still paints
 *    blank for a frame or two.
 * 3. **Animations.** Every running animation and transition driven to its end.
 *
 * The third one has a trap in it: an infinite animation never finishes. A looping spinner,
 * a pulsing dot, a permanently drifting gradient will all return a `finished` promise that
 * never resolves, so waiting on everything indiscriminately hangs until the timeout on most
 * real marketing pages. Those are filtered out by their computed timing, which is also the
 * correct behaviour: a loop has no "settled" state to wait for, and the page is as ready as
 * it will ever be while it keeps running.
 */

export interface SettleOptions {
  /** Give up after this long and report what was still pending. Defaults to 5000ms. */
  timeoutMs?: number;
  /** Wait for webfonts. Defaults to true. */
  fonts?: boolean;
  /** Wait for images to decode. Defaults to true. */
  images?: boolean;
  /** Drive running transitions and animations to their end. Defaults to true. */
  animations?: boolean;
  /** A final quiet pause after everything else, for work no API reports. Defaults to 150ms. */
  quietMs?: number;
}

export interface SettleReport {
  /** False when the timeout fired with work still outstanding. */
  settled: boolean;
  waitedMs: number;
  /** Animations still running when the wait ended, excluding infinite ones. */
  pendingAnimations: number;
  /** Infinite animations, which are never waited on and are not a problem. */
  loopingAnimations: number;
  fontsReady: boolean;
  imagesReady: boolean;
}

export const DEFAULT_SETTLE_TIMEOUT_MS = 5000;
export const DEFAULT_QUIET_MS = 150;

/**
 * Runs in the page. Returns once fonts, images and finite animations are all done, or
 * resolves early with what is still outstanding if the deadline passes first.
 */
/* c8 ignore start -- executes in the browser, covered by the real-browser E2E */
const settleInPage = async (opts: {
  timeoutMs: number;
  fonts: boolean;
  images: boolean;
  animations: boolean;
}): Promise<Omit<SettleReport, "waitedMs">> => {
  const deadline = Date.now() + opts.timeoutMs;
  const left = () => Math.max(0, deadline - Date.now());
  const withDeadline = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), left()))]);

  let fontsReady = true;
  if (opts.fonts && typeof document.fonts !== "undefined") {
    fontsReady = await withDeadline(document.fonts.ready.then(() => true), false);
  }

  let imagesReady = true;
  if (opts.images) {
    const pending = Array.from(document.images).filter((img) => !img.complete);
    imagesReady = await withDeadline(
      Promise.all(
        pending.map((img) =>
          img
            .decode()
            .catch(() => undefined)
            .then(() => undefined),
        ),
      ).then(() => true),
      false,
    );
  }

  let pendingAnimations = 0;
  let loopingAnimations = 0;
  if (opts.animations && typeof document.getAnimations === "function") {
    const running = document.getAnimations().filter((a) => a.playState === "running");
    const finite = running.filter((a) => {
      // An infinite animation has no end to wait for. Waiting on its `finished` promise
      // hangs until the timeout, which on a page with a single looping spinner would make
      // every capture pay the full deadline for nothing.
      const timing = a.effect?.getComputedTiming?.();
      const iterations = timing?.iterations;
      return !(iterations === Infinity || iterations === null);
    });
    loopingAnimations = running.length - finite.length;
    const allDone = await withDeadline(
      Promise.all(finite.map((a) => a.finished.catch(() => undefined))).then(() => true),
      false,
    );
    pendingAnimations = allDone
      ? 0
      : document.getAnimations().filter((a) => {
          if (a.playState !== "running") return false;
          const it = a.effect?.getComputedTiming?.()?.iterations;
          return !(it === Infinity || it === null);
        }).length;
  }

  return { settled: fontsReady && imagesReady && pendingAnimations === 0, pendingAnimations, loopingAnimations, fontsReady, imagesReady };
};
/* c8 ignore stop */

/**
 * Settles the page, then pauses briefly.
 *
 * The trailing pause is not superstition: a transition can finish one frame before the
 * compositor has painted its final state, and `requestAnimationFrame` ordering means the
 * screenshot can otherwise land on the frame before the last one.
 */
export async function settlePage(page: Page, opts: SettleOptions = {}): Promise<SettleReport> {
  const started = Date.now();
  const report = await page.evaluate(settleInPage, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS,
    fonts: opts.fonts !== false,
    images: opts.images !== false,
    animations: opts.animations !== false,
  });

  const quiet = opts.quietMs ?? DEFAULT_QUIET_MS;
  if (quiet > 0) await page.waitForTimeout(quiet);

  return { ...report, waitedMs: Date.now() - started };
}

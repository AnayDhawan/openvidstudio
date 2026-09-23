import type { Page } from "playwright";

/**
 * Opt-in determinism for capture_screenshot/capture_screen_recording, so two captures of
 * an unchanged page are byte-identical instead of differing on whatever the page derived
 * from the real clock or Math.random() (a timestamp-based id, a typewriter effect keyed off
 * Date.now(), a randomly ordered list).
 *
 * Deliberately uses `clock.setFixedTime`, not `clock.install`/`pauseAt`: those replace
 * setTimeout/setInterval/requestAnimationFrame with fake, manually-driven timers, which
 * would also freeze settlePage's own real-time deadline race (it runs *inside* the page via
 * page.evaluate) and every CSS/JS animation settlePage is waiting on -- exactly the two
 * things a capture still needs to actually finish. `setFixedTime` freezes only what
 * `Date.now()`/`new Date()` report, and "keeps all the timers running" (Playwright's own
 * wording), so nothing about settle or animation timing changes.
 *
 * Forcing a CSS animation to a specific phase, or a JS-driven one to a deterministic state,
 * is a separate, harder problem (reducedMotion emulation gets partway there but does not
 * solve it) and is intentionally out of scope here.
 */
export interface DeterminismOptions {
  /** Fixed value Date.now()/new Date() report for the whole capture. */
  epochMs?: number;
  /** Seed for the Math.random() override. */
  seed?: number;
}

/** An arbitrary fixed instant -- any constant works, what matters is that it never changes. */
export const DEFAULT_DETERMINISTIC_EPOCH_MS = Date.UTC(2024, 0, 1);
export const DEFAULT_DETERMINISTIC_SEED = 0x2f6e2b1;

/**
 * Runs in the page, injected via addInitScript before any page script. A small fixed-seed
 * PRNG (mulberry32) so the override needs no dependency and stays reproducible across Node
 * versions/platforms, unlike reseeding whatever RNG the JS engine's own Math.random() uses
 * internally (which isn't seedable at all).
 */
/* c8 ignore start -- executes in the browser, covered by the real-browser E2E */
function seedMathRandomInPage(seed: number): void {
  let state = seed >>> 0;
  Math.random = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* c8 ignore stop */

/**
 * Installs both overrides. Call after the page exists but before navigation -- same timing
 * rule as colorScheme/reducedMotion: applied after the first paint, this would race a page
 * that reads Math.random()/Date.now() once at load and caches the result.
 */
export async function installDeterminism(page: Page, opts: DeterminismOptions = {}): Promise<void> {
  await page.addInitScript(seedMathRandomInPage, opts.seed ?? DEFAULT_DETERMINISTIC_SEED);
  await page.clock.setFixedTime(opts.epochMs ?? DEFAULT_DETERMINISTIC_EPOCH_MS);
}

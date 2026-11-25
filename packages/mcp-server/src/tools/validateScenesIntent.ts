import * as fs from "node:fs";
import * as path from "node:path";
import type { Browser } from "playwright";
import {
  DEFAULT_VIEWPORT,
  launchChromium,
  readCaptureSidecar,
  replayInteractions,
  settlePage,
  type Interaction,
  type Viewport,
} from "@openvidstudio/capture";
import { pascalCase } from "../util";
import type { SceneFinding } from "./validateScenes";

/**
 * validate_scenes's intent mode: is what a beat was captured to show still what the page shows?
 *
 * A capture is a frame of a page at one moment. The beat that uses it claims something about that
 * page (it is at this url, you click this, this panel is on screen), and when the product changes
 * the capture still renders fine and the claim quietly stops being true. Nothing about the video
 * says so: the still is a perfectly good picture of the old page.
 *
 * So this opens each beat's page again, walks its click path and checks the claim against the live
 * page, naming the selector that is gone. What it checks is only what the beat itself states:
 *   - the url the beat captured, against the url the capture's sidecar says it was taken from
 *   - every selector in the beat's `interactions`: it has to exist when its step runs
 *   - every selector in `visual.shows`: it has to be visible once the path has run
 * A beat the brief calls constructed (shotList `real: false`), or one that is not a browser capture,
 * has no page to check and is skipped with the reason.
 */

/** How long a selector gets to appear, in ms. A live page is already loaded, so this is generous, not patient. */
const SELECTOR_TIMEOUT_MS = 4000;
const NAVIGATION_TIMEOUT_MS = 20000;

export interface IntentBeat {
  id: string;
  visual?: {
    captureMethod?: string;
    source?: string;
    url?: string;
    interactions?: Interaction[];
    /** Selectors that must be visible on the finished page: what the beat is meant to show. */
    shows?: string[];
  };
  artifacts?: { screenshotPath?: string; recordingPath?: string };
}

export interface BeatIntentResult {
  beatId: string;
  status: "ok" | "drifted" | "skipped";
  url?: string;
  /** Why a beat was skipped, or what drifted, in a sentence. */
  reason?: string;
  /** Selectors the beat needs that the live page does not have (or does not show). */
  missingSelectors: string[];
  /** The interaction that could not run, when the click path stopped. */
  failedStep?: { index: number; type: string; selector?: string };
  /** True when beats.json names a different url from the one the capture was taken of. */
  urlChanged?: boolean;
}

export interface IntentCheckResult {
  findings: SceneFinding[];
  beatsChecked: number;
  beats: BeatIntentResult[];
}

/** A url with the parts that do not change what page it is (a trailing slash, a hash) removed. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Why this beat has no page to check, or null when it does. Pure. */
export function intentSkipReason(beat: IntentBeat, briefReal: boolean | undefined): string | null {
  const method = beat.visual?.captureMethod;
  if (method !== "screenshot" && method !== "recording") return `captureMethod is ${method ?? "unset"}, not a browser capture`;
  if ((beat.visual?.source ?? "browser") !== "browser") return `source is ${beat.visual?.source}, not a browser page`;
  if (briefReal === false) return "the brief's shot list marks this beat as constructed (real: false), so there is no page behind it";
  return null;
}

/** The selectors a beat's click path needs, with the step each belongs to. Pure. */
export function interactionSelectors(interactions: Interaction[] | undefined): { index: number; selector: string }[] {
  const out: { index: number; selector: string }[] = [];
  (interactions ?? []).forEach((i, index) => {
    const selector = (i as { selector?: string }).selector;
    if (typeof selector === "string" && selector.length > 0) out.push({ index, selector });
  });
  return out;
}

/** Reads src/videos/<name>/brief.json's shotList into beatId -> real, or an empty map. */
export function readBriefReal(videoDir: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const file = path.join(videoDir, "brief.json");
  if (!fs.existsSync(file)) return out;
  try {
    const brief = JSON.parse(fs.readFileSync(file, "utf8")) as { shotList?: { beatId?: string; real?: boolean }[] };
    for (const e of brief.shotList ?? []) if (typeof e.beatId === "string" && typeof e.real === "boolean") out.set(e.beatId, e.real);
  } catch {
    // An unreadable brief is not this check's problem to report; its beats are simply not skipped.
  }
  return out;
}

function capturedAssetPath(beat: IntentBeat): string {
  const a = beat.artifacts ?? {};
  return beat.visual?.captureMethod === "recording"
    ? (a.recordingPath ?? path.join("public", "video", `${beat.id}.mp4`))
    : (a.screenshotPath ?? path.join("public", "images", `${beat.id}.png`));
}

function describeStep(i: Interaction): string {
  const sel = (i as { selector?: string }).selector;
  return sel ? `${i.type} "${sel}"` : i.type;
}

export async function runIntentChecks(opts: {
  projectRoot: string;
  videoDir: string;
  beats: IntentBeat[];
  /** Overrides the per-selector wait, in ms. */
  selectorTimeoutMs?: number;
}): Promise<IntentCheckResult> {
  const timeout = opts.selectorTimeoutMs ?? SELECTOR_TIMEOUT_MS;
  const brief = readBriefReal(opts.videoDir);
  const findings: SceneFinding[] = [];
  const results: BeatIntentResult[] = [];
  let browser: Browser | null = null;

  try {
    for (const beat of opts.beats) {
      const scene = `${pascalCase(beat.id)}.tsx`;
      const base = { beatId: beat.id, scene, source: "intent" as const, check: "intent" };
      const skip = intentSkipReason(beat, brief.get(beat.id));
      if (skip) {
        results.push({ beatId: beat.id, status: "skipped", reason: skip, missingSelectors: [] });
        continue;
      }

      const sidecar = readCaptureSidecar(path.join(opts.projectRoot, capturedAssetPath(beat)));
      const url = beat.visual?.url ?? sidecar?.url;
      if (!url) {
        const reason = "the beat names no url and its capture has no sidecar saying where it came from";
        results.push({ beatId: beat.id, status: "skipped", reason, missingSelectors: [] });
        findings.push({ ...base, severity: "warning", check: "intent-skipped", message: `Not checked against the live page: ${reason}.` });
        continue;
      }

      const result: BeatIntentResult = { beatId: beat.id, status: "ok", url, missingSelectors: [] };

      // 1. The beat and its capture have to be about the same page.
      if (beat.visual?.url && sidecar && normalizeUrl(beat.visual.url) !== normalizeUrl(sidecar.url)) {
        result.urlChanged = true;
        result.status = "drifted";
        findings.push({
          ...base,
          severity: "error",
          message:
            `beats.json says this beat shows ${beat.visual.url}, but its capture was taken of ${sidecar.url}. The picture ` +
            `is of a different page from the one the beat describes. Re-run the capture tool for this beat.`,
        });
      }

      // 2. Open the page the beat describes and walk its click path.
      browser ??= await launchChromium();
      const viewport: Viewport = sidecar?.viewport ?? DEFAULT_VIEWPORT;
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        let opened = true;
        try {
          const response = await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
          if (response && response.status() >= 400) {
            result.status = "drifted";
            result.reason = `${url} answered HTTP ${response.status()}`;
            findings.push({ ...base, severity: "error", message: `${url} now answers HTTP ${response.status()}, so the page this beat was captured from is gone or moved.` });
            opened = false;
          }
        } catch (err) {
          // Nothing listening is not drift: the product may simply not be running. Say so and move on.
          const reason = `could not open ${url}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
          results.push({ ...result, status: "skipped", reason });
          findings.push({ ...base, severity: "warning", check: "intent-skipped", message: `Not checked against the live page: ${reason}. Start the product and run again.` });
          continue;
        }

        if (opened) {
          let stopped = false;
          const steps = beat.visual?.interactions ?? [];
          for (const [index, step] of steps.entries()) {
            const selector = (step as { selector?: string }).selector;
            if (selector) {
              try {
                await page.waitForSelector(selector, { state: "attached", timeout: timeout });
              } catch {
                result.status = "drifted";
                result.failedStep = { index, type: step.type, selector };
                result.missingSelectors.push(selector);
                findings.push({
                  ...base,
                  severity: "error",
                  message:
                    `Selector \`${selector}\` is not on ${page.url()}. Step ${index + 1} of this beat's click path ` +
                    `(${describeStep(step)}) needs it, so the path stops there and the beat no longer shows what its ` +
                    `capture shows. The page has changed since the capture, or the selector was wrong.`,
                });
                stopped = true;
                break;
              }
            }
            try {
              await page.setDefaultTimeout(timeout);
              await replayInteractions(page, [step]);
            } catch (err) {
              result.status = "drifted";
              result.failedStep = { index, type: step.type, ...(selector ? { selector } : {}) };
              findings.push({
                ...base,
                severity: "error",
                message:
                  `Step ${index + 1} of this beat's click path (${describeStep(step)}) could not run on ${page.url()}: ` +
                  `${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
              });
              stopped = true;
              break;
            }
          }

          // 3. What the beat says it shows has to be on screen at the end of the path.
          const shows = beat.visual?.shows ?? [];
          if (!stopped && shows.length > 0) {
            await settlePage(page, { timeoutMs: 3000 }).catch(() => undefined);
            for (const selector of shows) {
              try {
                await page.waitForSelector(selector, { state: "visible", timeout: timeout });
              } catch {
                result.status = "drifted";
                result.missingSelectors.push(selector);
                findings.push({
                  ...base,
                  severity: "error",
                  message:
                    `Selector \`${selector}\` is not visible on ${page.url()} after this beat's click path, but the beat ` +
                    `says it shows it (visual.shows). The page has changed since the capture.`,
                });
              }
            }
          } else if (stopped && shows.length > 0) {
            result.reason = `the click path stopped at step ${(result.failedStep?.index ?? 0) + 1}, so visual.shows was not checked`;
          }
        }
      } finally {
        await context.close();
      }
      if (result.status === "drifted" && !result.reason) {
        result.reason = result.missingSelectors.length
          ? `missing: ${result.missingSelectors.map((s) => `\`${s}\``).join(", ")}`
          : result.urlChanged
            ? "the capture is of a different url"
            : "the click path no longer runs";
      }
      results.push(result);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  return { findings, beatsChecked: results.filter((r) => r.status !== "skipped").length, beats: results };
}

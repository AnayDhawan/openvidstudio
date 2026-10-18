import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import {
  DEFAULT_DEVICE_SCALE,
  DEFAULT_VIEWPORT,
  captureSidecarPath,
  detectAndCompensateZoom,
  launchChromium,
  readCaptureSidecar,
  replayInteractions,
  viewportSchema,
  interactionSchema,
  type Interaction,
  type Viewport,
} from "@openvidstudio/capture";
import { compareFrames, judgeDrift } from "../frameDiff";
import { runTool } from "./mcp";

/**
 * Re-captures the pages a video documents and reports which clips no longer match them.
 *
 * The problem this solves is well known and nobody solves it: a docs video is accurate the
 * day it is recorded and quietly wrong three releases later, because re-recording it by
 * hand is expensive enough that nobody does it until a user complains. Once capture is
 * automated, checking is cheap, and checking is most of the value: knowing which thirty
 * seconds of a ten minute video are stale is nearly as useful as re-rendering them, and it
 * is what makes re-rendering them affordable.
 *
 * The binding is docs route to beat id to reference frame. The reference is the frame the
 * beat was built from, which is already on disk as the beat's capture. Nothing new has to
 * be stored for a beat that was captured from a browser in the first place.
 */

export interface DriftBinding {
  beatId: string;
  url: string;
  /** Replayed before capture, same as the original. A page behind a click needs the click. */
  interactions?: Interaction[];
  /**
   * The CSS viewport to re-capture at. Defaults to the reference's own capture sidecar
   * (`<referencePath>.capture.json`, written by capture_screenshot/capture_screen_recording);
   * pass this explicitly for a reference that has no sidecar and isn't caught by the
   * legacy-heuristic fallback (see resolveCaptureSettings), or for a beat captured with
   * cropSelector, whose reference is a crop of a page rather than a view of one.
   */
  viewport?: Viewport;
  /** Pixels per CSS pixel to re-capture at. Defaults to the sidecar's own value, else 2. */
  deviceScaleFactor?: number;
  /** Defaults to the beat's own capture at public/images/<beatId>.png. */
  referencePath?: string;
}

export interface DocsDriftInput {
  projectRoot?: string;
  videoName: string;
  bindings?: DriftBinding[];
  outDir?: string;
  changedRatioThreshold?: number;
  meanDeltaThreshold?: number;
}

export interface DriftFinding {
  beatId: string;
  url: string;
  drifted: boolean;
  reason: string;
  changedRatio: number;
  meanDelta: number;
  referencePath: string;
  currentPath: string;
  diffPath: string;
}

export interface DocsDriftResult {
  ok: boolean;
  checked: number;
  driftedBeats: string[];
  findings: DriftFinding[];
  /** What to do about it, in the pipeline's own terms. */
  nextSteps: string[];
}

interface BeatLike {
  id: string;
  visual?: { captureMethod?: string; source?: string; url?: string; interactions?: Interaction[] };
  artifacts?: { screenshotPath?: string };
}

/**
 * Bindings inferred from the manifest, for the common case where nobody wrote any.
 *
 * Every browser screenshot beat already records the URL it came from and the interactions
 * that got it there, which is exactly a binding. Asking someone to restate that in a second
 * file would be asking them to keep two copies of one fact in sync.
 */
export function inferBindings(beats: BeatLike[]): DriftBinding[] {
  return beats
    .filter(
      (b) =>
        b.visual?.captureMethod === "screenshot" &&
        (b.visual?.source ?? "browser") === "browser" &&
        typeof b.visual?.url === "string" &&
        b.visual.url.length > 0,
    )
    .map((b) => ({
      beatId: b.id,
      url: b.visual!.url!,
      interactions: b.visual?.interactions,
      referencePath: b.artifacts?.screenshotPath ?? path.join("public", "images", `${b.id}.png`),
    }));
}

interface ResolvedCaptureSettings {
  viewport: Viewport;
  deviceScaleFactor: number;
  interactions?: Interaction[];
  /** Where the viewport/scale came from -- surfaced on findings-less debugging only. */
  source: "explicit" | "sidecar" | "legacy-heuristic";
}

/**
 * A common desktop CSS viewport a legacy (pre-sidecar) reference might have been captured
 * at. Only ever checked against HALF the reference PNG's own pixel size, and only when that
 * halving is exact -- this is deliberately the one narrow, checkable guess this tool is
 * allowed to make. Guessing a viewport from the reference's full pixel size (treating a
 * 2880x1800 PNG as a 2880x1800 viewport) is the exact bug this whole binding exists to kill.
 */
const COMMON_VIEWPORTS: Viewport[] = [
  DEFAULT_VIEWPORT, // 1600x1000
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 },
];

/**
 * Works out what CSS viewport and scale to re-capture a reference frame at, in the same
 * order of trust every time: an explicit binding, then the sidecar the original capture
 * wrote, then (only for a legacy asset with neither) the one narrow heuristic above. Never
 * the reference image's own pixel size read directly as a viewport -- that was the bug.
 */
async function resolveCaptureSettings(
  binding: DriftBinding,
  referenceAbs: string,
): Promise<ResolvedCaptureSettings> {
  if (binding.viewport) {
    return {
      viewport: binding.viewport,
      deviceScaleFactor: binding.deviceScaleFactor ?? DEFAULT_DEVICE_SCALE,
      interactions: binding.interactions,
      source: "explicit",
    };
  }

  const sidecar = readCaptureSidecar(referenceAbs);
  if (sidecar) {
    return {
      viewport: sidecar.viewport,
      deviceScaleFactor: sidecar.deviceScaleFactor,
      interactions: binding.interactions ?? sidecar.interactions,
      source: "sidecar",
    };
  }

  const meta = await sharp(referenceAbs).metadata();
  if (meta.width && meta.height && meta.width % 2 === 0 && meta.height % 2 === 0) {
    const halved: Viewport = { width: meta.width / 2, height: meta.height / 2 };
    const isCommon = COMMON_VIEWPORTS.some((v) => v.width === halved.width && v.height === halved.height);
    if (isCommon) {
      return {
        viewport: halved,
        deviceScaleFactor: 2,
        interactions: binding.interactions,
        source: "legacy-heuristic",
      };
    }
  }

  throw new Error(
    `Beat "${binding.beatId}" has no capture sidecar at ${captureSidecarPath(referenceAbs)}, and its ` +
      `reference image's pixel size (${meta.width ?? "?"}x${meta.height ?? "?"}) is not exactly double a ` +
      `common CSS viewport, so there is no safe way to guess the viewport it was captured at -- treating the ` +
      `pixel size itself as the viewport is exactly the bug this binding exists to avoid. Pass an explicit ` +
      `viewport (and deviceScaleFactor, if not 2) in this binding.`,
  );
}

export async function runDocsDrift(input: DocsDriftInput): Promise<DocsDriftResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const beatsPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsPath)) throw new Error(`${beatsPath} does not exist.`);
  const doc = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as { beats?: BeatLike[] };
  const beats = doc.beats ?? [];

  const bindings = input.bindings?.length ? input.bindings : inferBindings(beats);
  if (bindings.length === 0) {
    throw new Error(
      `No drift bindings. This video has no browser screenshot beat carrying a url, and none were passed ` +
        `in. Drift detection re-captures a page and compares it to the frame the beat was built from, so it ` +
        `needs to know which page each beat came from.`,
    );
  }

  const outRel = input.outDir ?? path.join("output", "drift", videoName);
  const outAbs = path.join(projectRoot, outRel);
  fs.mkdirSync(outAbs, { recursive: true });

  const findings: DriftFinding[] = [];
  const browser = await launchChromium();
  try {
    for (const binding of bindings) {
      const referenceRel = binding.referencePath ?? path.join("public", "images", `${binding.beatId}.png`);
      const referenceAbs = path.join(projectRoot, referenceRel);
      if (!fs.existsSync(referenceAbs)) {
        throw new Error(
          `Beat "${binding.beatId}" has no reference frame at ${referenceRel}. There is nothing to compare ` +
            `the live page against, so this is a missing capture rather than drift.`,
        );
      }

      // The CSS viewport and scale to re-capture at come from the reference's own capture
      // sidecar (or an explicit binding, or the legacy heuristic) -- never from the
      // reference PNG's pixel size read directly as a viewport. See resolveCaptureSettings.
      const { viewport: target, deviceScaleFactor, interactions } = await resolveCaptureSettings(
        binding,
        referenceAbs,
      );
      // deviceScaleFactor has to be set at context creation, matching capture_screenshot's
      // own newContext({ deviceScaleFactor }) -- a plain browser.newPage() context defaults
      // to 1x, which would make every re-capture a different pixel size than a reference
      // taken at the pipeline's default of 2x even once the CSS viewport itself is right.
      const context = await browser.newContext({ deviceScaleFactor });
      try {
        const page = await context.newPage();
        try {
          await page.setViewportSize(target);
          await page.goto(binding.url, { waitUntil: "networkidle" });
          // Same zoom compensation the original capture used, measured fresh on whatever
          // machine is running this check rather than replayed from a stored ratio --
          // CAPTURE.md is explicit that the ratio differs per machine/profile. Skipping
          // this would make every comparison a comparison of two different viewports.
          await detectAndCompensateZoom(page, target);
          await replayInteractions(page, interactions);

          const currentRel = path.join(outRel, `${binding.beatId}.png`);
          // "device", not the default, so the re-capture lands on the reference's own pixel
          // size (viewport * deviceScaleFactor) rather than being resampled to CSS size --
          // matching scale is what "compare at the reference's own pixel size" means here.
          await page.screenshot({
            path: path.join(projectRoot, currentRel),
            fullPage: false,
            scale: "device",
          });

          const diffRel = path.join(outRel, `${binding.beatId}.diff.png`);
          const comparison = await compareFrames(referenceAbs, path.join(projectRoot, currentRel), {
            diffPath: path.join(projectRoot, diffRel),
          });
          const verdict = judgeDrift(comparison, {
            changedRatio: input.changedRatioThreshold,
            meanDelta: input.meanDeltaThreshold,
          });

          findings.push({
            beatId: binding.beatId,
            url: binding.url,
            drifted: verdict.drifted,
            reason: verdict.reason,
            changedRatio: comparison.changedRatio,
            meanDelta: comparison.meanDelta,
            referencePath: referenceRel,
            currentPath: currentRel,
            diffPath: diffRel,
          });
        } finally {
          await page.close();
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const driftedBeats = findings.filter((f) => f.drifted).map((f) => f.beatId);
  const nextSteps =
    driftedBeats.length === 0
      ? ["Nothing has drifted. The clips still match the pages they document."]
      : [
          `Re-capture the drifted beats: capture_screenshot for ${driftedBeats.join(", ")}.`,
          `Then render_video with incremental: true, which re-renders only those beats rather than the ` +
            `whole composition.`,
          `The diff images in ${outRel} show which part of each page moved, which is usually enough to tell ` +
            `an intended redesign from an accident.`,
        ];

  return { ok: driftedBeats.length === 0, checked: findings.length, driftedBeats, findings, nextSteps };
}

export function registerDocsDrift(server: McpServer): void {
  server.registerTool(
    "docs_drift",
    {
      title: "Find the clips that no longer match the pages they document",
      description:
        "Re-captures the pages a video's beats were built from and compares them against the frames that " +
        "were captured at the time, reporting which beats have gone stale. A docs video is accurate the day " +
        "it is recorded and quietly wrong three releases later, because re-recording by hand is expensive " +
        "enough that nobody does it until a user complains. Checking is cheap once capture is automated, and " +
        "knowing which thirty seconds of a ten minute video are stale is most of the value. Bindings are " +
        "inferred from the manifest by default: every browser screenshot beat already records its url and " +
        "the interactions that got there, which is exactly a binding, so keeping a second copy of that in " +
        "another file would just be two things to keep in sync. The CSS viewport and deviceScaleFactor to " +
        "re-capture at come from the reference's own `<referencePath>.capture.json` sidecar (written by " +
        "capture_screenshot/capture_screen_recording), never from the reference PNG's pixel size read " +
        "directly as a viewport -- that produces a different, usually much wider layout than the one that " +
        "was actually captured, and reports drift on pages that never changed. A legacy reference with no " +
        "sidecar falls back to one narrow, checkable guess (its pixel size is exactly double a common CSS " +
        "viewport) and otherwise requires viewport (and deviceScaleFactor, if not 2) in an explicit binding, " +
        "same as a beat captured with cropSelector, whose reference is a crop of a page rather than a view " +
        "of one. The re-capture replays the same interactions and the same zoom compensation, measured fresh " +
        "rather than reused, since CAPTURE.md is explicit that the ratio differs per machine/profile. Output " +
        "is a per-beat verdict, a diff image showing where the page moved, and " +
        "the exact next commands: re-capture the drifted beats, then render with incremental so only those " +
        "beats are re-rendered. Run it on a schedule.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        bindings: z
          .array(
            z.object({
              beatId: z.string().min(1),
              url: z.string().url(),
              interactions: z.array(interactionSchema).optional(),
              viewport: viewportSchema
                .optional()
                .describe(
                  "Overrides the reference's capture sidecar / legacy heuristic. Required for a reference " +
                    "with neither (e.g. captured with cropSelector).",
                ),
              deviceScaleFactor: z.number().positive().optional().describe("Defaults to the sidecar's value, else 2."),
              referencePath: z.string().optional(),
            }),
          )
          .optional()
          .describe("Defaults to every browser screenshot beat in the manifest that carries a url."),
        outDir: z.string().optional(),
        changedRatioThreshold: z.number().positive().optional(),
        meanDeltaThreshold: z.number().positive().optional(),
      },
    },
    async (input) => runTool("docs_drift", () => runDocsDrift(input)),
  );
}

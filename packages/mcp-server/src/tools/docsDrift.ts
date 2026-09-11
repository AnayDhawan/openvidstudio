import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import {
  DEFAULT_VIEWPORT,
  detectAndCompensateZoom,
  launchChromium,
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
  viewport?: Viewport;
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

      // The reference frame's own dimensions are the viewport to re-capture at.
      //
      // beats.json does not record the viewport a capture used, and adding a field for it
      // would only be recording something the file on disk already proves. Matching it
      // exactly also removes the commonest false positive: a re-capture at a different
      // size is a size difference, which judgeDrift correctly calls drift, and which would
      // then be the only thing this tool ever reported.
      //
      // The exception is a beat captured with a cropSelector, where the reference is a
      // crop of a page rather than a view of one. Such a beat needs an explicit binding.
      const referenceSize = await sharp(referenceAbs).metadata();
      const target: Viewport =
        binding.viewport ??
        (referenceSize.width && referenceSize.height
          ? { width: referenceSize.width, height: referenceSize.height }
          : DEFAULT_VIEWPORT);
      const page = await browser.newPage();
      try {
        await page.setViewportSize(target);
        await page.goto(binding.url, { waitUntil: "networkidle" });
        // Same zoom compensation the original capture used. Skipping it here would make
        // every comparison a comparison of two different viewports.
        await detectAndCompensateZoom(page, target);
        await replayInteractions(page, binding.interactions);

        const currentRel = path.join(outRel, `${binding.beatId}.png`);
        await page.screenshot({ path: path.join(projectRoot, currentRel), fullPage: false });

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
        "another file would just be two things to keep in sync. The re-capture replays the same " +
        "interactions and the same zoom compensation, at the reference frame's own dimensions, otherwise " +
        "the comparison would be between two different viewports and every beat would report drift forever. " +
        "A beat captured with a cropSelector needs an explicit binding, since its reference is a crop of a " +
        "page rather than a view of one. Output is a per-beat verdict, a diff image showing where the page moved, and " +
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
              viewport: viewportSchema.optional(),
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

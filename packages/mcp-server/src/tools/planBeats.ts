import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot } from "../util";
import { loadConfig } from "../config";
import { runTool } from "./mcp";

/**
 * validate_beats enforces SCRIPT.md's 2.3-2.9 words/sec as a hard floor and ceiling,
 * per beat. SCRIPT.md reads like guidance, so the usual first draft gets rejected,
 * and often for being too *sparse*, which is not the failure anyone expects from a
 * pacing rule. The other repeat rejection is `screenshot` beats missing `url` and
 * `interactions`, which no doc states up front.
 *
 * This hands back a skeleton that already satisfies both, with the word budget stated
 * per beat, so narration is written to a number instead of guessed and revised.
 */

const PACE_MIN = 2.3;
const PACE_MAX = 2.9;

export type ArcName = "simple" | "packed" | "tutorial";

export interface PlanBeatsInput {
  projectRoot?: string;
  targetDurationSeconds: number;
  arc?: ArcName;
  /** One demo beat is planned per feature named here. */
  features?: string[];
  appUrl?: string;
  fps?: number;
}

export interface PlannedBeat {
  id: string;
  start: number;
  duration: number;
  seconds: number;
  captureMethod: "screenshot" | "recording" | "dom-demo" | "higgsfield";
  /** Inclusive word count range that will pass validate_beats for this duration. */
  wordBudget: { min: number; max: number; suggested: number };
  purpose: string;
}

export interface PlanBeatsResult {
  fps: number;
  totalFrames: number;
  totalSeconds: number;
  arc: ArcName;
  totalWordBudget: { min: number; max: number; suggested: number };
  beats: PlannedBeat[];
  notes: string[];
}

interface Slot {
  id: string;
  weight: number;
  method: PlannedBeat["captureMethod"];
  purpose: string;
}

function slotsFor(arc: ArcName, features: string[]): Slot[] {
  const demo = features.length ? features : ["feature"];
  if (arc === "simple") {
    return [
      { id: "hook", weight: 8, method: "screenshot", purpose: "What it is, in one line, over the real product" },
      { id: "problem", weight: 11, method: "dom-demo", purpose: "What is broken today" },
      ...demo.slice(0, 3).map((f, i) => ({
        id: `demo-${slug(f) || i + 1}`,
        weight: 13,
        method: "screenshot" as const,
        purpose: `Show ${f} working`,
      })),
      { id: "differentiator", weight: 10, method: "dom-demo", purpose: "Why this rather than the obvious alternative" },
      { id: "cta", weight: 9, method: "dom-demo", purpose: "Where to get it" },
    ];
  }
  if (arc === "tutorial") {
    return [
      { id: "hook", weight: 8, method: "screenshot", purpose: "What the viewer will be able to do by the end" },
      { id: "prereqs", weight: 8, method: "dom-demo", purpose: "What must exist first" },
      { id: "install", weight: 9, method: "dom-demo", purpose: "Getting it onto the machine" },
      { id: "setup", weight: 9, method: "dom-demo", purpose: "Wiring it up" },
      ...demo.map((f, i) => ({
        id: `step-${slug(f) || i + 1}`,
        weight: 11,
        method: "screenshot" as const,
        purpose: `Walk through ${f}`,
      })),
      { id: "result", weight: 7, method: "dom-demo", purpose: "The finished artefact" },
      { id: "recap", weight: 6, method: "dom-demo", purpose: "The steps as one reference card" },
      { id: "cta", weight: 6, method: "dom-demo", purpose: "Where to get it" },
    ];
  }
  // packed: one dense hero beat that states everything, then one demo per claim.
  return [
    { id: "hook", weight: 15, method: "screenshot", purpose: "Everything the product does, stated once, for a cold viewer" },
    ...demo.map((f, i) => ({
      id: `demo-${slug(f) || i + 1}`,
      weight: 12,
      method: "screenshot" as const,
      purpose: `Back the hook's claim about ${f}`,
    })),
    { id: "differentiator", weight: 10, method: "dom-demo", purpose: "The one thing nothing else does" },
    { id: "cta", weight: 8, method: "dom-demo", purpose: "Where to get it" },
  ];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

export function runPlanBeats(input: PlanBeatsInput): PlanBeatsResult {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const config = loadConfig(projectRoot);
  const fps = input.fps ?? config.videoConfig.fps ?? 30;
  const arc: ArcName = input.arc ?? "simple";
  const appUrl = input.appUrl ?? config.capture.appUrl;
  const totalFrames = Math.round(input.targetDurationSeconds * fps);

  const slots = slotsFor(arc, input.features ?? []);
  const weightTotal = slots.reduce((a, s) => a + s.weight, 0);

  const beats: PlannedBeat[] = [];
  let start = 0;
  slots.forEach((slot, i) => {
    // Last beat absorbs the rounding so the total lands exactly on target.
    const raw = Math.round((slot.weight / weightTotal) * totalFrames);
    const duration = i === slots.length - 1 ? totalFrames - start : raw;
    const seconds = duration / fps;
    const min = Math.ceil(PACE_MIN * seconds);
    const max = Math.floor(PACE_MAX * seconds);
    beats.push({
      id: slot.id,
      start,
      duration,
      seconds: Number(seconds.toFixed(2)),
      captureMethod: slot.method,
      wordBudget: { min, max, suggested: Math.round((min + max) / 2) },
      purpose: slot.purpose,
    });
    start += duration;
  });

  const notes = [
    `Word budgets are the range validate_beats will accept for each duration. Write to the suggested ` +
      `number: it sits mid band, so a small edit later does not push the beat out of range.`,
    `Every beat with captureMethod "screenshot" also needs visual.url and visual.interactions (an array, ` +
      `which may be empty). validate_beats rejects the beat without them, and no other doc states this up front.`,
    `Capture beats default to ${appUrl}. Change capture.appUrl in openvidstudio.config.json, or set a url ` +
      `per beat.`,
    `Beats must stay contiguous: each start equals the previous start plus its duration. These already are.`,
  ];

  const totalBudget = beats.reduce(
    (a, b) => ({
      min: a.min + b.wordBudget.min,
      max: a.max + b.wordBudget.max,
      suggested: a.suggested + b.wordBudget.suggested,
    }),
    { min: 0, max: 0, suggested: 0 },
  );

  return {
    fps,
    totalFrames,
    totalSeconds: Number((totalFrames / fps).toFixed(2)),
    arc,
    totalWordBudget: totalBudget,
    beats,
    notes,
  };
}

export function registerPlanBeats(server: McpServer): void {
  server.registerTool(
    "plan_beats",
    {
      title: "Plan a beat skeleton with word budgets before writing narration",
      description:
        "Given a target duration and the features to show, returns a contiguous beat skeleton with a " +
        "capture method and a narration word budget per beat. The budget is the range validate_beats will " +
        "actually accept, which matters because SCRIPT.md's 2.3 to 2.9 words per second reads like guidance " +
        "but is enforced as a hard floor and ceiling per beat, and first drafts are commonly rejected for " +
        "being too sparse rather than too long. Writing to a stated number avoids that round trip. Three " +
        "arcs: simple (single feature, hook to CTA), packed (one dense hero beat then one demo per claim), " +
        "tutorial (prerequisites, install, setup, steps, recap). Output feeds straight into validate_beats " +
        "once narration is written in.",
      inputSchema: {
        projectRoot: z.string().optional(),
        targetDurationSeconds: z.number().positive(),
        arc: z.enum(["simple", "packed", "tutorial"]).optional(),
        features: z.array(z.string()).optional(),
        appUrl: z.string().optional(),
        fps: z.number().positive().optional(),
      },
    },
    async (input) => runTool("plan_beats", () => runPlanBeats(input)),
  );
}

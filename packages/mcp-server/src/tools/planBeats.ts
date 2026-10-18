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
  /**
   * Land every beat boundary on a downbeat of the score (C3). Pass the score's bpm (what
   * compose_score was given, or plan_music_cues found). Each beat becomes a whole number of
   * bars, at least one, and the total moves to the nearest whole bar, so a cut never falls
   * between two beats of the music.
   */
  snapToBars?: { bpm: number; beatsPerBar?: number };
}

export interface PlannedBeat {
  id: string;
  start: number;
  duration: number;
  /** Set with snapToBars: the bar this beat starts on (0-based) and how many bars it lasts. */
  startBar?: number;
  bars?: number;
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
  /** Present when snapToBars was used. */
  snappedToBars?: { bpm: number; beatsPerBar: number; framesPerBar: number; totalBars: number };
  notes: string[];
}

/**
 * Round a set of beat durations to whole bars. Every beat gets at least one bar, the total is
 * the nearest whole number of bars to the original (never fewer than one per beat), and any
 * difference is settled on the beats whose rounding moved furthest the wrong way, so the
 * result stays as close to the requested proportions as whole bars allow. Boundaries are
 * placed at exact bar positions and rounded once, so they never drift across the video.
 */
export function snapDurationsToBars(
  durations: number[],
  fps: number,
  bpm: number,
  beatsPerBar = 4,
): { bars: number[]; starts: number[]; durations: number[]; barFrames: number; totalFrames: number; totalBars: number } {
  const barFrames = (60 / bpm) * beatsPerBar * fps;
  const n = durations.length;
  const total = durations.reduce((a, b) => a + b, 0);
  const totalBars = Math.max(n, Math.round(total / barFrames));
  const bars = durations.map((d) => Math.max(1, Math.round(d / barFrames)));
  let diff = totalBars - bars.reduce((a, b) => a + b, 0);
  while (diff !== 0) {
    const step = diff > 0 ? 1 : -1;
    let best = -1;
    let bestWant = -Infinity;
    for (let i = 0; i < n; i++) {
      if (step < 0 && bars[i] <= 1) continue;
      const want = step * (durations[i] / barFrames - bars[i]);
      if (want > bestWant) {
        bestWant = want;
        best = i;
      }
    }
    if (best === -1) break;
    bars[best] += step;
    diff -= step;
  }
  const starts: number[] = [];
  let acc = 0;
  for (const b of bars) {
    starts.push(Math.round(acc * barFrames));
    acc += b;
  }
  const totalFrames = Math.round(acc * barFrames);
  const snapped = starts.map((s, i) => (i + 1 < n ? starts[i + 1]! : totalFrames) - s);
  return { bars, starts, durations: snapped, barFrames, totalFrames, totalBars: acc };
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
  const requestedFrames = Math.round(input.targetDurationSeconds * fps);

  const slots = slotsFor(arc, input.features ?? []);
  const weightTotal = slots.reduce((a, s) => a + s.weight, 0);

  // Last beat absorbs the rounding so the total lands exactly on target.
  const rawDurations: number[] = [];
  let used = 0;
  slots.forEach((slot, i) => {
    const raw = Math.round((slot.weight / weightTotal) * requestedFrames);
    const duration = i === slots.length - 1 ? requestedFrames - used : raw;
    rawDurations.push(duration);
    used += duration;
  });

  let snap: ReturnType<typeof snapDurationsToBars> | null = null;
  const beatsPerBar = input.snapToBars?.beatsPerBar ?? 4;
  if (input.snapToBars) {
    const { bpm } = input.snapToBars;
    if (!(bpm > 0) || !Number.isFinite(bpm)) throw new Error(`snapToBars.bpm must be a positive number, got ${bpm}.`);
    if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
      throw new Error(`snapToBars.beatsPerBar must be a whole number of at least 1, got ${beatsPerBar}.`);
    }
    snap = snapDurationsToBars(rawDurations, fps, bpm, beatsPerBar);
  }
  const durations = snap ? snap.durations : rawDurations;
  const totalFrames = snap ? snap.totalFrames : requestedFrames;

  const beats: PlannedBeat[] = [];
  let start = 0;
  slots.forEach((slot, i) => {
    const duration = durations[i]!;
    const seconds = duration / fps;
    const min = Math.ceil(PACE_MIN * seconds);
    const max = Math.floor(PACE_MAX * seconds);
    let startBar: number | undefined;
    if (snap) startBar = snap.bars.slice(0, i).reduce((a, b) => a + b, 0);
    beats.push({
      id: slot.id,
      start,
      duration,
      ...(snap ? { startBar, bars: snap.bars[i] } : {}),
      seconds: Number(seconds.toFixed(2)),
      captureMethod: slot.method,
      wordBudget: { min, max, suggested: Math.round((min + max) / 2) },
      purpose: slot.purpose,
    });
    start += duration;
  });

  const notes = [
    ...(snap
      ? [
          `Beats snapped to bars at ${input.snapToBars!.bpm} bpm (${beatsPerBar} beats per bar, ${snap.barFrames.toFixed(2)} ` +
            `frames per bar): every boundary is a downbeat, so cuts land on the music. The total is ${snap.totalBars} ` +
            `bars, ${totalFrames} frames (${(totalFrames / fps).toFixed(2)} s) against the ${requestedFrames} frames asked for. ` +
            `Word budgets below are for the snapped durations.`,
        ]
      : []),
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
    ...(snap
      ? {
          snappedToBars: {
            bpm: input.snapToBars!.bpm,
            beatsPerBar,
            framesPerBar: Number(snap.barFrames.toFixed(4)),
            totalBars: snap.totalBars,
          },
        }
      : {}),
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
        "once narration is written in. Pass snapToBars with the score's bpm when the video is cut to music, so " +
        "every boundary lands on a downbeat; the planned total then moves to the nearest whole bar.",
      inputSchema: {
        projectRoot: z.string().optional(),
        targetDurationSeconds: z.number().positive(),
        arc: z.enum(["simple", "packed", "tutorial"]).optional(),
        features: z.array(z.string()).optional(),
        appUrl: z.string().optional(),
        fps: z.number().positive().optional(),
        snapToBars: z
          .object({ bpm: z.number().positive(), beatsPerBar: z.number().int().min(1).optional() })
          .optional()
          .describe(
            "Land every beat boundary on a downbeat of the score. Pass the score's bpm (what compose_score was " +
              "given). Each beat becomes a whole number of bars (at least one), the total moves to the nearest " +
              "whole bar, and each planned beat reports startBar and bars. Word budgets are for the snapped " +
              "durations, so write to those.",
          ),
      },
    },
    async (input) => runTool("plan_beats", () => runPlanBeats(input)),
  );
}

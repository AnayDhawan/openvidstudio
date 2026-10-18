import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PrimitiveSchemaDefinition } from "@modelcontextprotocol/sdk/types.js";
import { resolveProjectRoot } from "../util";
import { loadConfig, type CreativeLevel } from "../config";
import { runPreflight } from "./preflight";
import { runTool } from "./mcp";

/**
 * Turns the two intake questions (PLANNING.md step 0: creative level, time budget) into a
 * concrete plan with a time estimate per phase, based on this machine's actual measured
 * render speed rather than a guess. The agent shows this plan, with the estimate, at the
 * approval gate before any beat gets written.
 *
 * The estimate has two kinds of number in it, and they are not equally solid:
 *  - Render time (draft pass, stills, final pass) is derived from preflight's real
 *    `remotion benchmark` measurement on this machine, divided by a per-level scene weight
 *    (a finished video renders slower than the flat benchmark composition). The bundle time per
 *    review round is measured by the same benchmark. This is the part the ±30% accuracy
 *    bar is actually about, and it's real because it's measured, not guessed. The scene
 *    weights are calibrated against recorded runs (see LevelProfile.renderWeight).
 *  - Authoring time (how long writing N bespoke scenes or filling N templates actually
 *    takes) has no machine to benchmark -- it's a per-beat constant, tuned per level
 *    (AUTHORING_SECONDS_PER_BEAT below), and it is the part of this estimate most likely
 *    to need recalibrating against real telemetry once peak/mid mode's actual authoring
 *    tools (Phase C: design.ts, compose_score, the primitive library) exist to time. Treat
 *    it as an engineering estimate, not a measurement, until then.
 */

export interface PlanProductionInput {
  projectRoot?: string;
  creativeLevel: CreativeLevel;
  timeBudgetMinutes: number;
  targetDurationSeconds?: number;
}

export interface PhaseEstimate {
  phase: string;
  seconds: number;
  note: string;
}

export interface PlanProductionResult {
  creativeLevel: CreativeLevel;
  timeBudgetMinutes: number;
  targetDurationSeconds: number;
  beatCountEstimate: number;
  arc: string;
  customScenes: number;
  templateScenes: number;
  scoreStrategy: string;
  qcRounds: number;
  renderPasses: string[];
  phases: PhaseEstimate[];
  /** Sum of phases[].seconds. */
  totalEstimateSeconds: number;
  /** False when totalEstimateSeconds exceeds timeBudgetMinutes * 60. */
  fitsBudget: boolean;
  /** Ordered: first thing to cut, then the next, if the budget is short. Empty if it fits. */
  cutFirst: string[];
  /** Present when even the unavoidable minimum (one final render) doesn't fit the budget. */
  infeasibleWarning?: string;
  /** How the render-time portion was derived: a real measurement, or an unmeasured fallback. */
  measurement: { fps: number | null; cpuCount: number | null; source: "benchmark" | "fallback"; bundleSeconds?: number | null };
  warnings: string[];
}

// Draft renders at half resolution with a fast x264 preset (renderVideo.ts's
// buildRenderCommand); this is the same ratio runRenderVideo's own async-job estimate
// (estimateRenderSeconds) uses between draft and final, kept consistent with it rather
// than independently re-guessed here.
const DRAFT_SPEEDUP = 4;
// A still is one real frame at full quality, not a whole pass, so its cost scales with how
// many frames get sampled (start/mid/end/cut per beat, see Phase C's render_stills), not
// with the composition's total duration the way a draft or final pass does.
const STILL_FRAMES_PER_BEAT = 4;
// No benchmark available (preflight failed, or the composition couldn't render): fall back
// to a conservative, clearly-labeled placeholder rather than refusing to plan at all.
// Matches renderVideo.ts's own async-estimate fallback order of magnitude.
const FALLBACK_FPS = 2;
// One bundle of the project costs about this much when preflight could not time one.
const FALLBACK_BUNDLE_SECONDS = 30;
// Capturing a beat's real footage (open the page, settle, interact, record) and how many of those
// captures get repeated once because a selector moved or a frame came out wrong.
const CAPTURE_SECONDS_PER_BEAT = 45;
const CAPTURE_RETRY_FRACTION = 0.5;

interface LevelProfile {
  qcRounds: number;
  customFraction: number;
  arc: string;
  scoreStrategy: string;
  authoringSecondsPerBeat: number;
  scoreSeconds: number;
  /**
   * How much slower a finished video of this level renders than preflight's flat benchmark
   * composition. literal is 1: a real 6-beat literal render matched the benchmark within 5%. peak is
   * 3.7, from the recorded Acme run: 1800 frames took 15 minutes (2 fps) where the benchmark ran at
   * 7.3 fps. mid sits between the two and is an engineering estimate until a mid run is timed.
   */
  renderWeight: number;
}

// Authoring-time constants (see the module doc comment): an engineering estimate, most
// solid for literal (today's scaffold_scene + a real template is literally all that mode
// does, so this is close to directly measurable) and least solid for peak (depends on
// Phase C tooling that doesn't exist yet to time for real).
const LEVEL_PROFILES: Record<CreativeLevel, LevelProfile> = {
  peak: {
    qcRounds: 3,
    customFraction: 1,
    arc: "cold-open hook, tension, problem, reveal, chapters, payoff, optional twist",
    scoreStrategy: "compose_score: an original, arc-matched score (Phase C)",
    authoringSecondsPerBeat: 90,
    scoreSeconds: 90,
    renderWeight: 3.7,
  },
  mid: {
    qcRounds: 2,
    customFraction: 0.3,
    arc: "hook, problem, demo x2-3, differentiator, cta (PIPELINE.md's Simple demo arc)",
    scoreStrategy: "the built-in ambient music-bed.mp3 or a CC0 track via find_music_bed",
    authoringSecondsPerBeat: 35,
    scoreSeconds: 20,
    renderWeight: 2,
  },
  literal: {
    qcRounds: 1,
    customFraction: 0,
    arc: "exactly the beats specified, nothing added",
    scoreStrategy: "whatever beats.json/the brief specifies; the built-in music-bed.mp3 if unstated",
    authoringSecondsPerBeat: 10,
    scoreSeconds: 0,
    renderWeight: 1,
  },
};

// ~10s/beat average across PIPELINE.md's Simple demo arc (60-75s over hook+problem+2-3
// demos+differentiator+cta, 6-8 beats) -- the same ratio for any target duration.
const SECONDS_PER_BEAT_ESTIMATE = 10;

export function runPlanProductionLogic(
  input: PlanProductionInput,
  benchmark: { fps: number | null; cpuCount: number | null; source: "benchmark" | "fallback"; bundleSeconds?: number | null },
  projectConfig: { fps: number },
): PlanProductionResult {
  const profile = LEVEL_PROFILES[input.creativeLevel];
  const targetDurationSeconds = input.targetDurationSeconds ?? 60;
  const beatCountEstimate = Math.max(3, Math.round(targetDurationSeconds / SECONDS_PER_BEAT_ESTIMATE));
  const customScenes = Math.round(beatCountEstimate * profile.customFraction);
  const templateScenes = beatCountEstimate - customScenes;

  const fps = benchmark.fps ?? FALLBACK_FPS;
  const totalFrames = targetDurationSeconds * projectConfig.fps;
  // fps is the flat benchmark composition's speed; a finished video renders at fps / renderWeight.
  const sceneFps = fps / profile.renderWeight;
  const finalRenderSeconds = totalFrames / sceneFps;
  const draftRenderSeconds = totalFrames / (sceneFps * DRAFT_SPEEDUP);
  const stillsFramesTotal = beatCountEstimate * STILL_FRAMES_PER_BEAT;
  const stillsPassSeconds = stillsFramesTotal / sceneFps;
  const bundleMeasured = typeof benchmark.bundleSeconds === "number";
  const bundleSeconds = bundleMeasured ? (benchmark.bundleSeconds as number) : FALLBACK_BUNDLE_SECONDS;
  // One bundle per review round, one for the draft pass and one for the final render.
  const bundleCount = profile.qcRounds + 2;
  const captureSeconds = beatCountEstimate * CAPTURE_SECONDS_PER_BEAT * (1 + CAPTURE_RETRY_FRACTION);
  const authoringSeconds = beatCountEstimate * profile.authoringSecondsPerBeat;

  const phases: PhaseEstimate[] = [
    {
      phase: "brief + beats",
      seconds: Math.round(beatCountEstimate * 8),
      note: `${beatCountEstimate} beats, ${input.creativeLevel} arc: ${profile.arc}`,
    },
    {
      phase: "score",
      seconds: profile.scoreSeconds,
      note: profile.scoreStrategy,
    },
    {
      phase: "scene authoring",
      seconds: Math.round(authoringSeconds),
      note: `${customScenes} custom scene${customScenes === 1 ? "" : "s"}, ${templateScenes} template scene${templateScenes === 1 ? "" : "s"} ` +
        `(engineering estimate, not yet calibrated against real telemetry for peak/mid -- see this tool's module doc comment)`,
    },
    {
      phase: "capture",
      seconds: Math.round(captureSeconds),
      note: `${beatCountEstimate} beats x ${CAPTURE_SECONDS_PER_BEAT}s, plus an allowance for ${Math.round(CAPTURE_RETRY_FRACTION * 100)}% of them to be captured twice (engineering estimate)`,
    },
    {
      phase: "review bundles",
      seconds: Math.round(bundleSeconds * bundleCount),
      note: `${bundleCount} bundles (${profile.qcRounds} review round${profile.qcRounds === 1 ? "" : "s"}, the draft pass, the final render) x ${bundleSeconds}s` +
        (bundleMeasured ? " measured by preflight's benchmark" : " (unmeasured fallback, run preflight with benchmark: true for a real number)"),
    },
    {
      phase: "stills QC",
      seconds: Math.round(stillsPassSeconds * profile.qcRounds),
      note: `${profile.qcRounds} round${profile.qcRounds === 1 ? "" : "s"} x ${stillsFramesTotal} frames at ${sceneFps.toFixed(2)}fps (${fps.toFixed(2)}fps benchmark / ${profile.renderWeight}x ${input.creativeLevel} scene weight)`,
    },
    {
      phase: "draft render",
      seconds: Math.round(draftRenderSeconds),
      note: `${totalFrames} frames at ~${(sceneFps * DRAFT_SPEEDUP).toFixed(2)}fps (draft: half-res, veryfast preset)`,
    },
    {
      phase: "final render",
      seconds: Math.round(finalRenderSeconds),
      note: `${totalFrames} frames at ${sceneFps.toFixed(2)}fps: the measured ${fps.toFixed(2)}fps benchmark divided by a ${profile.renderWeight}x ${input.creativeLevel} scene weight${benchmark.source === "fallback" ? " (unmeasured fallback, run preflight with benchmark: true for a real number)" : ""}`,
    },
  ];

  const totalEstimateSeconds = phases.reduce((sum, p) => sum + p.seconds, 0);
  const budgetSeconds = input.timeBudgetMinutes * 60;
  const fitsBudget = totalEstimateSeconds <= budgetSeconds;

  const cutFirst: string[] = [];
  let infeasibleWarning: string | undefined;
  if (!fitsBudget) {
    if (profile.qcRounds > 1) cutFirst.push(`drop to 1 QC round (saves ~${Math.round(stillsPassSeconds * (profile.qcRounds - 1))}s)`);
    if (customScenes > 0) {
      cutFirst.push(
        `template the non-hook/cta beats instead of authoring them custom (saves up to ~${Math.round(
          authoringSeconds - beatCountEstimate * LEVEL_PROFILES.literal.authoringSecondsPerBeat,
        )}s)`,
      );
    }
    if (profile.scoreSeconds > 0) cutFirst.push(`use the built-in music-bed.mp3 instead of ${profile.scoreStrategy} (saves ~${profile.scoreSeconds}s)`);
    cutFirst.push(`shorten targetDurationSeconds (currently ${targetDurationSeconds}s)`);
    cutFirst.push(`render draft-only and skip the final pass for review, then render final once approved`);

    if (finalRenderSeconds > budgetSeconds) {
      const feasibleSeconds = Math.floor((budgetSeconds * sceneFps) / projectConfig.fps);
      infeasibleWarning =
        `Even the unavoidable minimum, one final render (${Math.round(finalRenderSeconds)}s), does not fit the ` +
        `${input.timeBudgetMinutes}min budget at this machine's measured ${fps.toFixed(2)}fps. Feasible alternatives: ` +
        `a ${Math.max(10, feasibleSeconds)}s target instead of ${targetDurationSeconds}s, draft quality only, or a longer budget.`;
    }
  }

  const warnings: string[] = [];
  if (benchmark.source === "fallback") {
    warnings.push(
      `No real benchmark available -- using a conservative ${FALLBACK_FPS}fps placeholder. Run preflight with ` +
        `benchmark: true for a real measurement; every render-time number above may be off by more than ±30%.`,
    );
  }

  return {
    creativeLevel: input.creativeLevel,
    timeBudgetMinutes: input.timeBudgetMinutes,
    targetDurationSeconds,
    beatCountEstimate,
    arc: profile.arc,
    customScenes,
    templateScenes,
    scoreStrategy: profile.scoreStrategy,
    qcRounds: profile.qcRounds,
    renderPasses: ["stills QC (" + profile.qcRounds + "x)", "draft", "final"],
    phases,
    totalEstimateSeconds: Math.round(totalEstimateSeconds),
    fitsBudget,
    cutFirst,
    ...(infeasibleWarning ? { infeasibleWarning } : {}),
    measurement: benchmark,
    warnings,
  };
}

export async function runPlanProduction(input: PlanProductionInput): Promise<PlanProductionResult> {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const config = loadConfig(projectRoot);
  const preflight = await runPreflight({ projectRoot, benchmark: true });
  const benchmark: PlanProductionResult["measurement"] =
    preflight.benchmarkResult?.ok === true
      ? {
          fps: preflight.benchmarkResult.fps,
          cpuCount: preflight.benchmarkResult.cpuCount,
          source: "benchmark",
          bundleSeconds: preflight.benchmarkResult.bundleSeconds ?? null,
        }
      : { fps: null, cpuCount: null, source: "fallback" };

  const result = runPlanProductionLogic(input, benchmark, { fps: config.videoConfig.fps });
  if (!preflight.ok) {
    result.warnings.push(
      `preflight reports this machine isn't fully ready: ${preflight.blockers.join("; ")}. The estimate above assumes those get fixed first.`,
    );
  }
  return result;
}

const CREATIVE_LEVEL_SCHEMA: PrimitiveSchemaDefinition = {
  type: "string",
  title: "Creative level",
  description:
    "peak: full creative liberty, bespoke story/design/score. mid: strong defaults, templates plus the " +
    "occasional custom scene. literal: exactly what's specified, nothing added.",
  oneOf: [
    { const: "peak", title: "Peak -- full creative liberty" },
    { const: "mid", title: "Mid -- strong defaults" },
    { const: "literal", title: "Literal -- exactly as specified" },
  ],
};

const TIME_BUDGET_SCHEMA: PrimitiveSchemaDefinition = {
  type: "number",
  title: "Time budget (minutes)",
  description: "Wall-clock minutes you're willing to wait for the finished video, not a conversation deadline.",
  minimum: 1,
};

export function registerPlanProduction(server: McpServer): void {
  server.registerTool(
    "plan_production",
    {
      title: "Turn creative level + time budget into a concrete, time-estimated plan",
      description:
        "Takes the two intake questions (PLANNING.md step 0: creativeLevel and timeBudgetMinutes) and " +
        "returns a concrete production plan: the arc, how many beats, how many get a bespoke scene versus a " +
        "template, the score strategy, how many stills-QC rounds, the render passes, and a time estimate per " +
        "phase based on this machine's real measured render speed (runs preflight with benchmark: true " +
        "internally). Render-time numbers (draft pass, stills, final pass) are derived from that real " +
        "measurement; scene-authoring time is a per-level engineering estimate, not a measurement (see this " +
        "tool's module doc comment for why, and what would make it one). Reports fitsBudget and, when it's " +
        "false, cutFirst: an ordered list of what to cut, cheapest first, plus an infeasibleWarning with " +
        "concrete feasible alternatives (a shorter target duration, draft-only quality, a longer budget) when " +
        "even one final render alone would not fit. Show this plan and its estimate at the approval gate " +
        "before writing any beat. creativeLevel/timeBudgetMinutes are optional on this tool specifically: " +
        "if either is omitted and the connected client supports MCP elicitation, this tool asks for the " +
        "missing one(s) itself (a structured form, not drafted content). If the client doesn't support " +
        "elicitation and either is still missing, it fails with an explicit instruction for the calling agent " +
        "to ask the dev directly (PLANNING.md §0) and call this again with both set -- it never guesses a " +
        "level or a budget.",
      inputSchema: {
        projectRoot: z.string().optional(),
        creativeLevel: z.enum(["peak", "mid", "literal"]).optional(),
        timeBudgetMinutes: z.number().positive().optional(),
        targetDurationSeconds: z.number().positive().optional(),
      },
    },
    async (input) =>
      runTool("plan_production", async () => {
        let { creativeLevel, timeBudgetMinutes } = input;

        if (creativeLevel === undefined || timeBudgetMinutes === undefined) {
          const caps = server.server.getClientCapabilities();
          if (caps?.elicitation) {
            const properties: Record<string, PrimitiveSchemaDefinition> = {};
            if (creativeLevel === undefined) properties.creativeLevel = CREATIVE_LEVEL_SCHEMA;
            if (timeBudgetMinutes === undefined) properties.timeBudgetMinutes = TIME_BUDGET_SCHEMA;

            const elicited = await server.server.elicitInput({
              mode: "form",
              message: "Before planning this video: what creative level and time budget?",
              requestedSchema: { type: "object", properties, required: Object.keys(properties) },
            });

            if (elicited.action === "accept" && elicited.content) {
              const content = elicited.content as { creativeLevel?: CreativeLevel; timeBudgetMinutes?: number };
              creativeLevel = creativeLevel ?? content.creativeLevel;
              timeBudgetMinutes = timeBudgetMinutes ?? content.timeBudgetMinutes;
            }
          }
        }

        if (creativeLevel === undefined || timeBudgetMinutes === undefined) {
          const missing = [creativeLevel === undefined && "creativeLevel", timeBudgetMinutes === undefined && "timeBudgetMinutes"]
            .filter(Boolean)
            .join(" and ");
          throw new Error(
            `${missing} still missing. This client doesn't support MCP elicitation, or the dev declined it -- ` +
              `ask directly in conversation (PLANNING.md §0 has the two questions), then call plan_production ` +
              `again with both set. Never guess these.`,
          );
        }

        return runPlanProduction({ ...input, creativeLevel, timeBudgetMinutes });
      }),
  );
}

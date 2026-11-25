import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot } from "../util";
import { loadConfig } from "../config";
import type { CreativeLevel } from "../config";
import { runTool } from "./mcp";
import { runPlanBeats } from "./planBeats";
import type { ArcName, PlanBeatsInput, PlanBeatsResult, PlannedBeat } from "./planBeats";
import { validateBeatsLogic } from "./validateBeats";
import type { ValidateBeatsResult } from "./validateBeats";

/**
 * generate_script collapses the front half of the pipeline into one call. The server never calls
 * an LLM, so it cannot write the narration. It orchestrates around it instead:
 *
 *   no draft   plan_beats' skeleton, already shaped like a beats.json, plus the level's defaults,
 *              so the agent writes to a word budget instead of guessing.
 *   a draft    the agent's narration merged into that same skeleton and run through
 *              validateBeatsLogic, so the human is shown a beats.json that already passes.
 *
 * It writes nothing. The human-approval gate and write_beats_file are exactly what they were.
 *
 * Per-beat visual defaults come from the creative level and the arc skeleton, not from
 * plan_production: that tool returns a time estimate and has no per-beat visuals to offer.
 */

export type ScriptStage = "skeleton" | "validated";

export interface ScriptDraft {
  /** The spoken line for each beat, keyed by beat id. */
  narration: Record<string, string>;
  /** Optional per-beat visual changes, keyed by beat id, shallow-merged over that beat's default visual. */
  visuals?: Record<string, Record<string, unknown>>;
}

export interface GenerateScriptInput {
  projectRoot?: string;
  targetDurationSeconds: number;
  arc?: ArcName;
  features?: string[];
  appUrl?: string;
  fps?: number;
  creativeLevel?: CreativeLevel;
  snapToBars?: PlanBeatsInput["snapToBars"];
  draft?: ScriptDraft;
}

export interface LevelScriptDefaults {
  /** The arc planned when the caller does not name one. At literal it is also the only arc allowed. */
  arc: ArcName;
  /** Whether a draft may carry per-beat visual overrides at this level. */
  allowVisualOverrides: boolean;
  /** One sentence on what the human should check before approving a draft at this level. */
  review: string;
}

export const LEVEL_SCRIPT_DEFAULTS: Record<CreativeLevel, LevelScriptDefaults> = {
  literal: {
    arc: "literal",
    allowVisualOverrides: false,
    review:
      "Check that every beat shows a feature you named and nothing else, because this level adds no hook, problem or call to action of its own.",
  },
  mid: {
    arc: "simple",
    allowVisualOverrides: true,
    review:
      "Check the hook and the call to action, and any visual you overrode, because this level fills in strong defaults for everything else.",
  },
  peak: {
    arc: "packed",
    allowVisualOverrides: true,
    review:
      "Check that the dense hero beat states every claim once and that each demo backs one of them, because this level leaves the most open to change.",
  },
};

export interface GenerateScriptResult {
  stage: ScriptStage;
  creativeLevel: CreativeLevel;
  defaults: LevelScriptDefaults;
  /** The plan_beats plan the skeleton was built from: word budgets, purposes, snapped bars. */
  plan: PlanBeatsResult;
  /** A full beats.json draft. At the skeleton stage no beat has vo yet. */
  beatsJson: Record<string, unknown>;
  /** Present only at the validated stage. */
  validation?: ValidateBeatsResult;
  notes: string[];
  next: string;
}

function defaultVisual(beat: PlannedBeat, appUrl: string): Record<string, unknown> {
  // Fresh object and array per beat, so an override or a later edit on one beat cannot reach another.
  return beat.captureMethod === "screenshot"
    ? { captureMethod: "screenshot", url: appUrl, interactions: [] }
    : { captureMethod: beat.captureMethod };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quoted(ids: string[]): string {
  return ids.map((id) => `"${id}"`).join(", ");
}

/** Refuses a draft that cannot be merged at all. A draft that merges but fails validation is not refused here. */
function checkDraft(draft: ScriptDraft, level: CreativeLevel, beatIds: string[]): void {
  if (!isPlainObject(draft.narration)) {
    throw new Error("draft.narration is required: an object of spoken lines keyed by beat id.");
  }
  const overrides = draft.visuals;

  // At a level that allows no overrides, carrying draft.visuals at all is refused, an empty object included.
  if (!LEVEL_SCRIPT_DEFAULTS[level].allowVisualOverrides && overrides !== undefined) {
    const named = isPlainObject(overrides) ? Object.keys(overrides) : [];
    throw new Error(
      `draft.visuals ${named.length > 0 ? `names ${quoted(named)}` : "is present"}, but visual overrides are not allowed ` +
        `at the ${level} level. This level does exactly what was specified and adds nothing, so send ` +
        `draft.narration only, or raise creativeLevel to mid or peak to change a beat's visual.`,
    );
  }

  if (overrides !== undefined && !isPlainObject(overrides)) {
    throw new Error("draft.visuals must be an object keyed by beat id.");
  }
  const overrideIds = overrides ? Object.keys(overrides) : [];

  const known = new Set(beatIds);
  const unknown = [...new Set([...Object.keys(draft.narration), ...overrideIds])].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `The draft names beat ids the skeleton does not have: ${quoted(unknown)}. ` +
        `This skeleton's beat ids are ${beatIds.join(", ")}. Ids depend on the arc, the features and the ` +
        `creative level, so send the same brief inputs that produced the skeleton.`,
    );
  }

  for (const id of overrideIds) {
    if (!isPlainObject(overrides![id])) {
      throw new Error(`draft.visuals["${id}"] must be an object of visual fields to change.`);
    }
  }
}

export function runGenerateScript(input: GenerateScriptInput): GenerateScriptResult {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const config = loadConfig(projectRoot);
  const creativeLevel: CreativeLevel = input.creativeLevel ?? config.production.creativeLevel ?? "mid";
  // The input is schema-checked, but a hand-edited config file is not.
  if (!Object.keys(LEVEL_SCRIPT_DEFAULTS).includes(creativeLevel)) {
    throw new Error(
      `creativeLevel "${creativeLevel}" is not one of ${Object.keys(LEVEL_SCRIPT_DEFAULTS).join(", ")}. ` +
        `Check production.creativeLevel in openvidstudio.config.json.`,
    );
  }
  // A copy, so a caller changing the result cannot change the table every later call reads.
  const defaults: LevelScriptDefaults = { ...LEVEL_SCRIPT_DEFAULTS[creativeLevel] };
  const arc: ArcName = creativeLevel === "literal" ? "literal" : (input.arc ?? defaults.arc);
  const appUrl = input.appUrl ?? config.capture.appUrl;

  const plan = runPlanBeats({
    projectRoot,
    targetDurationSeconds: input.targetDurationSeconds,
    arc,
    features: input.features,
    appUrl,
    fps: input.fps,
    snapToBars: input.snapToBars,
  });

  const notes = [...plan.notes, defaults.review];
  if (creativeLevel === "literal" && input.arc !== undefined && input.arc !== "literal") {
    notes.push(`The arc "${input.arc}" was ignored: the literal level always plans the literal arc.`);
  }

  const draft = input.draft;
  if (draft) {
    checkDraft(draft, creativeLevel, plan.beats.map((b) => b.id));
  }

  const beats = plan.beats.map((beat) => {
    const visual = { ...defaultVisual(beat, appUrl), ...(draft?.visuals?.[beat.id] ?? {}) };
    const vo = draft?.narration[beat.id];
    return {
      id: beat.id,
      start: beat.start,
      duration: beat.duration,
      ...(vo !== undefined ? { vo } : {}),
      visual,
    };
  });
  const beatsJson: Record<string, unknown> = { fps: plan.fps, production: { creativeLevel }, beats };

  if (!draft) {
    const visualAdvice = defaults.allowVisualOverrides
      ? "Visual changes, if any, go in draft.visuals keyed by beat id."
      : `The ${creativeLevel} level allows no visual overrides, so send draft.narration only.`;
    return {
      stage: "skeleton",
      creativeLevel,
      defaults,
      plan,
      beatsJson,
      notes,
      next:
        `Write one spoken line per beat in plan.beats, aiming for each beat's wordBudget.suggested words ` +
        `(wordBudget.min to wordBudget.max is what validate_beats accepts). Then call generate_script again ` +
        `with the same brief inputs plus draft: { narration: { "<beatId>": "<line>" } }. ${visualAdvice} ` +
        `Nothing has been written to disk.`,
    };
  }

  const validation = validateBeatsLogic(beatsJson);
  const next = validation.valid
    ? `beatsJson passes validate_beats. Show the full beatsJson to the human and wait for explicit approval, ` +
      `then call write_beats_file with it. Do not call write_beats_file before they approve. ` +
      `Nothing has been written to disk.`
    : `beatsJson does not pass validate_beats yet: fix the ${validation.errors.length} error(s) in validation.errors ` +
      `(a beat with no narration line is listed there too), then call generate_script again with the same brief ` +
      `inputs and the corrected draft. Do not call write_beats_file until validation.valid is true and the ` +
      `human has approved. Nothing has been written to disk.`;
  return { stage: "validated", creativeLevel, defaults, plan, beatsJson, validation, notes, next };
}

export function registerGenerateScript(server: McpServer): void {
  server.registerTool(
    "generate_script",
    {
      title: "Draft a script in one call: a skeleton with word budgets, then a validated beats.json",
      description:
        "Collapses brief, plan_beats, merge and validate_beats into one call. It orchestrates and never " +
        "writes narration, because this server does not call an LLM: you write the spoken lines and this tool " +
        "does everything around them. The stage depends on whether you pass draft. " +
        "(1) No draft: returns stage \"skeleton\", which is the plan_beats plan for the brief (beat ids, frame " +
        "timing, capture method, purpose and a narration word budget per beat), plus beatsJson, a beats.json " +
        "with every beat's start, duration and visual filled in and no vo yet, plus the creative level's defaults. " +
        "Write each beat's narration to its wordBudget.suggested. " +
        "(2) With draft { narration: { <beatId>: text }, visuals?: { <beatId>: { ...fields } } }: merges your " +
        "narration into that same skeleton, shallow-merges any visuals over the beat's default visual, runs " +
        "validate_beats' own checks, and returns stage \"validated\" with the full beatsJson and validation " +
        "{ valid, errors, warnings }, ready to show the human. " +
        "The call is stateless, so send the same brief inputs both times; beat ids depend on them. A draft " +
        "naming a beat id the skeleton lacks throws and names every unknown id. A beat with no narration line " +
        "is not an exception: it returns valid: false with the validator's own error for that beat. " +
        "Per-beat visual defaults come from the creative level and the arc skeleton, not from plan_production, " +
        "which returns a time estimate with no per-beat visuals. A screenshot beat gets { captureMethod: " +
        "\"screenshot\", url: appUrl or capture.appUrl, interactions: [] }, which is what validate_beats requires; " +
        "any other beat gets { captureMethod }. " +
        "Level defaults, taken from the creativeLevel input, else production.creativeLevel in " +
        "openvidstudio.config.json, else mid: literal plans the literal arc (one screenshot demo beat per " +
        "feature, features required) and rejects draft.visuals; mid plans the simple arc and allows visual " +
        "overrides; peak plans the packed arc and allows visual overrides. An explicit arc overrides the " +
        "level's arc except at literal, which always plans the literal arc. snapToBars works as in plan_beats. " +
        "This tool never writes anything to disk, beats.json included. The human-approval gate is unchanged: " +
        "show the human the full beatsJson, and call write_beats_file only after they approve.",
      inputSchema: {
        projectRoot: z.string().optional(),
        targetDurationSeconds: z.number().positive(),
        arc: z
          .enum(["simple", "packed", "tutorial", "literal"])
          .optional()
          .describe("Overrides the creative level's arc. Ignored at the literal level, which always plans the literal arc."),
        features: z
          .array(z.string())
          .optional()
          .describe("One demo beat is planned per feature. Required at the literal level."),
        appUrl: z.string().optional().describe("Defaults to capture.appUrl in openvidstudio.config.json."),
        fps: z.number().positive().optional(),
        creativeLevel: z
          .enum(["peak", "mid", "literal"])
          .optional()
          .describe("Defaults to production.creativeLevel in openvidstudio.config.json, else mid."),
        snapToBars: z
          .object({ bpm: z.number().positive(), beatsPerBar: z.number().int().min(1).optional() })
          .optional()
          .describe("As in plan_beats: land every beat boundary on a downbeat of the score at this bpm."),
        draft: z
          .object({
            narration: z
              .record(z.string(), z.string())
              .describe("The spoken line for each beat, keyed by beat id. Omit a beat and it is reported as missing its vo."),
            visuals: z
              .record(z.string(), z.record(z.string(), z.unknown()))
              .optional()
              .describe(
                "Per-beat visual changes keyed by beat id, shallow-merged over that beat's default visual. " +
                  "Not allowed at the literal level.",
              ),
          })
          .optional()
          .describe("Your narration. Omit it to get the skeleton and word budgets first."),
      },
    },
    async (input) => runTool("generate_script", () => runGenerateScript(input)),
  );
}

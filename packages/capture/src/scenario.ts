import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import * as yaml from "js-yaml";
import type { Interaction } from "./browser";

/**
 * A capture scenario: the click path to a beat's state as a file, instead of an `interactions`
 * array pasted into a tool call or a beats.json.
 *
 *   # scenarios/checkout.yaml
 *   url: http://localhost:3000
 *   steps:
 *     - action: click
 *       selector: "#buy"
 *       settleMs: 1500        # optional: let this step finish before the next one
 *     - action: type
 *       selector: "#email"
 *       text: a@b.co
 *     - action: scroll
 *       y: 800
 *       durationMs: 600
 *
 * JSON and YAML read the same. The scenario compiles to the `interactions` array every capture
 * tool already runs (compileScenario), so nothing downstream learned a second format, and an
 * existing array converts the other way (scenarioFromInteractions) so a beat that works today
 * keeps working when it moves to a file.
 */

const selector = z.string().min(1);
/** Optional on any step: how long to let the page settle after the step, in ms. Compiles to a settle step. */
const settleMs = z.number().positive().optional();

export const scenarioStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), url: z.string().min(1), settleMs }),
  z.object({ action: z.literal("click"), selector, settleMs }),
  z.object({ action: z.literal("hover"), selector, settleMs }),
  z.object({ action: z.literal("type"), selector, text: z.string(), settleMs }),
  z.object({ action: z.literal("select"), selector, value: z.string(), settleMs }),
  z.object({
    action: z.literal("scroll"),
    selector: selector.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    durationMs: z.number().positive().optional(),
    settleMs,
  }),
  z.object({ action: z.literal("wait"), ms: z.number().nonnegative().optional(), selector: selector.optional(), settleMs }),
  // Drive whatever the previous step started to completion, as its own step. settleMs on a step is the
  // shorthand for this directly after it.
  z.object({ action: z.literal("settle"), ms: z.number().positive().optional() }),
]);

export type ScenarioStep = z.infer<typeof scenarioStepSchema>;

export const scenarioSchema = z.object({
  /** Free text, for the person reading the file. */
  name: z.string().optional(),
  /** Where the capture starts. Optional when the tool call gives a url. */
  url: z.string().min(1).optional(),
  steps: z.array(scenarioStepSchema),
});

export type Scenario = z.infer<typeof scenarioSchema>;

export type ScenarioFormat = "json" | "yaml";

function formatOf(text: string, filePath?: string): ScenarioFormat {
  const ext = filePath ? path.extname(filePath).toLowerCase() : "";
  if (ext === ".json") return "json";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  return text.trimStart().startsWith("{") ? "json" : "yaml";
}

/** Parses scenario text, naming the step and field of any mistake. `filePath` only picks the format and names the file in errors. */
export function parseScenario(text: string, filePath?: string): Scenario {
  const label = filePath ?? "scenario";
  const format = formatOf(text, filePath);
  let raw: unknown;
  try {
    raw = format === "json" ? JSON.parse(text) : yaml.load(text);
  } catch (err) {
    throw new Error(`${label} is not valid ${format.toUpperCase()}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
    throw new Error(`${label} is not a valid scenario:\n  ${issues.join("\n  ")}`);
  }
  return parsed.data;
}

export function loadScenarioFile(file: string): Scenario {
  return parseScenario(fs.readFileSync(file, "utf8"), file);
}

/** One step as the interaction every capture tool runs. A step's settleMs follows as its own settle step. */
function compileStep(step: ScenarioStep): Interaction[] {
  const out: Interaction[] = [];
  switch (step.action) {
    case "navigate":
      out.push({ type: "navigate", url: step.url });
      break;
    case "click":
      out.push({ type: "click", selector: step.selector });
      break;
    case "hover":
      out.push({ type: "hover", selector: step.selector });
      break;
    case "type":
      out.push({ type: "fill", selector: step.selector, value: step.text });
      break;
    case "select":
      out.push({ type: "select", selector: step.selector, value: step.value });
      break;
    case "scroll":
      out.push({
        type: "scroll",
        ...(step.selector !== undefined ? { selector: step.selector } : {}),
        ...(step.x !== undefined ? { x: step.x } : {}),
        ...(step.y !== undefined ? { y: step.y } : {}),
        ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
      });
      break;
    case "wait":
      out.push({
        type: "wait",
        ...(step.ms !== undefined ? { ms: step.ms } : {}),
        ...(step.selector !== undefined ? { selector: step.selector } : {}),
      });
      break;
    case "settle":
      out.push({ type: "settle", ...(step.ms !== undefined ? { ms: step.ms } : {}) });
      return out;
  }
  if (step.settleMs !== undefined) out.push({ type: "settle", ms: step.settleMs });
  return out;
}

export interface CompiledScenario {
  url?: string;
  interactions: Interaction[];
}

/** The interactions array (and starting url) a scenario stands for. */
export function compileScenario(scenario: Scenario): CompiledScenario {
  return {
    ...(scenario.url !== undefined ? { url: scenario.url } : {}),
    interactions: scenario.steps.flatMap(compileStep),
  };
}

/**
 * The reverse, for moving an existing beat to a file: every interaction becomes a step, and a settle
 * that directly follows a step folds into that step's settleMs. compileScenario(scenarioFromInteractions(x))
 * gives x back for every array this package can run.
 */
export function scenarioFromInteractions(interactions: Interaction[], url?: string): Scenario {
  const steps: ScenarioStep[] = [];
  for (const i of interactions) {
    const last = steps[steps.length - 1];
    switch (i.type) {
      case "navigate":
        steps.push({ action: "navigate", url: i.url });
        break;
      case "click":
        steps.push({ action: "click", selector: i.selector });
        break;
      case "hover":
        steps.push({ action: "hover", selector: i.selector });
        break;
      case "fill":
        steps.push({ action: "type", selector: i.selector, text: i.value });
        break;
      case "select":
        steps.push({ action: "select", selector: i.selector, value: i.value });
        break;
      case "scroll":
        steps.push({
          action: "scroll",
          ...(i.selector !== undefined ? { selector: i.selector } : {}),
          ...(i.x !== undefined ? { x: i.x } : {}),
          ...(i.y !== undefined ? { y: i.y } : {}),
          ...(i.durationMs !== undefined ? { durationMs: i.durationMs } : {}),
        });
        break;
      case "wait":
        steps.push({
          action: "wait",
          ...(i.ms !== undefined ? { ms: i.ms } : {}),
          ...(i.selector !== undefined ? { selector: i.selector } : {}),
        });
        break;
      case "settle":
        // A settle with a budget right after a step is that step's settleMs; any other is its own step.
        if (last && last.action !== "settle" && last.settleMs === undefined && i.ms !== undefined && i.ms > 0) last.settleMs = i.ms;
        else steps.push({ action: "settle", ...(i.ms !== undefined ? { ms: i.ms } : {}) });
        break;
    }
  }
  return { ...(url !== undefined ? { url } : {}), steps };
}

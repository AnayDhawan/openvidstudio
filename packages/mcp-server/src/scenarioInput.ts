import * as fs from "node:fs";
import * as path from "node:path";
import { compileScenario, loadScenarioFile, type Interaction } from "@openvidstudio/capture";
import { resolveProjectRoot, sanitizeRelativeOutPath } from "./util";

/**
 * What the capture tools take from a scenario file: `scenarioPath` stands in for `interactions` (and
 * optionally for `url`), compiled to the same interactions array the tools always ran. Everything after
 * this point sees a plain url and interactions, so a scenario-driven capture and a hand-written one are
 * the same capture.
 */
export interface ScenarioInput {
  projectRoot?: string;
  /** A scenario file (JSON or YAML) relative to the project root. See CAPTURE.md, "Scenario files". */
  scenarioPath?: string;
  url?: string;
  interactions?: Interaction[];
}

export function applyScenario<T extends ScenarioInput>(input: T): Omit<T, "url" | "scenarioPath"> & { url: string } {
  const { scenarioPath, ...rest } = input;
  if (scenarioPath === undefined) {
    if (!input.url) throw new Error("url is required, or pass scenarioPath for a scenario file that sets one.");
    return { ...rest, url: input.url } as Omit<T, "url" | "scenarioPath"> & { url: string };
  }
  if (input.interactions !== undefined) {
    throw new Error("Pass either scenarioPath or interactions, not both: the scenario compiles to the interactions.");
  }
  const projectRoot = resolveProjectRoot(input.projectRoot);
  sanitizeRelativeOutPath(projectRoot, scenarioPath, "scenarioPath");
  const file = path.join(projectRoot, scenarioPath);
  if (!fs.existsSync(file)) throw new Error(`No scenario file at ${file}.`);
  const compiled = compileScenario(loadScenarioFile(file));
  const url = input.url ?? compiled.url;
  if (!url) throw new Error(`${scenarioPath} sets no url and the call gave none. Add a url to the scenario or pass one.`);
  return { ...rest, url, interactions: compiled.interactions } as Omit<T, "url" | "scenarioPath"> & { url: string };
}

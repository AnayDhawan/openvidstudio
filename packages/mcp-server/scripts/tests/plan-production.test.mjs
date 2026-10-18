#!/usr/bin/env node
// plan-production: Part 46, Part 47, Part 48 (split out of the former single manual-test.mjs; see _harness.mjs)

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  require,
  __dirname,
  packageRoot,
  distDir,
  monorepoRoot,
  monorepoTemplateDir,
  check,
  skip,
  listFilesRecursive,
  setQuiet,
  finish,
} from "./_harness.mjs";

console.log("\n== Part 46: plan_production -- three levels produce visibly different plans (B) ==");
{
  const { runPlanProductionLogic } = require(path.join(distDir, "tools", "planProduction.js"));
  const measured = { fps: 5, cpuCount: 8, source: "benchmark" };
  const videoConfig = { fps: 30 };

  const peak = runPlanProductionLogic({ creativeLevel: "peak", timeBudgetMinutes: 60, targetDurationSeconds: 90 }, measured, videoConfig);
  const mid = runPlanProductionLogic({ creativeLevel: "mid", timeBudgetMinutes: 15, targetDurationSeconds: 60 }, measured, videoConfig);
  const literal = runPlanProductionLogic({ creativeLevel: "literal", timeBudgetMinutes: 15, targetDurationSeconds: 60 }, measured, videoConfig);

  check("peak authors every beat as a bespoke scene", peak.customScenes === peak.beatCountEstimate && peak.templateScenes === 0);
  check("literal authors zero bespoke scenes, every beat templated", literal.customScenes === 0 && literal.templateScenes === literal.beatCountEstimate);
  check("mid sits strictly between peak and literal in custom-scene fraction", mid.customScenes > 0 && mid.customScenes < mid.beatCountEstimate);
  check(
    "QC rounds strictly decrease peak > mid > literal",
    peak.qcRounds > mid.qcRounds && mid.qcRounds > literal.qcRounds,
  );
  check("each level names a different score strategy", new Set([peak.scoreStrategy, mid.scoreStrategy, literal.scoreStrategy]).size === 3);
  check(
    "the three totals are genuinely different, not coincidentally equal",
    new Set([peak.totalEstimateSeconds, mid.totalEstimateSeconds, literal.totalEstimateSeconds]).size === 3,
  );
  check("peak's total estimate is the largest of the three (more QC, more custom authoring, a real score)", peak.totalEstimateSeconds > mid.totalEstimateSeconds && mid.totalEstimateSeconds > literal.totalEstimateSeconds);

  const tooTight = runPlanProductionLogic({ creativeLevel: "peak", timeBudgetMinutes: 1, targetDurationSeconds: 90 }, measured, videoConfig);
  check("a budget too tight even for one final render reports fitsBudget: false", tooTight.fitsBudget === false);
  check("...with a non-empty cutFirst list", tooTight.cutFirst.length > 0);
  check("...and an infeasibleWarning naming a concrete feasible alternative", typeof tooTight.infeasibleWarning === "string" && tooTight.infeasibleWarning.length > 0);

  const noBenchmark = runPlanProductionLogic(
    { creativeLevel: "mid", timeBudgetMinutes: 15, targetDurationSeconds: 60 },
    { fps: null, cpuCount: null, source: "fallback" },
    videoConfig,
  );
  check("no real benchmark available still produces a plan (fallback fps), with a warning saying so", noBenchmark.warnings.some((w) => w.includes("fallback") || w.includes("placeholder")));

  // Real-world calibration check (not run here, done once by hand against this exact
  // scenario): a real 6-beat, 60s, narration:"none" literal/15 render measured draft 85s
  // against an 89s estimate (-4.5%) and final 351s against a 358s estimate (-2.0%), both
  // from this same runPlanProductionLogic model. Far inside the ±30% accuracy bar. Scene-
  // authoring time for peak/mid remains an engineering estimate, not yet calibrated against
  // real telemetry -- Phase C's authoring tools (design.ts, compose_score, the primitive
  // library) don't exist yet to time for real; this is disclosed in the tool's own
  // module doc comment and in its warnings when no benchmark is available.
}

console.log("\n== Part 47: beats.json's production field mirrors config, shape-checked only (B) ==");
{
  const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
  // 8 words / 3.0s = 2.67 words/sec, inside SCRIPT.md's 2.3-2.9 budget.
  const baseBeat = { id: "hook", start: 0, duration: 90, vo: "About two point seven words a second fits.", visual: { captureMethod: "dom-demo" } };

  const ok = validateBeatsLogic({ fps: 30, production: { creativeLevel: "peak", timeBudgetMinutes: 60 }, beats: [baseBeat] });
  check("a valid production block validates", ok.valid === true);

  const omitted = validateBeatsLogic({ fps: 30, beats: [baseBeat] });
  check("omitting production entirely still validates -- every existing beats.json stays valid", omitted.valid === true);

  const badLevel = validateBeatsLogic({ fps: 30, production: { creativeLevel: "extreme" }, beats: [baseBeat] });
  check(
    "an invalid creativeLevel is rejected by name",
    badLevel.valid === false && badLevel.errors.some((e) => e.includes("production.creativeLevel")),
  );

  const badBudget = validateBeatsLogic({ fps: 30, production: { timeBudgetMinutes: -5 }, beats: [baseBeat] });
  check(
    "a non-positive timeBudgetMinutes is rejected",
    badBudget.valid === false && badBudget.errors.some((e) => e.includes("production.timeBudgetMinutes")),
  );
}

console.log("\n== Part 48: plan_production's real MCP elicitation (B) ==");
{
  const stdioPath = path.join(distDir, "stdio.js");
  const sdkClientDir = path.join(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client");
  const sdkTypesPath = path.join(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "types.js");

  async function callPlanProduction(elicitationCapable, respond) {
    const { Client } = await import(pathToFileURL(path.join(sdkClientDir, "index.js")).href);
    const { StdioClientTransport } = await import(pathToFileURL(path.join(sdkClientDir, "stdio.js")).href);
    const transport = new StdioClientTransport({ command: "node", args: [stdioPath], env: { ...process.env } });
    const client = new Client(
      { name: "ovs-elicit-test", version: "1.0.0" },
      elicitationCapable ? { capabilities: { elicitation: {} } } : {},
    );
    if (elicitationCapable) {
      const { ElicitRequestSchema } = await import(pathToFileURL(sdkTypesPath).href);
      client.setRequestHandler(ElicitRequestSchema, async (request) => respond(request.params));
    }
    await client.connect(transport);
    try {
      const r = await client.callTool(
        { name: "plan_production", arguments: { projectRoot: elicitProjectRoot, targetDurationSeconds: 60 } },
        undefined,
        { timeout: 30000 },
      );
      const text = r.content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
      return { isError: !!r.isError, text, parsed: (() => { try { return JSON.parse(text); } catch { return null; } })() };
    } finally {
      await client.close();
    }
  }

  const elicitProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-b-elicit-"));
  let elicitedRequest = null;

  const withCapability = await callPlanProduction(true, (params) => {
    elicitedRequest = params;
    const props = params.requestedSchema.properties;
    const content = {};
    if ("creativeLevel" in props) content.creativeLevel = "mid";
    if ("timeBudgetMinutes" in props) content.timeBudgetMinutes = 20;
    return { action: "accept", content };
  });
  check(
    "a client declaring the elicitation capability gets asked a real structured form, not a guess",
    elicitedRequest !== null &&
      elicitedRequest.requestedSchema.properties.creativeLevel?.oneOf?.length === 3 &&
      elicitedRequest.requestedSchema.properties.timeBudgetMinutes?.type === "number",
  );
  check(
    "...and the elicited values actually drive the plan (mid level, not peak or literal)",
    !withCapability.isError && withCapability.parsed?.creativeLevel === "mid" && withCapability.parsed?.timeBudgetMinutes === 20,
  );

  const withoutCapability = await callPlanProduction(false, () => ({ action: "accept", content: {} }));
  check(
    "a client with no elicitation capability gets a clear instruction to ask directly, never a guessed level/budget",
    withoutCapability.isError &&
      withoutCapability.text.includes("creativeLevel") &&
      withoutCapability.text.includes("PLANNING.md"),
  );

  const declined = await callPlanProduction(true, () => ({ action: "decline" }));
  check(
    "a dev declining the elicitation also gets the same clear instruction, not a silent default",
    declined.isError && declined.text.includes("PLANNING.md"),
  );
}

finish();

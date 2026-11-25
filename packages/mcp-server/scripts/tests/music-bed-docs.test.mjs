#!/usr/bin/env node
// The built-in music bed (#183). The scaffold ships it at public/sfx/music-bed.mp3, but
// stitch_composition only picks up public/audio/music-bed.mp3 and says nothing when that file is
// absent (musicBedFound: false, no warning). The mid level's default plan promises "the built-in
// ambient music-bed.mp3", so a first-time user got a silent video. The docs now say where the
// file is and the one copy that wires it in. Reads packages/docs and the template, never the
// gitignored packages/mcp-server/docs copy.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, monorepoRoot, monorepoTemplateDir, check, finish } from "./_harness.mjs";

const { createMcpServer } = require(path.join(distDir, "server.js"));
const { runPlanProductionLogic } = require(path.join(distDir, "tools", "planProduction.js"));

const doc = (name) => fs.readFileSync(path.join(monorepoRoot, "packages", "docs", name), "utf8").replace(/\r\n/g, "\n").replace(/\s+/g, " ");

console.log("\n== where the built-in bed ships ==");
check("the template ships the bed at public/sfx/music-bed.mp3", fs.existsSync(path.join(monorepoTemplateDir, "public", "sfx", "music-bed.mp3")));
check("the template does not ship one at public/audio/music-bed.mp3", !fs.existsSync(path.join(monorepoTemplateDir, "public", "audio", "music-bed.mp3")));

console.log("\n== the docs say how to wire it in ==");
{
  const planning = doc("PLANNING.md");
  check("PLANNING.md, at the mid level, says the built-in bed ships in public/sfx", /built-in ambient `music-bed\.mp3`[^.]*public\/sfx\/music-bed\.mp3/.test(planning));
  check("PLANNING.md says to copy it to public/audio/music-bed.mp3", /copy it to `public\/audio\/music-bed\.mp3`/.test(planning));
  check("PLANNING.md says to create public/audio if it does not exist", /creating `public\/audio` if it does not exist/.test(planning));
  const narration = doc("NARRATION.md");
  check("NARRATION.md says to create public/audio if it does not exist", /creating `public\/audio` if it does not exist/.test(narration));
  check("NARRATION.md says stitch_composition only looks in public/audio", /stitch_composition[^.]*public\/audio\/music-bed\.mp3/.test(narration) && /public\/sfx\/music-bed\.mp3/.test(narration));
  check("NARRATION.md says a missing bed gives musicBedFound false with no warning", /musicBedFound: false/.test(narration));
  const pipeline = doc("PIPELINE.md");
  check("the PIPELINE.md asset table row names the built-in copy", /\| Music bed \| `public\/audio\/music-bed\.mp3` \|[^|]*public\/sfx\/music-bed\.mp3/.test(pipeline));
}


console.log("\n== the tool and plan text a first-time MCP user reads first ==");
{
  const flat = (t) => t.replace(/\s+/g, " ");
  const stitch = flat(createMcpServer()._registeredTools.stitch_composition.description);
  check("stitch_composition says the scaffold ships the bed at public/sfx/music-bed.mp3", /ships[^.]*public\/sfx\/music-bed\.mp3/.test(stitch));
  check("stitch_composition says it only picks the bed up from public/audio/music-bed.mp3, so copy it there", /only[^.]*public\/audio\/music-bed\.mp3/.test(stitch) && /copy/i.test(stitch));
  check("stitch_composition says to create public/audio first", /create public\/audio/.test(stitch));
  const measured = { fps: 5, cpuCount: 8, source: "benchmark" };
  for (const level of ["mid", "literal"]) {
    const plan = runPlanProductionLogic({ creativeLevel: level, timeBudgetMinutes: 15, targetDurationSeconds: 60 }, measured, { fps: 30 });
    check(`plan_production at ${level} says where the built-in bed is and where stitch_composition reads it`, /public\/sfx\/music-bed\.mp3/.test(plan.scoreStrategy) && /public\/audio\/music-bed\.mp3/.test(plan.scoreStrategy));
  }
}

finish();

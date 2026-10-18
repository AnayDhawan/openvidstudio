#!/usr/bin/env node
// validate-beats: Part 8, Part 12 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 8: PLANNING.md's own worked example passes validate_beats (I4 regression pin) ==");

const planningMdPath = path.join(monorepoRoot, "packages", "docs", "PLANNING.md");
// Normalize CRLF -> LF first: a Windows checkout with core.autocrlf=true reads this file
// back as CRLF regardless of what's committed, and the fence regex is LF-literal.
const planningMd = fs.readFileSync(planningMdPath, "utf8").replace(/\r\n/g, "\n");
// Anchor on the worked-example section rather than "first json fence in the file":
// a fenced example added to any earlier section used to silently steal this pin, which
// is exactly what happened when the capture-sources section was written.
const workedExampleSection = planningMd.slice(planningMd.search(/^## \d+\. Worked example/m));
const jsonFenceMatch = workedExampleSection.match(/```json\n([\s\S]*?)\n```/);
check("PLANNING.md has a fenced ```json worked example", jsonFenceMatch !== null);

if (jsonFenceMatch) {
  const workedExampleBeats = JSON.parse(jsonFenceMatch[1]);
  const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
  const workedExampleResult = validateBeatsLogic(workedExampleBeats);
  check(
    `PLANNING.md's worked example passes validate_beats (errors: ${JSON.stringify(workedExampleResult.errors)})`,
    workedExampleResult.valid === true,
  );
}

console.log("\n== Part 12: validate_beats understands non-browser sources ==");

{
  const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
  // 5 words over 2.00s is 2.5 words/sec, inside SCRIPT.md's 2.3-2.9 budget, so these
  // fixtures exercise the source rules rather than tripping the pacing check.
  const beat = (visual, extra = {}) => ({
    fps: 30, title: "T",
    beats: [{ id: "b", start: 0, duration: 60, vo: "a short narration line here", visual, ...extra }],
  });

  check(
    "a browser beat with no source field still validates (backward compatible)",
    validateBeatsLogic(beat({ captureMethod: "recording", url: "https://x.example", interactions: [] })).valid,
  );
  check(
    "a desktop beat validates with durationSeconds",
    validateBeatsLogic(beat({ captureMethod: "recording", source: "desktop", window: "App", durationSeconds: 8 })).valid,
  );
  check(
    "a desktop beat without durationSeconds is rejected",
    !validateBeatsLogic(beat({ captureMethod: "recording", source: "desktop", window: "App" })).valid,
  );
  check(
    "a terminal beat validates with a bare command",
    validateBeatsLogic(beat({ captureMethod: "recording", source: "terminal", command: "hermes", args: ["--help"] })).valid,
  );
  const shellish = validateBeatsLogic(beat({ captureMethod: "recording", source: "terminal", command: "npm run build" }));
  check("a terminal command containing a full command line is rejected", !shellish.valid);
  check("...and the error explains that args belong in visual.args", shellish.errors.join(" ").includes("visual.args"));
  const longAndroid = validateBeatsLogic(
    beat({ captureMethod: "recording", source: "mobile", device: "android", durationSeconds: 240 }),
  );
  check("an Android beat over the 180s screenrecord limit is rejected", !longAndroid.valid);
  check("...and the error names the silent-truncation reason", longAndroid.errors.join(" ").includes("truncates silently"));
  check(
    "a non-browser source on a screenshot beat is rejected",
    !validateBeatsLogic(beat({ captureMethod: "screenshot", source: "desktop", durationSeconds: 5 })).valid,
  );
  check(
    "an unknown source is rejected",
    !validateBeatsLogic(beat({ captureMethod: "recording", source: "hologram", durationSeconds: 5 })).valid,
  );
  check(
    "an existing-asset beat validates with a path and attribution",
    validateBeatsLogic(beat({ captureMethod: "existing-asset", assetPath: "public/images/x.png", attribution: "the project's own README" })).valid,
  );
  const unattributed = validateBeatsLogic(beat({ captureMethod: "existing-asset", assetPath: "public/images/x.png" }));
  check("an existing-asset beat WITHOUT attribution is rejected", !unattributed.valid);
  check("...and the error says why an unattributed borrowed frame is a problem", unattributed.errors.join(" ").includes("attribution"));
}

finish();

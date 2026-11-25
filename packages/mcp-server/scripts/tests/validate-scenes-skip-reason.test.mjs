#!/usr/bin/env node
// validate_scenes render mode and render_stills (#183): a beat that plays a recording through
// OffthreadVideo cannot be mounted by the render checks, and the skip used to say only
// "Timed out after 12000ms waiting for window.remotion_renderReady", which names no cause a
// first-time user could act on. The reason now says what the beat is and what to do instead.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, monorepoRoot, check, finish } from "./_harness.mjs";

const { explainSkippedBeat } = require(path.join(distDir, "tools", "validateScenesRender.js"));

const timeout = "Timed out after 12000ms waiting for window.remotion_renderReady.";
const recordingScene = `import { OffthreadVideo, staticFile } from "remotion";
export const DemoLiveMap = () => <OffthreadVideo src={staticFile("video/demo-live-map.mp4")} />;`;
const stillScene = `import { staticFile } from "remotion";
import { DirectedShot } from "@openvidstudio/core";
export const Hook = () => <DirectedShot src={staticFile("images/hook.png")} />;`;

console.log("\n== the skip reason names the recording ==");
{
  check("explainSkippedBeat is exported", typeof explainSkippedBeat === "function");
  const reason = explainSkippedBeat(timeout, recordingScene);
  check("a render timeout on an OffthreadVideo scene keeps the original reason", reason.startsWith(timeout));
  check("...and says the beat plays a recording through OffthreadVideo", /recording/.test(reason) && /OffthreadVideo/.test(reason));
  check("...and says what to do instead", /render_video/.test(reason) && /draft/.test(reason));
  check("...and says the beat was not measured", /not measured|did not run/i.test(reason));
  check("the added text has no em or en dash", ![0x2013, 0x2014].some((cp) => reason.includes(String.fromCodePoint(cp))));
}

console.log("\n== other skips are left alone ==");
{
  check("a render timeout on a screenshot scene is unchanged", explainSkippedBeat(timeout, stillScene) === timeout);
  check("a render timeout with no readable scene source is unchanged", explainSkippedBeat(timeout, null) === timeout);
  const other = "Page crashed.";
  check("a different failure on a recording scene is unchanged", explainSkippedBeat(other, recordingScene) === other);
}

console.log("\n== PIPELINE.md says recording beats are skipped by the render checks ==");
{
  const doc = fs.readFileSync(path.join(monorepoRoot, "packages", "docs", "PIPELINE.md"), "utf8").replace(/\s+/g, " ");
  check("the review loop section names the recording case", /recording[^.]*render-skipped|render-skipped[^.]*recording/i.test(doc));
}

finish();

#!/usr/bin/env node
// validate_scenes render mode and render_stills (#183): a beat that plays a recording through
// OffthreadVideo cannot be mounted by the render checks, and the skip used to say only
// "Timed out after 12000ms waiting for window.remotion_renderReady", which names no cause a
// first-time user could act on. The reason now says what the beat is and what to do instead.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, monorepoRoot, check, finish } from "./_harness.mjs";

const { explainSkippedBeat, clipRelPathFor } = require(path.join(distDir, "tools", "validateScenesRender.js"));

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

console.log("\n== a missing clip file is named, not blamed on OffthreadVideo ==");
{
  const missing = explainSkippedBeat(timeout, recordingScene, { relPath: "public/video/demo-live-map.mp4", exists: false });
  check("a timeout on a recording scene whose file is missing keeps the original reason", missing.startsWith(timeout));
  check("...names the expected path relative to the project", missing.includes("public/video/demo-live-map.mp4"));
  check("...says the file is missing", /missing/.test(missing));
  check("...says the path is where the scene expects the clip, not that it is certain", /expected at public\/video\/demo-live-map\.mp4/.test(missing));
  check("...advice fits a recording and an imported clip alike: re-capture or re-import", /re-capture or re-import/i.test(missing));
  check("...does not blame OffthreadVideo", !/OffthreadVideo/.test(missing));
  check("...has no absolute path", !/[A-Za-z]:[\\/]/.test(missing));
  const present = explainSkippedBeat(timeout, recordingScene, { relPath: "public/video/demo-live-map.mp4", exists: true });
  check("the same scene with the file present keeps the recording explanation", /recording/.test(present) && /OffthreadVideo/.test(present) && !/missing/.test(present));
}

console.log("\n== any clip scene, and plain <Video> ==");
{
  const clipScene = `import { OffthreadVideo, staticFile } from "remotion";
export const Broll = () => <OffthreadVideo src={staticFile("video/broll.mp4")} />;`;
  const r = explainSkippedBeat(timeout, clipScene, { relPath: "public/video/broll.mp4", exists: true });
  check("a Higgsfield-style clip scene is described as a video clip", /video clip/.test(r) && /OffthreadVideo/.test(r));
  check("the recording scene text also says video clip", /video clip/.test(explainSkippedBeat(timeout, recordingScene)));
  const plainVideo = `import { Video, staticFile } from "remotion";
export const Plain = () => <Video src={staticFile("video/plain.mp4")} />;`;
  check("a scene with plain <Video> is not blamed on OffthreadVideo (nothing in the source shows it fails the same way)", explainSkippedBeat(timeout, plainVideo) === timeout);
  check("clipRelPathFor reads the staticFile path of the OffthreadVideo", clipRelPathFor(clipScene, "broll") === "public/video/broll.mp4");
  check("clipRelPathFor falls back to public/video/<beatId>.mp4", clipRelPathFor("<OffthreadVideo src={someVar} />", "demo-live-map") === "public/video/demo-live-map.mp4");
}

console.log("\n== PIPELINE.md says recording beats are skipped by the render checks ==");
{
  const doc = fs.readFileSync(path.join(monorepoRoot, "packages", "docs", "PIPELINE.md"), "utf8").replace(/\s+/g, " ");
  check("the review loop section names the recording case", /recording[^.]*render-skipped|render-skipped[^.]*recording/i.test(doc));
  check("the review loop section says a video clip, a screen recording or an imported clip, like the code", /video clip \(a screen recording or an imported clip\)/.test(doc));
}

finish();

#!/usr/bin/env node
/**
 * Renders this project's video and diffs it against the last accepted render.
 *
 * Meant for CI, but it is an ordinary script: run it locally with `node
 * scripts/visual-regression.mjs <videoName>` and it does the same thing.
 *
 * Draft mode by default. A full-quality render on every merge is minutes of CI time for a
 * check whose job is to notice that a panel changed colour, and draft is half resolution,
 * which the comparison downscales anyway. Incremental is on for the same reason: after the
 * first run, only the beats that actually changed are re-rendered.
 *
 * The baseline lives in .openvidstudio/visual-baseline/<videoName>/ and is meant to be
 * committed. That is the whole mechanism: the diff is against what the repository last
 * agreed the product looked like, and accepting a change is a commit like any other.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { runRenderVideo, runVisualRegression } from "@openvidstudio/mcp-server";

const videoName = process.argv[2];
if (!videoName) {
  console.error("usage: node scripts/visual-regression.mjs <videoName>");
  process.exit(2);
}

const projectRoot = process.cwd();
const accept = process.argv.includes("--accept");
const outPath = path.join("output", `${videoName}-ci.mp4`);

const render = await runRenderVideo({
  projectRoot,
  videoName,
  outPath,
  draft: true,
  incremental: true,
  // CI has no brand to extract from and no product running; the look is whatever the
  // project already committed.
  skipBrandLock: true,
});

if (!render.success) {
  console.error(render.stderr || render.stdout);
  process.exit(1);
}
console.log(
  `rendered ${render.renderedBeats?.length ?? "?"} beat(s), reused ${render.reusedBeats?.length ?? 0}, ` +
    `${render.framesRendered ?? "?"} of ${render.totalFrames ?? "?"} frames in ${render.elapsedSeconds}s`,
);

const result = await runVisualRegression({
  projectRoot,
  videoName,
  videoPath: outPath,
  baselineDir: path.join(".openvidstudio", "visual-baseline", videoName),
  updateBaseline: accept,
});

console.log(result.markdown);

// Written to a file as well as stdout: the workflow posts this verbatim as a PR comment,
// and passing multi-line markdown through a step output is a quoting problem nobody needs.
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync(path.join("output", "visual-regression.md"), result.markdown + "\n", "utf8");

// A drifted beat is a finding, not a build break: most of the time the change is intended
// and the right response is to look at the diff and accept it. The workflow reports, the
// human decides.
process.exit(0);

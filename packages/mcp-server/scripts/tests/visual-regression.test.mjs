#!/usr/bin/env node
// visual-regression: Part 21 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 21: frame comparison ==");

{
  const sharp = require("sharp");
  const { compareFrames, judgeDrift } = require(path.join(distDir, "frameDiff.js"));
  const { inferBindings } = require(path.join(distDir, "tools", "docsDrift.js"));

  const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-framediff-"));
  const flat = (r, g, b, width = 400, height = 300) =>
    sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png();

  const base = path.join(diffDir, "base.png");
  const same = path.join(diffDir, "same.png");
  const nudged = path.join(diffDir, "nudged.png");
  const repainted = path.join(diffDir, "repainted.png");
  const taller = path.join(diffDir, "taller.png");
  await flat(30, 30, 40).toFile(base);
  await flat(30, 30, 40).toFile(same);
  // Within the per-pixel threshold: this is the shape of encoder noise, which a useful
  // comparison has to ignore or it reports a difference on every single run.
  await flat(31, 31, 41).toFile(nudged);
  await flat(200, 40, 40).toFile(repainted);
  await flat(30, 30, 40, 400, 500).toFile(taller);

  const identical = await compareFrames(base, same);
  check("two identical frames compare as identical", identical.changedRatio === 0 && identical.meanDelta === 0);
  check("...and are not reported as resized", identical.resized === false);
  check("...and judge as unchanged", judgeDrift(identical).drifted === false);

  const noise = await compareFrames(base, nudged);
  check("a sub-threshold nudge moves no pixels past the threshold", noise.changedRatio === 0);
  check("...and still judges as unchanged, which is what stops every run flagging", judgeDrift(noise).drifted === false);

  const changed = await compareFrames(base, repainted);
  check("a repaint moves every pixel", changed.changedRatio === 1);
  check("...and judges as drifted", judgeDrift(changed).drifted === true);

  // A page that got taller has genuinely changed. Refusing to compare would hide the
  // finding behind a crash.
  const resized = await compareFrames(base, taller);
  check("a size change is reported rather than throwing", resized.resized === true);
  check("...and is drift on its own", judgeDrift(resized).drifted === true);

  const diffOut = path.join(diffDir, "out.diff.png");
  await compareFrames(base, repainted, { diffPath: diffOut });
  check("a diff image is written when asked for", fs.existsSync(diffOut));

  // Either signal alone is enough: a repainted button barely moves the mean, and a
  // palette shift barely moves the changed-pixel count.
  check(
    "a small mean shift alone still counts as drift",
    judgeDrift({ meanDelta: 0.05, changedRatio: 0, width: 10, height: 10, resized: false }).drifted === true,
  );

  const bindings = inferBindings([
    { id: "hook", visual: { captureMethod: "screenshot", url: "https://example.com/docs/start" } },
    { id: "panel", visual: { captureMethod: "dom-demo" } },
    { id: "term", visual: { captureMethod: "recording", source: "terminal" } },
    { id: "noUrl", visual: { captureMethod: "screenshot" } },
  ]);
  check("drift bindings are inferred from browser screenshot beats that carry a url", bindings.length === 1 && bindings[0].beatId === "hook");
  check("...and default to that beat's own capture as the reference", bindings[0].referencePath.includes("hook.png"));
}

finish();

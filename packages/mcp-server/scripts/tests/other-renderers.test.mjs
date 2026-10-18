#!/usr/bin/env node
// other-renderers: Part 19 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 19: other renderers over the same beats ==");

{
  const rend = require(path.join(distDir, "tools", "exportRendition.js"));
  const { buildPaletteArgs, buildGifArgs, buildFrameArgs, buildStoreFrameArgs, buildScreenshotIndex, beatMidpointSeconds, STORE_DEVICES } = rend;

  // A GIF is 256 colours. Without a generated palette ffmpeg uses a fixed web-safe one and
  // bands flat UI into mud, which is why most README GIFs look the way they do.
  check("the GIF export generates a palette first", buildPaletteArgs("in.mp4", "p.png", 12, 720).join(" ").includes("palettegen"));
  check("...and uses it on the second pass", buildGifArgs("in.mp4", "p.png", "out.gif", 12, 720).join(" ").includes("paletteuse"));
  check("...and loops forever, since a README GIF that plays once is a still", buildGifArgs("in.mp4", "p.png", "out.gif", 12, 720).includes("-loop"));

  // -ss after -i decodes to the exact timestamp. Before -i it seeks on keyframes, which is
  // fast and lands on the wrong frame, which is not acceptable for a docs screenshot.
  const frameArgs = buildFrameArgs("in.mp4", 1.5, "out.png");
  check("a docs frame seeks accurately, not to the nearest keyframe", frameArgs.indexOf("-i") < frameArgs.indexOf("-ss"));

  check("a beat's screenshot comes from its midpoint", beatMidpointSeconds({ id: "b", start: 30, duration: 60 }, 30) === 2);

  check("every store device has real dimensions", STORE_DEVICES["iphone-6.9"].width === 1290 && STORE_DEVICES["iphone-6.9"].height === 2796);
  const storeArgs = buildStoreFrameArgs("in.mp4", 1, "out.png", STORE_DEVICES["android-phone"], 32).join(" ");
  check("a store frame is padded to the exact canvas the store demands", storeArgs.includes("pad=1080:1920"));
  // Filling the canvas would crop away exactly the UI the screenshot exists to show.
  check("...and fits the shot rather than cropping it to fill", storeArgs.includes("force_original_aspect_ratio=decrease"));

  const index = buildScreenshotIndex("demo", [{ file: "01-hook.png", beat: { id: "hook", start: 0, duration: 90, vo: "What this beat says." } }]);
  check("the screenshot index pairs each shot with its narration", index.includes("![hook](./01-hook.png)") && index.includes("What this beat says."));
  check("...and says it is generated, so nobody hand-edits it", index.includes("overwritten"));
}

finish();

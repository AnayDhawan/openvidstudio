#!/usr/bin/env node
// contact-sheet: Part 35, Part 36 (split out of the former single manual-test.mjs; see _harness.mjs)

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

// ---- fixtures (quiet): state this file's checks expect from earlier in the old single script ----
setQuiet(true);
// fixture: CAP
const captureCore = require(path.join(packageRoot, "..", "capture", "dist", "browser.js"));
const { cropAndUpscale } = require(path.join(distDir, "tools", "captureScreenshot.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
const { buildFfmpegTranscodeArgs, buildFfprobeDurationArgs } = require(path.join(distDir, "tools", "captureScreenRecording.js"));
setQuiet(false);
// ---- checks ----

console.log("\n== Part 35: contact_sheet's tile filtergraph (A4) ==");

{
  const { buildContactSheetFilterGraph, buildContactSheetArgs } = require(path.join(distDir, "tools", "contactSheet.js"));

  // 4 frames -> the 2x2 grid runContactSheet computes for a 4-beat, midpointOnly video.
  const graph4 = buildContactSheetFilterGraph(4, 480, 2, 2);
  check(
    "4-frame filtergraph scales every input to the same width, forcing even height (-2)",
    graph4.includes("[0]scale=480:-2[t0]") && graph4.includes("[3]scale=480:-2[t3]"),
  );
  check(
    "...concatenates all 4 scaled streams into ONE stream before tile",
    graph4.includes("[t0][t1][t2][t3]concat=n=4:v=1:a=0"),
  );
  check(
    "...and only that single concatenated stream feeds tile, at exactly the requested grid " +
      "(the A4 bug: ffmpeg's tile filter takes exactly one input, not one per frame)",
    graph4.includes("concat=n=4:v=1:a=0,tile=2x2:padding=8:color=#0B0E14"),
  );
  check(
    "tile is never fed more than one input label directly (the old, broken shape)",
    !/\]\[t\d+\](?:\[t\d+\])*tile=/.test(graph4) && (graph4.match(/tile=/g) ?? []).length === 1,
  );

  // 16 frames -> the other grid size the accept criterion asks for (4x4).
  const graph16 = buildContactSheetFilterGraph(16, 480, 4, 4);
  check("16-frame filtergraph scales all 16 inputs", graph16.includes("[15]scale=480:-2[t15]"));
  check(
    "...concatenates all 16 into one stream, then tiles 4x4",
    graph16.includes("concat=n=16:v=1:a=0,tile=4x4:padding=8:color=#0B0E14"),
  );
  check(
    "16-frame graph's tile is likewise fed by the single concatenated stream only",
    !/\]\[t\d+\](?:\[t\d+\])*tile=/.test(graph16),
  );

  const args4 = buildContactSheetArgs(["a.png", "b.png", "c.png", "d.png"], 480, 2, 2, "sheet.jpg");
  check(
    "buildContactSheetArgs interleaves -i per frame, in order",
    JSON.stringify(args4.slice(0, 10)) ===
      JSON.stringify(["-v", "error", "-i", "a.png", "-i", "b.png", "-i", "c.png", "-i", "d.png"]),
  );
  check(
    "...and ends with -filter_complex <graph> -frames:v 1 <sheetPath> -y",
    JSON.stringify(args4.slice(-6)) ===
      JSON.stringify(["-filter_complex", buildContactSheetFilterGraph(4, 480, 2, 2), "-frames:v", "1", "sheet.jpg", "-y"]),
  );
}

console.log("\n== Part 36 (A4 continued): contact_sheet's real ffmpeg tiling, 4 and 16 inputs ==");

{
  const ffmpegAvailable = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  if (ffmpegAvailable) {
    const { buildContactSheetArgs } = require(path.join(distDir, "tools", "contactSheet.js"));
    const sharpForSheet = require(path.join(packageRoot, "node_modules", "sharp"));
    const tileWidth = 480;
    // 16:9 at these exact pixel counts so scale=480:-2 lands on 270 with no rounding to
    // reason about (480 * 360 / 640 = 270 exactly), which is what lets the dimension
    // checks below assert an exact pixel size instead of an approximate one.
    const srcWidth = 640;
    const srcHeight = 360;
    const scaledHeight = 270;
    const colors = ["red", "green", "blue", "yellow", "magenta", "cyan", "white", "gray"];

    function realTileRun(frameCount) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ovs-contact-sheet-${frameCount}-`));
      const files = [];
      for (let i = 0; i < frameCount; i++) {
        const f = path.join(dir, `frame${i}.png`);
        execFileSync("ffmpeg", [
          "-y", "-loglevel", "error",
          "-f", "lavfi", "-i", `color=c=${colors[i % colors.length]}:size=${srcWidth}x${srcHeight}`,
          "-frames:v", "1", f,
        ]);
        files.push(f);
      }
      // Same grid math as runContactSheet itself.
      const columns = Math.min(4, Math.ceil(Math.sqrt(frameCount)));
      const rows = Math.ceil(frameCount / columns);
      const sheetPath = path.join(dir, "contact-sheet.jpg");
      const args = buildContactSheetArgs(files, tileWidth, columns, rows, sheetPath);
      // The real fixed shape, run through ffmpeg for real -- a fixed argv list built by the
      // function under test, no user input, no Windows .cmd shim involved (ffmpeg is a real
      // .exe), so plain execFileSync matches this file's other real-process sections rather
      // than importing @openvidstudio/capture's spawnCapture for one call site.
      let code = 0;
      let stderr = "";
      try {
        execFileSync("ffmpeg", args, { stdio: "pipe" });
      } catch (err) {
        code = err.status ?? 1;
        stderr = String(err.stderr ?? err.message);
      }
      return { sheetPath, columns, rows, code, stderr };
    }

    for (const frameCount of [4, 16]) {
      const { sheetPath, columns, rows, code, stderr } = realTileRun(frameCount);
      check(`contact_sheet's real ffmpeg tile run exits 0 for ${frameCount} frames${code !== 0 ? `: ${stderr.slice(0, 300)}` : ""}`, code === 0);
      check(`...and produces a real image file for ${frameCount} frames`, fs.existsSync(sheetPath));
      const meta = await sharpForSheet(sheetPath).metadata();
      const expectedWidth = columns * tileWidth + (columns - 1) * 8;
      const expectedHeight = rows * scaledHeight + (rows - 1) * 8;
      check(
        `...at the exact tiled dimensions for ${frameCount} frames (${columns}x${rows} grid: ` +
          `got ${meta.width}x${meta.height}, expected ${expectedWidth}x${expectedHeight})`,
        meta.width === expectedWidth && meta.height === expectedHeight,
      );
    }
  } else {
    skip("Part 36: real ffmpeg tiling for 4 and 16 frames", "ffmpeg not available in this environment");
  }
}

finish();

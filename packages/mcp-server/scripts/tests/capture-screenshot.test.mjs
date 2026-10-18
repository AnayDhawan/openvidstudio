#!/usr/bin/env node
// capture-screenshot: Part 5, Part 6, Part 31, Part 32 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 5: capture_screenshot / capture_screen_recording -- pure functions (no browser) ==");

// capture.ts moved to @openvidstudio/capture (as browser.ts) when the capture engine was
// split into its own package; this require still pointed at mcp-server's own dist, which
// never had this file, crashing the suite before it could finish.
const captureCore = require(path.join(packageRoot, "..", "capture", "dist", "browser.js"));
const { detectAndCompensateZoom, ZoomCompensationError, DEFAULT_VIEWPORT } = captureCore;

check(
  "DEFAULT_VIEWPORT matches CAPTURE.md's worked example (1600x1000)",
  DEFAULT_VIEWPORT.width === 1600 && DEFAULT_VIEWPORT.height === 1000,
);

// Fake `page` -- only setViewportSize/evaluate are called by detectAndCompensateZoom, so a
// plain object satisfies it at runtime (this is compiled JS, no TS structural checking here).
function fakePage(sequence) {
  let call = 0;
  return {
    async setViewportSize() {
      // no-op; the fake's evaluate() below returns canned measurements regardless of the
      // requested size, exactly like a real desynced browser profile would.
    },
    async evaluate() {
      const result = sequence[call];
      call += 1;
      return result;
    },
  };
}

{
  // Case 1: no desync at all -- zoom measures to exactly 1.
  const page = fakePage([[1600, 1000]]);
  const result = await detectAndCompensateZoom(page, { width: 1600, height: 1000 });
  check("zoom=1 case: no compensation needed", result.zoom === 1 && result.viewport.width === 1600 && result.viewport.height === 1000);
}

{
  // Case 2: CAPTURE.md's own worked example -- requesting 1600x1000 renders at 2000x1250
  // (zoom = 0.8), compensating to 1280x800 brings it back to exactly 1600x1000.
  const page = fakePage([
    [2000, 1250],
    [1600, 1000],
  ]);
  const result = await detectAndCompensateZoom(page, { width: 1600, height: 1000 });
  check(
    "zoom=0.8 desync case converges (CAPTURE.md's worked example)",
    Math.abs(result.zoom - 0.8) < 1e-9 && result.viewport.width === 1280 && result.viewport.height === 800,
  );
}

{
  // Case 3: compensation attempted but the second measurement still doesn't match target --
  // must throw ZoomCompensationError, not silently proceed with a wrong crop.
  const page = fakePage([
    [2000, 1250],
    [1700, 1050], // still off after "compensating"
  ]);
  let threw = null;
  try {
    await detectAndCompensateZoom(page, { width: 1600, height: 1000 });
  } catch (err) {
    threw = err;
  }
  check(
    "non-convergent desync throws ZoomCompensationError instead of proceeding",
    threw instanceof ZoomCompensationError,
  );
}

const { cropAndUpscale } = require(path.join(distDir, "tools", "captureScreenshot.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
{
  // A 100x100 solid-color PNG, cropped/upscaled per crop-shot.py's math (rect in effective CSS
  // space, zoom = 2 physical-per-css): rect (10,10,20,20) at zoom 2 -> physical box (20,20,60,60),
  // a 40x40 extract, upscaled back to the rect's own 20x20 CSS size.
  const srcBuffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
  const outBuffer = await cropAndUpscale(srcBuffer, { x: 10, y: 10, width: 20, height: 20 }, 2);
  const meta = await sharp(outBuffer).metadata();
  check("cropAndUpscale (crop-shot.py port) resizes to the rect's own (unshrunk) size", meta.width === 20 && meta.height === 20);
}

const { buildFfmpegTranscodeArgs, buildFfprobeDurationArgs } = require(
  path.join(distDir, "tools", "captureScreenRecording.js"),
);
// The encode is now screen-tuned rather than x264-default: crf 18 and -tune stillimage
// instead of the film-oriented defaults that put ringing around text. Pinned as the exact
// argv so a future change to the profile is a deliberate edit here, not a silent drift.
check(
  "buildFfmpegTranscodeArgs returns the expected argv array",
  JSON.stringify(buildFfmpegTranscodeArgs("in.webm", "out.mp4")) ===
    JSON.stringify([
      "-nostdin", "-i", "in.webm",
      "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-tune", "stillimage",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "out.mp4", "-y",
    ]),
);
check(
  "buildFfprobeDurationArgs returns the expected argv array",
  JSON.stringify(buildFfprobeDurationArgs("out.mp4")) ===
    JSON.stringify(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "out.mp4"]),
);

const captureScreenshotSrc = fs.readFileSync(path.join(packageRoot, "src", "tools", "captureScreenshot.ts"), "utf8");
const captureRecordingSrc = fs.readFileSync(path.join(packageRoot, "src", "tools", "captureScreenRecording.ts"), "utf8");
check(
  "captureScreenRecording.ts's ffmpeg transcode goes through spawnCapture, never exec/execSync",
  !/\bexec(Sync)?\(/.test(captureRecordingSrc) && /spawnCapture\(\s*"ffmpeg"/.test(captureRecordingSrc),
);
check("captureScreenshot.ts never calls exec/execSync", !/\bexec(Sync)?\(/.test(captureScreenshotSrc));

console.log("\n== Part 6: capture_screenshot / capture_screen_recording -- real browser E2E ==");

const { launchChromium } = captureCore;
let browserAvailable = false;
try {
  const probeBrowser = await launchChromium();
  await probeBrowser.close();
  browserAvailable = true;
} catch (err) {
  console.log(`  (skipped: real Chromium is not available in this environment: ${err.message})`);
}

if (browserAvailable) {
  const http = await import("node:http");
  const testPageHtml = `<!doctype html>
<html><head><style>
  body { margin: 0; background: #f0f0f0; }
  #target { position: absolute; left: 50px; top: 80px; width: 400px; height: 300px; background: #3355ff; }
  #status { position: absolute; left: 10px; top: 400px; font-family: sans-serif; }
  #btn { position: absolute; left: 10px; top: 440px; }
  #inp { position: absolute; left: 10px; top: 470px; }
</style></head>
<body>
  <div id="status">idle</div>
  <button id="btn" onclick="document.getElementById('status').textContent = 'clicked'">Click me</button>
  <input id="inp" />
  <div id="target"></div>
  <script>
    document.getElementById('inp').addEventListener('input', function (e) {
      document.getElementById('status').textContent = 'typed:' + e.target.value;
    });
  </script>
</body></html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(testPageHtml);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  const captureTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-capture-test-"));

  try {
    const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));
    const shotResult = await runCaptureScreenshot({
      projectRoot: captureTmpRoot,
      beatId: "hook",
      url: testUrl,
      viewport: { width: 800, height: 600 },
      interactions: [
        { type: "click", selector: "#btn" },
        { type: "fill", selector: "#inp", value: "hello" },
      ],
      cropSelector: "#target",
    });
    check(
      "capture_screenshot wrote to the default public/images/<beatId>.png convention",
      shotResult.outPath === path.join(captureTmpRoot, "public", "images", "hook.png"),
    );
    check("capture_screenshot's output file exists on disk", fs.existsSync(shotResult.outPath));
    check("capture_screenshot reports a numeric zoom (real live measurement, not skipped)", typeof shotResult.zoom === "number" && shotResult.zoom > 0);
    check(
      "capture_screenshot's cropSelector result matches #target's own CSS size (400x300), unshrunk regardless of measured zoom",
      shotResult.width === 400 && shotResult.height === 300,
    );
    const shotMeta = await sharp(shotResult.outPath).metadata();
    // width/height are CSS pixels (what the layout was measured in, and what the scene
    // templates lay out against); the file on disk carries deviceScaleFactor times that,
    // which is the whole point of capturing at 2x.
    check(
      "capture_screenshot's saved PNG is deviceScaleFactor times the reported CSS size",
      shotMeta.width === shotResult.width * shotResult.deviceScaleFactor &&
        shotMeta.height === shotResult.height * shotResult.deviceScaleFactor,
    );
    check(
      "...and the reported pixel dimensions match the file exactly",
      shotMeta.width === shotResult.pixelWidth && shotMeta.height === shotResult.pixelHeight,
    );
    check("...at 2x by default", shotResult.deviceScaleFactor === 2);

    const ffmpegAvailable = (() => {
      try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();

    if (ffmpegAvailable) {
      const { runCaptureScreenRecording } = require(path.join(distDir, "tools", "captureScreenRecording.js"));
      const recResult = await runCaptureScreenRecording({
        projectRoot: captureTmpRoot,
        beatId: "hook",
        url: testUrl,
        viewport: { width: 800, height: 600 },
        interactions: [
          { type: "click", selector: "#btn" },
          { type: "wait", ms: 200 },
        ],
      });
      check(
        "capture_screen_recording wrote to the default public/video/<beatId>.mp4 convention",
        recResult.outPath === path.join(captureTmpRoot, "public", "video", "hook.mp4"),
      );
      check("capture_screen_recording's output file exists and is non-empty", fs.existsSync(recResult.outPath) && fs.statSync(recResult.outPath).size > 0);
      check("capture_screen_recording reports a numeric zoom", typeof recResult.zoom === "number" && recResult.zoom > 0);

      let ffprobeOk = false;
      try {
        const probeOut = execFileSync(
          "ffprobe",
          ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", recResult.outPath],
          { encoding: "utf8" },
        );
        ffprobeOk = probeOut.trim() === "video";
      } catch (err) {
        console.log(`  (ffprobe stream check skipped: ${err.message})`);
      }
      check("ffprobe confirms the transcoded mp4 has a video stream", ffprobeOk);
    } else {
      console.log("  (skipped capture_screen_recording: ffmpeg not found on PATH)");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} else {
  console.log("  (skipped entirely: no real Chromium available -- see DONE_WITH_CONCERNS note in the task report)");
}

console.log("\n== Part 31: capture and render quality ==");

{
  const cap = require(path.join(packageRoot, "..", "capture", "dist", "browser.js"));
  const native = require(path.join(packageRoot, "..", "capture", "dist", "native.js"));
  const { buildFfmpegTranscodeArgs } = require(path.join(distDir, "tools", "captureScreenRecording.js"));
  const { buildRenderCommand } = require(path.join(distDir, "tools", "renderVideo.js"));
  const { cropAndUpscale } = require(path.join(distDir, "tools", "captureScreenshot.js"));
  const sharp = require("sharp");

  // The video puts a capture on a 1920x1080 stage and then pushes a camera into it, so a
  // 1x capture is upscaled twice over. Measured on a real page, 2x retains ~1.6x the fine
  // detail at the size the renderer actually shows it.
  check("captures default to 2x the CSS resolution", cap.DEFAULT_DEVICE_SCALE === 2);

  const enc = native.screenEncodeArgs().join(" ");
  // x264's defaults are tuned for camera footage: grain, motion, no hard edges. A screen is
  // the opposite, and the default crf 23 puts visible ringing around text.
  check("captures encode with a screen-tuned x264 profile", enc.includes("-crf 18") && enc.includes("-tune stillimage"));
  check("...and the webm transcode uses the identical profile", buildFfmpegTranscodeArgs("i.webm", "o.mp4").join(" ").includes(enc));

  const win = native.buildDesktopCaptureArgs({ platform: "win32", framerate: 30, durationSeconds: 5, outPath: "o.mp4" });
  check("a desktop capture draws the cursor by default", win.join(" ").includes("-draw_mouse 1"));
  check("...and can be told not to", native.buildDesktopCaptureArgs({ platform: "win32", framerate: 30, durationSeconds: 5, outPath: "o.mp4", drawMouse: false }).join(" ").includes("-draw_mouse 0"));
  // gdigrab drops frames at the start of a capture without a queue, which lands as a
  // stutter in the first second, the second a demo can least afford to lose.
  check("...and buffers the input queue so the first second is not dropped", win.includes("-thread_queue_size"));
  check("a linux capture draws the cursor too", native.buildDesktopCaptureArgs({ platform: "linux", framerate: 30, durationSeconds: 5, outPath: "o.mp4" }).join(" ").includes("-draw_mouse 1"));
  check("a macOS capture captures the cursor too", native.buildDesktopCaptureArgs({ platform: "darwin", framerate: 30, durationSeconds: 5, outPath: "o.mp4" }).join(" ").includes("-capture_cursor 1"));

  // Remotion serialises every frame before encoding, defaulting to JPEG at quality 80. On
  // text and flat UI that is a visible loss applied to every frame before x264 sees it.
  const finalArgs = buildRenderCommand("Demo", "out.mp4").args.join(" ");
  check("a final render serialises frames losslessly", finalArgs.includes("--image-format=png"));
  check("...and a draft does not pay for that", !buildRenderCommand("Demo", "out.mp4", { draft: true }).args.join(" ").includes("--image-format=png"));

  // The crop path has to keep the extra pixels a 2x capture was taken for. Cropping at full
  // resolution and then resizing back to CSS size would throw away exactly what was gained.
  const src = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  const cropped = await cropAndUpscale(src, { x: 100, y: 100, width: 200, height: 150 }, 2, 2);
  const meta = await sharp(cropped).metadata();
  check("a 2x crop keeps its resolution instead of being resampled back down", meta.width === 400 && meta.height === 300);
  const cropped1x = await cropAndUpscale(src, { x: 100, y: 100, width: 200, height: 150 }, 1, 1);
  const meta1x = await sharp(cropped1x).metadata();
  check("...and a 1x crop is unchanged from before", meta1x.width === 200 && meta1x.height === 150);
}

console.log("\n== Part 32: settling, so nothing is captured half-finished ==");

{
  const { buildFfmpegTranscodeArgs } = require(path.join(distDir, "tools", "captureScreenRecording.js"));

  // setpts scales presentation timestamps, so the multiplier is the reciprocal of the rate.
  check("2x speed halves each frame's presentation time", buildFfmpegTranscodeArgs("i.webm", "o.mp4", 2).join(" ").includes("setpts=0.500000*PTS"));
  check("half speed doubles it", buildFfmpegTranscodeArgs("i.webm", "o.mp4", 0.5).join(" ").includes("setpts=2.000000*PTS"));
  check("1x adds no filter at all", !buildFfmpegTranscodeArgs("i.webm", "o.mp4", 1).join(" ").includes("setpts"));
}

if (browserAvailable) {
  const http = await import("node:http");
  const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));
  const sharp = require("sharp");

  // A 1500ms entrance transition and an infinite spinner on the same page. The transition is
  // the thing to wait for; the spinner is the trap, because its `finished` promise never
  // resolves and waiting on it would burn the whole timeout on every capture.
  const settleHtml = `<!doctype html><html><head><style>
    body{margin:0;background:#fff;font:48px system-ui}
    #panel{opacity:0;transform:translateY(60px);animation:in 1500ms ease-out forwards}
    @keyframes in{to{opacity:1;transform:none}}
    #spin{width:40px;height:40px;border:6px solid #ccc;border-top-color:#333;border-radius:50%;animation:spin 800ms linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style></head><body><div id=spin></div><div id=panel>PANEL</div></body></html>`;

  const settleServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(settleHtml);
  });
  await new Promise((resolve) => settleServer.listen(0, "127.0.0.1", resolve));
  const settleUrl = `http://127.0.0.1:${settleServer.address().port}/`;
  const settleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-settle-"));

  try {
    const on = await runCaptureScreenshot({
      projectRoot: settleRoot, beatId: "on", url: settleUrl,
      viewport: { width: 900, height: 400 }, deviceScaleFactor: 1,
    });
    check("settling reports that it finished", on.settle.settled === true);
    check("...having waited for the 1500ms transition", on.settle.waitedMs >= 1400);
    // The whole point of the infinite filter: without it this capture would have taken the
    // full 5s timeout and still reported unsettled.
    check("...and identified the infinite spinner rather than waiting on it", on.settle.loopingAnimations === 1);
    check("...and did not blow the timeout doing so", on.settle.waitedMs < 4000);
    check("...with fonts and images accounted for", on.settle.fontsReady === true && on.settle.imagesReady === true);

    const off = await runCaptureScreenshot({
      projectRoot: settleRoot, beatId: "off", url: settleUrl,
      viewport: { width: 900, height: 400 }, deviceScaleFactor: 1, settle: false,
    });
    check("settling can be turned off deliberately", off.settle === undefined);

    // The real difference: settled catches the panel landed, unsettled catches it mid-fade.
    // Measured as ink on the page, since a faded panel is nearly white.
    const ink = async (file) => {
      const { data } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
      let dark = 0;
      for (let i = 0; i < data.length; i++) if (data[i] < 128) dark++;
      return dark;
    };
    const inkOn = await ink(on.outPath);
    const inkOff = await ink(off.outPath);
    check(`the settled capture has the panel fully painted (${inkOn} dark px vs ${inkOff})`, inkOn > inkOff * 1.5);
  } finally {
    settleServer.close();
  }
} else {
  skip("Part 32: real settling E2E", "real Chromium is not available in this environment");
}

finish();

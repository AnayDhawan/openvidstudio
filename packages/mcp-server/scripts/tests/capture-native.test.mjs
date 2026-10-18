#!/usr/bin/env node
// capture-native: Part 11, Part 13 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 11: non-browser capture -- pure argv builders (no process spawned) ==");

{
  const native = require(path.join(packageRoot, "..", "capture", "dist", "native.js"));
  const {
    buildDesktopCaptureArgs,
    buildAdbRecordArgs,
    buildAdbPullArgs,
    buildSimctlRecordArgs,
    buildRemuxArgs,
    sanitizeDeviceId,
    sanitizeWindowTitle,
  } = native;

  const win = buildDesktopCaptureArgs({
    platform: "win32", framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check("win32 full-screen capture uses gdigrab against `desktop`", win.includes("gdigrab") && win.includes("desktop"));
  check("win32 capture bounds itself with -t", win[win.indexOf("-t") + 1] === "5");

  const winWindow = buildDesktopCaptureArgs({
    platform: "win32", window: "Hermes Agent", framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check(
    "win32 window capture passes title= as ONE argv entry (spaces intact, never shell-split)",
    winWindow.includes("title=Hermes Agent"),
  );

  const winRegion = buildDesktopCaptureArgs({
    platform: "win32", region: { x: 10, y: 20, width: 640, height: 480 },
    framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check(
    "win32 region capture uses gdigrab's own offset/video_size input flags",
    winRegion.includes("-offset_x") && winRegion.includes("-video_size") && winRegion.includes("640x480"),
  );

  const mac = buildDesktopCaptureArgs({
    platform: "darwin", display: 1, framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check("darwin capture uses avfoundation with a <display>:none input", mac.includes("avfoundation") && mac.includes("1:none"));

  const macRegion = buildDesktopCaptureArgs({
    platform: "darwin", region: { x: 5, y: 6, width: 300, height: 200 },
    framerate: 30, durationSeconds: 5, outPath: "out.mp4",
  });
  check(
    "darwin region becomes a crop filter (avfoundation cannot grab a sub-rect)",
    macRegion.join(" ").includes("crop=300:200:5:6"),
  );

  const linux = buildDesktopCaptureArgs({
    platform: "linux", region: { x: 100, y: 50, width: 800, height: 600 },
    framerate: 25, durationSeconds: 5, outPath: "out.mp4",
  });
  check("linux capture uses x11grab with the region in its input spec", linux.includes("x11grab") && linux.includes(":0.0+100,50"));

  // h264/yuv420p cannot encode odd dimensions, and a hand-picked region very often is odd.
  for (const [name, args] of [["win32", win], ["darwin", mac], ["linux", linux]]) {
    check(
      `${name} output forces even dimensions (odd-width regions would fail at the encoder)`,
      args.join(" ").includes("trunc(iw/2)*2:trunc(ih/2)*2"),
    );
  }
  check("desktop output is yuv420p + faststart so Remotion can seek it", win.includes("yuv420p") && win.includes("+faststart"));

  const adb = buildAdbRecordArgs("/sdcard/x.mp4", 20, "emulator-5554");
  check("adb record targets the chosen device and self-terminates via --time-limit",
    adb[0] === "-s" && adb[1] === "emulator-5554" && adb.includes("--time-limit") && adb.includes("20"));
  check("adb record omits -s entirely when no deviceId is given", buildAdbRecordArgs("/sdcard/x.mp4", 20)[0] === "shell");
  check("adb pull moves the device file to a local path", buildAdbPullArgs("/sdcard/x.mp4", "local.mp4").join(" ") === "pull /sdcard/x.mp4 local.mp4");
  check("simctl defaults to the booted simulator", buildSimctlRecordArgs("out.mp4").includes("booted"));
  check("remux copies streams rather than re-encoding", buildRemuxArgs("in.mp4", "out.mp4").join(" ").includes("-c copy"));

  check("sanitizeDeviceId accepts a real adb serial", sanitizeDeviceId("emulator-5554") === "emulator-5554");
  let rejectedId = false;
  try { sanitizeDeviceId("a; rm -rf /"); } catch { rejectedId = true; }
  check("sanitizeDeviceId rejects a shell-metacharacter payload", rejectedId);
  check("sanitizeWindowTitle allows spaces and quotes (argv is passed intact)", sanitizeWindowTitle('My "App" v2') === 'My "App" v2');
  let rejectedTitle = false;
  try { sanitizeWindowTitle("bad\ntitle"); } catch { rejectedTitle = true; }
  check("sanitizeWindowTitle rejects a newline (it would truncate gdigrab's selector)", rejectedTitle);
}

console.log("\n== Part 13: Wayland backend selection and pipewiregrab argv ==");

{
  const native = require(path.join(packageRoot, "..", "capture", "dist", "native.js"));
  const { detectLinuxDisplayServer, buildDesktopCaptureArgs, hasFilter, buildFilterProbeArgs } = native;

  check("XDG_SESSION_TYPE=wayland is detected", detectLinuxDisplayServer({ XDG_SESSION_TYPE: "wayland" }) === "wayland");
  check("XDG_SESSION_TYPE=x11 is detected", detectLinuxDisplayServer({ XDG_SESSION_TYPE: "x11" }) === "x11");
  // Containers and some session managers leave XDG_SESSION_TYPE unset, so WAYLAND_DISPLAY
  // is the fallback signal rather than defaulting a Wayland box to x11grab.
  check(
    "WAYLAND_DISPLAY alone still means wayland",
    detectLinuxDisplayServer({ WAYLAND_DISPLAY: "wayland-0" }) === "wayland",
  );
  check("an empty environment falls back to x11", detectLinuxDisplayServer({}) === "x11");

  const wayland = buildDesktopCaptureArgs({
    platform: "linux",
    displayServer: "wayland",
    framerate: 30,
    durationSeconds: 6,
    outPath: "out.mp4",
  });
  check("a wayland capture goes through lavfi's pipewiregrab", wayland.includes("lavfi") && wayland.some((a) => a.startsWith("pipewiregrab=")));
  check("...and never through x11grab", !wayland.includes("x11grab"));
  // pipewiregrab is a filter source, not an input device, so there is no -framerate to ask
  // the device for: the rate is imposed downstream with fps.
  check("...and imposes the framerate with the fps filter", wayland.join(" ").includes("fps=30"));
  check("...and still forces even dimensions for h264", wayland.join(" ").includes("scale=trunc(iw/2)*2"));

  const waylandCropped = buildDesktopCaptureArgs({
    platform: "linux",
    displayServer: "wayland",
    framerate: 24,
    durationSeconds: 3,
    outPath: "out.mp4",
    region: { x: 10, y: 20, width: 640, height: 481 },
  });
  check("a region on wayland becomes a crop filter", waylandCropped.join(" ").includes("crop=640:481:10:20"));

  const withNode = buildDesktopCaptureArgs({
    platform: "linux",
    displayServer: "wayland",
    framerate: 30,
    durationSeconds: 3,
    outPath: "out.mp4",
    pipewire: { node: 42 },
  });
  check("a pre-negotiated portal node id is passed to the filter", withNode.join(" ").includes("node=42"));

  const x11 = buildDesktopCaptureArgs({ platform: "linux", framerate: 30, durationSeconds: 3, outPath: "out.mp4" });
  check("an x11 session is unchanged by any of this", x11.includes("x11grab"));

  check("buildFilterProbeArgs asks ffmpeg for its filter list", JSON.stringify(buildFilterProbeArgs()) === JSON.stringify(["-hide_banner", "-filters"]));
  check(
    "hasFilter finds pipewiregrab in real ffmpeg -filters output",
    hasFilter(" T.. crop              V->V       Crop the input video.\n ... pipewiregrab      |->V       Capture a portal stream.\n", "pipewiregrab"),
  );
  check(
    "hasFilter does not false-positive on a build without it",
    !hasFilter(" T.. crop              V->V       Crop the input video.\n", "pipewiregrab"),
  );
}

finish();

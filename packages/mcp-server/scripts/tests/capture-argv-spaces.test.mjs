#!/usr/bin/env node
// Paths and window titles with spaces must reach ffmpeg, adb and simctl as single argv
// entries. The capture README promises this; these checks hold it to that, per backend, by
// asserting on argv arrays element by element (a joined string would hide a word-split).
// A real child process then echoes back what it received, so the spawn wrappers are
// checked as well as the builders.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { require, packageRoot, check, skip, finish } from "./_harness.mjs";

const capture = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
const {
  buildDesktopCaptureArgs,
  buildPipewireCaptureArgs,
  buildAdbRecordArgs,
  buildAdbPullArgs,
  buildAdbCleanupArgs,
  buildSimctlRecordArgs,
  buildRemuxArgs,
  spawnCapture,
  spawnForDuration,
} = capture;

const isArgv = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");
// The value right after a flag, or undefined when the flag is absent.
const after = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

const WIN_OUT = "C:\\Users\\Jane Doe\\My Videos\\product demo.mp4";
const POSIX_OUT = "/home/jane doe/my videos/product demo.mp4";
const TITLE = "Visual Studio Code - my project (v2)";

console.log("\n== gdigrab (win32): window title and output path with spaces ==");
{
  const argv = buildDesktopCaptureArgs({
    platform: "win32",
    window: TITLE,
    framerate: 30,
    durationSeconds: 8,
    outPath: WIN_OUT,
  });
  check("gdigrab builder returns an argv array of strings", isArgv(argv));
  check("the window selector is exactly one entry, spaces intact, no added quotes", after(argv, "-i") === `title=${TITLE}`);
  check("no entry is a fragment of the title", !argv.includes("Studio") && !argv.includes("project") && !argv.includes("Code"));
  check("the output path is one entry, directly before the overwrite flag", argv[argv.length - 2] === WIN_OUT && argv[argv.length - 1] === "-y");
  check("neither value picked up wrapping quote characters", !argv.some((a) => a.startsWith('"') || a.endsWith('"')));
  check("the path really contains backslashes and spaces (the fixture is what it claims)", WIN_OUT.split("\\").length === 5 && WIN_OUT.includes(" "));

  const region = buildDesktopCaptureArgs({
    platform: "win32",
    region: { x: 10, y: 20, width: 800, height: 600 },
    framerate: 30,
    durationSeconds: 4,
    outPath: WIN_OUT,
  });
  check("a region capture still carries the spaced output path as one entry", region.filter((a) => a === WIN_OUT).length === 1);
  check("region geometry is separate entries, not a joined string", after(region, "-video_size") === "800x600" && after(region, "-offset_x") === "10");

  const windowRegion = buildDesktopCaptureArgs({
    platform: "win32",
    window: TITLE,
    region: { x: 0, y: 0, width: 640, height: 480 },
    framerate: 30,
    durationSeconds: 4,
    outPath: WIN_OUT,
  });
  check("window plus region keeps both the title and the path whole", windowRegion.includes(`title=${TITLE}`) && windowRegion.includes(WIN_OUT));
}

console.log("\n== avfoundation (darwin), x11grab and pipewiregrab (linux): spaced output path ==");
{
  const mac = buildDesktopCaptureArgs({ platform: "darwin", framerate: 30, durationSeconds: 5, outPath: POSIX_OUT });
  check("avfoundation: argv array with the spaced path as one entry", isArgv(mac) && mac.filter((a) => a === POSIX_OUT).length === 1);
  const x11 = buildDesktopCaptureArgs({ platform: "linux", framerate: 30, durationSeconds: 5, outPath: POSIX_OUT, region: { x: 1, y: 2, width: 300, height: 200 } });
  check("x11grab: argv array with the spaced path as one entry", isArgv(x11) && x11.filter((a) => a === POSIX_OUT).length === 1);
  const wl = buildPipewireCaptureArgs({ platform: "linux", displayServer: "wayland", framerate: 30, durationSeconds: 5, outPath: POSIX_OUT });
  check("pipewiregrab: argv array with the spaced path as one entry", isArgv(wl) && wl.filter((a) => a === POSIX_OUT).length === 1);
}

console.log("\n== adb: device paths, local paths and serials ==");
{
  const devicePath = "/sdcard/my screen recording.mp4";
  const localPath = "C:\\Users\\Jane Doe\\captures\\phone demo.mp4";
  const record = buildAdbRecordArgs(devicePath, 12, "emulator-5554");
  check("adb record: argv array, device path is one entry, last", isArgv(record) && record[record.length - 1] === devicePath);
  check("adb record: --time-limit carries the number as its own entry", after(record, "--time-limit") === "12");
  check("adb record: the serial is its own entry after -s", after(record, "-s") === "emulator-5554");
  const pull = buildAdbPullArgs(devicePath, localPath, "emulator-5554");
  check("adb pull: both spaced paths are whole entries, in order", pull[pull.length - 2] === devicePath && pull[pull.length - 1] === localPath);
  const cleanup = buildAdbCleanupArgs(devicePath);
  check("adb cleanup: spaced device path is one entry", isArgv(cleanup) && cleanup[cleanup.length - 1] === devicePath);
  check("adb without a serial adds no -s", !buildAdbRecordArgs(devicePath, 5).includes("-s"));
}

console.log("\n== simctl and remux ==");
{
  const udid = "A1B2C3D4-0000-1111-2222-333344445555";
  const sim = buildSimctlRecordArgs(WIN_OUT, udid);
  check("simctl: argv array, spaced output path is the last entry, whole", isArgv(sim) && sim[sim.length - 1] === WIN_OUT);
  check("simctl: the udid is its own entry after io", after(sim, "io") === udid);
  const rawIn = "C:\\in dir\\raw capture.mp4";
  const finalOut = "C:\\out dir\\final capture.mp4";
  const remux = buildRemuxArgs(rawIn, finalOut);
  check("remux: both spaced paths are whole entries", remux.includes(rawIn) && remux.includes(finalOut));
}

console.log("\n== real children receive spaced arguments intact ==");
{
  const printArgv = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
  const sent = ["a b", WIN_OUT, TITLE, "plain"];

  const viaCapture = await spawnCapture(process.execPath, ["-e", printArgv, "--", ...sent], os.tmpdir());
  check("spawnCapture: a real process gets every spaced argument as one entry", viaCapture.code === 0 && JSON.stringify(JSON.parse(viaCapture.stdout)) === JSON.stringify(sent));

  const viaTimer = await spawnForDuration(process.execPath, ["-e", printArgv, "--", ...sent], os.tmpdir(), 10_000);
  check("spawnForDuration: same guarantee", viaTimer.code === 0 && JSON.stringify(JSON.parse(viaTimer.stdout)) === JSON.stringify(sent));

  if (process.platform === "win32") {
    // The one place spawnCapture goes through cmd.exe (a .cmd shim) is where a space would
    // word-split if the arguments were not quoted for it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs argv shim "));
    const shim = path.join(dir, "print argv.cmd");
    fs.writeFileSync(shim, `@"${process.execPath}" -e "${printArgv}" -- %*\r\n`);
    try {
      const viaShim = await spawnCapture(shim, sent, dir);
      check("spawnCapture through a .cmd shim: spaced arguments stay whole", viaShim.code === 0 && JSON.stringify(JSON.parse(viaShim.stdout)) === JSON.stringify(sent));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } else {
    skip("spawnCapture through a .cmd shim", "the shim path only exists on win32");
  }
}

finish();

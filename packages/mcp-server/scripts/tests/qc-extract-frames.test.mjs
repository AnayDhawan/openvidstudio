#!/usr/bin/env node
// qc-extract-frames: Part 38 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 38: qc_extract_frames -- exact end frames, including the final beat (A6) ==");

const qcFfmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

if (qcFfmpegAvailable) {
  const { runQcExtractFrames } = require(path.join(distDir, "tools", "qcExtractFrames.js"));
  const sharp = require("sharp");

  const qcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-qc-"));
  const qcVideoName = "qctest";
  fs.mkdirSync(path.join(qcRoot, "src", "videos", qcVideoName), { recursive: true });
  fs.mkdirSync(path.join(qcRoot, "output"), { recursive: true });

  // Three 1s (30-frame) beats at 30fps, each a distinct solid color, so a beat's END frame
  // landing on the NEXT beat's first frame (the reported off-by-one) shows up immediately as
  // the wrong color. The FINAL beat ("three") is the headline regression: it has no "next"
  // beat to land on, which is exactly why the old sample-time seek wrote nothing for it.
  const qcFps = 30;
  const qcBeats = [
    { id: "one", start: 0, duration: 30, color: [255, 0, 0], hex: "0xff0000" },
    { id: "two", start: 30, duration: 30, color: [0, 255, 0], hex: "0x00ff00" },
    { id: "three", start: 60, duration: 30, color: [0, 0, 255], hex: "0x0000ff" },
  ];
  fs.writeFileSync(
    path.join(qcRoot, "src", "videos", qcVideoName, "beats.json"),
    JSON.stringify(
      { fps: qcFps, title: "qc frame test", beats: qcBeats.map(({ id, start, duration }) => ({ id, start, duration, visual: {}, vo: "" })) },
      null,
      2,
    ),
  );

  const qcVideoPath = path.join(qcRoot, "output", `${qcVideoName}.mp4`);
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `color=${qcBeats[0].hex}:size=64x64:rate=${qcFps}:duration=1`,
    "-f", "lavfi", "-i", `color=${qcBeats[1].hex}:size=64x64:rate=${qcFps}:duration=1`,
    "-f", "lavfi", "-i", `color=${qcBeats[2].hex}:size=64x64:rate=${qcFps}:duration=1`,
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map", "[v]", "-r", String(qcFps), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
    qcVideoPath,
  ]);

  const qcResult = await runQcExtractFrames({ projectRoot: qcRoot, videoName: qcVideoName });

  check("qc_extract_frames reports no warnings for a clean synthetic render", !qcResult.warnings || qcResult.warnings.length === 0);
  check("qc_extract_frames returned one frame entry per beat", qcResult.frames.length === qcBeats.length);

  async function centerPixel(file) {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const cx = Math.floor(info.width / 2);
    const cy = Math.floor(info.height / 2);
    const idx = (cy * info.width + cx) * info.channels;
    return [data[idx], data[idx + 1], data[idx + 2]];
  }
  const closeEnough = (actual, expected, tol = 28) => actual.every((v, i) => Math.abs(v - expected[i]) <= tol);

  for (const beat of qcBeats) {
    const frame = qcResult.frames.find((f) => f.beatId === beat.id);
    check(`qc_extract_frames returned a frame entry for beat "${beat.id}"`, !!frame);
    if (!frame) continue;

    check(`beat "${beat.id}": end frame extraction reported no error`, !frame.endError);
    check(
      `beat "${beat.id}": end frame is a real, non-empty file`,
      !!frame.endPath && fs.existsSync(frame.endPath) && fs.statSync(frame.endPath).size > 0,
    );
    if (frame.endPath && fs.existsSync(frame.endPath)) {
      const rgb = await centerPixel(frame.endPath);
      check(
        `beat "${beat.id}": end frame shows its OWN color, not the next beat's (rgb=${rgb.join(",")}, expected=${beat.color.join(",")})`,
        closeEnough(rgb, beat.color),
      );
    }

    check(`beat "${beat.id}": mid frame extraction reported no error`, !frame.midError);
    check(
      `beat "${beat.id}": mid frame is a real, non-empty file`,
      !!frame.midPath && fs.existsSync(frame.midPath) && fs.statSync(frame.midPath).size > 0,
    );
    if (frame.midPath && fs.existsSync(frame.midPath)) {
      const rgb = await centerPixel(frame.midPath);
      check(`beat "${beat.id}": mid frame shows its own color too (rgb=${rgb.join(",")})`, closeEnough(rgb, beat.color));
    }
  }

  // The headline regression pin: the LAST beat in the whole composition has no "next beat"
  // to land on if a seek overshoots -- the original bug wrote nothing at all for this one.
  const finalBeat = qcBeats[qcBeats.length - 1];
  const finalFrame = qcResult.frames[qcResult.frames.length - 1];
  check(
    `final beat ("${finalBeat.id}")'s end frame is a real, non-empty file, not a phantom path (the original bug produced nothing here)`,
    finalFrame.beatId === finalBeat.id &&
      !!finalFrame.endPath &&
      fs.existsSync(finalFrame.endPath) &&
      fs.statSync(finalFrame.endPath).size > 0,
  );
} else {
  skip("Part 38: qc_extract_frames end-frame extraction (entire section)", "ffmpeg not found on PATH");
}

finish();

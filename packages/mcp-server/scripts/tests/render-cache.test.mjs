#!/usr/bin/env node
// render-cache: Part 15, Part 33 (split out of the former single manual-test.mjs; see _harness.mjs)

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
// fixture: INIT
const bundledTemplateDir = path.join(packageRoot, "templates", "default");
if (!fs.existsSync(bundledTemplateDir)) {
  console.error(`Bundled template not found at ${bundledTemplateDir}. Run "npm run build" first.`);
  process.exit(1);
}

const { TEMPLATE_DIR } = require(path.join(distDir, "paths.js"));
check("TEMPLATE_DIR points at the bundled copy (not monorepo templates/default)", TEMPLATE_DIR === bundledTemplateDir);
check("TEMPLATE_DIR exists on disk", fs.existsSync(TEMPLATE_DIR));

const bundledFileList = listFilesRecursive(bundledTemplateDir);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-init-test-"));
const backupDir = `${monorepoTemplateDir}.manual-test-bak`;

let initResult;
const monorepoTemplateExisted = false; // only init-project.test.mjs hides the monorepo template; a rename that fails (a watcher holding a handle) would strand it and break every later file
if (!monorepoTemplateExisted) {
  console.log(`  (monorepo templates/default already absent, skipping rename-away step)`);
}
try {
  if (monorepoTemplateExisted) {
    fs.renameSync(monorepoTemplateDir, backupDir);
  }
  // The monorepo-relative path templates/default does NOT exist right now. If
  // init_project's compiled code resolved its template through anything other than
  // TEMPLATE_DIR (packages/mcp-server/templates/default), this call fails.
  delete require.cache[require.resolve(path.join(distDir, "tools", "initProject.js"))];
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  initResult = runInitProject({
    name: "demo",
    projectRoot: tmpRoot,
    hasHiggsfield: true,
    targetDurationSeconds: 45,
  });
} finally {
  if (monorepoTemplateExisted && fs.existsSync(backupDir)) {
    fs.renameSync(backupDir, monorepoTemplateDir);
  }
}

check("init_project succeeded with the monorepo template path unavailable", !!initResult);
check("openvidstudio.config.json written with merged fields", (() => {
  const cfg = JSON.parse(fs.readFileSync(path.join(tmpRoot, "openvidstudio.config.json"), "utf8"));
  return cfg.hasHiggsfield === true && cfg.targetDurationSeconds === 45 && cfg.videoConfig.fps === 30;
})());

// src/Root.tsx is the one deliberate exception (B): init_project seeds preflight's
// benchmark composition into the registry and immediately regenerates Root.tsx from it
// (see initProject.ts), so the scaffolded copy is bigger than the bundled template's bare
// `return null;` starting point by design, not a copy failure.
const EXPECTED_TO_DIFFER = new Set([path.join("src", "Root.tsx")]);
let allBundledFilesCopied = true;
for (const rel of bundledFileList) {
  if (EXPECTED_TO_DIFFER.has(rel)) continue;
  const src = path.join(bundledTemplateDir, rel);
  const dst = path.join(tmpRoot, rel);
  if (!fs.existsSync(dst) || fs.statSync(src).size !== fs.statSync(dst).size) {
    allBundledFilesCopied = false;
    console.log(`  MISMATCH: ${rel}`);
  }
}
check(
  `every file in packages/mcp-server/templates/default (${bundledFileList.length} files, Root.tsx excepted) was copied into the scaffolded project`,
  allBundledFilesCopied,
);
check("src/videos/demo/scenes/ was created", fs.existsSync(path.join(tmpRoot, "src", "videos", "demo", "scenes")));
check(
  "src/Root.tsx was regenerated to register the preflight benchmark composition (B)",
  fs.readFileSync(path.join(tmpRoot, "src", "Root.tsx"), "utf8").includes("PreflightBenchmark"),
);
// fixture: PIPELINE

const beatsJson = {
  fps: 30,
  title: "Manual Test Demo",
  beats: [
    {
      id: "hook",
      start: 0,
      duration: 150,
      vo: "This tool scaffolds a demo video project from a single beats file quickly.",
      visual: { captureMethod: "screenshot", url: "https://example.com/app", interactions: [] },
    },
    {
      id: "explain",
      start: 150,
      duration: 180,
      vo: "Every beat gets its own scene file, ready for a developer to fill in content.",
      visual: { captureMethod: "dom-demo" },
    },
    {
      id: "outro",
      start: 330,
      duration: 120,
      vo: "A quiet establishing shot closes the demo with calm motion.",
      visual: {
        captureMethod: "higgsfield",
        higgsfieldPrompt: "slow drone push over a misty forest canopy at dawn, no text, cinematic",
      },
    },
  ],
};

const { runWriteBeatsFile } = require(path.join(distDir, "tools", "writeBeatsFile.js"));
const writeResult = runWriteBeatsFile({ projectRoot: tmpRoot, videoName: "demo", beatsJson });
check("write_beats_file accepted the 3-beat draft", writeResult.written === true);
check("beats.json written to disk", fs.existsSync(path.join(tmpRoot, "src", "videos", "demo", "beats.json")));

const { runScaffoldScene } = require(path.join(distDir, "tools", "scaffoldScene.js"));
const sceneSpecs = [
  { beatId: "hook", kind: "real-screenshot" },
  { beatId: "explain", kind: "dom-demo" },
  { beatId: "outro", kind: "higgsfield-clip" },
];
for (const spec of sceneSpecs) {
  const res = runScaffoldScene({ projectRoot: tmpRoot, videoName: "demo", beatId: spec.beatId, kind: spec.kind });
  check(`scaffold_scene wrote ${spec.beatId} (${spec.kind})`, res.written === true && fs.existsSync(res.path));
}

// Refusal-without-overwrite check.
let refused = false;
try {
  runScaffoldScene({ projectRoot: tmpRoot, videoName: "demo", beatId: "hook", kind: "real-screenshot" });
} catch (err) {
  refused = /already exists/.test(String(err.message));
}
check("scaffold_scene refuses to clobber an existing scene without overwrite: true", refused);

const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
const stitchResult = runStitchComposition({ projectRoot: tmpRoot, videoName: "demo" });
check("stitch_composition succeeded", stitchResult.written === true);
check("DemoDemo.tsx written", fs.existsSync(path.join(tmpRoot, "src", "videos", "demo", "DemoDemo.tsx")));
check("durationInFrames matches beats.json's last beat", stitchResult.durationInFrames === 450);
check("no VO beats found (no public/audio/vo/*.mp3 exists in this throwaway project)", stitchResult.voBeatsFound.length === 0);
check("no music bed found", stitchResult.musicBedFound === false);

const rootTsx = fs.readFileSync(path.join(tmpRoot, "src", "Root.tsx"), "utf8");
check("Root.tsx registers the DemoDemo composition", rootTsx.includes('id="DemoDemo"') && rootTsx.includes("DemoDemo"));
// fixture: NM
const tempNodeModules = path.join(tmpRoot, "node_modules");
const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
// Link only. The tsc pass over the scaffolded project is scaffold-and-stitch's own check.
let tscOk = false;
if (fs.existsSync(templateNodeModules)) {
  try {
    fs.symlinkSync(templateNodeModules, tempNodeModules, "junction");
    tscOk = true;
  } catch {}
}
setQuiet(false);
// ---- checks ----

console.log("\n== Part 15: per-beat render cache -- pure logic ==");

{
  const cache = require(path.join(distDir, "renderCache.js"));
  const { buildSegmentRenderArgs, buildConcatList, buildConcatArgs, renderKey, hashFile } = cache;

  const seg = buildSegmentRenderArgs("DemoDemo", "output/segments/demo/hook.mp4", 0, 89);
  check("a segment render asks Remotion for exactly that beat's frame range", seg.args.includes("--frames=0-89"));
  // Without this, a beat with no narration renders with no audio stream at all, and the
  // concat demuxer cannot stream-copy a segment that has an audio track together with one
  // that does not. It either fails or silently drops audio for the rest of the file.
  check("...and forces an audio track so every segment has uniform streams", seg.args.includes("--enforce-audio-track"));
  check("...and still asks for verbose logs, since Remotion hides progress off a TTY", seg.args.includes("--log=verbose"));
  const draftSeg = buildSegmentRenderArgs("DemoDemo", "s.mp4", 0, 9, { draft: true, concurrency: 4 });
  check("a draft segment carries the draft flags", draftSeg.args.includes("--scale=0.5") && draftSeg.args.includes("--concurrency=4"));

  check(
    "draft and final never share a cache",
    renderKey({ draft: true, width: 1920, height: 1080, fps: 30 }) !==
      renderKey({ draft: false, width: 1920, height: 1080, fps: 30 }),
  );
  check(
    "a resolution change invalidates the cache",
    renderKey({ draft: false, width: 1920, height: 1080, fps: 30 }) !==
      renderKey({ draft: false, width: 1080, height: 1920, fps: 30 }),
  );

  check(
    "the concat list is in ffmpeg's own format",
    buildConcatList(["hook.mp4", "body.mp4"]) === "file 'hook.mp4'\nfile 'body.mp4'\n",
  );
  // A beat id cannot contain a quote (sanitizeSegment forbids it), but the list writer is
  // the wrong place to rely on that, so it escapes per ffmpeg's rules regardless.
  check("...and escapes a quote the way ffmpeg expects", buildConcatList(["it's.mp4"]).includes("'it'\\''s.mp4'"));
  const concatArgs = buildConcatArgs("concat.txt", "../../demo.mp4");
  check("the concat is a stream copy, never a re-encode", concatArgs.includes("-c") && concatArgs.includes("copy"));
  check("...and writes a seekable moov", concatArgs.includes("+faststart"));
  check("...and allows relative paths in the list", concatArgs.includes("-safe") && concatArgs.includes("0"));

  const missing = hashFile(path.join(tmpRoot, "definitely-not-here.png"));
  check("a missing artifact hashes to a stable sentinel rather than throwing", typeof missing === "string" && missing.length === 64);
}

console.log("\n== Part 33: incremental render's sample-exact audio join (A1) ==");
{
  const rc = require(path.join(distDir, "renderCache.js"));
  const {
    expectedPcmBytes,
    fitPcmLength,
    buildExtractPcmArgs,
    buildIsolateVideoArgs,
    buildVideoOnlyConcatArgs,
    buildFinalMuxArgs,
    buildConcatList,
    pcmFileName,
    videoOnlyFileName,
  } = rc;

  check("expectedPcmBytes: 1s at 30fps, 48kHz stereo s16le is 192000 bytes", expectedPcmBytes(30, 30) === 48000 * 2 * 2);
  const short = Buffer.alloc(100, 7);
  const padded = fitPcmLength(short, 200);
  check(
    "fitPcmLength pads a short buffer with trailing silence",
    padded.length === 200 && padded.subarray(0, 100).equals(short) && padded.subarray(100).every((b) => b === 0),
  );
  const long = Buffer.alloc(300, 9);
  check("fitPcmLength trims a long buffer", fitPcmLength(long, 200).length === 200);

  const ffmpegAvailable = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  if (ffmpegAvailable) {
    const fps = 30;
    const beatFrames = 45; // 1.5s/beat, short enough to keep this test fast
    const beatCount = 16;
    const blipBeatIndex = 8;
    const padSec = 0.052; // matches the drift reported against a real 16-beat render
    const blipOffsetSec = 0.2;
    const blipDurSec = 0.05;

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a1-sync-"));
    const segDir = path.join(testDir, "segments");
    fs.mkdirSync(segDir);
    const beats = Array.from({ length: beatCount }, (_, i) => ({ id: `b${i}`, start: i * beatFrames, duration: beatFrames }));

    for (let i = 0; i < beatCount; i++) {
      const beat = beats[i];
      const videoDurSec = beat.duration / fps;
      // Every segment's own audio deliberately overruns its video by padSec, the same shape
      // as a real per-beat AAC encode's frame-boundary padding -- this is what the old
      // stream-copy concat let accumulate beat over beat.
      const audioDurSec = videoDurSec + padSec;
      const videoFile = path.join(segDir, `${beat.id}.video.mp4`);
      const audioFile = path.join(segDir, `${beat.id}.audio.m4a`);
      const segFile = path.join(segDir, `${beat.id}.mp4`);

      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", `testsrc2=size=320x240:rate=${fps}:duration=${videoDurSec}`,
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoFile,
      ]);

      let audioArgs;
      if (i === blipBeatIndex) {
        // A short, loud blip inside otherwise-silent audio, at a known offset -- stands in
        // for the report's "impact at a known beat boundary" so its arrival time in the
        // final file can be checked against what beats 0..i-1 plus the offset predict.
        const rest = audioDurSec - blipOffsetSec - blipDurSec;
        audioArgs = [
          "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${blipOffsetSec}`,
          "-f", "lavfi", "-i", `sine=f=2000:r=48000:d=${blipDurSec}`,
          "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${rest}`,
          "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[aout]",
          "-map", "[aout]",
        ];
      } else {
        audioArgs = ["-f", "lavfi", "-i", `sine=f=${330 + i * 7}:r=48000:d=${audioDurSec}`];
      }
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...audioArgs, "-c:a", "aac", "-b:a", "128k", audioFile]);
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-i", videoFile, "-i", audioFile,
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", segFile,
      ]);
    }

    // The actual join, calling the exact functions render_video's incremental path calls.
    for (const beat of beats) {
      const segFile = path.join(segDir, `${beat.id}.mp4`);
      const pcmFile = path.join(segDir, pcmFileName(beat.id));
      execFileSync("ffmpeg", buildExtractPcmArgs(segFile, pcmFile));
      fs.writeFileSync(pcmFile, fitPcmLength(fs.readFileSync(pcmFile), expectedPcmBytes(beat.duration, fps)));
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...buildIsolateVideoArgs(segFile, videoOnlyFileName(beat.id))], { cwd: segDir });
    }
    fs.writeFileSync(path.join(segDir, "concat.txt"), buildConcatList(beats.map((b) => videoOnlyFileName(b.id))));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...buildVideoOnlyConcatArgs("concat.txt", "_video-only.mp4")], { cwd: segDir });
    fs.writeFileSync(
      path.join(segDir, "_concat-audio.pcm"),
      Buffer.concat(beats.map((b) => fs.readFileSync(path.join(segDir, pcmFileName(b.id))))),
    );
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...buildFinalMuxArgs("_video-only.mp4", "_concat-audio.pcm", "final.mp4")], {
      cwd: segDir,
    });

    const finalPath = path.join(segDir, "final.mp4");
    const probeDuration = (stream) =>
      parseFloat(
        execFileSync("ffprobe", [
          "-v", "error", "-select_streams", stream,
          "-show_entries", "stream=duration",
          "-of", "default=noprint_wrappers=1:nokey=1",
          finalPath,
        ]).toString().trim(),
      );
    const expectedDur = (beatCount * beatFrames) / fps;
    const videoDur = probeDuration("v:0");
    const audioDur = probeDuration("a:0");
    check(`joined video duration matches frames/fps exactly (${videoDur}s vs expected ${expectedDur}s)`, Math.abs(videoDur - expectedDur) < 0.001);
    check(
      `joined audio duration matches frames/fps exactly, not drifted by 16 segments' encoder padding (${audioDur}s vs expected ${expectedDur}s)`,
      Math.abs(audioDur - expectedDur) < 0.001,
    );

    // Only the blip beat's silence-blip-silence pattern produces silence in an otherwise
    // continuously-toned track, so the first silence_end in the whole file is the blip's start.
    // -30dB, not -20dB: lavfi's sine source sits around -21dB mean RMS, so a -20dB floor would
    // misclassify every beat's own continuous tone as silence too.
    const detect = spawnSync("ffmpeg", ["-i", finalPath, "-af", "silencedetect=n=-30dB:d=0.02", "-f", "null", "-"], { encoding: "utf8" });
    const match = (detect.stderr || "").match(/silence_end: ([\d.]+)/);
    const blipAt = match ? parseFloat(match[1]) : null;
    const expectedBlipAt = beats.slice(0, blipBeatIndex).reduce((sum, b) => sum + b.duration / fps, 0) + blipOffsetSec;
    check(
      `a transient inside beat ${blipBeatIndex} lands within 1 frame of its expected time (got ${blipAt}, expected ${expectedBlipAt.toFixed(4)})`,
      blipAt !== null && Math.abs(blipAt - expectedBlipAt) < 1 / fps,
    );
  } else {
    skip("Part 33: sample-exact audio join E2E", "ffmpeg/ffprobe not available in this environment");
  }
}

finish();

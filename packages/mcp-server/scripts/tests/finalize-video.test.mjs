#!/usr/bin/env node
// finalize-video: Part 56, Part 57 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 56: final assembly, pure logic (C10) ==");
{
  const fin = require(path.join(distDir, "tools", "finalizeVideo.js"));
  const rend = require(path.join(distDir, "tools", "exportRendition.js"));
  const target = { lufs: -14, truePeakDb: -1.5, lra: 11 };

  const sample = 'size= 0kB time=00:00:06.00 speed=100x\n[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-36.52",\n\t"input_tp" : "-27.10",\n\t"input_lra" : "1.90",\n\t"input_thresh" : "-46.80",\n\t"output_i" : "-23.90",\n\t"output_tp" : "-14.50",\n\t"output_lra" : "0.80",\n\t"output_thresh" : "-34.40",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "9.90"\n}\n';
  const m = fin.parseLoudnormJson(sample);
  check("loudnorm's JSON is parsed out of ffmpeg's noisy stderr", m.integratedLufs === -36.52 && m.truePeakDb === -27.1 && m.loudnessRange === 1.9 && m.threshold === -46.8 && m.targetOffset === 9.9);
  let silentError = "";
  try {
    fin.parseLoudnormJson(sample.replace('"-36.52"', '"-inf"'));
  } catch (err) {
    silentError = String(err.message);
  }
  check("a silent track (-inf) is an error, not a number", /silent/.test(silentError));
  const apply = fin.buildLoudnormApplyArgs("in.mp4", "out.mp4", target, m).join(" ");
  check("the second pass is fed the first pass's real measurements", apply.includes("measured_I=-36.52") && apply.includes("measured_TP=-27.1") && apply.includes("measured_thresh=-46.8") && apply.includes("offset=9.9"));
  check("...applies one linear gain rather than dynamic adjustment", apply.includes("linear=true"));
  check("...and copies the video stream untouched", apply.includes("-c:v copy"));
  const cut = fin.buildLoudnormApplyArgs("in.mp4", "out.mp4", target, m, 59.966667);
  check("given the video's length, the apply command cuts the output there, right before the output path", cut.slice(-3).join(" ") === "-t 59.966667 out.mp4");
  check("without a length it adds no cut", !fin.buildLoudnormApplyArgs("in.mp4", "out.mp4", target, m).includes("-t"));
  check("the default target is -14 LUFS with a -1.5 dBTP ceiling", fin.DEFAULT_TARGET_LUFS === -14 && fin.DEFAULT_TRUE_PEAK_DB === -1.5);

  const plan = (over) => rend.planShareEncode({ maxBytes: 10_000_000, durationSec: 60, srcWidth: 1920, srcHeight: 1080, fps: 30, hasAudio: true, ...over });
  const p60 = plan({});
  // 10MB * 0.92 * 8 / 60s = 1226kbps in total, 96 of it audio.
  check("the share bitrate is the cap's budget minus audio, over the duration", p60.videoKbps === 1130);
  check("...and 1130kbps cannot carry 1080p or 720p without blocking, so it steps down to 540p", p60.height === 540 && p60.width === 960 && p60.tight === false);
  check("a shorter clip under the same cap gets a bigger picture", plan({ durationSec: 10 }).height === 1080);
  check("a longer one gets a smaller picture, never a bigger file", plan({ durationSec: 600 }).height < p60.height);
  check("a hopelessly small cap is flagged tight rather than pretending", plan({ maxBytes: 200_000 }).tight === true);
  check("a source with no audio spends nothing on it", plan({ hasAudio: false }).audioKbps === 0);
  check("a retry scale lowers the bitrate", plan({ bitrateScale: 0.8 }).videoKbps < p60.videoKbps);
  check("the picture never exceeds the source", plan({ srcWidth: 640, srcHeight: 360, durationSec: 5 }).height <= 360);

  const passArgs = (pass) => rend.buildSharePassArgs({ inPath: "in.mp4", outPath: "out.mp4", plan: p60, pass, passLog: "log", hasAudio: true });
  check("share is two-pass: pass 1 analyses with no audio and no output file", passArgs(1).includes("-an") && passArgs(1).join(" ").includes("-pass 1") && passArgs(1).join(" ").includes("-f null"));
  check("...pass 2 writes the file with faststart", passArgs(2).join(" ").includes("-pass 2") && passArgs(2).includes("+faststart") && passArgs(2).at(-1) === "out.mp4");

  const stat = (mean, stdev, entropy) => rend.scoreFrameStats({ mean, stdev, entropy });
  check("a detailed frame outscores a black one", stat(110, 70, 7.4) > stat(2, 1, 0.1) * 10);
  check("...and a flat grey one", stat(110, 70, 7.4) > stat(128, 0.5, 0.2) * 10);
  check("a near-black frame is cut to 30% even if it has contrast", Math.abs(stat(10, 60, 6) - stat(100, 60, 6) * 0.3) < 1e-9);
  check("a tie goes to the earlier beat", rend.pickBestScore([{ beatId: "a", score: 3 }, { beatId: "b", score: 3 }]) === "a");
}

console.log("\n== Part 57: final assembly against a real file, measured independently (C10) ==");
{
  const ffOk = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
  if (!ffOk) {
    skip("Part 57: real final assembly", "ffmpeg/ffprobe not available in this environment");
  } else {
    const sharp = require("sharp");
    const { runFinalizeVideo } = require(path.join(distDir, "tools", "finalizeVideo.js"));
    const { runExportRendition } = require(path.join(distDir, "tools", "exportRendition.js"));
    const { runCollectFacts } = require(path.join(distDir, "tools", "collectFacts.js"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c10-"));
    const videoDir = path.join(root, "src", "videos", "c10check");
    fs.mkdirSync(videoDir, { recursive: true });
    fs.mkdirSync(path.join(root, "output"), { recursive: true });
    // Three 2s beats at 30fps: a detailed test pattern, then black, then flat grey. The LAST beat
    // is grey, so the default poster pick is a dud and only a scored pick finds the first one.
    fs.writeFileSync(
      path.join(videoDir, "beats.json"),
      JSON.stringify({
        fps: 30,
        beats: [
          { id: "detail", start: 0, duration: 60 },
          { id: "dark", start: 60, duration: 60 },
          { id: "flat", start: 120, duration: 60 },
        ],
      }),
    );
    const src = path.join(root, "output", "c10check.mp4");
    const gen = spawnSync(
      "ffmpeg",
      [
        "-nostdin", "-y",
        "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=2",
        "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30:d=2",
        "-f", "lavfi", "-i", "color=c=0x808080:s=1280x720:r=30:d=2",
        // Quiet, with a slow tremolo so the loudness is not a trivially constant tone.
        "-f", "lavfi", "-i", "sine=frequency=330:duration=6,volume=0.06,tremolo=f=1.5:d=0.6",
        "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
        "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-t", "6", src,
      ],
      { encoding: "utf8" },
    );
    check("the fixture video was generated by real ffmpeg", gen.status === 0 && fs.existsSync(src));

    // An independent measurement: ffmpeg's ebur128 filter, not the loudnorm one the tool uses.
    const ebur = (file) => {
      const r = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
      const tail = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
      return {
        lufs: Number.parseFloat(/I:\s+(-?[\d.]+) LUFS/.exec(tail)?.[1]),
        peak: Number.parseFloat(/Peak:\s+(-?[\d.]+) dBFS/.exec(tail)?.[1]),
      };
    };
    const probe = (file, entries) =>
      JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "json", file], { encoding: "utf8" }).stdout);

    const beforeLufs = ebur(src).lufs;
    check("the source is quiet, well under the target (so there is something to fix)", beforeLufs < -25);

    const fin = await runFinalizeVideo({ projectRoot: root, videoName: "c10check", shareMaxMB: 0.4 });
    const finalAbs = path.join(root, fin.finalPath);
    check("final_video wrote output/<video>-final.mp4 and kept the original", fs.existsSync(finalAbs) && fs.existsSync(src) && fin.finalPath.endsWith("c10check-final.mp4"));

    const after = ebur(finalAbs);
    console.log(`  loudness: ${beforeLufs} LUFS in, ${after.lufs} LUFS out (ebur128), true peak ${after.peak} dBFS; tool says ${fin.loudness.before.integratedLufs} -> ${fin.loudness.after.integratedLufs}`);
    check("the FINAL file measures within 1 LU of -14 LUFS, by an independent ebur128 measurement", Math.abs(after.lufs - -14) <= 1);
    check("...and its true peak is under the -1.5 dBTP ceiling (to measurement tolerance)", after.peak <= -1.0);
    check("the tool's own 'after' is a re-measurement of the written file and agrees with ebur128", Math.abs(fin.loudness.after.integratedLufs - after.lufs) < 0.5);
    check("the tool's own 'before' agrees with ebur128 on the source", Math.abs(fin.loudness.before.integratedLufs - beforeLufs) < 0.5);
    check("the result reports within-tolerance from that measurement", fin.loudness.withinTolerance === true);
    const vSrc = probe(src, "stream=codec_name,width,height,nb_frames").streams.find((s) => s.codec_name === "h264");
    const vOut = probe(finalAbs, "stream=codec_name,width,height,nb_frames").streams.find((s) => s.codec_name === "h264");
    check("the video stream was copied, not re-encoded (same codec, size and frame count)", vOut && vSrc.width === vOut.width && vSrc.height === vOut.height && vSrc.nb_frames === vOut.nb_frames);

    // loudnorm's lookahead makes its output about 100 ms longer than its input. Left alone, the
    // audio ran three frames past the picture in the finished file, over the one-frame A/V budget.
    const durs = probe(finalAbs, "stream=codec_type,duration").streams;
    const vDur = Number(durs.find((s) => s.codec_type === "video").duration);
    const aDur = Number(durs.find((s) => s.codec_type === "audio").duration);
    check(`audio and video end together in the final file, within one frame (video ${vDur}s, audio ${aDur}s)`, Math.abs(vDur - aDur) <= 1 / 30 + 1e-3);

    // The description is part of the finished video: written on every run, beside the final file.
    check("finalize_video also wrote the description, with credits, and the result points at it", fin.description?.written === true && fs.existsSync(fin.description.path) && /output[\\/]c10check-DESCRIPTION\.md$/.test(fin.description.path) && fs.readFileSync(fin.description.path, "utf8").includes("## Credits"));

    // Poster: a real frame, opened and inspected.
    check("a poster frame was written", fin.poster?.files.length === 1 && fs.existsSync(path.join(root, fin.poster.files[0])));
    check("posterPick auto chose the detailed beat, not the last (flat grey) one", fin.poster.posterPick?.beatId === "detail");
    const posterStats = await sharp(path.join(root, fin.poster.files[0])).greyscale().stats();
    check("the poster is a real picture: 1280x720 with real contrast, not a blank frame", (await sharp(path.join(root, fin.poster.files[0])).metadata()).width === 1280 && posterStats.channels[0].stdev > 30);
    const defaultPoster = await runExportRendition({ projectRoot: root, videoName: "c10check", format: "poster", inPath: fin.finalPath, outPath: path.join("output", "default-poster.jpg"), bake: false });
    const defaultStats = await sharp(path.join(root, defaultPoster.files[0])).greyscale().stats();
    check("omitting posterPick now also defaults to auto: the detailed beat, not the flat one", defaultPoster.posterPick?.beatId === "detail" && defaultStats.channels[0].stdev > 30);
    const lastPoster = await runExportRendition({ projectRoot: root, videoName: "c10check", format: "poster", inPath: fin.finalPath, outPath: path.join("output", "last-poster.jpg"), bake: false, posterPick: "last" });
    const lastStats = await sharp(path.join(root, lastPoster.files[0])).greyscale().stats();
    check("posterPick: \"last\" still opts back into the old behavior: the last beat's frame, which here is flat", lastStats.channels[0].stdev < 5);

    // Share: under its cap, measured from the file on disk.
    const shareAbs = path.join(root, fin.share.share.path);
    const shareBytes = fs.statSync(shareAbs).size;
    const shareProbe = probe(shareAbs, "stream=codec_name,width,height");
    console.log(`  share: ${shareBytes} bytes against a ${fin.share.share.maxBytes} byte cap, ${fin.share.share.width}x${fin.share.share.height}, ${fin.share.share.attempts} attempt(s)`);
    check("the share export is under its size cap, by the file's real size on disk", shareBytes <= 400_000 && fin.share.share.withinCap === true && shareBytes === fin.share.share.bytes);
    check("...with a real playable video and audio stream", shareProbe.streams.some((s) => s.codec_name === "h264") && shareProbe.streams.some((s) => s.codec_name === "aac"));
    check("...and the cap drove the picture size (smaller than the 1280x720 source)", fin.share.share.height < 720);

    // A cap with room to spare keeps the picture bigger: the cap, not a preset, picks the size.
    const roomy = await runExportRendition({ projectRoot: root, videoName: "c10check", format: "share", inPath: fin.finalPath, outPath: path.join("output", "roomy-share.mp4"), maxMB: 5 });
    check("a roomier cap keeps more resolution and is still under it", roomy.share.height === 720 && fs.statSync(path.join(root, roomy.share.path)).size <= 5_000_000);

    // An impossible cap is reported honestly, not claimed.
    const tiny = await runExportRendition({ projectRoot: root, videoName: "c10check", format: "share", inPath: fin.finalPath, outPath: path.join("output", "tiny-share.mp4"), maxMB: 0.01 });
    check("a cap the content cannot meet reports withinCap false and says so", tiny.share.withinCap === false && tiny.notes.join(" ").includes("over the"));

    // The run leaves a record, and collect_facts carries the measured numbers.
    const collected = runCollectFacts({ projectRoot: root, videoName: "c10check" });
    const factsDoc = JSON.parse(fs.readFileSync(collected.factsPath, "utf8"));
    check("collect_facts records the measured final loudness and the poster beat", typeof factsDoc.video.final?.loudness?.afterLufs === "number" && factsDoc.video.final.posterBeat !== null);

    // A silent render has no loudness to fix, and says so.
    const silent = path.join(root, "output", "silent.mp4");
    spawnSync("ffmpeg", ["-nostdin", "-y", "-i", src, "-an", "-c:v", "copy", silent]);
    const finSilent = await runFinalizeVideo({ projectRoot: root, videoName: "c10check", inPath: path.join("output", "silent.mp4"), outPath: path.join("output", "silent-final.mp4"), poster: false, share: false, description: false });
    check("description: false skips the description file", finSilent.description === undefined);
    check("a render with no audio skips loudness and says so", finSilent.loudness === null && finSilent.notes.join(" ").includes("no audio"));

  }
}

finish();

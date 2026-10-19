#!/usr/bin/env node
// fit-beats: fit_beats sizes each beat from the measured voice (#135).
//
// A real voice reads plain prose at about 3 words per second and number-heavy lines at about 2.2, so beats sized
// from word counts overrun or sit half empty. These tests give it provisional beats and a fake narration report
// (the spokenSeconds generate_narration would have measured) and check the result against validate_beats itself.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { require, distDir, check, skip, finish } from "./_harness.mjs";

const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const { runFitBeats, fitFrames } = require(path.join(distDir, "tools", "fitBeats.js"));
const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));

const FPS = 30;
const LINES = {
  hook: "Why does a ball thrown at forty five degrees go the farthest?", // 12 words
  pic: "Now the honest part.", // 4 words
  numbers: "The ball leaves at twenty metres per second, at thirty degrees above level ground.", // 14 words
  long: "Split the velocity into a sideways part and an upward part, and treat each one by itself.", // 17 words
};
const beatsDoc = (durations) => {
  let start = 0;
  return {
    fps: FPS,
    title: "Lesson",
    beats: Object.entries(LINES).map(([id, vo], i) => {
      const beat = { id, start, duration: durations[i], vo, visual: { captureMethod: "dom-demo" } };
      start += durations[i];
      return beat;
    }),
  };
};
function project(doc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-fit-"));
  runInitProject({ name: "lesson", projectRoot: root });
  const file = path.join(root, "src", "videos", "lesson", "beats.json");
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  return { root, file };
}
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const seconds = (b) => b.duration / FPS;

console.log("\n== fitting provisional beats to a measured voice ==");
{
  // Provisional beats sized by word count at 2.6 words per second: 12, 4, 14 and 17 words.
  const provisional = beatsDoc([139, 46, 162, 196]);
  const before = validateBeatsLogic(provisional);
  check("the provisional beats are valid on word counts alone", before.valid);

  // What generate_narration measured: a plain line at 3 w/s, the one-liner quick, the number line slow.
  const report = { written: [
    { beatId: "hook", spokenSeconds: 4.1, language: "en" },
    { beatId: "pic", spokenSeconds: 1.2, language: "en" },
    { beatId: "numbers", spokenSeconds: 5.4, language: "en" },
    { beatId: "long", spokenSeconds: 6.3, language: "en" },
  ] };

  const { root, file } = project(provisional);
  const dry = runFitBeats({ projectRoot: root, videoName: "lesson", narration: report, dryRun: true });
  check("dryRun writes nothing", dry.dryRun === true && dry.written === false && JSON.stringify(read(file)) === JSON.stringify(provisional));
  check("dryRun still returns the proposed durations", dry.beats.length === 4 && dry.beats.every((b) => Number.isInteger(b.after)));

  const result = runFitBeats({ projectRoot: root, videoName: "lesson", narration: report });
  const fitted = read(file);
  console.log(`  fitted frames: ${JSON.stringify(fitted.beats.map((b) => [b.id, b.duration]))}`);
  check("the result was written", result.written === true);
  check("the fitted beats pass validate_beats with no errors (no overrun, no slack)", result.validation.valid === true && validateBeatsLogic(fitted).valid === true);
  check("a one-line beat ends near 1.7 s, not 2.0", Math.abs(seconds(fitted.beats[1]) - 1.7) <= 0.05);
  check("each beat is the spoken length plus the 0.5 s pad where the pace window allows", Math.abs(seconds(fitted.beats[0]) - 4.6) <= 0.05 && Math.abs(seconds(fitted.beats[2]) - 5.9) <= 0.05);
  check("durations are whole frames", fitted.beats.every((b) => Number.isInteger(b.duration) && Number.isInteger(b.start)));
  check("the beats stay contiguous", fitted.beats.every((b, i) => b.start === (i === 0 ? 0 : fitted.beats[i - 1].start + fitted.beats[i - 1].duration)));
  check("vo is never changed", fitted.beats.every((b) => b.vo === LINES[b.id]));
  check("nothing but start and duration changed", fitted.beats.every((b, i) => JSON.stringify({ ...b, start: 0, duration: 0 }) === JSON.stringify({ ...provisional.beats[i], start: 0, duration: 0 })));
  check("the result reports the totals", result.framesBefore === 139 + 46 + 162 + 196 && result.framesAfter === fitted.beats.reduce((n, b) => n + b.duration, 0));
  check("nothing was unfittable", result.unfittable.length === 0);

  const again = runFitBeats({ projectRoot: root, videoName: "lesson", narration: report });
  check("fitting twice changes nothing the second time", again.written === false && again.beats.every((b) => b.status === "unchanged"));
}

console.log("\n== the pace window clamps ==");
{
  // 4 words in 0.6 s of voice: 1.1 s of beat would be 3.6 words/sec, faster than 2.9. Held at words/2.9 = 1.4 s.
  const quick = fitFrames(4, 0.6, FPS, 0.5);
  check("a line quicker than 2.9 words/sec is held at the shortest the window allows", quick.clampedTo === "min" && quick.frames === Math.ceil((4 / 2.9) * FPS) && !quick.overruns);
  // 10 words in 4.2 s of voice would be 4.7 s of beat = 2.1 w/s: held at words/2.3 = 4.33 s.
  const slow = fitFrames(10, 4.2, FPS, 0.5);
  check("a line slower than 2.3 words/sec is held at the longest the window allows", slow.clampedTo === "max" && slow.frames === Math.floor((10 / 2.3) * FPS) && !slow.overruns);
  const over = fitFrames(10, 7.5, FPS, 0.5);
  check("a voice too long for even that is reported as an overrun", over.overruns === true);
}

console.log("\n== a line that cannot fit ==");
{
  const { root, file } = project(beatsDoc([139, 46, 162, 196]));
  // 17 words need 7.6 s of voice: the window ends at 17 / 2.3 = 7.39 s and the voice can only be sped to 6.79 s.
  const spokenSeconds = { hook: 4.1, pic: 1.2, numbers: 6.1, long: 8.4 };
  const result = runFitBeats({ projectRoot: root, videoName: "lesson", spokenSeconds });
  check("the beat is listed as unfittable", result.unfittable.length === 1 && result.unfittable[0].beatId === "long");
  const note = result.unfittable[0]?.note ?? "";
  check("the note says how many words to cut and what to lengthen the beat to", /about \d+ words or fewer/.test(note) && /\d+ frames/.test(note));
  check("it is set to the longest legal length meanwhile, so the rest still lines up", result.unfittable[0].after === Math.floor((17 / 2.3) * FPS));
  check("the other beats are still fitted", result.beats.filter((b) => b.status === "fitted").length >= 2);
  check("the file was written all the same", read(file).beats[3].duration === result.unfittable[0].after);
}

console.log("\n== where the voice length comes from ==");
{
  const { root } = project(beatsDoc([139, 46, 162, 196]));
  const missing = runFitBeats({ projectRoot: root, videoName: "lesson", spokenSeconds: { hook: 4.1 }, dryRun: true });
  check("a beat with no measured voice is skipped and says why", missing.beats.filter((b) => b.status === "skipped").length === 3 && /generate_narration/.test(missing.beats[1].note ?? ""));
  check("a skipped beat keeps its length", missing.beats[1].after === missing.beats[1].before);
  let threw = "";
  try {
    runFitBeats({ projectRoot: root, videoName: "lesson", spokenSeconds: { nope: 3 }, dryRun: true });
  } catch (err) {
    threw = String(err.message);
  }
  check("a spokenSeconds key that is not a beat is refused", /not in beats\.json/.test(threw));

  const silentDoc = { ...beatsDoc([139, 46, 162, 196]), narration: "none" };
  const silent = project(silentDoc);
  const none = runFitBeats({ projectRoot: silent.root, videoName: "lesson", spokenSeconds: { hook: 4.1 }, dryRun: true });
  check("a narration: none project has no voice to fit", none.beats.every((b) => b.status === "skipped"));
}

console.log("\n== reading the voice from the clips on disk ==");
if (spawnSync("ffmpeg", ["-version"]).status !== 0 || spawnSync("ffprobe", ["-version"]).status !== 0) {
  skip("clips on disk", "ffmpeg/ffprobe is not installed");
} else {
  const { root, file } = project(beatsDoc([139, 46, 162, 196]));
  const tone = (out, secs) => spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=300:duration=${secs}`, "-f", "mp3", out, "-y"]);
  const rawDir = path.join(root, ".openvidstudio", "narration");
  fs.mkdirSync(rawDir, { recursive: true });
  tone(path.join(rawDir, "hook.raw"), 4.1);
  const voDir = path.join(root, "public", "audio", "vo");
  fs.mkdirSync(voDir, { recursive: true });
  tone(path.join(voDir, "pic.mp3"), 1.2);
  const result = runFitBeats({ projectRoot: root, videoName: "lesson", dryRun: true });
  const by = Object.fromEntries(result.beats.map((b) => [b.beatId, b]));
  check("the raw clip is measured when nothing is passed in", by.hook.source === "raw-clip" && Math.abs(by.hook.spokenSeconds - 4.1) < 0.1 && Math.abs(by.hook.after - 138) <= 2);
  check("a fitted clip is the fallback, and is said to be an estimate", by.pic.source === "final-clip" && /estimate/.test(by.pic.note ?? ""));
  check("a beat with neither is skipped", by.numbers.status === "skipped");
  check("a passed-in length wins over a clip on disk", runFitBeats({ projectRoot: root, videoName: "lesson", spokenSeconds: { hook: 3.0 }, dryRun: true }).beats[0].source === "report");
  void file;
}

console.log("\n== the beat after a changed one moves ==");
{
  const doc = beatsDoc([139, 46, 162, 196]);
  doc.beats[1].vo = "";
  const { root, file } = project(doc);
  runFitBeats({ projectRoot: root, videoName: "lesson", spokenSeconds: { hook: 4.1, numbers: 6.1, long: 6.3 } });
  const fitted = read(file);
  check("a beat with no vo keeps its length while the ones around it change", fitted.beats[1].duration === 46 && fitted.beats[0].duration !== 139);
  check("and later beats still start where the one before ends", fitted.beats[2].start === fitted.beats[1].start + fitted.beats[1].duration);
}

finish();

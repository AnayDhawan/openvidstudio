#!/usr/bin/env node
// plan_beats: the skeleton planner, including snapToBars (C3), which lands every beat boundary
// on a downbeat of the score so cuts fall on the music.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { require, distDir, check, finish } from "./_harness.mjs";

const { runPlanBeats, snapDurationsToBars } = require(path.join(distDir, "tools", "planBeats.js"));

console.log("\n== snapDurationsToBars: the pure rounding ==");
{
  // 120 bpm at 30 fps: one 4/4 bar is exactly 60 frames.
  const snap = snapDurationsToBars([90, 150, 210], 30, 120, 4);
  check("bar length at 120 bpm / 30 fps is 60 frames", snap.barFrames === 60);
  check("the total moves to the nearest whole bar (450 frames is 7.5 bars, so 8)", snap.totalBars === 8 && snap.totalFrames === 480);
  check("every beat keeps at least one bar and the bars add up to the total", snap.bars.every((b) => b >= 1) && snap.bars.reduce((a, b) => a + b, 0) === 8);
  check("the rounding excess is taken from the beat that was rounded up furthest (first of equals)", snap.bars.join(",") === "1,3,4");
  check("every start is a whole number of bars from zero", snap.starts.every((s) => s % 60 === 0) && snap.starts[0] === 0);
  check("durations are contiguous and sum to the snapped total", snap.durations.reduce((a, b) => a + b, 0) === 480 && snap.starts.every((s, i) => i === 0 || s === snap.starts[i - 1] + snap.durations[i - 1]));

  // A bar that is not a whole number of frames: boundaries are placed at exact bar positions and
  // rounded once, so rounding error never accumulates down the video.
  const odd = snapDurationsToBars([100, 100, 100, 100, 100, 100, 100, 100], 30, 128, 4);
  check("128 bpm / 30 fps gives a 56.25-frame bar", odd.barFrames === 56.25);
  let cum = 0;
  const exact = odd.bars.map((b) => { const s = Math.round(cum * 56.25); cum += b; return s; });
  check("each boundary is round(bars so far x 56.25), not a running sum of rounded lengths", odd.starts.join(",") === exact.join(","));
  check("the end lands on round(total bars x 56.25)", odd.totalFrames === Math.round(odd.totalBars * 56.25));

  // More beats than bars available: every beat still gets a bar, so the total grows to fit.
  const tight = snapDurationsToBars([20, 20, 20, 20, 20], 30, 120, 4);
  check("five beats that total under two bars still get a bar each", tight.bars.join(",") === "1,1,1,1,1" && tight.totalBars === 5);
  check("beatsPerBar changes the bar length (3/4 at 120 bpm is 45 frames)", snapDurationsToBars([90], 30, 120, 3).barFrames === 45);
}

console.log("\n== runPlanBeats with snapToBars ==");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-plan-beats-"));
  const features = ["search", "share"];
  const plain = runPlanBeats({ projectRoot: root, targetDurationSeconds: 60, arc: "simple", features });
  check("without snapToBars nothing changes: the total is exactly the request and there is no bar data", plain.totalFrames === 1800 && plain.snappedToBars === undefined && plain.beats.every((b) => b.startBar === undefined));

  const snapped = runPlanBeats({ projectRoot: root, targetDurationSeconds: 60, arc: "simple", features, snapToBars: { bpm: 112 } });
  const barFrames = (60 / 112) * 4 * 30;
  check("snappedToBars reports the grid used", snapped.snappedToBars?.bpm === 112 && snapped.snappedToBars.beatsPerBar === 4 && Math.abs(snapped.snappedToBars.framesPerBar - barFrames) < 0.001);
  check("every beat reports a startBar and a bar count", snapped.beats.every((b) => Number.isInteger(b.startBar) && Number.isInteger(b.bars) && b.bars >= 1));
  check("every beat starts on the frame of its downbeat", snapped.beats.every((b) => b.start === Math.round(b.startBar * barFrames)));
  check("beats stay contiguous from frame 0 to the snapped total", snapped.beats[0].start === 0 && snapped.beats.every((b, i) => i === 0 || b.start === snapped.beats[i - 1].start + snapped.beats[i - 1].duration) && snapped.beats.at(-1).start + snapped.beats.at(-1).duration === snapped.totalFrames);
  check("the snapped total is within half a bar of the request", Math.abs(snapped.totalFrames - 1800) <= barFrames / 2 + 1);
  check("totalBars matches the bars of the beats", snapped.snappedToBars.totalBars === snapped.beats.reduce((a, b) => a + b.bars, 0));
  check("word budgets follow the snapped durations, not the requested ones", snapped.beats.every((b) => b.wordBudget.min === Math.ceil(2.3 * (b.duration / 30)) && b.wordBudget.max === Math.floor(2.9 * (b.duration / 30))));
  check("a note says the total moved and why", snapped.notes.some((n) => /snapped to bars at 112 bpm/.test(n) && /frames asked for/.test(n)));
  check("totalSeconds is the snapped total", Math.abs(snapped.totalSeconds - snapped.totalFrames / 30) < 0.01);

  let threw = "";
  try { runPlanBeats({ projectRoot: root, targetDurationSeconds: 30, snapToBars: { bpm: 0 } }); } catch (e) { threw = String(e.message); }
  check("a zero bpm is refused with a message", /bpm must be a positive number/.test(threw));
  threw = "";
  try { runPlanBeats({ projectRoot: root, targetDurationSeconds: 30, snapToBars: { bpm: 120, beatsPerBar: 0 } }); } catch (e) { threw = String(e.message); }
  check("zero beats per bar is refused with a message", /beatsPerBar must be a whole number/.test(threw));
}

finish();

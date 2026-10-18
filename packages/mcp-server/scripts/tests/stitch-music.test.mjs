#!/usr/bin/env node
// stitch_composition and the music layer: a hand-picked track survives a re-stitch (#64), the
// default level differs with and without narration (#65), and the bed's cue grid is copied
// next to the composition and handed to scenes through MusicClockProvider (C3's useMusicClock).
//
// Self-contained: it builds throwaway projects with just the files stitch_composition reads, and
// inspects the file it writes. Whether the generated file compiles and renders is covered by
// core-primitives.test.mjs, which renders a composition that uses the clock.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { require, distDir, check, finish } from "./_harness.mjs";

const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));

function makeProject({ narration } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-stitch-music-"));
  const videoDir = path.join(root, "src", "videos", "m");
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(path.join(root, "public", "audio"), { recursive: true });
  fs.writeFileSync(
    path.join(videoDir, "beats.json"),
    JSON.stringify({
      fps: 30,
      ...(narration ? { narration } : {}),
      beats: [
        { id: "hook", start: 0, duration: 120 },
        { id: "payoff", start: 120, duration: 180 },
      ],
    }),
  );
  return { root, videoDir, demo: path.join(videoDir, "MDemo.tsx") };
}
const touchAudio = (root, name) => fs.writeFileSync(path.join(root, "public", "audio", name), "not real audio, stitch only checks existence");
const writeCues = (root, stem, cues) => fs.writeFileSync(path.join(root, "public", "audio", `${stem}.cues.json`), JSON.stringify(cues));
const stitch = (p, musicBed) => runStitchComposition({ projectRoot: p.root, videoName: "m", ...(musicBed ? { musicBed } : {}) });
const demoText = (p) => fs.readFileSync(p.demo, "utf8");

const bedCues = {
  track: "music-bed",
  bpm: 120,
  key: "A",
  beats: [0.5, 1, 1.5, 2],
  strongCues: [0.5, 2.5],
  sections: [
    { label: "intro", startBar: 0, durationBars: 2, startSeconds: 0.5, endSeconds: 4.5 },
    { label: "peak", startBar: 2, durationBars: 4, startSeconds: 4.5, endSeconds: 12.5 },
  ],
  impacts: [{ label: "reveal", atBar: 2, atBeat: 0, atSeconds: 4.5 }],
  lufsIntegrated: -14.1,
  spectrogramPath: "somewhere/else.png",
};

console.log("\n== the music layer: defaults, and which track wins ==");
{
  const p = makeProject();
  touchAudio(p.root, "music-bed.mp3");
  const first = stitch(p);
  check("an auto-detected bed is reported as auto, at the narrated default of 0.18", first.musicBedSource === "auto" && first.musicBedFile === "music-bed.mp3" && first.musicBedVolume === 0.18);
  check("the generated file tags the layer's source so a later stitch can tell it from a pick", demoText(p).includes("ovs-music-source: auto"));

  const noNarration = makeProject({ narration: "none" });
  touchAudio(noNarration.root, "music-bed.mp3");
  const loud = stitch(noNarration);
  check("with narration none the bed defaults to full level, since there is no voice to sit under (#65)", loud.musicBedVolume === 1 && demoText(noNarration).includes("volume={1}"));

  const nothing = makeProject();
  const none = stitch(nothing);
  check("no bed at all is reported as none with no layer written", none.musicBedSource === "none" && none.musicBedFile === null && !demoText(nothing).includes("<Audio src={staticFile(\"audio/m"));
}

console.log("\n== a hand-picked track survives a re-stitch (#64) ==");
{
  const p = makeProject();
  touchAudio(p.root, "music-bed.mp3");
  touchAudio(p.root, "my-track.mp3");
  const picked = stitch(p, { file: "my-track.mp3", volume: 0.4 });
  check("an explicit musicBed is reported as explicit", picked.musicBedSource === "explicit" && picked.musicBedFile === "my-track.mp3" && picked.musicBedVolume === 0.4);

  const again = stitch(p);
  check("re-stitching without musicBed keeps the picked track, not the auto-detected one", again.musicBedFile === "my-track.mp3" && again.musicBedSource === "preserved");
  check("...and the level it was given, not the 0.18 default", again.musicBedVolume === 0.4 && demoText(p).includes("volume={0.4}"));
  check("a preserved layer stays preserved on the stitch after that", stitch(p).musicBedSource === "preserved");

  const override = stitch(p, { file: "music-bed.mp3" });
  check("an explicit musicBed on a later stitch replaces the preserved one", override.musicBedFile === "music-bed.mp3" && override.musicBedSource === "explicit");

  // The preserved file disappears: refuse to silently pretend, fall back, and say so.
  const gone = makeProject();
  touchAudio(gone.root, "music-bed.mp3");
  touchAudio(gone.root, "gone.mp3");
  stitch(gone, { file: "gone.mp3", volume: 0.5 });
  fs.rmSync(path.join(gone.root, "public", "audio", "gone.mp3"));
  const fallback = stitch(gone);
  check("a preserved track that was deleted falls back to auto-detection with a warning that names it", fallback.musicBedFile === "music-bed.mp3" && fallback.warnings.some((w) => w.includes("gone.mp3") && /gone/.test(w)));

  // A layer written by hand into the generated file, with no marker, on a name the tool would never auto-pick.
  const hand = makeProject();
  touchAudio(hand.root, "pulse-bed.mp3");
  touchAudio(hand.root, "custom.mp3");
  stitch(hand);
  fs.writeFileSync(hand.demo, demoText(hand).replace(/<Audio src=\{staticFile\("audio\/pulse-bed.mp3"\)\} volume=\{[0-9.]+\} loop \/>/, '<Audio src={staticFile("audio/custom.mp3")} volume={0.33} loop />').replace("ovs-music-source: auto", "by hand"));
  const kept = stitch(hand);
  check("a hand-edited layer on a non-default file is preserved with its level", kept.musicBedFile === "custom.mp3" && kept.musicBedVolume === 0.33 && kept.musicBedSource === "preserved");
}

console.log("\n== auto-detected beds still upgrade ==");
{
  const p = makeProject();
  touchAudio(p.root, "music-bed.mp3");
  check("first stitch picks music-bed.mp3", stitch(p).musicBedFile === "music-bed.mp3");
  touchAudio(p.root, "pulse-bed.mp3");
  const upgraded = stitch(p);
  check("dropping in pulse-bed.mp3 still wins on the next stitch, because the old pick was only auto", upgraded.musicBedFile === "pulse-bed.mp3" && upgraded.musicBedSource === "auto");
}

console.log("\n== the cue grid reaches scenes (useMusicClock) ==");
{
  const p = makeProject();
  touchAudio(p.root, "music-bed.mp3");
  writeCues(p.root, "music-bed", bedCues);
  const res = stitch(p);
  const copied = path.join(p.videoDir, "music.cues.json");
  check("the cues are copied next to the composition and the result says where", res.musicCuesPath === "src/videos/m/music.cues.json" && fs.existsSync(copied));
  const trimmed = JSON.parse(fs.readFileSync(copied, "utf8"));
  check("the copy carries bpm and the offset of the first downbeat", trimmed.bpm === 120 && trimmed.offsetSeconds === 0.5);
  check("sections and impacts are trimmed to what the clock reads", trimmed.sections.length === 2 && Object.keys(trimmed.sections[0]).sort().join() === "durationBars,label,startBar" && trimmed.impacts[0].label === "reveal" && trimmed.impacts[0].atBar === 2);
  check("loudness figures and file paths from the analysis are not copied", trimmed.lufsIntegrated === undefined && trimmed.spectrogramPath === undefined);
  const demo = demoText(p);
  check("the composition imports the copy and mounts MusicClockProvider around the scenes", demo.includes('import musicCues from "./music.cues.json"') && demo.includes("<MusicClockProvider cues={MUSIC_CUES} beatStarts={BEAT_STARTS}>") && demo.includes("const MUSIC_CUES = musicCues;"));
  check("BEAT_STARTS is built from the beats themselves", demo.includes("Object.fromEntries(beats.beats.map((b) => [b.id, b.start]))"));

  const bare = makeProject();
  touchAudio(bare.root, "music-bed.mp3");
  const noCues = stitch(bare);
  check("a bed with no cues file gives no copy, a null path, and a provider with null cues", noCues.musicCuesPath === null && !fs.existsSync(path.join(bare.videoDir, "music.cues.json")) && demoText(bare).includes("const MUSIC_CUES = null;") && !demoText(bare).includes("music.cues.json"));

  // The bed changes to one without cues: the stale copy must not linger and feed the wrong grid.
  touchAudio(p.root, "other.mp3");
  const switched = stitch(p, { file: "other.mp3" });
  check("switching to a track with no cues removes the stale copy", switched.musicCuesPath === null && !fs.existsSync(copied));

  const junk = makeProject();
  touchAudio(junk.root, "music-bed.mp3");
  fs.writeFileSync(path.join(junk.root, "public", "audio", "music-bed.cues.json"), "{ not json");
  check("an unreadable cues file is treated as no cues rather than crashing the stitch", stitch(junk).musicCuesPath === null);
}

finish();

#!/usr/bin/env node
// evals/acme-launch/score.mjs, held to the standard it holds a video to: run against a project
// built to pass, then against copies broken one check at a time. A check that cannot fail is
// worthless, so each break must fail exactly the check it targets and nothing else.
//
// The good project is made with the real tools (init_project, write_brief, stitch_composition,
// finalize_video), so the scorer reads what a real run leaves behind.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { require, packageRoot, distDir, monorepoRoot, monorepoTemplateDir, check, skip, finish } from "./_harness.mjs";

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
if (!fs.existsSync(templateNodeModules) || !haveFfmpeg) {
  skip("the eval scorer against a built-to-pass project and its breakages", "needs the template's node_modules and ffmpeg");
  finish();
} else {
  const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  const { runWriteBrief } = require(path.join(distDir, "tools", "writeBrief.js"));
  const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
  const { runFinalizeVideo } = require(path.join(distDir, "tools", "finalizeVideo.js"));
  const scorer = path.join(monorepoRoot, "evals", "acme-launch", "score.mjs");
  const VIDEO = "acme-launch";

  console.log("\n== building a project that should pass every automated check ==");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-eval-good-"));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: VIDEO, projectRoot: root });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
  fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");
  const videoDir = path.join(root, "src", "videos", VIDEO);
  const scenesDir = path.join(videoDir, "scenes");
  fs.mkdirSync(scenesDir, { recursive: true });

  const sceneSource = (name, text) =>
    [
      'import React from "react";',
      'import { CinematicScene, E } from "@openvidstudio/core";',
      `export const ${name}: React.FC = () => (`,
      "  <CinematicScene camera={[{ frame: 0, x: 960, y: 540, scale: 1.0 }, { frame: 600, x: 960, y: 540, scale: 1.12, easing: E.drift }]}>",
      `    <div style={{ position: "absolute", left: 300, top: 440, fontSize: 84, color: "#fff" }}>${text}</div>`,
      "  </CinematicScene>",
      ");",
      "",
    ].join("\n");
  const beats = [
    { id: "hook", name: "Hook", text: "The week never ends" },
    { id: "turn", name: "Turn", text: "Then it ships" },
    { id: "payoff", name: "Payoff", text: "Calm tasks for small teams" },
  ];
  for (const b of beats) fs.writeFileSync(path.join(scenesDir, `${b.name}.tsx`), sceneSource(b.name, b.text));
  fs.writeFileSync(
    path.join(videoDir, "beats.json"),
    JSON.stringify({
      fps: 30,
      beats: beats.map((b, i) => ({
        id: b.id,
        start: i * 600,
        duration: 600,
        vo: "x ".repeat(48).trim(),
        // the third beat is the constructed one in the brief, so it claims no capture
        visual: i < 2 ? { captureMethod: "screenshot", url: "http://localhost:4173", interactions: [] } : { captureMethod: "dom-demo" },
      })),
    }),
  );
  fs.writeFileSync(path.join(videoDir, "design.ts"), 'import { defineDesignSystem } from "@openvidstudio/core";\nexport const design = defineDesignSystem({});\n');

  const brief = {
    creativeLevel: "peak",
    logline: "A task board that makes the end of the week feel calm.",
    audience: "Small teams that ship weekly.",
    feeling: "Relief at the end of a long week.",
    storyDevice: { device: "a ticking clock", reason: "the product is about the weekly rhythm." },
    arc: { hook: "The week never ends.", tension: "Tasks pile up.", turn: "One click captures a task.", proof: "The real board, live.", payoff: "The week ends on time.", cta: "Try the board." },
    designSystem: { path: `src/videos/${VIDEO}/design.ts`, paletteRationale: "the brand's calm blues", motif: "rounded-soft", motifRationale: "rounded cards in the product", motionRationale: "slow drift" },
    music: { bpm: 100, key: "A minor", sectionMap: [{ label: "intro", startBar: 1, endBar: 4 }, { label: "peak", startBar: 5, endBar: 12 }], impactPoints: [{ name: "turn", bar: 6, note: "the turn lands" }] },
    shotList: [
      { beatId: "hook", real: true, provenance: "capture of the board", focalPoint: "the backlog" },
      { beatId: "turn", real: true, provenance: "capture of the new task flow", focalPoint: "the new task button" },
      { beatId: "payoff", real: false, provenance: "Acme Tasks, a fictional task board", whyConstructed: "the product is a sample built to be filmed", focalPoint: "the insights card" },
    ],
  };
  runWriteBrief({ projectRoot: root, videoName: VIDEO, briefMarkdown: "# Brief\n\n" + "The story is the end of the week. ".repeat(14), briefJson: brief });

  fs.mkdirSync(path.join(root, "public", "images"), { recursive: true });
  for (const n of ["hook", "turn"]) {
    await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 30, g: 60, b: 120 } } }).png().toFile(path.join(root, "public", "images", `${n}.png`));
  }
  fs.mkdirSync(path.join(root, "public", "audio"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "audio", "music-bed.cues.json"), JSON.stringify({ source: "generated", bpm: 100, sections: [{ label: "intro", startBar: 0, durationBars: 4 }], impacts: [{ label: "turn", atBar: 6 }] }));
  fs.writeFileSync(path.join(videoDir, "facts.json"), JSON.stringify({ schemaVersion: 1, videoName: VIDEO, recordsUsed: 6, beats: { hook: { provenance: "capture" }, turn: { provenance: "capture" }, payoff: { provenance: "construction" } } }));

  // A 60 s render stand-in: video plus audio, the real finalize_video then normalises it, writes the
  // poster and share copy, and writes the description (chapters, credits, sample disclosure).
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  const made = spawnSync("ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=60", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=60", "-af", "volume=0.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(root, "output", `${VIDEO}.mp4`)]);
  check("a 60 second stand-in render was made", made.status === 0);
  const fin = await runFinalizeVideo({ projectRoot: root, videoName: VIDEO, shareMaxMB: 2 });
  check("finalize_video produced the final file, a poster, a share copy and the description", !!fin.poster && !!fin.share && !!fin.description?.written);

  for (const round of [1, 2]) {
    const dir = path.join(root, "output", "stills", VIDEO, `round-${round}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "contact-grid.png"), "grid");
  }
  runStitchComposition({ projectRoot: root, videoName: VIDEO });

  const score = (dir, extra = []) => {
    const r = spawnSync(process.execPath, [scorer, dir, VIDEO, "--json", ...extra], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    let parsed = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      /* reported by the check that reads it */
    }
    return { status: r.status, parsed, stderr: r.stderr };
  };
  const failing = (s) => (s.parsed?.results ?? []).filter((x) => x.pass === false).map((x) => x.id).sort();

  console.log("\n== the scorer on the good project (this one does the real render-mode validation) ==");
  const good = score(root, ["--wall-minutes", "40", "--estimate-minutes", "35"]);
  console.log(`  failing: ${JSON.stringify(failing(good))}${good.parsed ? "" : `  stderr: ${good.stderr.slice(0, 300)}`}`);
  for (const r of (good.parsed?.results ?? []).filter((x) => x.pass === false)) console.log(`    ${r.id}: ${r.label} [${r.detail}]`);
  check("every automated check passes on the good project, and the exit code is 0", good.status === 0 && failing(good).length === 0 && good.parsed.passed >= 25);
  check("the render-mode gate really ran: validate_scenes measured all three beats", good.parsed.results.find((r) => r.id === "G2b")?.detail.startsWith("3 measured, 0 skipped"));
  check("the loudness gate measured the finalized file at about -14 LUFS", /^-1[34]/.test(good.parsed.results.find((r) => r.id === "G7")?.detail ?? ""));

  console.log("\n== the scorer on copies broken one check at a time ==");
  const copyOf = () => {
    const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-eval-bad-"));
    fs.cpSync(root, dst, { recursive: true, filter: (src) => path.basename(src) !== "node_modules" });
    return dst;
  };
  const cases = [
    ["no description file", (d) => fs.rmSync(path.join(d, "output", `${VIDEO}-DESCRIPTION.md`)), [], ["G10", "T2"]],
    ["an em dash in brief.md", (d) => fs.appendFileSync(path.join(d, "src", "videos", VIDEO, "brief.md"), "\nA clause \u2014 with a dash.\n"), [], ["T3"]],
    ["a template scene", (d) => fs.appendFileSync(path.join(d, "src", "videos", VIDEO, "scenes", "Hook.tsx"), '\n// Scene for beat "hook", generated by scaffold_scene from the "title" template.\n'), [], ["T6"]],
    ["facts.json missing", (d) => fs.rmSync(path.join(d, "src", "videos", VIDEO, "facts.json")), [], ["T5"]],
    ["a number typed into a scene", (d) => fs.appendFileSync(path.join(d, "src", "videos", VIDEO, "scenes", "Turn.tsx"), "\nconst extra = <div>Ships 32 tools</div>;\n"), [], ["T4"]],
    ["no score cues", (d) => fs.rmSync(path.join(d, "public", "audio", "music-bed.cues.json")), [], ["G12"]],
    ["only one review round", (d) => fs.rmSync(path.join(d, "output", "stills", VIDEO, "round-2"), { recursive: true }), [], ["G11"]],
    ["no design.ts", (d) => fs.rmSync(path.join(d, "src", "videos", VIDEO, "design.ts")), [], ["G13"]],
    ["no brief", (d) => fs.rmSync(path.join(d, "src", "videos", VIDEO, "brief.json")), [], ["T1"]],
    ["no final video", (d) => fs.rmSync(path.join(d, "output", `${VIDEO}-final.mp4`)), [], ["G3"]],
    [
      "a final video far too loud",
      (d) => {
        const f = path.join(d, "output", `${VIDEO}-final.mp4`);
        const loud = path.join(d, "output", "loud.mp4");
        spawnSync("ffmpeg", ["-nostdin", "-y", "-i", f, "-af", "volume=12dB", "-c:v", "copy", "-c:a", "aac", loud]);
        fs.renameSync(loud, f);
      },
      [],
      ["G7", "G8"], // far too loud is also over the true-peak ceiling
    ],
    [
      "a final video half the target length",
      (d) => {
        const f = path.join(d, "output", `${VIDEO}-final.mp4`);
        const half = path.join(d, "output", "half.mp4");
        spawnSync("ffmpeg", ["-nostdin", "-y", "-i", f, "-t", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", half]);
        fs.renameSync(half, f);
      },
      [],
      ["G4"],
    ],
    ["wall time over the budget", () => {}, ["--wall-minutes", "75", "--estimate-minutes", "70"], ["W1"]],
    ["wall time far over the estimate", () => {}, ["--wall-minutes", "50", "--estimate-minutes", "20"], ["W2"]],
  ];
  for (const [label, mutate, extra, expected] of cases) {
    const dir = copyOf();
    mutate(dir);
    const s = score(dir, ["--no-render", ...(extra.length ? extra : ["--wall-minutes", "40", "--estimate-minutes", "35"])]);
    const got = failing(s);
    check(`${label}: fails exactly ${expected.join(", ")}${got.join() === [...expected].sort().join() ? "" : ` (got ${got.join(", ") || "nothing"})`}`, s.status === 1 && got.join() === [...expected].sort().join());
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const noFlag = score(copyOf(), ["--no-render"]);
  check("without --wall-minutes the time check is n/a, not a pass or a fail", noFlag.parsed.results.find((r) => r.id === "W1")?.pass === null);
  finish();
}

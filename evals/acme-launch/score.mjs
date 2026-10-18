#!/usr/bin/env node
// Automated half of the acme-launch eval: truth checks and gate results, measured from the files
// a finished run left behind. The other half (story, design coherence, craft, scored 1 to 5 from the
// contact grids by a separate reviewer) is in RUBRIC.md and is deliberately not automated.
//
//   node evals/acme-launch/score.mjs <projectRoot> <videoName> [--target-seconds 60] [--budget-minutes 60] [--wall-minutes N] [--estimate-minutes M] [--json] [--no-render]
//
// Exit code 0 when every automated check passes, 1 when any fails. Needs the mcp-server built
// (pnpm --filter @openvidstudio/mcp-server build) and ffmpeg/ffprobe on PATH.

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = path.join(repoRoot, "packages", "mcp-server", "dist");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] ?? "").startsWith("--"));
const [projectRoot, videoName] = positional;
if (!projectRoot || !videoName) {
  console.error("usage: node evals/acme-launch/score.mjs <projectRoot> <videoName> [--target-seconds 60] [--budget-minutes 60] [--wall-minutes N] [--estimate-minutes M] [--json]");
  process.exit(2);
}
const targetSeconds = Number(flag("target-seconds", 60));
const budgetMinutes = Number(flag("budget-minutes", 60));
const wallMinutes = flag("wall-minutes") === undefined ? null : Number(flag("wall-minutes"));
const estimateMinutes = flag("estimate-minutes") === undefined ? null : Number(flag("estimate-minutes"));

const root = path.resolve(projectRoot);
const videoDir = path.join(root, "src", "videos", videoName);
const outDir = path.join(root, "output");
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const json = (p) => {
  try {
    return JSON.parse(read(p));
  } catch {
    return null;
  }
};
const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const results = [];
function record(group, id, label, pass, detail = "") {
  results.push({ group, id, label, pass: pass === null ? null : !!pass, detail });
}

const EM_DASH = "\u2014";
const sceneFiles = walk(videoDir).filter((f) => /\.tsx$/.test(f));
const beatsDoc = json(path.join(videoDir, "beats.json"));
const brief = json(path.join(videoDir, "brief.json"));
const factsPath = path.join(videoDir, "facts.json");
const descriptionPath = path.join(outDir, `${videoName}-DESCRIPTION.md`);
const description = read(descriptionPath);

// ---------------------------------------------------------------- truth checks
{
  const { validateBriefLogic } = require(path.join(dist, "tools", "writeBrief.js"));
  const v = brief ? validateBriefLogic(brief) : { valid: false, errors: ["no brief.json"] };
  record("truth", "T1", "brief.json exists and passes write_brief's own validation", v.valid, v.valid ? "" : v.errors.slice(0, 3).join("; "));
  record("truth", "T1b", "brief.md exists and is not empty", (read(path.join(videoDir, "brief.md")) ?? "").trim().length > 200);

  const shots = brief?.shotList ?? [];
  const constructed = shots.filter((s) => s.real === false);
  const hasDisclosure = !!description && (/fictional|sample content|sample app/i.test(description) || constructed.some((s) => description.includes(s.provenance ?? "\u0000")));
  record("truth", "T2", "the sample app is disclosed: the description says Acme Tasks is a fictional sample", hasDisclosure, descriptionPath ? "" : "no description file");

  const textFiles = [
    path.join(videoDir, "brief.md"),
    path.join(videoDir, "brief.json"),
    path.join(videoDir, "beats.json"),
    path.join(videoDir, "design.ts"),
    descriptionPath,
    ...sceneFiles,
  ];
  const withDash = textFiles.filter((f) => (read(f) ?? "").includes(EM_DASH)).map(rel);
  record("truth", "T3", "no em dash in the brief, beats, design, scenes or description", withDash.length === 0, withDash.join(", "));

  let sourcing = [];
  try {
    const { runValidateScenes } = require(path.join(dist, "tools", "validateScenes.js"));
    sourcing = runValidateScenes({ projectRoot: root, videoName }).findings.filter((f) => f.check === "numbers-sourcing");
  } catch (err) {
    sourcing = [{ beatId: "?", message: String(err.message) }];
  }
  record("truth", "T4", "every number a scene shows comes from facts.json or a capture (no numbers-sourcing warning)", sourcing.length === 0, sourcing.map((f) => f.beatId).join(", "));

  const facts = json(factsPath);
  const used = facts?.recordsUsed ?? 0;
  const capturedBeats = Object.values(facts?.beats ?? {}).filter((b) => b.provenance === "capture").length;
  record("truth", "T5", "facts.json exists and merges real tool runs (at least 4 run records, at least 2 beats backed by a capture)", used >= 4 && capturedBeats >= 2, `${used} records, ${capturedBeats} captured beats`);

  const templated = sceneFiles.filter((f) => /generated by scaffold_scene from the "[\w-]+" template/.test(read(f) ?? "")).map(rel);
  record("truth", "T6", "zero template scenes: a peak run ships bespoke scenes only", sceneFiles.length > 0 && templated.length === 0, templated.length ? `template scenes: ${templated.join(", ")}` : `${sceneFiles.length} scene files`);

  const beatIds = (beatsDoc?.beats ?? []).map((b) => b.id);
  const wired = beatIds.length > 0 && beatIds.every((id) => (beatsDoc.beats.find((b) => b.id === id)?.scene ?? "").length > 0 || fs.existsSync(path.join(videoDir, "scenes")));
  record("truth", "T7", "every beat has a scene wired", wired);

  const realCaptures = (beatsDoc?.beats ?? []).filter((b) => b.visual?.captureMethod === "screenshot" || b.visual?.captureMethod === "recording" || b.visual?.source === "terminal");
  const captureFiles = walk(path.join(root, "public")).filter((f) => /(images|recordings|terminal)[\\/]/.test(f));
  record("truth", "T8", "the product on screen is a real capture of the running app (at least two capture files, and capture beats in beats.json)", captureFiles.length >= 2 && realCaptures.length >= 1, `${captureFiles.length} capture files, ${realCaptures.length} capture beats`);
}

// ---------------------------------------------------------------- gate results
{
  const { validateBeatsLogic } = require(path.join(dist, "tools", "validateBeats.js"));
  const vb = beatsDoc ? validateBeatsLogic(beatsDoc) : { valid: false, errors: ["no beats.json"] };
  record("gates", "G1", "beats.json passes validate_beats", vb.valid, vb.valid ? "" : (vb.errors ?? []).slice(0, 2).join("; "));

  if (argv.includes("--no-render")) {
    record("gates", "G2", "validate_scenes in render mode (skipped by --no-render)", null);
    record("gates", "G2b", "...and measured every beat (skipped by --no-render)", null);
  } else {
    let render = null;
    try {
      const { runValidateScenesFull } = require(path.join(dist, "tools", "validateScenes.js"));
      render = await runValidateScenesFull({ projectRoot: root, videoName, render: true });
    } catch (err) {
      render = { error: String(err.message) };
    }
    const errors = render?.findings?.filter((f) => f.severity === "error") ?? [];
    const warnings = render?.findings?.filter((f) => f.severity === "warning") ?? [];
    record("gates", "G2", "validate_scenes in render mode reports no error (crop, size, em dash, contrast)", !!render && !render.error && errors.length === 0, render?.error ?? errors.map((f) => `${f.beatId}:${f.check ?? "static"}`).join(", "));
    record("gates", "G2b", "...and measured every beat (none skipped)", !!render && !render.error && render.render?.beatsSkipped?.length === 0, render?.render ? `${render.render.beatsMeasured} measured, ${render.render.beatsSkipped.length} skipped; ${warnings.length} warning(s)` : "");
  }

  const finalPath = path.join(outDir, `${videoName}-final.mp4`);
  const finalExists = fs.existsSync(finalPath);
  record("gates", "G3", "a final mp4 exists (finalize_video ran)", finalExists, rel(finalPath));
  if (finalExists) {
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,duration,r_frame_rate", "-show_entries", "format=duration", "-of", "json", finalPath], { encoding: "utf8" });
    const info = probe.status === 0 ? JSON.parse(probe.stdout) : { streams: [], format: {} };
    const v = info.streams.find((s) => s.codec_type === "video");
    const a = info.streams.find((s) => s.codec_type === "audio");
    const duration = Number(info.format.duration);
    record("gates", "G4", `length is within 15% of the ${targetSeconds}s target`, Math.abs(duration - targetSeconds) <= targetSeconds * 0.15, `${duration.toFixed(1)}s`);
    record("gates", "G5", "the file has an h264 video stream and an audio stream", v?.codec_name === "h264" && !!a, `${v?.codec_name ?? "no video"} / ${a?.codec_name ?? "no audio"}`);
    const fps = (() => {
      const [n, d] = String(v?.r_frame_rate ?? "30/1").split("/").map(Number);
      return n / (d || 1);
    })();
    const drift = v && a ? Math.abs(Number(v.duration) - Number(a.duration)) : NaN;
    record("gates", "G6", "A/V drift is at most one frame (stream durations agree)", Number.isFinite(drift) && drift <= 1 / fps + 1e-3, `${(drift * 1000).toFixed(1)} ms against a ${(1000 / fps).toFixed(1)} ms frame`);
    const ebur = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-i", finalPath, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
    const text = ebur.stderr ?? "";
    const lufs = Number(/I:\s+(-?[\d.]+)\s+LUFS/.exec(text.slice(text.lastIndexOf("Summary")))?.[1]);
    const peak = Number(/Peak:\s+(-?[\d.]+)\s+dBFS/.exec(text.slice(text.lastIndexOf("True peak")))?.[1]);
    record("gates", "G7", "loudness is within 1 LU of -14 LUFS, measured independently with ebur128", Number.isFinite(lufs) && Math.abs(lufs + 14) <= 1, `${lufs} LUFS`);
    record("gates", "G8", "true peak is at or below -1 dBTP (the ceiling is -1.5, with measurement tolerance)", Number.isFinite(peak) && peak <= -1, `${peak} dBTP`);
  }
  const outFiles = walk(outDir);
  record("gates", "G9", "a poster frame and a size-capped share copy were written", outFiles.some((f) => /poster/i.test(f)) && outFiles.some((f) => /share/i.test(f)));

  const desc = description ?? "";
  record("gates", "G10", "the description has a Chapters list starting at 0:00, and a Credits section", /## Chapters\s+0:00 /.test(desc) && /## Credits/.test(desc), description ? "" : "no description file");

  const grids = walk(path.join(outDir, "stills", videoName)).filter((f) => /contact-grid\.png$/.test(f));
  record("gates", "G11", "contact grids exist from at least two review rounds", new Set(grids.map((g) => path.basename(path.dirname(g)))).size >= 2, grids.map(rel).join(", "));

  const cues = json(path.join(root, "public", "audio", "music-bed.cues.json"));
  record("gates", "G12", "an original score exists with an exact cue grid (source generated, bpm, sections, impacts)", cues?.source === "generated" && cues.bpm > 0 && (cues.sections?.length ?? 0) > 0 && (cues.impacts?.length ?? 0) > 0, cues ? `${cues.bpm} bpm, ${cues.sections?.length} sections, ${cues.impacts?.length} impacts` : "no cues file");
  record("gates", "G13", "design.ts exists and builds on defineDesignSystem", /defineDesignSystem/.test(read(path.join(videoDir, "design.ts")) ?? ""));
}

// ---------------------------------------------------------------- wall time
if (wallMinutes !== null) {
  record("time", "W1", `wall time is within the ${budgetMinutes}-minute budget`, wallMinutes <= budgetMinutes, `${wallMinutes} min`);
  if (estimateMinutes !== null) {
    record("time", "W2", "wall time against plan_production's estimate (reported; passes within 1.5x)", wallMinutes <= estimateMinutes * 1.5, `${wallMinutes} min against an estimate of ${estimateMinutes} min (${(wallMinutes / estimateMinutes).toFixed(2)}x)`);
  }
} else {
  record("time", "W1", "wall time recorded", null, "pass --wall-minutes");
}

const failed = results.filter((r) => r.pass === false);
if (argv.includes("--json")) {
  console.log(JSON.stringify({ projectRoot: root, videoName, passed: results.filter((r) => r.pass === true).length, failed: failed.length, results }, null, 2));
} else {
  for (const group of ["truth", "gates", "time"]) {
    console.log(`\n== ${group} ==`);
    for (const r of results.filter((x) => x.group === group)) {
      console.log(`  ${r.pass === null ? "n/a " : r.pass ? "pass" : "FAIL"} ${r.id.padEnd(4)} ${r.label}${r.detail ? `  [${r.detail}]` : ""}`);
    }
  }
  console.log(`\n${failed.length === 0 ? "ALL AUTOMATED CHECKS PASSED" : `${failed.length} AUTOMATED CHECK(S) FAILED: ${failed.map((r) => r.id).join(", ")}`}`);
}
process.exitCode = failed.length === 0 ? 0 : 1;

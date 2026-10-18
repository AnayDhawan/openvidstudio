#!/usr/bin/env node
// supernova-skill: the skill and SUPERNOVA.md are true (#116). Every tool the skill names exists in the
// registry; the concept card and the example script in SUPERNOVA.md are real (the script passes
// check_script); the skill is mirrored to the other tool directories; and the steps work in order on a
// real project, from init_project to a validate_scenes render with no errors (the voice step needs the
// network and is left out here: narration is "none").

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { require, distDir, monorepoRoot, monorepoTemplateDir, check, skip, finish } from "./_harness.mjs";

const read = (...p) => fs.readFileSync(path.join(monorepoRoot, ...p), "utf8").replace(/\r\n/g, "\n");
const skill = read(".claude", "skills", "supernova", "SKILL.md");
const doc = read("packages", "docs", "SUPERNOVA.md");
const { createMcpServer } = require(path.join(distDir, "server.js"));
const registered = new Set(Object.keys(createMcpServer({ hasHiggsfield: true, targetDurationSeconds: 60, videoConfig: { fps: 30, width: 1080, height: 1920 }, capture: { appUrl: "http://localhost:3000", width: 1440, height: 900, settleMs: 1200 }, narration: { engine: "edge-tts", voice: "en-US-AndrewNeural" } })._registeredTools));

console.log("\n== the skill names only tools that exist ==");
{
  const named = [...new Set([...skill.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]))];
  console.log(`  ${named.length} tool-shaped names: ${named.join(", ")}`);
  const missing = named.filter((n) => !registered.has(n));
  check("every snake_case name in the skill is a registered tool", named.length >= 12 && missing.length === 0);
  if (missing.length) console.log(`  not registered: ${missing.join(", ")}`);
  const core = ["init_project", "preflight", "plan_production", "plan_beats", "validate_beats", "check_script", "write_beats_file", "generate_narration", "scaffold_scene", "compose_score", "stitch_composition", "validate_scenes", "render_stills", "contact_sheet", "render_video", "finalize_video", "write_description"];
  check("the steps cover the whole path, from init_project to write_description", core.filter((t) => t !== "preflight").every((t) => named.includes(t)) && skill.includes("`preflight`") && registered.has("preflight"));
  check("control: a made-up tool name would be caught by the same check", ["render_everything"].every((n) => !registered.has(n)));
  const stemNames = ["Spark", "Nova", "Axes", "Plot", "NumberLine", "Equation", "FreeBody", "ArrayViz", "supernovaDesignSystem"];
  const stemIndex = read("packages", "stem", "src", "index.ts");
  check("every primitive the skill names is exported by @openvidstudio/stem", stemNames.every((n) => skill.includes(n) && new RegExp(`\\b${n}\\b`).test(stemIndex)));
  check("the skill's front matter names it supernova and says when to use it", /^---\nname: supernova\ndescription: Use when/.test(skill));
  check("the skill is mirrored to all five tool directories (sync-skills --check)", [".agents", ".cursor", ".github", ".opencode", ".windsurf"].every((d) => read(d, "skills", "supernova", "SKILL.md") === skill));
}

console.log("\n== SUPERNOVA.md's concept card and example script are real ==");
const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));
const cards = jsonBlocks.filter((j) => typeof j.goal === "string" && Array.isArray(j.terms) && typeof j.example === "string");
check("the doc carries two concept cards that parse, a template and the projectile example", cards.length === 2);
const projectile = cards.find((c) => /projectile/.test(c.terms.join(" ")));
const rows = [...doc.matchAll(/^\| (hook|picture|split|numbers|aha|check) \| (.+) \|$/gm)].map((m) => ({ id: m[1], vo: m[2] }));
check("the example script has its six beats", rows.length === 6);
const { checkScriptLogic } = require(path.join(distDir, "tools", "checkScript.js"));
const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));
const FPS = 30;
let start = 0;
const beats = rows.map((r) => {
  const words = r.vo.trim().split(/\s+/).length;
  const duration = Math.round((words / 2.6) * FPS);
  const b = { id: r.id, start, duration, vo: r.vo, visual: { captureMethod: "dom-demo" } };
  start += duration;
  return b;
});
const beatsFile = { fps: FPS, narration: "voice", production: { mode: "supernova" }, beats };
{
  const script = checkScriptLogic(beatsFile, projectile, () => null);
  console.log(`  check_script on the example: ${script.findings.length} findings ${JSON.stringify(script.findings.map((f) => `${f.check}@${f.beatId}:${f.severity}`))}`);
  check("the example script passes check_script with no errors", script.ok === true && script.findings.filter((f) => f.severity === "error").length === 0);
  check("...and with no warnings either", script.findings.filter((f) => f.severity === "warning").length === 0);
  const valid = validateBeatsLogic(beatsFile);
  check("the example script's beats pass validate_beats at 2.6 words a second", valid.valid === true);
  check("its numbers are the card's worked example (20, 45, 10, 40)", ["20", "45", "10", "40"].every((n) => rows.map((r) => r.vo).join(" ").includes(n)) && ["20", "45", "10", "40"].every((n) => projectile.example.includes(n)));
}

console.log("\n== the steps work in order on a real project ==");
if (!fs.existsSync(path.join(monorepoTemplateDir, "node_modules"))) {
  skip("the steps in order", "no resolvable node_modules to scaffold a renderable project from");
} else {
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  const { runWriteBeatsFile } = require(path.join(distDir, "tools", "writeBeatsFile.js"));
  const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
  const { runValidateScenesFull } = require(path.join(distDir, "tools", "validateScenes.js"));
  const { runCheckScript } = require(path.join(distDir, "tools", "checkScript.js"));
  const { runWriteDescription } = require(path.join(distDir, "tools", "writeDescription.js"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-supernova-skill-"));
  for (let attempt = 1; ; attempt++) {
    try { runInitProject({ name: "projectile", projectRoot: root, mode: "supernova" }); break; } catch (err) { if (attempt >= 3) throw err; fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true }); }
  }
  fs.symlinkSync(path.join(monorepoTemplateDir, "node_modules"), path.join(root, "node_modules"), "junction");
  const videoDir = path.join(root, "src", "videos", "projectile");
  fs.writeFileSync(path.join(videoDir, "concept.json"), JSON.stringify(projectile, null, 2));
  const written = runWriteBeatsFile({ projectRoot: root, videoName: "projectile", beatsJson: beatsFile });
  check("step 3: write_beats_file accepts the approved script", written.written === true);
  // Scenes written by hand from the stem primitives, as step 5 says. The Equation's spoken form is in its beat's narration.
  const scene = (name, body) => `import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Axes, Plot, Equation, Spark, Nova, supernovaDesignSystem, fall } from "@openvidstudio/stem";
export const ${name}: React.FC = () => {
  const { width, height } = useVideoConfig();
  const design = supernovaDesignSystem("physics");
  return (
    <AbsoluteFill style={{ background: design.color.bg0 }}>
${body}
    </AbsoluteFill>
  );
};
`;
  const dir = path.join(videoDir, "scenes");
  fs.mkdirSync(dir, { recursive: true });
  const w = {
    Hook: `      <Spark subject="physics" path={fall(0.9, { x: width * 0.15, y: height * 0.55, vx: 9, vy: -24 })} />`,
    Picture: `      <Spark subject="physics" path={fall(0.9, { x: width * 0.15, y: height * 0.55, vx: 9, vy: -24 })} />`,
    Split: `      <Axes box={{ x: 130, y: 700, width: 820, height: 500 }} xRange={[0, 48]} yRange={[0, 14]} subject="physics"><Plot fn={(x) => x - (x * x) / 40} domain={[0, 40]} /></Axes>`,
    Numbers: `      <Equation tex={String.raw\`v = 20\\ \\mathrm{m/s}\`} spoken="v equals twenty metres a second" size={90} />`,
    Aha: `      <Nova at={10} duration={40} subject="physics"><div style={{ position: "absolute", left: 140, top: 900, width: 800, height: 120, background: "#FFB347" }} /></Nova>`,
    Check: `      <Spark subject="physics" path={fall(0.9, { x: width * 0.15, y: height * 0.55, vx: 9, vy: -24 })} />`,
  };
  for (const [name, body] of Object.entries(w)) fs.writeFileSync(path.join(dir, `${name}.tsx`), scene(name, body));
  const stitched = runStitchComposition({ projectRoot: root, videoName: "projectile" });
  check("step 5: stitch_composition wires the scenes", stitched.written === true);
  const script = runCheckScript({ projectRoot: root, videoName: "projectile" });
  const spoken = script.findings.filter((f) => f.check === "spoken");
  console.log(`  check_script with scenes on disk: ${JSON.stringify(script.findings.map((f) => `${f.check}@${f.beatId}`))}`);
  check("step 6: check_script reads the Equation's spoken string from its scene and compares it with the narration (this one is not in the narration: caught)", spoken.length === 1 && spoken[0].beatId === "numbers");
  fs.writeFileSync(path.join(dir, "Numbers.tsx"), scene("Numbers", w.Numbers.replace("v equals twenty metres a second", "leaves at 20 metres a second, at 45 degrees")));
  const fixedBeats = JSON.parse(fs.readFileSync(path.join(videoDir, "beats.json"), "utf8"));
  check("step 6: with the spoken string matching the narration the script passes", (() => {
    const numbersBeat = fixedBeats.beats.find((b) => b.id === "numbers");
    numbersBeat.vo = numbersBeat.vo.replace("Say it leaves at 20 metres a second, at 45 degrees.", "Say it leaves at 20 metres a second, at 45 degrees.");
    fs.writeFileSync(path.join(dir, "Numbers.tsx"), scene("Numbers", `      <Equation tex={String.raw\`v = 20\\ \\mathrm{m/s}\`} spoken="it leaves at 20 metres a second" size={90} />`));
    return runCheckScript({ projectRoot: root, videoName: "projectile" }).findings.every((f) => f.check !== "spoken");
  })());
  const rendered = await runValidateScenesFull({ projectRoot: root, videoName: "projectile", render: true });
  console.log(`  validate_scenes: ${JSON.stringify(rendered.findings.filter((f) => f.severity === "error").map((f) => [f.beatId, f.check, f.message.slice(0, 400)]))}`);
  check("step 6: validate_scenes with render measured all six beats", rendered.render?.beatsMeasured === 6 && rendered.render.beatsSkipped.length === 0 && rendered.mode === "supernova");
  check("step 6: ...and reports no errors (no crop, no glow-budget error)", rendered.findings.filter((f) => f.severity === "error").length === 0);
  const desc = runWriteDescription({ projectRoot: root, videoName: "projectile" });
  check("step 7: write_description says the video is a constructed explanation", fs.readFileSync(desc.path, "utf8").includes("This video is a constructed explanation, not footage."));
}

finish();

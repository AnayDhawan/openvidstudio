#!/usr/bin/env node
// Renders one real still per @openvidstudio/core primitive for packages/docs/API.md.
//
//   node scripts/build-api-gallery.mjs        (after: pnpm --filter @openvidstudio/mcp-server build)
//
// It scaffolds a throwaway project, writes one small scene per primitive (or per group that only
// makes sense together), stitches them, renders the frame that shows each one best through
// render_stills, and writes 960px PNGs to packages/docs/img/api/. The stills are the primitives
// as they actually render, not drawings of them, so re-run this when a primitive's look changes.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "packages", "mcp-server", "dist");
const outDir = path.join(root, "packages", "docs", "img", "api");
const templateModules = path.join(root, "templates", "default", "node_modules");
if (!fs.existsSync(path.join(dist, "server.js"))) {
  console.error("Build first: pnpm --filter @openvidstudio/mcp-server build");
  process.exit(2);
}
if (!fs.existsSync(templateModules)) {
  console.error(`${templateModules} is missing. Run pnpm install at the repo root first.`);
  process.exit(2);
}
const sharp = require(path.join(root, "packages", "mcp-server", "node_modules", "sharp"));
const { runInitProject } = require(path.join(dist, "tools", "initProject.js"));
const { runStitchComposition } = require(path.join(dist, "tools", "stitchComposition.js"));
const { runRenderStills } = require(path.join(dist, "tools", "renderStills.js"));

const project = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-gallery-"));
runInitProject({ name: "gallery", projectRoot: project });
fs.symlinkSync(templateModules, path.join(project, "node_modules"), "junction");
const videoDir = path.join(project, "src", "videos", "gallery");
const scenesDir = path.join(videoDir, "custom-scenes");
fs.mkdirSync(scenesDir, { recursive: true });
fs.mkdirSync(path.join(project, "public", "images"), { recursive: true });
fs.mkdirSync(path.join(project, "public", "audio"), { recursive: true });

// A sample "capture" for DirectedShot: a mock dashboard, drawn as SVG, labelled as a sample.
const dashboard = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <rect width="1920" height="1080" fill="#0f172a"/>
  <rect x="0" y="0" width="1920" height="72" fill="#111c33"/>
  <text x="40" y="47" font-family="Arial" font-size="28" fill="#94a3b8">Acme Tasks  /  Sprint 14  /  sample capture</text>
  <rect x="40" y="120" width="560" height="860" rx="16" fill="#16223d"/>
  <rect x="680" y="120" width="560" height="860" rx="16" fill="#16223d"/>
  <rect x="1320" y="120" width="560" height="860" rx="16" fill="#1d2b4d" stroke="#38bdf8" stroke-width="4"/>
  <text x="70" y="170" font-family="Arial" font-size="30" font-weight="700" fill="#e2e8f0">To do</text>
  <text x="710" y="170" font-family="Arial" font-size="30" font-weight="700" fill="#e2e8f0">In progress</text>
  <text x="1350" y="170" font-family="Arial" font-size="30" font-weight="700" fill="#38bdf8">Done: 12 tasks</text>
  <rect x="1350" y="210" width="500" height="120" rx="12" fill="#0f172a"/>
  <text x="1380" y="262" font-family="Arial" font-size="28" fill="#e2e8f0">Ship the release notes</text>
  <text x="1380" y="302" font-family="Arial" font-size="22" fill="#34d399">Closed today</text>
  <rect x="1350" y="350" width="500" height="120" rx="12" fill="#0f172a"/>
  <text x="1380" y="402" font-family="Arial" font-size="28" fill="#e2e8f0">Fix the import bug</text>
  <rect x="70" y="210" width="500" height="120" rx="12" fill="#0f172a"/>
  <text x="100" y="262" font-family="Arial" font-size="28" fill="#e2e8f0">Write the changelog</text>
  <rect x="710" y="210" width="500" height="120" rx="12" fill="#0f172a"/>
  <text x="740" y="262" font-family="Arial" font-size="28" fill="#e2e8f0">Review the design</text>
</svg>`;
await sharp(Buffer.from(dashboard)).png().toFile(path.join(project, "public", "images", "dashboard.png"));

// Silence plus a cue grid, so useMusicClock has a real bed to read (120 bpm: 15 frames a beat).
spawnSync("ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "30", "-q:a", "9", path.join(project, "public", "audio", "music-bed.mp3")]);
fs.writeFileSync(
  path.join(project, "public", "audio", "music-bed.cues.json"),
  JSON.stringify({ bpm: 120, beats: [0], sections: [{ label: "intro", startBar: 0, durationBars: 8 }], impacts: [{ label: "reveal", atBar: 3 }] }),
);

const HEAD = `import React from "react";\nimport { CinematicScene, Layer, E, color } from "@openvidstudio/core";\n`;
const CAM = "camera={[{ frame: 0, x: 960, y: 540, scale: 1.0 }, { frame: 90, x: 960, y: 540, scale: 1.03, easing: E.drift }]}";
function scene(name, extraImports, body, { overlay = "", cam = CAM } = {}) {
  const overlayProp = overlay ? ` overlay={${overlay}}` : "";
  fs.writeFileSync(
    path.join(scenesDir, `${name}.tsx`),
    `${HEAD}${extraImports}\nexport const ${name}: React.FC = () => (\n  <CinematicScene ${cam}${overlayProp}>\n${body}\n  </CinematicScene>\n);\n`,
  );
}
const at = (left, top, inner) => `    <div style={{ position: "absolute", left: ${left}, top: ${top} }}>${inner}</div>`;

// name, the frame (local to its 90-frame beat) that shows it best, and the file(s) written
const beats = [];
function add(id, name, frames) {
  beats.push({ id, name, frames });
}

scene("GWords", 'import { Words } from "@openvidstudio/core";', at(160, 430, '<Words text="Primitives render for real" at={0} size={96} accent={{ 3: color.accent }} />'));
add("g-words", "GWords", { 60: "words" });

scene("GDotText", 'import { DotText } from "@openvidstudio/core";', at(200, 400, '<DotText text="OPEN VIDEO" at={0} px={16} build="none" />'));
add("g-dottext", "GDotText", { 60: "dottext" });

scene(
  "GPixelLogo",
  'import { PixelLogo } from "@openvidstudio/core";',
  at(760, 330, '<PixelLogo shapes={[{ x: 0, y: 0, width: 10, height: 10, color: color.accent }, { x: 14, y: 0, width: 10, height: 10, color: color.accentAlt }, { x: 0, y: 14, width: 10, height: 10, color: color.success }, { x: 14, y: 14, width: 10, height: 10, color: color.warn }]} at={0} scale={14} />'),
);
add("g-pixellogo", "GPixelLogo", { 60: "pixellogo" });

scene(
  "GPixelWipe",
  'import { Words, PixelWipe } from "@openvidstudio/core";',
  at(160, 430, '<Words text="One move across the cut" at={0} size={88} />') + '\n    <PixelWipe mode="in" at={0} dur={60} cell={80} />',
);
add("g-pixelwipe", "GPixelWipe", { 30: "pixelwipe" });

scene("GAtmosphere", 'import { Atmosphere, Words } from "@openvidstudio/core";', "    <Atmosphere />\n" + at(160, 460, '<Words text="Atmosphere" at={0} size={110} />'));
add("g-atmosphere", "GAtmosphere", { 60: "atmosphere" });

scene(
  "GDotGrid",
  'import { DotGrid, Glass, Words } from "@openvidstudio/core";',
  '    <DotGrid opacity={0.14} />\n' + at(560, 380, '<Glass><div style={{ width: 760 }}><Words text="DotGrid texture" at={0} size={72} /></div></Glass>'),
);
add("g-dotgrid", "GDotGrid", { 60: "dotgrid" });

scene("GFlash", 'import { Flash, Words } from "@openvidstudio/core";', at(160, 460, '<Words text="A hit lands" at={0} size={110} />') + "\n    <Flash at={10} dur={20} strength={0.7} />");
add("g-flash", "GFlash", { 12: "flash" });

scene("GLetterbox", 'import { Letterbox, Words } from "@openvidstudio/core";', at(160, 440, '<Words text="Letterbox" at={0} size={110} />') + "\n    <Letterbox />");
add("g-letterbox", "GLetterbox", { 60: "letterbox" });

scene("GBlack", 'import { Black, Words } from "@openvidstudio/core";', at(160, 460, '<Words text="Under the black" at={0} size={110} />') + "\n    <Black from={0} to={70} />");
add("g-black", "GBlack", { 30: "black" });

scene(
  "GChapterHud",
  'import { ChapterHud, Words } from "@openvidstudio/core";',
  at(160, 460, '<Words text="Chapter rail and label" at={0} size={84} />'),
  { overlay: '<ChapterHud chapters={[{ label: "SETUP" }, { label: "CAPTURE" }, { label: "RENDER" }]} activeIndex={1} fillDurationInFrames={90} />' },
);
add("g-chapterhud", "GChapterHud", { 60: "chapterhud" });

scene(
  "GWindowJson",
  'import { Window, JsonView } from "@openvidstudio/core";',
  at(520, 230, '<Window title="status.json" width={880} height={620}><JsonView value={{ ok: true, tools: 40, beats: 12, loudnessLufs: -14 }} at={0} fontSize={30} /></Window>'),
);
add("g-window-jsonview", "GWindowJson", { 70: "window-jsonview" });

scene(
  "GChips",
  'import { ToolChip, Pill } from "@openvidstudio/core";',
  at(500, 430, '<div style={{ display: "flex", gap: 24, alignItems: "center" }}><ToolChip name="render_stills" at={0} doneAt={40} size={36} /><Pill color={color.success} size={30}>verified</Pill><Pill size={30}>12 beats</Pill></div>'),
);
add("g-toolchip-pill", "GChips", { 70: "toolchip-pill" });

scene(
  "GGlassMarks",
  'import { Check, Cross, Glass } from "@openvidstudio/core";',
  at(560, 360, '<Glass><div style={{ display: "flex", gap: 60, padding: 20, alignItems: "center" }}><Check size={120} at={0} /><Cross size={120} /></div></Glass>'),
);
add("g-check-cross-glass", "GGlassMarks", { 60: "check-cross-glass" });

fs.writeFileSync(
  path.join(scenesDir, "GTyped.tsx"),
  [
    'import React from "react";',
    'import { CinematicScene, E, Window, useTyped, Caret, color } from "@openvidstudio/core";',
    "",
    "const TypedLine: React.FC = () => {",
    '  const t = useTyped("npx openvidstudio init", 0, 14);',
    "  return (",
    '    <Window title="terminal" width={1000} height={300}>',
    '      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 54, color: "#e2e8f0", fontFamily: "monospace" }}>',
    "        <span style={{ color: color.accent }}>$</span>",
    "        <span>{t.visible}</span>",
    "        <Caret h={54} />",
    "      </div>",
    "    </Window>",
    "  );",
    "};",
    "",
    "export const GTyped: React.FC = () => (",
    `  <CinematicScene ${CAM}>`,
    '    <div style={{ position: "absolute", left: 460, top: 380 }}><TypedLine /></div>',
    "  </CinematicScene>",
    ");",
    "",
  ].join("\n"),
);
add("g-typed-caret", "GTyped", { 40: "typed-caret" });

scene(
  "GDirected",
  'import { DirectedShot } from "@openvidstudio/core";\nimport { staticFile } from "remotion";',
  '    <DirectedShot src={staticFile("images/dashboard.png")} focus={{ x: 1560, y: 280 }} push={1.9} tilt={{ y: -4, x: 2 }} move={{ from: 0, to: 70 }} cursor={{ path: [{ frame: 0, x: 900, y: 600 }, { frame: 55, x: 1500, y: 300 }], clicks: [60] }} />',
  { cam: "camera={[{ frame: 0, x: 960, y: 540, scale: 1.0 }, { frame: 90, x: 960, y: 540, scale: 1.0 }]}" },
);
add("g-directedshot", "GDirected", { 0: "directedshot-start", 80: "directedshot-end" });

fs.writeFileSync(
  path.join(scenesDir, "GClock.tsx"),
  [
    'import React from "react";',
    'import { CinematicScene, E, useMusicClock, color } from "@openvidstudio/core";',
    "",
    "const ClockPulse: React.FC = () => {",
    '  const clock = useMusicClock("g-clock");',
    "  const pulse = clock.beatPulse();",
    "  const pos = clock.position(0);",
    "  return (",
    "    <>",
    '      <div style={{ position: "absolute", left: 760, top: 200, width: 400, height: 400, borderRadius: 200, background: color.accent, opacity: 0.25 + 0.75 * pulse, transform: "scale(" + (0.8 + 0.4 * pulse) + ")" }} />',
    '      <div style={{ position: "absolute", left: 260, top: 720, width: 1400, textAlign: "center", fontSize: 54, color: "#e2e8f0", fontFamily: "monospace" }}>',
    '        {"bar " + pos.bar + "   pulse " + pulse.toFixed(2) + "   onDownbeat " + clock.onDownbeat()}',
    "      </div>",
    "    </>",
    "  );",
    "};",
    "",
    "export const GClock: React.FC = () => (",
    `  <CinematicScene ${CAM}>`,
    "    <ClockPulse />",
    "  </CinematicScene>",
    ");",
    "",
  ].join("\n"),
);
add("g-clock", "GClock", { 0: "musicclock-downbeat", 4: "musicclock-decay" });

// beats: 90 frames each, contiguous. The clock scene sits at a bar boundary (frame 60 * k) so
// local frame 0 is a downbeat: put it at a multiple of 60.
const ordered = beats.filter((b) => b.id !== "g-clock");
const clockBeat = beats.find((b) => b.id === "g-clock");
const finalBeats = [];
let start = 0;
// stitch_composition imports each beat's scene by the PascalCase of its id, so the scene's export
// has to carry that name. The scenes above use friendlier names; alias them.
const pascal = (id) => id.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
for (const b of beats) {
  if (pascal(b.id) !== b.name) fs.appendFileSync(path.join(scenesDir, `${b.name}.tsx`), `export { ${b.name} as ${pascal(b.id)} };\n`);
}
for (const b of ordered) {
  finalBeats.push({ id: b.id, start, duration: 90, scene: `./custom-scenes/${b.name}.tsx` });
  start += 90;
}
// pad to the next multiple of 60 so the clock beat starts on a downbeat
if (start % 60 !== 0) {
  const pad = 60 - (start % 60);
  finalBeats[finalBeats.length - 1].duration += pad;
  start += pad;
}
finalBeats.push({ id: clockBeat.id, start, duration: 90, scene: `./custom-scenes/${clockBeat.name}.tsx` });
fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, beats: finalBeats }));
runStitchComposition({ projectRoot: project, videoName: "gallery" });

const frames = [];
const names = new Map();
for (const fb of finalBeats) {
  const src = beats.find((b) => b.id === fb.id);
  for (const [local, name] of Object.entries(src.frames)) {
    const f = fb.start + Number(local);
    frames.push(f);
    names.set(f, name);
  }
}
const result = await runRenderStills({ projectRoot: project, videoName: "gallery", frames, findings: false, contactGrid: false });

fs.mkdirSync(outDir, { recursive: true });
for (const still of result.stills) {
  const name = names.get(still.frame);
  await sharp(still.path)
    .resize(960, 540)
    .png({ palette: true, quality: 85, compressionLevel: 9 })
    .toFile(path.join(outDir, `${name}.png`));
  console.log(`wrote img/api/${name}.png  (${fs.statSync(path.join(outDir, `${name}.png`)).size} bytes)`);
}
console.log(`\n${result.stills.length} stills in ${outDir}`);
fs.rmSync(project, { recursive: true, force: true });

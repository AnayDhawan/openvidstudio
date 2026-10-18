#!/usr/bin/env node
// core-primitives: Part 52 (split out of the former single manual-test.mjs; see _harness.mjs)

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
// fixture: RENDERCMD
const { buildRenderCommand, runRenderVideo } = require(path.join(distDir, "tools", "renderVideo.js"));
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

console.log("\n== Part 52: C4's new core primitives render for real, together (C4) ==");
if (fs.existsSync(templateNodeModules)) {
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  const c4Root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c4-render-"));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "c4check", projectRoot: c4Root });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log(`  (init_project hit ${err.code ?? err.message}, retrying: attempt ${attempt})`);
      fs.rmSync(c4Root, { recursive: true, force: true });
      fs.mkdirSync(c4Root, { recursive: true });
    }
  }
  fs.symlinkSync(templateNodeModules, path.join(c4Root, "node_modules"), "junction");

  const videoDir = path.join(c4Root, "src", "videos", "c4check");
  const customDir = path.join(videoDir, "custom-scenes");
  fs.mkdirSync(customDir, { recursive: true });
  // One scene, one real import of a representative slice across all four of C4's new
  // files (pixel.tsx, kinetic.tsx, atmosphere.tsx, panels.tsx), composed together the way
  // a bespoke peak/mid scene actually would -- proving they compile AND render real,
  // non-blank pixels as a set, not just individually in isolation.
  fs.writeFileSync(
    path.join(customDir, "BespokeC4Check.tsx"),
    `import React from "react";
import {
  CinematicScene, Layer, E, color,
  Atmosphere, Words, DotText, PixelLogo,
  Window, JsonView, ToolChip, Check, Pill, Glass, ChapterHud,
} from "@openvidstudio/core";

export const BespokeC4Check: React.FC = () => {
  const logoShapes = [
    { x: 0, y: 0, width: 10, height: 10, color: color.accent },
    { x: 14, y: 0, width: 10, height: 10, color: color.accentAlt },
    { x: 7, y: 14, width: 10, height: 10, color: color.success },
  ];
  return (
    <CinematicScene
      camera={[
        { frame: 0, x: 960, y: 540, scale: 1.04 },
        { frame: 150, x: 960, y: 540, scale: 1.1, easing: E.drift },
      ]}
      overlay={<ChapterHud chapters={[{ label: "check" }, { label: "done" }]} activeIndex={0} fillDurationInFrames={150} />}
    >
      <Layer depth={0}>
        <Atmosphere />
        <div style={{ position: "absolute", left: 140, top: 140 }}>
          <PixelLogo shapes={logoShapes} at={0} scale={6} build="none" />
        </div>
        <div style={{ position: "absolute", left: 140, top: 340 }}>
          <Words text="Primitives render for real" at={0} />
        </div>
        <div style={{ position: "absolute", left: 140, top: 460 }}>
          <DotText text="C4" at={0} build="none" />
        </div>
        <div style={{ position: "absolute", left: 1100, top: 160, display: "flex", flexDirection: "column", gap: 20 }}>
          <Window title="status.json" width={620} height={260}>
            <JsonView value={{ ok: true, components: 4 }} at={0} />
          </Window>
          <div style={{ display: "flex", gap: 14 }}>
            <ToolChip name="render_still" at={0} doneAt={0} />
            <Pill color={color.success}>verified</Pill>
          </div>
          <Glass>
            <Check size={28} at={0} />
          </Glass>
        </div>
      </Layer>
    </CinematicScene>
  );
};
`,
    "utf8",
  );
  // C3's useMusicClock and C4's DirectedShot, each in a scene that prints or shows something a
  // test can check: the clock's numbers as text, the shot's framing as pixels.
  const audioDir = path.join(c4Root, "public", "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(path.join(c4Root, "public", "images"), { recursive: true });
  const silence = spawnSync("ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "20", "-q:a", "9", path.join(audioDir, "music-bed.mp3")]);
  const haveFfmpeg = silence.status === 0;
  // 120 bpm at 30 fps: a beat is 15 frames, a 4/4 bar is 60.
  fs.writeFileSync(
    path.join(audioDir, "music-bed.cues.json"),
    JSON.stringify({
      bpm: 120,
      beats: [0],
      sections: [
        { label: "intro", startBar: 0, durationBars: 2, startSeconds: 0, endSeconds: 4 },
        { label: "peak", startBar: 2, durationBars: 4, startSeconds: 4, endSeconds: 12 },
      ],
      impacts: [{ label: "reveal", atBar: 3, atBeat: 0, atSeconds: 6 }],
    }),
  );
  // Left half red, right half blue, so where the camera ends up is readable from pixels alone.
  const sharpLib = require(path.join(packageRoot, "node_modules", "sharp"));
  const halves = await sharpLib({ create: { width: 1920, height: 1080, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .composite([{ input: await sharpLib({ create: { width: 960, height: 1080, channels: 3, background: { r: 30, g: 60, b: 230 } } }).png().toBuffer(), left: 960, top: 0 }])
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(c4Root, "public", "images", "halves.png"), halves);
  fs.writeFileSync(
    path.join(customDir, "ClockShot.tsx"),
    `import React from "react";
import { CinematicScene, useMusicClock } from "@openvidstudio/core";

export const ClockShot: React.FC = () => {
  const clock = useMusicClock("clock-shot");
  const parts = [
    "avail:" + clock.available,
    "bpm:" + clock.bpm,
    "hit:" + clock.at(3, 0),
    "reveal:" + clock.impact("reveal"),
    "pulse:" + clock.beatPulse().toFixed(2),
    "down:" + clock.onDownbeat(),
    "beat:" + clock.onBeat(),
    "section:" + clock.sectionAt(0),
  ];
  return (
    <CinematicScene camera={[{ frame: 0, x: 960, y: 540, scale: 1 }, { frame: 150, x: 960, y: 540, scale: 1.03 }]}>
      <div id="clock-readout" style={{ position: "absolute", left: 200, top: 300, fontSize: 40, color: "#fff", whiteSpace: "pre" }}>{parts.join(" ")}</div>
    </CinematicScene>
  );
};
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(customDir, "DirectedOnly.tsx"),
    `import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { DirectedShot } from "@openvidstudio/core";

export const DirectedOnly: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    <DirectedShot src={staticFile("images/halves.png")} focus={{ x: 1500, y: 540 }} push={2} move={{ from: 0, to: 30 }} depthOfField={0} />
  </AbsoluteFill>
);
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(videoDir, "beats.json"),
    JSON.stringify({
      fps: 30,
      beats: [
        { id: "bespoke-c4-check", start: 0, duration: 150, scene: "./custom-scenes/BespokeC4Check.tsx" },
        { id: "clock-shot", start: 150, duration: 150, scene: "./custom-scenes/ClockShot.tsx" },
        { id: "directed-only", start: 300, duration: 90, scene: "./custom-scenes/DirectedOnly.tsx" },
      ],
    }),
  );

  const c4Stitch = runStitchComposition({ projectRoot: c4Root, videoName: "c4check" });
  check("C4 check composition stitches (scene override + new primitives all resolve as real imports)", c4Stitch.written === true);

  const c4OutRel = path.join("out", "c4-check.mp4");
  const c4Render = await runRenderVideo({ projectRoot: c4Root, videoName: "c4check", outPath: c4OutRel, skipBrandLock: true });
  check(
    "render_video renders the new primitives for real, no React/CSS crash, a real file lands on disk",
    c4Render.success === true && fs.existsSync(c4Render.outPath) && fs.statSync(c4Render.outPath).size > 20000,
  );

  // C3 and C4, read back out of a real render: seek the composition and look at the DOM and pixels.
  if (haveFfmpeg) {
    check("stitch copied the bed's cues next to the composition for useMusicClock", c4Stitch.musicCuesPath === "src/videos/c4check/music.cues.json" && c4Stitch.musicBedFile === "music-bed.mp3");
    const bridge = require(path.join(distDir, "remotionBridge.js"));
    const { colorShares } = require(path.join(distDir, "tools", "validateScenesRender.js"));
    const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
    const bundleDir = await bridge.bundleProject(c4Root);
    const server = await bridge.serveBundleDirectory(bundleDir);
    const remotionBrowser = await bridge.openRenderBrowser();
    let browser = null;
    try {
      const comp = await bridge.resolveComposition(bundleDir, c4Stitch.compositionId, remotionBrowser);
      browser = await launchChromium();
      const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
      await bridge.openSeekablePage({ page, bundleUrl: server.url, composition: comp, timeoutMs: 20000 });
      const readout = async (frame) => {
        await bridge.seekToFrame(page, comp.id, frame, 20000);
        return page.evaluate(() => document.getElementById("clock-readout")?.textContent ?? "");
      };

      // clock-shot starts at composition frame 150; at 120 bpm and 30 fps a beat is 15 frames.
      check("on bar 3's downbeat the clock says so: at(3) is local frame 30, pulse is full, section is peak", (await readout(180)) === "avail:true bpm:120 hit:30 reveal:30 pulse:1.00 down:true beat:true section:peak");
      check("3 frames later the pulse has decayed to 0.44 and it is no longer a beat", (await readout(183)) === "avail:true bpm:120 hit:30 reveal:30 pulse:0.44 down:false beat:false section:peak");
      check("a non-downbeat beat pulses without being a downbeat", (await readout(195)).endsWith("pulse:1.00 down:false beat:true section:peak"));
      check("between beats the pulse is zero", (await readout(177)).includes("pulse:0.00 down:false beat:false"));
      check("the scene's first frame is a beat (bar 2.5 starts on beat 10) but not a downbeat", (await readout(150)).includes("pulse:1.00 down:false beat:true"));

      const share = async (frame) => {
        await bridge.seekToFrame(page, comp.id, frame, 20000);
        const shot = path.join(c4Root, `directed-${frame}.png`);
        await page.screenshot({ path: shot });
        const { data, info } = await sharpLib(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const s = colorShares(data, info.width, info.height, info.channels, ["#dc1e1e", "#1e3ce6"]);
        return { red: s.get("#dc1e1e"), blue: s.get("#1e3ce6") };
      };
      const wide = await share(300);
      check("DirectedShot starts on the whole capture: about half red, half blue", wide.red > 0.4 && wide.red < 0.6 && wide.blue > 0.4 && wide.blue < 0.6);
      const pushed = await share(360);
      check("...and after its move has pushed into the blue half, the frame is blue and the red is gone", pushed.blue > 0.95 && pushed.red < 0.01);
    } finally {
      await browser?.close().catch(() => undefined);
      await remotionBrowser.close({ silent: true });
      await server.close();
    }
  } else {
    skip("C3 useMusicClock and C4 DirectedShot read back from a real render", "ffmpeg is not available to make a silent bed");
  }
} else {
  skip("Part 52: C4 primitives real render", "no resolvable node_modules to scaffold a renderable project from");
}

finish();

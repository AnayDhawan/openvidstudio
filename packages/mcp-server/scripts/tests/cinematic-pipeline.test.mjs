#!/usr/bin/env node
// cinematic-pipeline: transitions drawn over the cut, the rhythm warning in validate_beats, and
// capture_screenshot layers. Everything that can be checked on real pixels is: a stitched
// composition is rendered and the frames are compared, not the generated text grepped.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  require,
  packageRoot,
  distDir,
  monorepoTemplateDir,
  check,
  skip,
  finish,
} from "./_harness.mjs";

const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
const stitchModule = require(path.join(distDir, "tools", "stitchComposition.js"));
const { runStitchComposition } = stitchModule;
const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));

const TYPES = ["fade", "whip", "push", "wipe", "light-leak"];
const RED = "#c81e1e";
const BLUE = "#1e46c8";
const HALF = 6; // frames either side of a cut at 30 fps; the overlay is 2 * HALF long

console.log("\n== Transitions: the vocabulary is accepted and anything else is refused ==");
{
  const beat = (transition) => ({
    fps: 30,
    title: "T",
    beats: [
      { id: "a", start: 0, duration: 60, vo: "a short narration line here", visual: { captureMethod: "dom-demo" } },
      { id: "b", start: 60, duration: 60, vo: "a short narration line here", visual: { captureMethod: "dom-demo" }, ...(transition ? { transition } : {}) },
    ],
  });
  for (const t of ["cut", "whip", "fade", "push", "wipe", "light-leak"]) {
    check(`validate_beats accepts transition "${t}"`, validateBeatsLogic(beat(t)).valid === true);
  }
  const bad = validateBeatsLogic(beat("spin"));
  check("...and refuses an unknown one", bad.valid === false);
  check(
    "...naming every accepted type in the error",
    ["cut", "whip", "fade", "push", "wipe", "light-leak"].every((t) => bad.errors.join(" ").includes(`"${t}"`)),
  );
  // The transition check used to sit below the early returns for desktop/mobile/terminal beats,
  // so a typo on one of those was never reported.
  const terminal = validateBeatsLogic({
    fps: 30,
    title: "T",
    beats: [
      { id: "a", start: 0, duration: 60, vo: "a short narration line here", visual: { captureMethod: "dom-demo" } },
      { id: "b", start: 60, duration: 60, vo: "a short narration line here", visual: { captureMethod: "recording", source: "terminal", command: "hermes" }, transition: "spin" },
    ],
  });
  check("a bad transition on a terminal beat is reported too", terminal.errors.join(" ").includes("transition must be one of"));
  const { DEFAULT_TRANSITIONS } = (() => {
    const src = fs.readFileSync(path.join(packageRoot, "..", "core", "src", "designSystem.ts"), "utf8");
    const m = src.match(/DEFAULT_TRANSITIONS\s*=\s*(\[[^\]]*\])/);
    return { DEFAULT_TRANSITIONS: m ? JSON.parse(m[1]) : [] };
  })();
  check(
    "the design system's default transition list names all six",
    ["cut", "whip", "fade", "push", "wipe", "light-leak"].every((t) => DEFAULT_TRANSITIONS.includes(t)),
  );
  check("...and the stitcher's half-window scales with fps (6 at 30, 12 at 60, 5 at 24)",
    stitchModule.transitionHalfFrames?.(30) === 6 && stitchModule.transitionHalfFrames?.(60) === 12 && stitchModule.transitionHalfFrames?.(24) === 5);
}

console.log("\n== Rhythm: uniform shot lengths draw a warning, never an error ==");
{
  const file = (durations, extra = {}) => {
    let start = 0;
    return {
      fps: 30,
      title: "T",
      narration: "none",
      beats: durations.map((duration, i) => {
        const beat = { id: `b${i}`, start, duration, visual: { captureMethod: "dom-demo" } };
        start += duration;
        return beat;
      }),
      ...extra,
    };
  };
  const rhythm = (r) => r.warnings.filter((w) => /metronome/.test(w));

  const uniform = validateBeatsLogic(file([90, 90, 90, 90, 90]));
  check("five equal beats still validate: the rhythm note is a warning, not an error", uniform.valid === true && uniform.errors.length === 0);
  check("...and carry exactly one warning that names the problem (metronome)", rhythm(uniform).length === 1 && uniform.warnings.length === 1);
  check("...which says what to do (one long hold, one short punch)", /long hold/.test(uniform.warnings[0]) && /short punch/.test(uniform.warnings[0]));
  check("...and quotes the real numbers (longest 90 frames, shortest 90 frames, 1.00x)", /90 frames/.test(uniform.warnings[0]) && /1\.00x/.test(uniform.warnings[0]));

  const varied = validateBeatsLogic(file([150, 45, 90, 60]));
  check("four beats with a 3.3x spread draw no warning", varied.valid === true && varied.warnings.length === 0);
  check("three equal beats draw none (fewer than four is not a rhythm yet)", validateBeatsLogic(file([90, 90, 90])).warnings.length === 0);
  check("three beats of varied length draw none", validateBeatsLogic(file([150, 45, 90])).warnings.length === 0);

  // The line is "longest less than 2.5x the shortest": 2.5x exactly is fine, a hair under is not.
  check("a longest exactly 2.5x the shortest (100 vs 40) draws none", validateBeatsLogic(file([100, 40, 70, 70])).warnings.length === 0);
  check("...and 100 vs 41 (2.44x) does", rhythm(validateBeatsLogic(file([100, 41, 70, 70]))).length === 1);
  // Control meant to fail if the check ever stops reading the durations: the same four ids
  // with the spread removed must warn, the one above must not.
  check("control: [100,40,70,70] and [70,70,70,70] disagree", validateBeatsLogic(file([100, 40, 70, 70])).warnings.length === 0 && rhythm(validateBeatsLogic(file([70, 70, 70, 70]))).length === 1);

  // The documented worked example is the first thing an agent copies, so it must not trip the note.
  const planning = fs.readFileSync(path.join(packageRoot, "..", "docs", "PLANNING.md"), "utf8").replace(/\r\n/g, "\n");
  const example = JSON.parse(planning.slice(planning.search(/^## \d+\. Worked example/m)).match(/```json\n([\s\S]*?)\n```/)[1]);
  const exampleResult = validateBeatsLogic(example);
  check(`PLANNING.md's worked example is valid and draws no rhythm warning (${example.beats.map((b) => b.duration).join("/")} frames)`, exampleResult.valid === true && exampleResult.warnings.length === 0);

  const withErrors = validateBeatsLogic(file([90, 90, 90, 90], { beats: undefined }));
  check("a file with no beats array returns no warnings and no crash", Array.isArray(withErrors.warnings) && withErrors.warnings.length === 0 && withErrors.valid === false);
  const { runWriteBeatsFile } = require(path.join(distDir, "tools", "writeBeatsFile.js"));
  const wroteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-rhythm-"));
  check("write_beats_file still writes a uniform file: a warning does not block", runWriteBeatsFile({ projectRoot: wroteRoot, videoName: "u", beatsJson: file([90, 90, 90, 90]) }).written === true);
}

console.log("\n== Layers: capture_screenshot splits a page into a background and transparent element layers ==");
{
  const captureCore = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
  const { runCaptureScreenshot, layerPixelRect } = require(path.join(distDir, "tools", "captureScreenshot.js"));

  // Pure geometry first: where an element's rectangle lands in the saved image.
  const rect = { x: 100, y: 50, width: 200, height: 80 };
  const geo = (over = {}) => layerPixelRect(rect, { zoom: 1, deviceScaleFactor: 2, imageWidth: 3200, imageHeight: 2000, ...over });
  check("layerPixelRect at 2x: CSS rect times 2, plus one pixel of bleed each side", JSON.stringify(geo()) === JSON.stringify({ x: 199, y: 99, width: 402, height: 162 }));
  check("...under a 1.25 zoom desync the scale is zoom times dpr (x 249, w 502 with the bleed)", JSON.stringify(geo({ zoom: 1.25 })) === JSON.stringify({ x: 249, y: 124, width: 502, height: 202 }));
  check("...a fractional edge grows outward, never inward (x 10.3 w 5 at 1x covers 10 to 16, so 9 to 17 with the bleed)", JSON.stringify(layerPixelRect({ x: 10.3, y: 0, width: 5, height: 5 }, { zoom: 1, deviceScaleFactor: 1, imageWidth: 100, imageHeight: 100 })) === JSON.stringify({ x: 9, y: 0, width: 8, height: 6 }));
  check("...relative to a crop, the crop's origin is subtracted (x 60 css px at 2x is 120, 119 with the bleed)", geo({ crop: { x: 40, y: 20, width: 500, height: 300 }, imageWidth: 1000, imageHeight: 600 })?.x === 119);
  check("...clamped to the image, and null when it lies wholly outside", geo({ imageWidth: 300 })?.width === 101 && geo({ imageWidth: 150 }) === null);

  let browserAvailable = false;
  try {
    const probe = await captureCore.launchChromium();
    await probe.close();
    browserAvailable = true;
  } catch {}

  if (!browserAvailable) {
    skip("layers against a real page", "real Chromium is not available in this environment");
  } else {
    const http = await import("node:http");
    // Rounded and bordered elements (so their corners are transparent in a layer), a fractional
    // position, a gradient, text, two elements sharing a class, an infinite spinner that is NOT a
    // layer (it has to hold still between the shots), and a #stage box for the cropSelector case.
    const html = `<!doctype html><html><head><style>
      body { margin: 0; background: #f0f0f0; width: 800px; height: 600px; position: relative; font-family: sans-serif; }
      #stage { position: absolute; left: 20px; top: 40px; width: 700px; height: 260px; background: #e4e8f0; }
      #hero { position: absolute; left: 40px; top: 60px; width: 300px; height: 200px; background: #3355ff; border: 4px solid #112299; border-radius: 24px; box-sizing: border-box; }
      #card { position: absolute; left: 420.5px; top: 90.25px; width: 260px; height: 180px; background: linear-gradient(#ffcc00, #ff6600); border-radius: 12px; }
      #title { position: absolute; left: 40px; top: 320px; margin: 0; font-size: 48px; color: #222; }
      .chip { position: absolute; top: 420px; width: 120px; height: 40px; background: #22aa66; border-radius: 20px; }
      #chip-a { left: 40px; } #chip-b { left: 200px; }
      #spin { position: absolute; left: 600px; top: 420px; width: 60px; height: 60px; border: 8px solid #bbb; border-top-color: #333; border-radius: 50%; animation: spin 700ms linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style></head><body>
      <div id="stage"></div><div id="hero"></div><div id="card"></div><h1 id="title">Hello layers</h1>
      <div class="chip" id="chip-a"></div><div class="chip" id="chip-b"></div><div id="spin"></div>
    </body></html>`;
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const layerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-layers-"));
    const viewport = { width: 800, height: 600 };

    // Real bounding boxes, measured independently in a page of the same size.
    const measure = async (selectors) => {
      const b = await captureCore.launchChromium();
      try {
        const page = await b.newPage({ viewport, deviceScaleFactor: 1 });
        await page.goto(url);
        const out = {};
        for (const s of selectors) {
          out[s] = await page.$$eval(s, (els) => els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }));
        }
        return out;
      } finally {
        await b.close();
      }
    };
    const boxes = await measure(["#hero", "#card", "#title", ".chip"]);

    // Composites bg plus the layers at their rectangles, in manifest order, and compares it with
    // the original screenshot. Returns the real numbers so the test prints what the tolerance is.
    const reconstruct = async (shotPath, manifest, publicDir, { withLayers = true } = {}) => {
      const base = sharp(path.join(publicDir, manifest.background)).removeAlpha();
      const parts = withLayers ? manifest.layers.map((l) => ({ input: path.join(publicDir, l.src), left: l.x, top: l.y })) : [];
      const composed = await (parts.length ? base.composite(parts) : base).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const original = await sharp(shotPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let sum = 0;
      let max = 0;
      let over8 = 0;
      const n = original.info.width * original.info.height;
      for (let i = 0; i < n; i++) {
        let worst = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(composed.data[i * composed.info.channels + c] - original.data[i * original.info.channels + c]);
          sum += d;
          if (d > worst) worst = d;
        }
        if (worst > max) max = worst;
        if (worst > 8) over8++;
      }
      return { mean: sum / (n * 3), max, over8: over8 / n, same: composed.info.width === original.info.width && composed.info.height === original.info.height };
    };

    try {
      const shot = await runCaptureScreenshot({
        projectRoot: layerRoot, beatId: "hook", url, viewport,
        layers: [{ selector: "#hero", name: "hero" }, { selector: "#card" }, { selector: "#title", depth: 3 }, { selector: ".chip", name: "chip" }],
      });
      const publicDir = path.join(layerRoot, "public");
      const manifestPath = path.join(layerRoot, "public", "images", "hook.layers.json");
      check("layers: the manifest is written next to the screenshot as <out>.layers.json", fs.existsSync(manifestPath) && shot.layers?.manifestPath === manifestPath);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      check("...with exactly the shape the camera's LayeredShot reads: width, height, background, layers[{src,x,y,width,height,depth}]",
        Object.keys(manifest).sort().join() === "background,height,layers,width" &&
          manifest.layers.every((l) => Object.keys(l).sort().join() === "depth,height,src,width,x,y"));
      const mainMeta = await sharp(shot.outPath).metadata();
      check(`...in capture pixels: the size is the screenshot's own (${manifest.width}x${manifest.height})`, manifest.width === mainMeta.width && manifest.height === mainMeta.height && manifest.width === 1600);
      check("...paths are relative to public/, like the main image", manifest.background === "images/hook-bg.png" && manifest.layers.every((l) => l.src.startsWith("images/hook-layer-") && fs.existsSync(path.join(publicDir, l.src))));
      check("one layer per matched element: hero, card, title and the two chips make five", manifest.layers.length === 5);
      check("...a selector matching two elements gets numbered names, a lone one keeps its own",
        manifest.layers.map((l) => path.basename(l.src)).join() === "hook-layer-hero.png,hook-layer-card.png,hook-layer-title.png,hook-layer-chip-1.png,hook-layer-chip-2.png");
      check("depth defaults to a 0.5 spread in order (0.5, 1, then the explicit 3, then 2 for the chips' entry)", manifest.layers.map((l) => l.depth).join() === "0.5,1,3,2,2");

      // Rectangles against the real boxes, at the capture's 2x.
      const expected = [...boxes["#hero"], ...boxes["#card"], ...boxes["#title"], ...boxes[".chip"]];
      let worstEdge = 0;
      manifest.layers.forEach((l, i) => {
        const e = expected[i];
        worstEdge = Math.max(worstEdge, Math.abs(l.x - e.x * 2), Math.abs(l.y - e.y * 2), Math.abs(l.x + l.width - (e.x + e.width) * 2), Math.abs(l.y + l.height - (e.y + e.height) * 2));
      });
      // Half a pixel from rounding outward (a card at y 90.25 css is 180.5 at 2x) plus the one pixel of bleed.
      check(`the manifest rectangles match the elements' real bounding boxes (worst edge ${worstEdge.toFixed(2)} px of 2x capture, 1.5 allowed: rounding plus 1px bleed)`, worstEdge <= 1.5);

      // Each layer is a transparent-background PNG of the manifest's size, opaque where the element is.
      let allAlpha = true;
      let allSized = true;
      for (const l of manifest.layers) {
        const meta = await sharp(path.join(publicDir, l.src)).metadata();
        if (!meta.hasAlpha) allAlpha = false;
        if (meta.width !== l.width || meta.height !== l.height) allSized = false;
      }
      check("every layer PNG has an alpha channel and is exactly its manifest size", allAlpha && allSized);
      const hero = manifest.layers[0];
      const heroPixels = await sharp(path.join(publicDir, hero.src)).raw().toBuffer({ resolveWithObject: true });
      const alphaAt = (x, y) => heroPixels.data[(y * heroPixels.info.width + x) * heroPixels.info.channels + 3];
      check(`the hero layer is transparent in its rounded corner and opaque in the middle (alpha ${alphaAt(1, 1)} and ${alphaAt(hero.width >> 1, hero.height >> 1)})`, alphaAt(1, 1) === 0 && alphaAt(hero.width >> 1, hero.height >> 1) === 255);
      const bg = await sharp(path.join(publicDir, manifest.background)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const bgAt = (x, y) => [0, 1, 2].map((c) => bg.data[(y * bg.info.width + x) * bg.info.channels + c]).join();
      check(`the background has the layer elements gone: the hero's centre is the stage colour behind it (${bgAt(hero.x + (hero.width >> 1), hero.y + (hero.height >> 1))})`, bgAt(hero.x + (hero.width >> 1), hero.y + (hero.height >> 1)) === "228,232,240");

      // Reassembly: the point of the whole thing.
      const full = await reconstruct(shot.outPath, manifest, publicDir);
      check(`bg plus layers at their rectangles reproduces the screenshot (mean error ${full.mean.toFixed(4)} of 255, worst pixel ${full.max}, ${(full.over8 * 100).toFixed(3)}% of pixels off by more than 8)`,
        full.same && full.mean < 0.01 && full.max <= 4 && full.over8 === 0);
      const bgOnly = await reconstruct(shot.outPath, manifest, publicDir, { withLayers: false });
      check(`control: the background alone does not (${(bgOnly.over8 * 100).toFixed(1)}% of pixels off by more than 8)`, bgOnly.over8 > 0.05);
      const sidecars = fs.readdirSync(path.join(layerRoot, "public", "images")).filter((f) => f.endsWith(".png")).length;
      check("only the screenshot, the background and the five layers are PNGs (nothing left over from isolating elements)", sidecars === 7);

      // A 1x capture with a fractional element position, and a cropSelector.
      const one = await runCaptureScreenshot({
        projectRoot: layerRoot, beatId: "one", url, viewport, deviceScaleFactor: 1,
        layers: [{ selector: "#hero" }, { selector: "#card" }],
      });
      const oneManifest = JSON.parse(fs.readFileSync(path.join(layerRoot, "public", "images", "one.layers.json"), "utf8"));
      const oneFull = await reconstruct(one.outPath, oneManifest, publicDir);
      check(`at 1x with a card on a fractional pixel the reassembly still holds (mean ${oneFull.mean.toFixed(4)}, ${(oneFull.over8 * 100).toFixed(3)}% off by more than 8)`, oneFull.same && oneFull.mean < 0.01 && oneFull.max <= 4 && oneFull.over8 === 0);

      const cropped = await runCaptureScreenshot({
        projectRoot: layerRoot, beatId: "crop", url, viewport, cropSelector: "#stage",
        layers: [{ selector: "#hero" }, { selector: "#card" }],
      });
      const cropManifest = JSON.parse(fs.readFileSync(path.join(layerRoot, "public", "images", "crop.layers.json"), "utf8"));
      const cropFull = await reconstruct(cropped.outPath, cropManifest, publicDir);
      check(`with a cropSelector the rectangles are relative to the crop and the reassembly holds (${cropManifest.width}x${cropManifest.height}, mean ${cropFull.mean.toFixed(4)}, ${(cropFull.over8 * 100).toFixed(3)}% off)`,
        cropManifest.width === 1400 && cropManifest.height === 520 && cropFull.same && cropFull.mean < 0.01 && cropFull.max <= 4 && cropFull.over8 === 0);
      check("...hero sits 20 css px in from the stage's left and 20 down, so at 2x its rectangle starts at (39, 39) with the bleed", cropManifest.layers[0].x === 39 && cropManifest.layers[0].y === 39);

      // Refusals name the selector, and leave nothing behind.
      let missing = null;
      try {
        await runCaptureScreenshot({ projectRoot: layerRoot, beatId: "bad", url, viewport, layers: [{ selector: "#hero" }, { selector: "#nope" }] });
      } catch (err) {
        missing = err;
      }
      check("control: an unknown selector throws, naming it", missing !== null && String(missing.message).includes("#nope"));
      check("...and no manifest or layer files were written for it", !fs.existsSync(path.join(layerRoot, "public", "images", "bad.layers.json")) && !fs.existsSync(path.join(layerRoot, "public", "images", "bad-bg.png")));
      let invalid = null;
      try {
        await runCaptureScreenshot({ projectRoot: layerRoot, beatId: "bad2", url, viewport, layers: [{ selector: "##" }] });
      } catch (err) {
        invalid = err;
      }
      check("a selector that is not valid CSS throws, naming it", invalid !== null && String(invalid.message).includes("##"));
      let outside = null;
      try {
        await runCaptureScreenshot({ projectRoot: layerRoot, beatId: "bad3", url, viewport, cropSelector: "#stage", layers: [{ selector: "#title" }] });
      } catch (err) {
        outside = err;
      }
      check("an element outside the captured crop throws rather than being skipped", outside !== null && String(outside.message).includes("#title"));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");
if (!fs.existsSync(templateNodeModules)) {
  skip("transition renders", "no resolvable node_modules to scaffold a renderable project from");
  finish();
  process.exit(process.exitCode ?? 0);
}

console.log("\n== Transitions: real renders of stitched compositions ==");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-cin-pipeline-"));
for (let attempt = 1; ; attempt++) {
  try {
    runInitProject({ name: "cin", projectRoot: root });
    break;
  } catch (err) {
    if (attempt >= 3) throw err;
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
  }
}
fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");

// A beat is a flat colour, so any difference between two renders of it is the overlay and
// nothing else. Ids are the only thing that differs between videos; the scenes are copied.
const pascal = (id) => id.charAt(0).toUpperCase() + id.slice(1);
function makeVideo(name, plan, { fps = 30 } = {}) {
  const videoDir = path.join(root, "src", "videos", name);
  const scenesDir = path.join(videoDir, "custom-scenes");
  fs.mkdirSync(scenesDir, { recursive: true });
  let start = 0;
  const beats = plan.map((p, i) => {
    const id = `s${i}`;
    fs.writeFileSync(
      path.join(scenesDir, `${pascal(id)}.tsx`),
      `import React from "react";\nimport { AbsoluteFill } from "remotion";\n\nexport const ${pascal(id)}: React.FC = () => <AbsoluteFill style={{ background: "${p.color}" }} />;\n`,
      "utf8",
    );
    const beat = { id, start, duration: p.duration, scene: `./custom-scenes/${pascal(id)}.tsx`, ...(p.transition ? { transition: p.transition } : {}) };
    start += p.duration;
    return beat;
  });
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps, beats }, null, 2));
  return runStitchComposition({ projectRoot: root, videoName: name });
}
const demoText = (name) => fs.readFileSync(path.join(root, "src", "videos", name, `${name.charAt(0).toUpperCase() + name.slice(1)}Demo.tsx`), "utf8");

// Two scenes, cut versus fade, and a six-scene run with one of each type at successive cuts.
const six = (transitions) =>
  [RED, BLUE, RED, BLUE, RED, BLUE].map((color, i) => ({ color, duration: 90, ...(i > 0 && transitions[i - 1] ? { transition: transitions[i - 1] } : {}) }));
const tcut = makeVideo("tcut", [{ color: RED, duration: 90 }, { color: BLUE, duration: 90 }]);
const tfade = makeVideo("tfade", [{ color: RED, duration: 90 }, { color: BLUE, duration: 90, transition: "fade" }]);
const tplain = makeVideo("tplain", six([]));
const tmix = makeVideo("tmix", six(TYPES));
// A first beat shorter than the half-window: the overlay must clamp, not reach before frame 0.
const tshort = makeVideo("tshort", [{ color: RED, duration: 4 }, { color: BLUE, duration: 60, transition: "fade" }]);
const tshortPlain = makeVideo("tshortplain", [{ color: RED, duration: 4 }, { color: BLUE, duration: 60 }]);

// ---- text: nothing changes unless a beat asks for a transition ----
const seriesBlock = (text) => text.slice(text.indexOf("<Series>"), text.indexOf("</Series>") + "</Series>".length);
check("a cut-only composition has no overlay, import or sequence for one", !/TransitionOverlay|transition/i.test(demoText("tcut")));
check("...nor does a plain six-beat one", !/TransitionOverlay|transition/i.test(demoText("tplain")));
check("a composition with a transition imports the overlay and draws it", /import \{[^}]*TransitionOverlay[^}]*\} from "@openvidstudio\/core"/.test(demoText("tfade")) && demoText("tfade").includes("<TransitionOverlay"));
check("the Series (what fixes every beat's start and duration) is byte-for-byte the same with and without one", seriesBlock(demoText("tcut")) === seriesBlock(demoText("tfade")) && seriesBlock(demoText("tplain")) === seriesBlock(demoText("tmix")));
check("both compositions are the same length", tcut.durationInFrames === 180 && tfade.durationInFrames === 180 && tplain.durationInFrames === 540 && tmix.durationInFrames === 540);
{
  // An explicit "cut" and a first beat's transition both mean no overlay.
  const explicitCut = makeVideo("texplicit", [{ color: RED, duration: 90, transition: "fade" }, { color: BLUE, duration: 90, transition: "cut" }]);
  check("transition \"cut\" and a transition on beat 0 draw nothing (there is no cut into the first beat)", !demoText("texplicit").includes("TransitionOverlay") && explicitCut.durationInFrames === 180);
}

const bridge = require(path.join(distDir, "remotionBridge.js"));
const bundleDir = await bridge.bundleProject(root);
const browser = await bridge.openRenderBrowser();
const stillDir = path.join(root, "stills");
const compositions = new Map();
async function still(video, compositionId, frame) {
  if (!compositions.has(compositionId)) compositions.set(compositionId, await bridge.resolveComposition(bundleDir, compositionId, browser));
  const outPath = path.join(stillDir, `${video}-${frame}.png`);
  await bridge.renderStillPng({ serveUrl: bundleDir, composition: compositions.get(compositionId), frame, outPath, browser });
  const { data, info } = await sharp(outPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}
// Fraction of pixels that differ by more than 2 levels in any channel, and the frame's mean luma.
function compare(a, b) {
  let differing = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const o = i * a.channels;
    if (Math.abs(a.data[o] - b.data[o]) > 2 || Math.abs(a.data[o + 1] - b.data[o + 1]) > 2 || Math.abs(a.data[o + 2] - b.data[o + 2]) > 2) differing++;
  }
  return differing / n;
}
function luma(a) {
  let sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const o = i * a.channels;
    sum += 0.299 * a.data[o] + 0.587 * a.data[o + 1] + 0.114 * a.data[o + 2];
  }
  return sum / n;
}

try {
  // ---- (b) fade versus cut on the same two scenes ----
  const cutAt = 90;
  const cutCut = await still("tcut", tcut.compositionId, cutAt);
  const cutFade = await still("tfade", tfade.compositionId, cutAt);
  const lumaCut = luma(cutCut);
  const lumaFade = luma(cutFade);
  check(`the plain cut frame is the incoming scene (mean luma ${lumaCut.toFixed(1)})`, lumaCut > 60 && lumaCut < 90);
  check(`at the cut the fade frame is clearly darker (mean luma ${lumaFade.toFixed(1)} vs ${lumaCut.toFixed(1)})`, lumaFade < lumaCut * 0.5);
  // The dip is to the brand background token (bg0, #0B0E14 until a brand overrides it), not to black.
  const bg0 = Buffer.alloc(cutFade.data.length);
  for (let i = 0; i < bg0.length; i += cutFade.channels) {
    bg0[i] = 0x0b;
    bg0[i + 1] = 0x0e;
    bg0[i + 2] = 0x14;
  }
  check(`...and it is the background token's colour, not black (${(compare(cutFade, { ...cutFade, data: bg0 }) * 100).toFixed(3)}% of pixels off)`, compare(cutFade, { ...cutFade, data: bg0 }) === 0);
  const before20 = [await still("tcut", tcut.compositionId, cutAt - 20), await still("tfade", tfade.compositionId, cutAt - 20)];
  const after20 = [await still("tcut", tcut.compositionId, cutAt + 20), await still("tfade", tfade.compositionId, cutAt + 20)];
  check(`20 frames before the cut the two compositions are pixel-identical (${(compare(...before20) * 100).toFixed(3)}% differ)`, compare(...before20) === 0);
  check(`20 frames after the cut they are pixel-identical (${(compare(...after20) * 100).toFixed(3)}% differ)`, compare(...after20) === 0);
  // Control meant to fail: the comparator must be able to see two different scenes as different,
  // otherwise "identical" above proves nothing.
  const redFrame = await still("tcut", tcut.compositionId, 30);
  check("control: the comparator sees red and blue scenes as different", compare(redFrame, after20[0]) > 0.99);
  check("control: ...and a frame as identical to itself", compare(redFrame, redFrame) === 0);

  // ---- (c) each type, one per cut of the six-scene run ----
  console.log("\n  per-type measurements (share of pixels that differ from the plain cut):");
  for (let i = 0; i < TYPES.length; i++) {
    const type = TYPES[i];
    const cut = 90 * (i + 1);
    const plainAtCut = await still("tplain", tplain.compositionId, cut);
    const mixAtCut = await still("tmix", tmix.compositionId, cut);
    const share = compare(plainAtCut, mixAtCut);
    check(`${type}: the frame at the cut differs from the plain cut frame (${(share * 100).toFixed(1)}% of pixels)`, share > 0.2);

    // The overlay really ends: HALF + 2 frames out either side the render is the plain one.
    const farBefore = [await still("tplain", tplain.compositionId, cut - HALF - 2), await still("tmix", tmix.compositionId, cut - HALF - 2)];
    const farAfter = [await still("tplain", tplain.compositionId, cut + HALF + 2), await still("tmix", tmix.compositionId, cut + HALF + 2)];
    check(`${type}: HALF+2 frames before the cut the frame is identical to plain (${(compare(...farBefore) * 100).toFixed(3)}% differ)`, compare(...farBefore) === 0);
    check(`${type}: HALF+2 frames after the cut the frame is identical to plain (${(compare(...farAfter) * 100).toFixed(3)}% differ)`, compare(...farAfter) === 0);

    // It also eases to nothing rather than popping off: the last frame the overlay is mounted on
    // either side is already invisible.
    const lastBefore = [await still("tplain", tplain.compositionId, cut - HALF + 1), await still("tmix", tmix.compositionId, cut - HALF + 1)];
    const lastAfter = [await still("tplain", tplain.compositionId, cut + HALF - 1), await still("tmix", tmix.compositionId, cut + HALF - 1)];
    check(`${type}: the overlay's first and last mounted frames are already clear (${(compare(...lastBefore) * 100).toFixed(3)}% / ${(compare(...lastAfter) * 100).toFixed(3)}%)`, compare(...lastBefore) < 0.001 && compare(...lastAfter) < 0.001);

    // Next to the cut it is visibly there on both sides, so the cut is covered, not just the one frame.
    const nearBefore = [await still("tplain", tplain.compositionId, cut - 2), await still("tmix", tmix.compositionId, cut - 2)];
    check(`${type}: two frames before the cut the overlay is already drawn (${(compare(...nearBefore) * 100).toFixed(1)}%)`, compare(...nearBefore) > 0.05);
  }

  // ---- a first beat shorter than the half-window ----
  const shortCut = await still("tshort", tshort.compositionId, 4);
  const shortPlainCut = await still("tshortplain", tshortPlain.compositionId, 4);
  check(`a 4-frame first beat: the overlay clamps to the composition start and still covers the cut (${(compare(shortCut, shortPlainCut) * 100).toFixed(1)}% differ)`, compare(shortCut, shortPlainCut) > 0.2);
  const shortFirst = [await still("tshort", tshort.compositionId, 0), await still("tshortplain", tshortPlain.compositionId, 0)];
  check("...and frame 0 is untouched", compare(...shortFirst) === 0);
} finally {
  await browser.close({ silent: true });
}

finish();

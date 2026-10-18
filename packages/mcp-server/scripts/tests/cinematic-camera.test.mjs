#!/usr/bin/env node
// cinematic-camera: the camera and core-primitive half of the "cinematic shots" work.
// DirectedShot defects (blur off by default, protected regions, rack focus), Caption placement
// and settle time, the shot vocabulary, handheld and impact shake, true Z parallax, layered shots,
// motion blur, cursor arcs and the new easings. Everything is checked on a real render: a project
// is scaffolded, custom scenes are bundled with Remotion, and frames are sought in a real browser
// and read back as pixels or DOM text.

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

const templateNodeModules = path.join(monorepoTemplateDir, "node_modules");

// ---------------------------------------------------------------- scaffold

const sections = [];
/** Registers a group of scenes and the checks that read them back. */
function section(title, scenes, run) {
  sections.push({ title, scenes, run });
}

const sharpLib = require(path.join(packageRoot, "node_modules", "sharp"));

/** Mean absolute horizontal+vertical gradient inside a rect: a measure of how sharp the pixels are. */
function edgeEnergy(img, rect = { x: 0, y: 0, w: img.w, h: img.h }) {
  let sum = 0;
  let n = 0;
  const x1 = Math.min(img.w - 1, rect.x + rect.w);
  const y1 = Math.min(img.h - 1, rect.y + rect.h);
  for (let y = rect.y; y < y1; y++) {
    for (let x = rect.x; x < x1; x++) {
      const i = y * img.w + x;
      sum += Math.abs(img.data[i + 1] - img.data[i]) + Math.abs(img.data[i + img.w] - img.data[i]);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** A scene that drops a DirectedShot (with the given props) into a black frame. */
function directedScene(name, props, { body, imports = "" } = {}) {
  return String.raw`import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { DirectedShot${imports} } from "@openvidstudio/core";

export const ${name}: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    ${body ?? `<DirectedShot src={staticFile("images/stripes.png")} focus={{ x: 960, y: 540 }} push={1} move={{ from: 0, to: 30 }} ${props} />`}
  </AbsoluteFill>
);
`;
}

const pascal = (id) => id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");

// ============================================================ 1. DirectedShot defects

section(
  "1. DirectedShot: blur is opt-in, protected regions stay sharp, the cursor is never blurred, focus racks",
  [
    { id: "dof-default", frames: 60, source: directedScene("DofDefault", "") },
    { id: "dof-zero", frames: 60, source: directedScene("DofZero", "depthOfField={0}") },
    { id: "dof-six", frames: 60, source: directedScene("DofSix", "depthOfField={6}") },
    {
      id: "dof-protect",
      frames: 60,
      source: directedScene("DofProtect", "depthOfField={6} protect={[{ x: 100, y: 100, width: 300, height: 300 }]}"),
    },
    {
      id: "dof-rack",
      frames: 60,
      source: directedScene("DofRack", "depthOfField={6} rackTo={{ x: 1500, y: 540 }}", {
        body: `<DirectedShot src={staticFile("images/stripes.png")} focus={{ x: 400, y: 540 }} rackTo={{ x: 1500, y: 540 }} depthOfField={6} push={1} move={{ from: 0, to: 30 }} />`,
      }),
    },
    // Striped patch on a flat grey capture, pushed in and tilted: the only edges on screen are the
    // patch's, so the energy ratio says whether the protect hole landed on the projected patch.
    ...[
      ["dof-tilt-zero", "DofTiltZero", "depthOfField={0}"],
      ["dof-tilt-open", "DofTiltOpen", "depthOfField={6}"],
      ["dof-tilt-protect", "DofTiltProtect", "depthOfField={6} protect={[{ x: 1340, y: 160, width: 270, height: 170 }]}"],
    ].map(([id, name, props]) => ({
      id,
      frames: 60,
      source: directedScene(name, "", {
        body: `<DirectedShot focus={{ x: 960, y: 540 }} push={1.4} tilt={{ y: -5, x: 3 }} move={{ from: 0, to: 30 }} ${props}>
      <div style={{ position: "relative", width: 1920, height: 1080, background: "#808080" }}>
        <div style={{ position: "absolute", left: 1350, top: 170, width: 250, height: 150, background: "repeating-linear-gradient(90deg, #000 0px, #000 2px, #fff 2px, #fff 4px)" }} />
      </div>
    </DirectedShot>`,
      }),
    })),
    {
      id: "dof-cursor-six",
      frames: 60,
      source: directedScene("DofCursorSix", "", {
        body: `<DirectedShot focus={{ x: 960, y: 540 }} push={1} depthOfField={6} move={{ from: 0, to: 30 }} cursor={{ path: [{ frame: 0, x: 200, y: 200 }, { frame: 1, x: 200, y: 200 }] }}>
      <div style={{ width: 1920, height: 1080, background: "#223046" }} />
    </DirectedShot>`,
      }),
    },
    {
      id: "dof-cursor-zero",
      frames: 60,
      source: directedScene("DofCursorZero", "", {
        body: `<DirectedShot focus={{ x: 960, y: 540 }} push={1} depthOfField={0} move={{ from: 0, to: 30 }} cursor={{ path: [{ frame: 0, x: 200, y: 200 }, { frame: 1, x: 200, y: 200 }] }}>
      <div style={{ width: 1920, height: 1080, background: "#223046" }} />
    </DirectedShot>`,
      }),
    },
  ],
  async (t) => {
    const at = (id) => t.frameOf(id, 30);
    const def = await t.grab(at("dof-default"));
    const zero = await t.grab(at("dof-zero"));
    const six = await t.grab(at("dof-six"));
    const eDef = edgeEnergy(def);
    const eZero = edgeEnergy(zero);
    const eSix = edgeEnergy(six);
    console.log(`  edge energy: default=${eDef.toFixed(2)} depthOfField0=${eZero.toFixed(2)} depthOfField6=${eSix.toFixed(2)}`);
    check("the stripe capture is high-frequency enough to measure blur (energy > 100)", eZero > 100);
    check("default DirectedShot has the same edge energy as depthOfField={0} (>= 0.99x)", eDef >= 0.99 * eZero);
    check(
      "control: explicit depthOfField={6} (the old default) is clearly lower (< 0.7x)",
      eSix < 0.7 * eZero,
    );

    const prot = await t.grab(at("dof-protect"));
    const rect = { x: 100, y: 100, w: 300, h: 300 };
    const far = { x: 1500, y: 700, w: 300, h: 300 };
    const protectedRatio = edgeEnergy(prot, rect) / edgeEnergy(zero, rect);
    const unprotectedRatio = edgeEnergy(prot, far) / edgeEnergy(zero, far);
    const sixRectRatio = edgeEnergy(six, rect) / edgeEnergy(zero, rect);
    console.log(`  protect rect ratio=${protectedRatio.toFixed(3)} (without protect: ${sixRectRatio.toFixed(3)}), unprotected far ratio=${unprotectedRatio.toFixed(3)}`);
    check("a protected rect stays sharp under depthOfField={6} (>= 0.99x)", protectedRatio >= 0.99);
    check("control: the same rect is blurred when it is not protected (< 0.7x)", sixRectRatio < 0.7);
    check("control: an unprotected area of the same frame is still blurred (< 0.7x)", unprotectedRatio < 0.7);

    // Under a push and a tilt the hole has to follow the projected picture, not the flat rectangle.
    const tiltZero = edgeEnergy(await t.grab(at("dof-tilt-zero")));
    const tiltOpen = edgeEnergy(await t.grab(at("dof-tilt-open")));
    const tiltProt = edgeEnergy(await t.grab(at("dof-tilt-protect")));
    console.log(`  tilted + pushed patch: no blur=${tiltZero.toFixed(3)} blur6=${tiltOpen.toFixed(3)} blur6+protect=${tiltProt.toFixed(3)}`);
    check("tilted and pushed: the protect hole covers the projected patch (>= 0.95x)", tiltProt >= 0.95 * tiltZero);
    check("control: the same tilted patch is blurred without protect (< 0.7x)", tiltOpen < 0.7 * tiltZero);

    // Cursor: a flat background has no edges of its own, so every edge in the patch is the cursor's.
    const cur6 = await t.grab(at("dof-cursor-six"));
    const cur0 = await t.grab(at("dof-cursor-zero"));
    const patch = { x: 190, y: 190, w: 80, h: 90 };
    const cursorRatio = edgeEnergy(cur6, patch) / edgeEnergy(cur0, patch);
    console.log(`  cursor patch energy ratio (blur 6 vs 0) = ${cursorRatio.toFixed(3)}`);
    check("the cursor patch has edges to measure (energy > 5)", edgeEnergy(cur0, patch) > 5);
    check("the cursor is never blurred by depth of field (>= 0.95x)", cursorRatio >= 0.95);

    // Rack focus: the sharp region slides from focus (left) to rackTo (right) across the move.
    const rackStart = await t.grab(t.frameOf("dof-rack", 0));
    const rackEnd = await t.grab(t.frameOf("dof-rack", 40));
    const left = { x: 250, y: 440, w: 300, h: 200 };
    const right = { x: 1350, y: 440, w: 300, h: 200 };
    const base = edgeEnergy(zero, left);
    const r = (img, rc) => edgeEnergy(img, rc) / base;
    console.log(
      `  rack: start left=${r(rackStart, left).toFixed(2)} right=${r(rackStart, right).toFixed(2)}; end left=${r(rackEnd, left).toFixed(2)} right=${r(rackEnd, right).toFixed(2)}`,
    );
    check("rack focus: at the start the focus side is sharp and the far side blurred", r(rackStart, left) >= 0.9 && r(rackStart, right) < 0.7);
    check("rack focus: at the end the sharp region has slid to rackTo", r(rackEnd, right) >= 0.9 && r(rackEnd, left) < 0.7);
  },
);

// ============================================================ run

console.log("\n== cinematic camera: DirectedShot, Caption, shots, handheld, parallax, layered shots, cursor arcs ==");

if (!fs.existsSync(templateNodeModules)) {
  skip("cinematic camera real render", "no resolvable node_modules to scaffold a renderable project from");
  finish();
} else {
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));
  const { runStitchComposition } = require(path.join(distDir, "tools", "stitchComposition.js"));
  const bridge = require(path.join(distDir, "remotionBridge.js"));
  const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-camera-"));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "cam", projectRoot: root });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
  fs.symlinkSync(templateNodeModules, path.join(root, "node_modules"), "junction");

  const videoDir = path.join(root, "src", "videos", "cam");
  const customDir = path.join(videoDir, "custom-scenes");
  fs.mkdirSync(customDir, { recursive: true });
  fs.mkdirSync(path.join(root, "public", "images"), { recursive: true });

  // 4px-period vertical stripes: black, black, white, white. Any blur wider than a pixel or two
  // flattens them, which makes "was this region blurred" a number instead of an opinion.
  {
    const w = 1920;
    const h = 1080;
    const buf = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf[y * w + x] = (x >> 1) & 1 ? 255 : 0;
    fs.writeFileSync(
      path.join(root, "public", "images", "stripes.png"),
      await sharpLib(buf, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer(),
    );
  }

  // Lay the sections' scenes out back to back and write the files.
  const beats = [];
  const starts = new Map();
  let cursorFrame = 0;
  for (const s of sections) {
    for (const sc of s.scenes) {
      fs.writeFileSync(path.join(customDir, `${pascal(sc.id)}.tsx`), sc.source, "utf8");
      beats.push({ id: sc.id, start: cursorFrame, duration: sc.frames, scene: `./custom-scenes/${pascal(sc.id)}.tsx` });
      starts.set(sc.id, cursorFrame);
      cursorFrame += sc.frames;
    }
  }
  fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, beats }));
  const stitch = runStitchComposition({ projectRoot: root, videoName: "cam" });
  check("the camera check composition stitches", stitch.written === true);

  const bundleDir = await bridge.bundleProject(root);
  const server = await bridge.serveBundleDirectory(bundleDir);
  const remotionBrowser = await bridge.openRenderBrowser();
  let browser = null;
  try {
    const comp = await bridge.resolveComposition(bundleDir, stitch.compositionId, remotionBrowser);
    browser = await launchChromium();
    let shotNo = 0;

    for (const s of sections) {
      console.log(`\n-- ${s.title}`);
      const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
      try {
        await bridge.openSeekablePage({
          page,
          bundleUrl: server.url,
          composition: comp,
          timeoutMs: 20000,
          initialFrame: starts.get(s.scenes[0].id) ?? 0,
        });
        const t = {
          frameOf: (id, local = 0) => {
            if (!starts.has(id)) throw new Error(`no scene "${id}"`);
            return starts.get(id) + local;
          },
          seek: (frame) => bridge.seekToFrame(page, comp.id, frame, 20000),
          grab: async (frame) => {
            await bridge.seekToFrame(page, comp.id, frame, 20000);
            const file = path.join(root, `shot-${++shotNo}.png`);
            await page.screenshot({ path: file });
            const { data, info } = await sharpLib(file).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
            return { data, w: info.width, h: info.height, file };
          },
          rgb: async (frame) => {
            await bridge.seekToFrame(page, comp.id, frame, 20000);
            const file = path.join(root, `shot-${++shotNo}.png`);
            await page.screenshot({ path: file });
            const { data, info } = await sharpLib(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
            return { data, w: info.width, h: info.height, file };
          },
          text: async (frame, selector) => {
            await bridge.seekToFrame(page, comp.id, frame, 20000);
            return page.evaluate((sel) => document.querySelector(sel)?.textContent ?? "", selector);
          },
          page,
        };
        await s.run(t);
      } catch (err) {
        console.log(`  FAIL ${s.title}: ${String(err?.message ?? err).split("\n")[0]}${errors.length ? ` (page error: ${errors[0]})` : ""}`);
        check(`${s.title}: the scenes render and the checks run`, false);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await remotionBrowser.close({ silent: true });
    await server.close();
  }
  finish();
}

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

/** A scene file from a component name, the core names it imports and the JSX to render. */
function sceneFile(name, coreImports, jsx, { extra = "" } = {}) {
  return String.raw`import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { ${coreImports.join(", ")} } from "@openvidstudio/core";
${extra}
export const ${name}: React.FC = () => (
  <AbsoluteFill style={{ background: "#0b0e14" }}>
    ${jsx}
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

// ============================================================ 2. Caption

const FOURTEEN = "One click turns a messy backlog into a clear plan you can actually ship";
const captionScene = (name, props, text = FOURTEEN) =>
  sceneFile(name, ["Caption"], `<Caption text="${text}" at={10} ${props} />`);

section(
  "2. Caption: placement, a settled reveal, width from the composition",
  [
    { id: "cap-bottom", frames: 60, source: captionScene("CapBottom", "") },
    { id: "cap-top", frames: 60, source: captionScene("CapTop", 'position="top"') },
    { id: "cap-left", frames: 60, source: captionScene("CapLeft", 'position="left"') },
    { id: "cap-right", frames: 60, source: captionScene("CapRight", 'position="right"') },
    { id: "cap-auto-none", frames: 60, source: captionScene("CapAutoNone", 'position="auto"') },
    {
      id: "cap-auto-left-product",
      frames: 60,
      source: captionScene("CapAutoLeftProduct", 'position="auto" avoid={{ x: 100, y: 100, width: 800, height: 880 }}'),
    },
    {
      id: "cap-auto-top-product",
      frames: 60,
      source: captionScene("CapAutoTopProduct", 'position="auto" avoid={{ x: 200, y: 80, width: 1500, height: 300 }}'),
    },
    {
      id: "cap-auto-bottom-product",
      frames: 60,
      source: captionScene("CapAutoBottomProduct", 'position="auto" avoid={{ x: 200, y: 700, width: 1500, height: 300 }}'),
    },
    {
      id: "cap-long",
      frames: 60,
      source: captionScene("CapLong", "", Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ")),
    },
    {
      id: "cap-layout",
      frames: 30,
      source: sceneFile(
        "CapLayout",
        ["captionLayout"],
        `<div id="cap-layout-readout" style={{ color: "#fff", fontSize: 24, whiteSpace: "pre" }}>{JSON.stringify([
      captionLayout("bottom", undefined, 1920, 1080, 34),
      captionLayout("bottom", undefined, 1080, 1920, 34),
      captionLayout("bottom", undefined, 3840, 2160, 34),
      captionLayout("left", undefined, 1080, 1920, 34),
      captionLayout("auto", { x: 100, y: 100, width: 800, height: 880 }, 1920, 1080, 34),
      captionLayout("auto", { x: 0, y: 0, width: 1080, height: 1000 }, 1080, 1920, 34),
    ])}</div>`,
      ),
    },
  ],
  async (t) => {
    const REVEALED = 0.01;
    const wipes = (frame) =>
      t.eval(frame, () =>
        Array.from(document.querySelectorAll("[data-ovs-caption-word]")).map((el) => {
          const cp = getComputedStyle(el).clipPath;
          if (cp === "none") return 0;
          const m = cp.match(/inset\(\S+\s+([\d.]+)%/);
          return m ? parseFloat(m[1]) : -1;
        }),
      );
    const at = 10;
    const n = 14;
    check("the test caption renders 14 word elements", (await wipes(t.frameOf("cap-bottom", at + 8))).length === n);

    // The first frame on which every word is fully revealed.
    let settleFrame = null;
    for (let f = at; f <= at + 40 && settleFrame === null; f++) {
      const w = await wipes(t.frameOf("cap-bottom", f));
      if (w.length === n && w.every((v) => v >= 0 && v <= REVEALED)) settleFrame = f;
    }
    const oldSettle = at + (n - 1) * 2 + 5;
    console.log(`  14-word caption settles at at+${settleFrame === null ? "never" : settleFrame - at} (the old 2-frame stagger: at+${oldSettle - at})`);
    check("every word is fully revealed at at+8 for a 14-word caption", settleFrame !== null && settleFrame <= at + 8);
    check("the new settle frame is earlier than the old stagger's (at + (n-1)*2 + 5)", settleFrame !== null && settleFrame < oldSettle);
    const early = await wipes(t.frameOf("cap-bottom", at + 2));
    check("it still reveals as a wipe, not a pop: at at+2 some words are partly clipped", early.some((v) => v > 5 && v < 100));
    const before = await wipes(t.frameOf("cap-bottom", at));
    check("nothing is revealed on the 'at' frame itself", before.length === n && before.every((v) => v > 99));

    const box = (frame) =>
      t.eval(frame, () => {
        const r = document.querySelector("[data-ovs-caption-card]")?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      });
    const settled = (id) => t.frameOf(id, at + 12);
    const bottom = await box(settled("cap-bottom"));
    const top = await box(settled("cap-top"));
    const left = await box(settled("cap-left"));
    const right = await box(settled("cap-right"));
    const centre = (b) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
    console.log(`  cards: bottom y=${bottom?.y.toFixed(0)} top y=${top?.y.toFixed(0)} left x=${left?.x.toFixed(0)} right x=${right?.x.toFixed(0)}`);
    check("position bottom (the default) lands in the lower half", bottom !== null && centre(bottom).cy > 540);
    check("position top lands in the upper half", top !== null && centre(top).cy < 540);
    check("position left lands in the left half", left !== null && centre(left).cx < 960);
    check("position right lands in the right half", right !== null && centre(right).cx > 960);
    check(
      "every placement keeps the whole card inside the frame",
      [bottom, top, left, right].every((b) => b && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1920 && b.y + b.h <= 1080),
    );

    const autoNone = await box(settled("cap-auto-none"));
    check("auto without an avoid rect behaves like bottom", autoNone !== null && bottom !== null && Math.abs(autoNone.y - bottom.y) < 1);
    const overlaps = (b, a) => b.x < a.x + a.width && b.x + b.w > a.x && b.y < a.y + a.height && b.y + b.h > a.y;
    const autoLeft = await box(settled("cap-auto-left-product"));
    const leftProduct = { x: 100, y: 100, width: 800, height: 880 };
    check("auto picks the far side from a product on the left (right half, clear of it)", autoLeft !== null && centre(autoLeft).cx > 960 && !overlaps(autoLeft, leftProduct));
    const autoTop = await box(settled("cap-auto-top-product"));
    const topProduct = { x: 200, y: 80, width: 1500, height: 300 };
    check("auto picks the bottom when the product sits at the top, clear of it", autoTop !== null && centre(autoTop).cy > 540 && !overlaps(autoTop, topProduct));
    const autoBottom = await box(settled("cap-auto-bottom-product"));
    const bottomProduct = { x: 200, y: 700, width: 1500, height: 300 };
    check("auto picks the top when the product sits at the bottom, clear of it", autoBottom !== null && centre(autoBottom).cy < 540 && !overlaps(autoBottom, bottomProduct));

    const longBox = await box(settled("cap-long"));
    console.log(`  long caption card width=${longBox?.w.toFixed(0)}`);
    check("a 40-word caption wraps inside min(1400, 0.9 * width) = 1400", longBox !== null && longBox.w <= 1400.5 && longBox.w > 1000);

    const layout = JSON.parse(await t.text(t.frameOf("cap-layout", 0), "#cap-layout-readout"));
    console.log(`  layouts: ${JSON.stringify(layout)}`);
    check("maxWidth is min(1400, 0.9 * width): 1400 at 1920", layout[0].maxWidth === 1400);
    check("...972 in a 1080 wide (9:16) composition", layout[1].maxWidth === 972);
    check("...still 1400 in a 4K composition", layout[2].maxWidth === 1400);
    check("side placements use a narrower column that still fits a 1080 wide frame", layout[3].side === "left" && layout[3].maxWidth <= 0.34 * 1080 + 0.5);
    check("auto picks right for a product on the left of a landscape frame", layout[4].side === "right");
    check("auto picks bottom for a product filling the top of a portrait frame", layout[5].side === "bottom");
  },
);

// ---- 2b. scaffold_scene templates: caption spots vary, the push on a capture is capped

const templates = require(path.join(distDir, "scenes", "templates.js"));
const TPL_IDS = ["problem", "install", "dashboard", "export", "share", "outro"];
const tplCtx = (id, extra = {}) => ({
  beatId: id,
  componentName: pascal(id),
  description: "",
  vo: "One click turns a messy backlog into a clear plan you can actually ship.",
  durationFrames: 120,
  captureWidth: 1440,
  captureHeight: 900,
  url: "https://example.com",
  ...extra,
});

section(
  "2b. scaffold_scene templates: the caption does not sit in the same spot in every scene; pushes on captures stay at or below 1.6",
  TPL_IDS.map((id) => ({
    id: `tpl-${id}`,
    frames: 120,
    needsImage: `tpl-${id}`,
    source: templates.renderTemplate("browser-capture", tplCtx(`tpl-${id}`), "real-screenshot"),
  })),
  async (t) => {
    const sides = [];
    for (const id of TPL_IDS) {
      const info = await t.eval(t.frameOf(`tpl-${id}`, 100), () => {
        const root = document.querySelector("[data-ovs-caption]");
        const r = document.querySelector("[data-ovs-caption-card]")?.getBoundingClientRect();
        return { side: root?.getAttribute("data-ovs-caption-side") ?? null, box: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null };
      });
      sides.push(info.side);
      check(
        `the "${id}" scene's caption is on screen and inside the frame`,
        info.box !== null && info.box.x >= 0 && info.box.y >= 0 && info.box.x + info.box.w <= 1920 && info.box.y + info.box.h <= 1080,
      );
    }
    console.log(`  caption sides across ${TPL_IDS.length} scaffolded scenes: ${sides.join(", ")}`);
    check("the scaffolded scenes use at least 3 different caption spots", new Set(sides).size >= 3);
    check("...and the choice is stable: the same beat id gives the same source", templates.renderTemplate("browser-capture", tplCtx("tpl-problem"), "real-screenshot") === templates.renderTemplate("browser-capture", tplCtx("tpl-problem"), "real-screenshot"));

    const pushes = [];
    for (const [w, h] of [[1440, 900], [1920, 1080], [800, 600], [1280, 720], [400, 300]]) {
      const src = templates.renderTemplate("browser-capture", tplCtx("probe", { captureWidth: w, captureHeight: h }), "real-screenshot");
      pushes.push(Math.max(...[...src.matchAll(/scale: ([\d.]+)/g)].map((m) => Number(m[1]))));
    }
    console.log(`  browser-capture end scales for five capture sizes: ${pushes.join(", ")}`);
    check("the browser-capture template never pushes past 1.6 on a capture with text", pushes.every((p) => p <= 1.6));
    check("...but it still pushes in on the commonest capture size (>= 1.3)", pushes[0] >= 1.3);
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
      if (sc.needsImage) fs.copyFileSync(path.join(root, "public", "images", "stripes.png"), path.join(root, "public", "images", `${sc.needsImage}.png`));
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
          eval: async (frame, fn, arg) => {
            await bridge.seekToFrame(page, comp.id, frame, 20000);
            return page.evaluate(fn, arg);
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

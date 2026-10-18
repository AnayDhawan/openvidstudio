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
function sceneFile(name, coreImports, jsx, { extra = "", remotion = "" } = {}) {
  return String.raw`import React from "react";
import { AbsoluteFill, staticFile${remotion} } from "remotion";
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

// ============================================================ 3. Shot vocabulary

/** Share of pixels near a colour, over the whole frame. */
const colourShare = (img, [r, g, b], tol = 60) => {
  let hit = 0;
  for (let i = 0; i < img.data.length; i += 3) {
    if (Math.abs(img.data[i] - r) < tol && Math.abs(img.data[i + 1] - g) < tol && Math.abs(img.data[i + 2] - b) < tol) hit++;
  }
  return hit / (img.data.length / 3);
};
const RED = [220, 30, 30];
const BLUE = [30, 60, 230];

const shotScene = (name, props) =>
  directedScene(name, "", {
    body: `<DirectedShot src={staticFile("images/halves.png")} focus={{ x: 1500, y: 540 }} ${props} />`,
  });

section(
  "3. shot vocabulary: pushIn, pullOut, pan, whip, orbit, dutch, hold, drift",
  [
    {
      id: "shot-readout",
      frames: 30,
      source: sceneFile(
        "ShotReadout",
        ["resolveShot", "directedKeyframes", "resolveCamera", "SHOT_NAMES", "E"],
        `<div id="shot-readout" style={{ color: "#fff", fontSize: 18, whiteSpace: "pre" }}>{JSON.stringify((() => {
      const frames = [0, 9, 18, 40, 60, 90, 120, 150];
      const base = { W: 1920, H: 1080, captureWidth: 1920, captureHeight: 1080, focus: { x: 1500, y: 540 } };
      const out = { names: SHOT_NAMES, plans: {}, cams: {}, easeMid: E.whip(0.5) };
      for (const name of SHOT_NAMES) {
        const p = resolveShot(name, { focus: base.focus });
        out.plans[name] = { ...p, easing: p.easing(0.5) };
        const kfs = directedKeyframes({ ...base, shot: name });
        out.cams[name] = frames.map((f) => ({ f, ...resolveCamera(kfs, f) }));
      }
      out.pushOverride = resolveShot("pushIn", { push: 2 }).endScale;
      out.pullOverride = resolveShot("pullOut", { push: 2 }).startScale;
      const won = directedKeyframes({ ...base, shot: "whip", move: { from: 0, to: 60 }, push: 1.2, tilt: { z: 2 } });
      out.explicit = { lastFrame: won[won.length - 1].frame, scale: won[won.length - 1].scale, rotZ: won[won.length - 1].rotZ };
      return out;
    })())}</div>`,
      ),
    },
    { id: "shot-push-in", frames: 160, source: shotScene("ShotPushIn", 'shot="pushIn"') },
    { id: "shot-pull-out", frames: 160, source: shotScene("ShotPullOut", 'shot="pullOut"') },
    { id: "shot-hold", frames: 160, source: shotScene("ShotHold", 'shot="hold"') },
    { id: "shot-dutch", frames: 160, source: shotScene("ShotDutch", 'shot="dutch"').replace("x: 1500", "x: 960") },
    { id: "shot-orbit", frames: 160, source: shotScene("ShotOrbit", 'shot="orbit"').replace("x: 1500", "x: 960").replace("halves.png", "bars.png") },
    { id: "shot-whip", frames: 90, source: shotScene("ShotWhip", 'shot="whip"') },
  ],
  async (t) => {
    const r = JSON.parse(await t.text(t.frameOf("shot-readout", 0), "#shot-readout"));
    const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
    check("all eight shots exist", ["pushIn", "pullOut", "pan", "whip", "orbit", "dutch", "hold", "drift"].every((n) => r.names.includes(n)));
    const finite = (p) => [p.startScale, p.endScale, p.startFocus.x, p.startFocus.y, p.endFocus.x, p.endFocus.y, p.moveFrames, p.easing].every(Number.isFinite);
    check("every shot resolves to finite numbers", r.names.every((n) => finite(r.plans[n])));
    const P = r.plans;
    check("pushIn ends zoomed on the focus: endScale >= 1.3 > startScale = 1", P.pushIn.startScale === 1 && P.pushIn.endScale >= 1.3 && near(P.pushIn.endFocus.x, 1500));
    check("pullOut starts close on the focus and ends on the whole capture", P.pullOut.startScale > 1.3 && P.pullOut.endScale === 1 && near(P.pullOut.endFocus.x, 960) && near(P.pullOut.startFocus.x, 1500));
    check("whip is a short move (<= 18 frames) with E.whip and blur on", P.whip.moveFrames <= 18 && P.whip.blur === true && near(P.whip.easing, r.easeMid));
    check("no other shot blurs by default", r.names.filter((n) => n !== "whip").every((n) => P[n].blur === false));
    check("hold stays on the whole capture (scale <= 1.03, centre to centre)", P.hold.endScale <= 1.03 && near(P.hold.startFocus.x, 960) && near(P.hold.endFocus.x, 960) && near(P.hold.endFocus.y, 540));
    check("dutch tilts the horizon: nonzero rotZ at the end", Math.abs(P.dutch.tilt.z) >= 2);
    check("orbit swings rotY from one sign to the other", P.orbit.startTilt.y < 0 && P.orbit.tilt.y > 0);
    check("pan keeps its zoom and moves the camera sideways to the focus", near(P.pan.startScale, P.pan.endScale) && P.pan.startFocus.x < P.pan.endFocus.x && near(P.pan.startFocus.y, P.pan.endFocus.y));
    check("drift is a slow, small move (> 120 frames, end scale <= 1.1)", P.drift.moveFrames > 120 && P.drift.endScale <= 1.1);
    check("an explicit push overrides the preset (pushIn end, pullOut start)", r.pushOverride === 2 && r.pullOverride === 2);
    check("explicit move, push and tilt win over a shot's preset", r.explicit.lastFrame === 60 && near(r.explicit.scale, 1.2) && near(r.explicit.rotZ, 2));

    const cam = (name, f) => r.cams[name].find((c) => c.f === f);
    check("camera: pushIn ends at 1.4x after its 90 frame move and starts at 1x", near(cam("pushIn", 90).scale, 1.4) && near(cam("pushIn", 0).scale, 1));
    check("camera: whip is settled by frame 18 and still moving at frame 9", near(cam("whip", 18).x, cam("whip", 150).x) && Math.abs(cam("whip", 9).x - cam("whip", 18).x) > 20);
    check("camera: hold never leaves the middle of the capture", r.cams.hold.every((c) => near(c.x, 960) && near(c.y, 540) && c.scale <= 1.03));
    check("camera: dutch starts level and ends tilted", near(cam("dutch", 0).rotZ, 0) && Math.abs(cam("dutch", 150).rotZ) >= 2);
    check("camera: orbit's rotY changes sign across the move", cam("orbit", 0).rotY < 0 && cam("orbit", 150).rotY > 0);

    // Pixels: red left half, blue right half; focus on the blue side except where noted.
    const rgbAt = (id, local) => t.rgb(t.frameOf(id, local));
    const pushStart = await rgbAt("shot-push-in", 0);
    const pushEnd = await rgbAt("shot-push-in", 120);
    console.log(`  pushIn blue share ${colourShare(pushStart, BLUE).toFixed(2)} -> ${colourShare(pushEnd, BLUE).toFixed(2)}`);
    // At 1.4x the view is 1371 px of the 1920 px capture and the camera centre clamps at the capture edge, so the seam stays in view.
    check("pixels: pushIn starts on both halves and ends zoomed in on the blue side", colourShare(pushStart, RED) > 0.4 && colourShare(pushEnd, BLUE) > 0.65 && colourShare(pushEnd, RED) < 0.35 && colourShare(pushEnd, BLUE) > colourShare(pushStart, BLUE) + 0.15);
    const pullStart = await rgbAt("shot-pull-out", 0);
    const pullEnd = await rgbAt("shot-pull-out", 120);
    check("pixels: pullOut starts close on the blue side and ends on the whole capture", colourShare(pullStart, BLUE) > 0.65 && colourShare(pullStart, RED) < 0.35 && colourShare(pullEnd, RED) > 0.4 && colourShare(pullEnd, BLUE) > 0.4);
    const holdEnd = await rgbAt("shot-hold", 150);
    console.log(`  hold at the end: red ${colourShare(holdEnd, RED).toFixed(2)} blue ${colourShare(holdEnd, BLUE).toFixed(2)}`);
    check("pixels: hold stays on the whole capture", colourShare(holdEnd, RED) > 0.4 && colourShare(holdEnd, BLUE) > 0.4);

    // Where the red/blue seam crosses the top and bottom rows: a tilted plane makes it lean.
    const seam = (img, row) => {
      for (let x = 0; x < img.w; x++) {
        const i = (row * img.w + x) * 3;
        if (img.data[i + 2] > 150 && img.data[i] < 120) return x;
      }
      return -1;
    };
    const dutchStart = await rgbAt("shot-dutch", 0);
    const dutchEnd = await rgbAt("shot-dutch", 150);
    const lean = (img) => seam(img, 100) - seam(img, 980);
    console.log(`  dutch seam lean: start ${lean(dutchStart)}px, end ${lean(dutchEnd)}px`);
    check("pixels: dutch leans the seam by tens of pixels by the end, and starts level", Math.abs(lean(dutchEnd)) > 30 && Math.abs(lean(dutchStart)) < 3);

    // 120 px bars, red and blue alternating: the bars on the side of the plane that swings toward the
    // camera come out wider than the ones on the far side, and the near side flips with the sign of rotY.
    const barWidths = (img) => {
      const row = 540;
      const edges = [];
      let prev = 0;
      for (let x = 0; x < img.w; x++) {
        const i = (row * img.w + x) * 3;
        const c = img.data[i] > 150 && img.data[i + 2] < 120 ? 1 : img.data[i + 2] > 150 && img.data[i] < 120 ? 2 : 0;
        if (c !== 0 && prev !== 0 && c !== prev) edges.push(x);
        if (c !== 0) prev = c;
      }
      const widths = (lo, hi) => {
        const w = [];
        for (let k = 1; k < edges.length; k++) if (edges[k - 1] >= lo && edges[k] <= hi) w.push(edges[k] - edges[k - 1]);
        return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
      };
      return { left: widths(0, 940), right: widths(980, img.w) };
    };
    const orbitStart = barWidths(await rgbAt("shot-orbit", 0));
    const orbitEnd = barWidths(await rgbAt("shot-orbit", 150));
    console.log(`  orbit mean bar width left/right: start ${orbitStart.left.toFixed(1)}/${orbitStart.right.toFixed(1)}, end ${orbitEnd.left.toFixed(1)}/${orbitEnd.right.toFixed(1)}`);
    check("pixels: orbit swings the near side from the right to the left", orbitStart.right > 1.03 * orbitStart.left && orbitEnd.left > 1.03 * orbitEnd.right);

    const whipStart = await rgbAt("shot-whip", 0);
    const whipEnd = await rgbAt("shot-whip", 30);
    const whipLater = await rgbAt("shot-whip", 80);
    console.log(`  whip blue share ${colourShare(whipStart, BLUE).toFixed(2)} -> ${colourShare(whipEnd, BLUE).toFixed(2)}`);
    check("pixels: whip lands on the focus within 30 frames", colourShare(whipStart, BLUE) < 0.4 && colourShare(whipEnd, BLUE) > 0.6 && Math.abs(colourShare(whipEnd, BLUE) - colourShare(whipLater, BLUE)) < 0.01);
  },
);

// ============================================================ 4. Handheld and impact shake

section(
  "4. handheld sway and impact shake: deterministic, zero in holds, decaying after a hit",
  [
    {
      // Pure functions over a run of frames, plus the hooks read at the frame the page is seeked to.
      id: "hh-readout",
      frames: 130,
      source: sceneFile(
        "HhReadout",
        ["handheldOffset", "impactShake", "useHandheld", "useImpactShake"],
        `<HhInner />`,
        {
          extra: String.raw`
const HhInner: React.FC = () => {
  const hand = useHandheld(6, { holds: [[40, 70]] });
  const shake = useImpactShake([20, 90]);
  const frames = Array.from({ length: 130 }, (_, i) => i);
  const data = {
    hook: hand,
    shakeHook: shake,
    sway: frames.map((f) => handheldOffset(f, 4, 1)),
    swayAgain: frames.map((f) => handheldOffset(f, 4, 1)),
    swaySeed2: frames.map((f) => handheldOffset(f, 4, 2)),
    raw6: frames.map((f) => handheldOffset(f, 6, 1)),
    hit: frames.map((f) => impactShake(f, [30], { amplitude: 10, decay: 8 })),
    hitAgain: frames.map((f) => impactShake(f, [30], { amplitude: 10, decay: 8 })),
    twoHits: frames.map((f) => impactShake(f, [30, 80], { amplitude: 10, decay: 8 })),
  };
  return <div id="hh-readout" style={{ color: "#fff", fontSize: 10, whiteSpace: "pre" }}>{JSON.stringify(data)}</div>;
};
`,
        },
      ),
    },
    {
      id: "hh-handheld",
      frames: 90,
      source: directedScene("HhHandheld", "", {
        body: `<DirectedShot src={staticFile("images/halves.png")} focus={{ x: 960, y: 540 }} push={1.2} handheld={6} />`,
      }),
    },
    {
      id: "hh-shake",
      frames: 90,
      source: directedScene("HhShake", "", {
        body: `<DirectedShot src={staticFile("images/halves.png")} focus={{ x: 960, y: 540 }} push={1.2} shake={[20]} />`,
      }),
    },
    {
      id: "hh-none",
      frames: 30,
      source: directedScene("HhNone", "", {
        body: `<DirectedShot src={staticFile("images/halves.png")} focus={{ x: 960, y: 540 }} push={1.2} />`,
      }),
    },
  ],
  async (t) => {
    const read = async (local) => JSON.parse(await t.text(t.frameOf("hh-readout", local), "#hh-readout"));
    const mag = (o) => Math.hypot(o.x, o.y);
    const base = await read(0);

    // handheldOffset: bounded, moving, deterministic, seed-dependent.
    check("handheldOffset is deterministic (same inputs, same output)", JSON.stringify(base.sway) === JSON.stringify(base.swayAgain));
    check("handheldOffset stays inside its amplitude (4px) on both axes", base.sway.every((o) => Math.abs(o.x) <= 4 && Math.abs(o.y) <= 4));
    const maxSway = Math.max(...base.sway.map(mag));
    console.log(`  sway at amount 4: largest offset ${maxSway.toFixed(2)}px, largest roll ${Math.max(...base.sway.map((o) => Math.abs(o.rot))).toFixed(3)} deg`);
    check("...and it actually moves (largest offset > 2px)", maxSway > 2);
    check("a different seed gives a different path", JSON.stringify(base.sway) !== JSON.stringify(base.swaySeed2));
    check("the two axes do not move in lockstep", base.sway.some((o) => Math.abs(Math.abs(o.x) - Math.abs(o.y)) > 0.5));

    // useHandheld with a hold window 40..70.
    const inHold = [];
    for (const f of [40, 55, 70]) inHold.push((await read(f)).hook);
    check("useHandheld is exactly zero inside a hold window", inHold.every((o) => o.x === 0 && o.y === 0 && o.rot === 0));
    const outside = [];
    for (const f of [10, 22, 95, 110]) outside.push(await read(f));
    check("...and nonzero outside it", outside.every((d) => mag(d.hook) > 0.01));
    check("...matching the plain sway once the ramp is over", outside.every((d, i) => Math.abs(d.hook.x - d.raw6[[10, 22, 95, 110][i]].x) < 1e-9));
    const nearEdge = await read(38);
    check("it eases into the hold: two frames before the window it is damped", mag(nearEdge.hook) < mag({ x: nearEdge.raw6[38].x, y: nearEdge.raw6[38].y }) * 0.9);

    // impactShake: 0 before the hit, the peak at it, decayed by 3x the decay constant.
    const hit = base.hit;
    check("impactShake is exactly zero before the impact frame", hit.slice(0, 30).every((o) => o.x === 0 && o.y === 0 && o.rot === 0));
    const peak = Math.max(...hit.map(mag));
    console.log(`  impact at 30, amplitude 10: peak ${peak.toFixed(2)}px at frame ${hit.findIndex((o) => mag(o) === peak)}; at +24 frames ${mag(hit[54]).toFixed(3)}px`);
    check("the peak is on the impact frame and equals the amplitude", hit.findIndex((o) => mag(o) === peak) === 30 && Math.abs(peak - 10) < 1e-9);
    check("it decays below 10% of the amplitude within 3x decay (24 frames) and stays there", hit.slice(54).every((o) => mag(o) < 1));
    check("it is deterministic", JSON.stringify(hit) === JSON.stringify(base.hitAgain));
    check("a second impact starts from zero again and peaks on its own frame", base.twoHits.slice(50, 80).every((o) => mag(o) < 1) && mag(base.twoHits[80]) > 8);

    // The hook version, read at the frame the page is on.
    check("useImpactShake is zero the frame before the hit and at full strength on it", mag((await read(19)).shakeHook) === 0 && Math.abs(mag((await read(20)).shakeHook) - 12) < 1e-9);
    check("...and a later hit fires on its own frame", mag((await read(89)).shakeHook) < 1 && Math.abs(mag((await read(90)).shakeHook) - 12) < 0.01);

    // DirectedShot applies it to the whole shot.
    const shift = (frame) =>
      t.eval(frame, () => {
        const el = document.querySelector("[data-ovs-handheld]");
        if (!el) return null;
        // The element scales and rotates about its own centre, so the matrix translation is the shift.
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return { x: m.e, y: m.f };
      });
    const hand = [];
    for (const f of [5, 17, 31, 46, 60, 75]) hand.push(await shift(t.frameOf("hh-handheld", f)));
    console.log(`  DirectedShot handheld={6}: offsets ${hand.map((o) => (o ? mag(o).toFixed(1) : "none")).join(" ")}`);
    check("DirectedShot handheld={6} moves the shot, never past 6px", hand.every((o) => o && mag(o) <= 6.0001) && hand.filter((o) => mag(o) > 0.2).length >= 4);
    check("...and the offset changes frame to frame", new Set(hand.map((o) => o.x.toFixed(2))).size >= 5);
    check("control: a DirectedShot without handheld or shake has no shake wrapper at all", (await shift(t.frameOf("hh-none", 10))) === null);
    const before = await shift(t.frameOf("hh-shake", 19));
    const at = await shift(t.frameOf("hh-shake", 20));
    const later = await shift(t.frameOf("hh-shake", 44));
    console.log(`  DirectedShot shake={[20]}: before ${mag(before).toFixed(2)}px, at the hit ${mag(at).toFixed(2)}px, +24 frames ${mag(later).toFixed(2)}px`);
    check("DirectedShot shake: still before the hit, hard at it, settled 24 frames later", mag(before) < 0.01 && mag(at) > 10 && mag(later) < 1.3);
  },
);

// ============================================================ 5. Layer: true Z parallax

const MARKER = '<div style={{ position: "absolute", left: 400, top: 300, width: 24, height: 24, background: "#ff0000" }} />';
/** A CameraRig on the full composition with one marker in a Layer at the given depth. */
const parallaxScene = (name, depth, keyframes, rig = "") =>
  sceneFile(
    name,
    ["CameraRig", "Layer"],
    `<CameraRig keyframes={${keyframes}} ${rig}>
      <Layer depth={${depth}} maxBlur={0}>${MARKER}</Layer>
    </CameraRig>`,
  );
const REST = "[{ frame: 0, x: 960, y: 540, scale: 1 }, { frame: 30, x: 960, y: 540, scale: 1 }]";
const PAN = "[{ frame: 0, x: 960, y: 540, scale: 1 }, { frame: 30, x: 1260, y: 540, scale: 1 }]";
// A 1080x1920 stage seen through a 540x960 window at 0.5x, placed inside the 1920x1080 composition.
const PORTRAIT_REST = "[{ frame: 0, x: 540, y: 960, scale: 0.5 }, { frame: 30, x: 540, y: 960, scale: 0.5 }]";
const portraitScene = (name, depth, extra = "") =>
  sceneFile(
    name,
    ["CameraRig", "Layer", "useCamera"],
    `<div style={{ position: "absolute", left: 100, top: 60 }}>
      <CameraRig keyframes={${PORTRAIT_REST}} stageWidth={1080} stageHeight={1920} viewportWidth={540} viewportHeight={960}>
        <Layer depth={${depth}} maxBlur={0}><div style={{ position: "absolute", left: 200, top: 400, width: 40, height: 40, background: "#ff0000" }} /></Layer>
        ${extra}
      </CameraRig>
    </div>`,
    {
      extra: String.raw`
export const StageProbe: React.FC = () => {
  const cam = useCamera();
  return <div id="stage-probe" style={{ position: "absolute", left: 700, top: 20, color: "#fff", fontSize: 20 }}>{cam ? cam.stageWidth + "x" + cam.stageHeight : "no camera"}</div>;
};
`,
    },
  );

section(
  "5. Layer: depth is real Z, not a translate; it lines up at rest on any stage size",
  [
    { id: "par-rest-0", frames: 40, source: parallaxScene("ParRest0", 0, REST) },
    { id: "par-rest-1", frames: 40, source: parallaxScene("ParRest1", 1, REST) },
    { id: "par-rest-m1", frames: 40, source: parallaxScene("ParRestM1", -1, REST) },
    { id: "par-pan-0", frames: 40, source: parallaxScene("ParPan0", 0, PAN) },
    { id: "par-pan-1", frames: 40, source: parallaxScene("ParPan1", 1, PAN) },
    { id: "par-pan-2", frames: 40, source: parallaxScene("ParPan2", 2, PAN) },
    { id: "par-pan-m1", frames: 40, source: parallaxScene("ParPanM1", -1, PAN) },
    { id: "par-portrait-0", frames: 40, source: portraitScene("ParPortrait0", 0, "<StageProbe />") },
    { id: "par-portrait-1", frames: 40, source: portraitScene("ParPortrait1", 1) },
    { id: "par-portrait-2", frames: 40, source: portraitScene("ParPortrait2", 2) },
    {
      // Source order is back-to-front only by accident here: the nearer layer is declared first.
      id: "par-order",
      frames: 30,
      source: sceneFile(
        "ParOrder",
        ["CameraRig", "Layer"],
        `<CameraRig keyframes={${REST}}>
      <Layer depth={0}><div style={{ position: "absolute", left: 600, top: 300, width: 700, height: 400, background: "#ff0000" }} /></Layer>
      <Layer depth={1}><div style={{ position: "absolute", left: 500, top: 200, width: 900, height: 600, background: "#0000ff" }} /></Layer>
    </CameraRig>`,
      ),
    },
    ...[
      ["par-blur-0", "ParBlur0", "0", ""],
      ["par-blur-1", "ParBlur1", "1", ""],
      ["par-blur-1-off", "ParBlur1Off", "1", " maxBlur={0}"],
    ].map(([id, name, depth, props]) => ({
      id,
      frames: 30,
      source: sceneFile(
        name,
        ["CameraRig", "Layer"],
        `<CameraRig keyframes={${REST}}>
      <Layer depth={${depth}}${props}><div style={{ position: "absolute", left: 300, top: 200, width: 600, height: 400, background: "repeating-linear-gradient(90deg, #000 0px, #000 3px, #fff 3px, #fff 6px)" }} /></Layer>
    </CameraRig>`,
      ),
    })),
  ],
  async (t) => {
    const centroid = async (id, local, box = { x: 0, y: 0, w: 1920, h: 1080 }) => {
      const img = await t.rgb(t.frameOf(id, local));
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
          const i = (y * img.w + x) * 3;
          if (img.data[i] > 200 && img.data[i + 1] < 60 && img.data[i + 2] < 60) {
            sx += x;
            sy += y;
            n++;
          }
        }
      }
      return n === 0 ? null : { x: sx / n, y: sy / n, n };
    };

    const r0 = await centroid("par-rest-0", 5);
    const r1 = await centroid("par-rest-1", 5);
    const rm1 = await centroid("par-rest-m1", 5);
    console.log(`  at rest the marker sits at (${r0?.x.toFixed(2)}, ${r0?.y.toFixed(2)}) on depth 0, (${r1?.x.toFixed(2)}, ${r1?.y.toFixed(2)}) on depth 1, (${rm1?.x.toFixed(2)}, ${rm1?.y.toFixed(2)}) on depth -1`);
    check("depth 0 puts the marker where the stage says (411.5, 311.5)", r0 !== null && Math.abs(r0.x - 411.5) < 1 && Math.abs(r0.y - 311.5) < 1);
    check("at rest a depth 1 layer places the marker at the same pixel as depth 0 (within 1px)", r1 !== null && r0 !== null && Math.abs(r1.x - r0.x) <= 1 && Math.abs(r1.y - r0.y) <= 1);
    check("...and so does a foreground layer (depth -1)", rm1 !== null && r0 !== null && Math.abs(rm1.x - r0.x) <= 1 && Math.abs(rm1.y - r0.y) <= 1);
    check("...with the marker the same size (pixel count within 4%)", r1 !== null && r0 !== null && Math.abs(r1.n / r0.n - 1) < 0.04);

    // Pan: the camera moves 300 stage px right. Depth 0 moves the full 300 on screen.
    const move = async (id) => {
      const a = await centroid(id, 0);
      const b = await centroid(id, 35);
      return a && b ? b.x - a.x : null;
    };
    const d0 = await move("par-pan-0");
    const d1 = await move("par-pan-1");
    const d2 = await move("par-pan-2");
    const dm1 = await move("par-pan-m1");
    console.log(`  after a 300px camera pan the marker moved ${d0?.toFixed(1)} (depth 0), ${d1?.toFixed(1)} (depth 1), ${d2?.toFixed(1)} (depth 2), ${dm1?.toFixed(1)} (depth -1)`);
    check("depth 0 moves with the camera (about -300px)", d0 !== null && Math.abs(d0 + 300) < 2);
    check("a layer behind (depth 1) moves LESS than depth 0, the same way", d1 !== null && d1 < 0 && Math.abs(d1) < Math.abs(d0) - 10);
    check("...and the further back (depth 2) the less it moves", d2 !== null && d2 < 0 && Math.abs(d2) < Math.abs(d1) - 10);
    check("a foreground layer (depth -1) moves MORE than depth 0, the same way", dm1 !== null && dm1 < 0 && Math.abs(dm1) > Math.abs(d0) + 10);
    check("the parallax is the perspective ratio: depth 1 moves 1400/(1400+170) = 0.892 of depth 0 (+-0.02)", d1 !== null && Math.abs(d1 / d0 - 1400 / 1570) < 0.02);

    // A 1080x1920 stage seen through a 540x960 window: the layer centre has to be the stage centre.
    const box = { x: 100, y: 60, w: 540, h: 960 };
    const p0 = await centroid("par-portrait-0", 5, box);
    const p1 = await centroid("par-portrait-1", 5, box);
    const p2 = await centroid("par-portrait-2", 5, box);
    console.log(`  1080x1920 stage at rest: marker at (${p0?.x.toFixed(2)}, ${p0?.y.toFixed(2)}) depth 0, (${p1?.x.toFixed(2)}, ${p1?.y.toFixed(2)}) depth 1, (${p2?.x.toFixed(2)}, ${p2?.y.toFixed(2)}) depth 2`);
    check("1080x1920 stage: depth 0 marker lands at (209.5, 269.5)", p0 !== null && Math.abs(p0.x - 209.5) < 1 && Math.abs(p0.y - 269.5) < 1);
    check("1080x1920 stage: depth 1 lines up with depth 0 at rest (within 1px)", p1 !== null && p0 !== null && Math.abs(p1.x - p0.x) <= 1 && Math.abs(p1.y - p0.y) <= 1);
    check("1080x1920 stage: depth 2 lines up with depth 0 at rest (within 1px)", p2 !== null && p0 !== null && Math.abs(p2.x - p0.x) <= 1 && Math.abs(p2.y - p0.y) <= 1);
    check("the camera context carries the stage size", (await t.text(t.frameOf("par-portrait-0", 5), "#stage-probe")) === "1080x1920");

    // Depth is a place in space now, not a paint order.
    const order = await t.rgb(t.frameOf("par-order", 5));
    const px = (x, y) => [...order.data.slice((y * order.w + x) * 3, (y * order.w + x) * 3 + 3)];
    console.log(`  overlap of depth 0 (declared first) and depth 1 (declared second): centre pixel ${px(960, 500)}`);
    check("a layer behind is behind even when it is declared later", px(960, 500)[0] > 200 && px(960, 500)[2] < 60);
    check("...and still visible around the nearer one", px(540, 260)[2] > 200 && px(540, 260)[0] < 60);

    // The blur behaviour is unchanged.
    const e = async (id) => edgeEnergy(await t.grab(t.frameOf(id, 5)));
    const eSharp = await e("par-blur-0");
    const eBlur = await e("par-blur-1");
    const eOff = await e("par-blur-1-off");
    console.log(`  edge energy: depth 0 ${eSharp.toFixed(2)}, depth 1 ${eBlur.toFixed(2)}, depth 1 with maxBlur 0 ${eOff.toFixed(2)}`);
    check("depth 0 stays sharp and depth 1 is blurred (< 0.5x)", eSharp > 5 && eBlur < 0.5 * eSharp);
    check("maxBlur={0} switches the depth blur off (>= 0.9x of the sharp layer)", eOff >= 0.9 * eSharp);
  },
);

// ============================================================ 6. LayeredShot and MotionBlur

const LAY_LAYERS = [
  { file: "lay-a.png", x: 200, y: 150, width: 300, height: 200, depth: 0.5, rgb: [224, 48, 48] },
  { file: "lay-b.png", x: 900, y: 300, width: 400, height: 250, depth: 0, rgb: [48, 192, 96] },
  { file: "lay-c.png", x: 1300, y: 700, width: 300, height: 120, depth: -0.5, rgb: [240, 192, 32] },
];
const manifestJs = (layers, extra = "") =>
  `{ width: 1920, height: 1080, background: staticFile("images/lay-bg.png"), layers: [${layers
    .map((l) => `{ src: staticFile("images/${l.file}"), x: ${l.x}, y: ${l.y}, width: ${l.width}, height: ${l.height}, depth: ${l.depth} }`)
    .join(", ")}]${extra} }`;
const layeredScene = (name, layers, props) =>
  directedScene(name, "", {
    imports: ", LayeredShot",
    body: `<LayeredShot manifest={${manifestJs(layers)}} ${props} />`,
  });
const MARKER_LAYER = { file: "lay-marker.png", x: 1300, y: 400, width: 40, height: 40, depth: -1, rgb: [255, 0, 0] };
const PAN_PROPS = "focus={{ x: 1500, y: 540 }} push={1.3} move={{ from: 0, to: 30 }}";

section(
  "6. LayeredShot composites to the flat picture at rest and separates in depth; MotionBlur only inside its window",
  [
    { id: "lay-stack", frames: 60, source: layeredScene("LayStack", LAY_LAYERS, "focus={{ x: 960, y: 540 }} push={1} move={{ from: 0, to: 30 }}") },
    {
      id: "lay-flat",
      frames: 60,
      source: directedScene("LayFlat", "", {
        body: `<DirectedShot src={staticFile("images/lay-flat.png")} focus={{ x: 960, y: 540 }} push={1} move={{ from: 0, to: 30 }} />`,
      }),
    },
    {
      // Control: the same stack with one layer 30px out of place must NOT match the flat picture.
      id: "lay-shifted",
      frames: 60,
      source: layeredScene("LayShifted", LAY_LAYERS.map((l, i) => (i === 1 ? { ...l, x: l.x + 30 } : l)), "focus={{ x: 960, y: 540 }} push={1} move={{ from: 0, to: 30 }}"),
    },
    { id: "lay-pan-stack", frames: 60, source: layeredScene("LayPanStack", [MARKER_LAYER], PAN_PROPS) },
    {
      id: "lay-pan-flat",
      frames: 60,
      source: directedScene("LayPanFlat", "", {
        body: `<DirectedShot src={staticFile("images/lay-flat-marker.png")} ${PAN_PROPS} />`,
      }),
    },
    {
      id: "blur-whip",
      frames: 60,
      source: directedScene("BlurWhip", "", {
        body: `<DirectedShot src={staticFile("images/stripes.png")} focus={{ x: 1500, y: 540 }} shot="whip" move={{ from: 10 }} />`,
      }),
    },
    {
      id: "blur-whip-off",
      frames: 60,
      source: directedScene("BlurWhipOff", "", {
        body: `<DirectedShot src={staticFile("images/stripes.png")} focus={{ x: 1500, y: 540 }} shot="whip" blur={false} move={{ from: 10 }} />`,
      }),
    },
    {
      id: "blur-whip-wide",
      frames: 60,
      source: directedScene("BlurWhipWide", "", {
        body: `<DirectedShot src={staticFile("images/stripes.png")} focus={{ x: 1500, y: 540 }} shot="whip" blur={{ shutterAngle: 360, samples: 12 }} move={{ from: 10 }} />`,
      }),
    },
    {
      // The component on its own: a bar sliding across, blurred only for frames 10..20.
      id: "blur-component",
      frames: 40,
      source: sceneFile(
        "BlurComponent",
        ["MotionBlur"],
        `<MotionBlur from={10} to={20}><Slider /></MotionBlur>`,
        {
          extra: String.raw`
const Slider: React.FC = () => {
  const frame = useCurrentFrame();
  return <div style={{ position: "absolute", left: 100 + frame * 40, top: 300, width: 60, height: 300, background: "repeating-linear-gradient(90deg, #fff 0px, #fff 2px, #000 2px, #000 4px)" }} />;
};
`,
          remotion: ", useCurrentFrame",
        },
      ),
    },
  ],
  async (t) => {
    // ---- stack vs flat at rest
    const stack = await t.rgb(t.frameOf("lay-stack", 0));
    const flat = await t.rgb(t.frameOf("lay-flat", 0));
    const shifted = await t.rgb(t.frameOf("lay-shifted", 0));
    const diff = (a, b) => {
      let sum = 0;
      let big = 0;
      const n = a.w * a.h;
      for (let p = 0; p < n; p++) {
        let d = 0;
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[p * 3 + c] - b.data[p * 3 + c]));
        sum += d;
        if (d > 40) big++;
      }
      return { mean: sum / n, big: big / n };
    };
    const live = (img) => img.data.reduce((a, v) => a + v, 0) / img.data.length > 20;
    check("the layered, flat and shifted scenes all render a picture (not a blank crash frame)", live(stack) && live(flat) && live(shifted));
    const dStack = diff(stack, flat);
    const dShifted = diff(shifted, flat);
    console.log(`  stack vs flat: mean channel diff ${dStack.mean.toFixed(3)}, pixels off by >40: ${(dStack.big * 100).toFixed(3)}%; with one layer moved 30px: ${dShifted.mean.toFixed(3)} / ${(dShifted.big * 100).toFixed(3)}%`);
    check("LayeredShot at rest composites to the same picture as the flat background plus layers (mean diff < 1.5, < 0.3% of pixels off by more than 40)", dStack.mean < 1.5 && dStack.big < 0.003);
    check("control: one layer 30px out of place is detected (> 5x the mean diff, > 0.5% of pixels)", dShifted.mean > 5 * Math.max(dStack.mean, 0.1) && dShifted.big > 0.005);

    // ---- the layers separate when the camera moves
    const redCentroid = (img) => {
      let sx = 0;
      let n = 0;
      for (let y = 0; y < img.h; y++) {
        for (let x = 0; x < img.w; x++) {
          const i = (y * img.w + x) * 3;
          if (img.data[i] > 200 && img.data[i + 1] < 60 && img.data[i + 2] < 60) {
            sx += x;
            n++;
          }
        }
      }
      return n ? sx / n : null;
    };
    const panStart = [redCentroid(await t.rgb(t.frameOf("lay-pan-stack", 0))), redCentroid(await t.rgb(t.frameOf("lay-pan-flat", 0)))];
    const panEnd = [redCentroid(await t.rgb(t.frameOf("lay-pan-stack", 40))), redCentroid(await t.rgb(t.frameOf("lay-pan-flat", 40)))];
    console.log(`  marker x at rest: layered ${panStart[0]?.toFixed(1)} flat ${panStart[1]?.toFixed(1)}; after the push: layered ${panEnd[0]?.toFixed(1)} flat ${panEnd[1]?.toFixed(1)}`);
    check("a foreground layer starts exactly where the flat capture puts it", panStart[0] !== null && panStart[1] !== null && Math.abs(panStart[0] - panStart[1]) <= 1);
    check("...and moves further than the flat capture once the camera moves (parallax, > 10px)", panEnd[0] !== null && panEnd[1] !== null && panEnd[1] - panEnd[0] > 10);

    // ---- motion blur only inside its window
    const sameBytes = (a, b) => Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;
    for (const f of [5, 40]) {
      const on = await t.rgb(t.frameOf("blur-whip", f));
      const off = await t.rgb(t.frameOf("blur-whip-off", f));
      check(`outside the blur window (frame ${f}) the render is pixel-identical to a no-blur render`, sameBytes(on, off) && edgeEnergy(await t.grab(t.frameOf("blur-whip", f))) > 20);
    }
    // The whip eases in and out, so the camera is fastest a little past the middle of the move (10..28).
    let fastest = { frame: 0, on: Infinity, off: 1, wide: 0 };
    for (const f of [16, 18, 20, 22, 24, 26]) {
      const on = edgeEnergy(await t.grab(t.frameOf("blur-whip", f)));
      const off = edgeEnergy(await t.grab(t.frameOf("blur-whip-off", f)));
      if (on / off < fastest.on / fastest.off) fastest = { frame: f, on, off, wide: edgeEnergy(await t.grab(t.frameOf("blur-whip-wide", f))) };
    }
    const { on: midOn, off: midOff, wide: midWide } = fastest;
    console.log(`  whip at its fastest (frame ${fastest.frame}): edge energy no blur ${midOff.toFixed(2)}, blur ${midOn.toFixed(2)} (${(midOn / midOff).toFixed(2)}x), wide shutter ${midWide.toFixed(2)}`);
    check("mid-whip the blur softens the high-frequency pattern (< 0.5x of the no-blur render)", midOff > 20 && midOn < 0.5 * midOff);
    // Compared where the camera is moving at a moderate speed: at full speed both shutters smear the
    // stripes past anything measurable and the numbers stop ordering.
    const modOn = edgeEnergy(await t.grab(t.frameOf("blur-whip", 19)));
    const modWide = edgeEnergy(await t.grab(t.frameOf("blur-whip-wide", 19)));
    console.log(`  frame 19: 180 degree shutter ${modOn.toFixed(2)}, 360 degree shutter with 12 samples ${modWide.toFixed(2)} (full speed: ${midWide.toFixed(2)})`);
    check("a wider shutter blurs more (blur={{ shutterAngle: 360, samples: 12 }})", modWide < 0.5 * modOn);

    // The component by itself: sharp outside 10..20, smeared inside.
    const bar = async (f) => edgeEnergy(await t.grab(t.frameOf("blur-component", f)), { x: 0, y: 200, w: 1920, h: 500 });
    const before = await bar(5);
    const inside = await bar(15);
    const after = await bar(30);
    console.log(`  MotionBlur component, bar edge energy: frame 5 ${before.toFixed(2)}, 15 ${inside.toFixed(2)}, 30 ${after.toFixed(2)}`);
    check("MotionBlur: sharp before and after its window, smeared inside", before > 1 && after > 1 && inside < 0.6 * before && inside < 0.6 * after);
  },
);

// ============================================================ 7. CursorActor arcs

const CURSOR_PATH = "[{ frame: 0, x: 200, y: 500 }, { frame: 60, x: 1000, y: 500 }, { frame: 120, x: 1800, y: 500 }, { frame: 140, x: 1810, y: 500 }]";

section(
  "7. CursorActor: segments arc slightly (alternating sides), overshoot on arrival, exact at keyframes",
  [
    {
      id: "cursor-readout",
      frames: 30,
      source: sceneFile(
        "CursorReadout",
        ["cursorPositionAt", "E"],
        `<div id="cursor-readout" style={{ color: "#fff", fontSize: 12, whiteSpace: "pre" }}>{JSON.stringify((() => {
      const path = ${CURSOR_PATH};
      const frames = Array.from({ length: 160 }, (_, i) => i);
      return { pos: frames.map((f) => cursorPositionAt(path, f)), ease: [0.25, 0.5, 0.75].map((t) => E.cinematic(t)) };
    })())}</div>`,
      ),
    },
    {
      id: "cursor-live",
      frames: 160,
      source: sceneFile("CursorLive", ["CursorActor"], `<CursorActor path={${CURSOR_PATH}} clicks={[60]} sfx={false} />`),
    },
  ],
  async (t) => {
    const r = JSON.parse(await t.text(t.frameOf("cursor-readout", 0), "#cursor-readout"));
    const P = r.pos;
    const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
    check("the cursor is exactly on every keyframe (frames 0, 60, 120, 140)", near(P[0].x, 200) && near(P[0].y, 500) && near(P[60].x, 1000) && near(P[60].y, 500) && near(P[120].x, 1800) && near(P[120].y, 500) && near(P[140].x, 1810) && near(P[140].y, 500));
    check("it holds the first and last keyframe outside the path", near(P[159].x, 1810) && near(P[159].y, 500));

    // First segment: 800px long, from 200 to 1000 along y = 500.
    const seg1 = P.slice(0, 61);
    const seg2 = P.slice(60, 121);
    const dev1 = seg1.map((p) => p.y - 500);
    const dev2 = seg2.map((p) => p.y - 500);
    const peak1 = dev1.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0);
    const peak2 = dev2.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0);
    console.log(`  800px segments: midpoint (frame 30) is ${dev1[30].toFixed(1)}px off the straight line, peak ${peak1.toFixed(1)}px; the next segment peaks ${peak2.toFixed(1)}px`);
    check("the midpoint of a long segment deviates from the straight line (> 10px of 800)", Math.abs(dev1[30]) > 10);
    check("the arc is slight: its peak is about 6% of the segment length (40 to 56px of 800)", Math.abs(peak1) > 40 && Math.abs(peak1) < 56);
    check("the next segment bows to the other side", peak1 * peak2 < 0 && Math.abs(Math.abs(peak2) - Math.abs(peak1)) < 4);

    // Timing: the progress along the segment still follows E.cinematic.
    const along = (f) => (P[f].x - 200) / 800;
    const progressAt30 = along(30);
    console.log(`  progress along the segment at the half-way frame: ${progressAt30.toFixed(3)} (E.cinematic(0.5) = ${r.ease[1].toFixed(3)})`);
    check("progress along the segment keeps E.cinematic timing (within 0.02 at the half-way frame)", Math.abs(progressAt30 - r.ease[1]) < 0.02);

    // Overshoot on arrival: past the target, then back to it exactly.
    const farthest = Math.max(...seg1.map((p) => p.x));
    const overshoot = farthest - 1000;
    console.log(`  overshoot past the target: ${overshoot.toFixed(1)}px (${((overshoot / 800) * 100).toFixed(2)}% of the segment)`);
    check("the cursor overshoots the target a little (0.5% to 4% of the segment) and comes back", overshoot > 4 && overshoot < 32 && near(P[60].x, 1000));
    check("a very short segment (10px) stays within a pixel of its line", P.slice(120, 141).every((p) => Math.abs(p.y - 500) < 1 && p.x >= 1799 && p.x <= 1812));

    // The component draws the cursor where the function says.
    const live = await t.eval(t.frameOf("cursor-live", 30), () => {
      const svg = document.querySelector("svg");
      const b = svg?.getBoundingClientRect();
      return b ? { x: b.x, y: b.y } : null;
    });
    check("CursorActor renders the arrowhead at that arced position (frame 30, within 1px)", live !== null && Math.abs(live.x - P[30].x) < 1 && Math.abs(live.y - P[30].y) < 1);
    // The click ring anchors on the keyframe, not on wherever the arc has wandered to.
    const ring = await t.eval(t.frameOf("cursor-live", 62), () => {
      const rings = [...document.querySelectorAll("div")].filter((d) => getComputedStyle(d).borderRadius === "50%" && getComputedStyle(d).borderTopWidth === "3px");
      const b = rings[0]?.getBoundingClientRect();
      return b ? { cx: b.x + b.width / 2, cy: b.y + b.height / 2 } : null;
    });
    check("the click ring at frame 60 is centred on the keyframe (1000, 500), within 1px", ring !== null && Math.abs(ring.cx - 1000) < 1 && Math.abs(ring.cy - 500) < 1);
  },
);

// ============================================================ 8. E.sine and E.expo

section(
  "8. easing presets E.sine and E.expo (in-out)",
  [
    {
      id: "ease-readout",
      frames: 30,
      source: sceneFile(
        "EaseReadout",
        ["E", "tween"],
        `<div id="ease-readout" style={{ color: "#fff", fontSize: 12, whiteSpace: "pre" }}>{JSON.stringify((() => {
      const samples = Array.from({ length: 101 }, (_, i) => i / 100);
      return {
        keys: Object.keys(E),
        sine: samples.map((t) => (E.sine ? E.sine(t) : null)),
        expo: samples.map((t) => (E.expo ? E.expo(t) : null)),
        tweened: [tween(0, [0, 30], [100, 200], E.expo), tween(30, [0, 30], [100, 200], E.expo), tween(15, [0, 30], [100, 200], E.sine)],
      };
    })())}</div>`,
      ),
    },
  ],
  async (t) => {
    const r = JSON.parse(await t.text(t.frameOf("ease-readout", 0), "#ease-readout"));
    check("E has sine and expo alongside the original four", ["cinematic", "whip", "drift", "snap", "sine", "expo"].every((k) => r.keys.includes(k)));
    for (const name of ["sine", "expo"]) {
      const v = r[name];
      check(`E.${name}: exactly 0 at 0 and exactly 1 at 1`, v[0] === 0 && v[100] === 1);
      check(`E.${name}: half-way at t = 0.5`, Math.abs(v[50] - 0.5) < 1e-9);
      check(`E.${name}: never goes backwards`, v.every((x, i) => i === 0 || x >= v[i - 1]));
      check(`E.${name}: eases in and out (< 0.1 at t = 0.1, > 0.9 at t = 0.9; not linear)`, v[10] < 0.1 && v[90] > 0.9);
    }
    const slope = (v) => v[60] - v[40];
    console.log(`  slope across the middle fifth: sine ${slope(r.sine).toFixed(3)}, expo ${slope(r.expo).toFixed(3)}; value at 0.1: sine ${r.sine[10].toFixed(4)}, expo ${r.expo[10].toFixed(5)}`);
    check("expo is the harder curve: steeper through the middle and flatter at the ends than sine", slope(r.expo) > slope(r.sine) && r.expo[10] < r.sine[10]);
    check("tween takes them: 100 at the start, 200 at the end, 150 half-way", r.tweened[0] === 100 && r.tweened[1] === 200 && Math.abs(r.tweened[2] - 150) < 1e-9);
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

  // 120 px bars, red and blue alternating, for measuring perspective.
  {
    const w = 1920;
    const h = 1080;
    const buf = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const red = Math.floor(x / 120) % 2 === 0;
        const i = (y * w + x) * 3;
        buf[i] = red ? 220 : 30;
        buf[i + 1] = red ? 30 : 60;
        buf[i + 2] = red ? 30 : 230;
      }
    }
    fs.writeFileSync(path.join(root, "public", "images", "bars.png"), await sharpLib(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer());
  }

  // Layered capture fixtures: a flat background with hard-edged panels, three solid layers on top of
  // it, and the pre-composited flat picture to compare the stack against.
  {
    const solid = (w, h, [r, g, b]) => sharpLib({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();
    const images = path.join(root, "public", "images");
    const bgBase = await sharpLib({ create: { width: 1920, height: 1080, channels: 3, background: { r: 42, g: 53, b: 80 } } })
      .composite([
        { input: await solid(1400, 800, [61, 74, 107]), left: 260, top: 140 },
        { input: await solid(1200, 60, [90, 104, 140]), left: 360, top: 900 },
      ])
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(images, "lay-bg.png"), bgBase);
    const placed = [];
    for (const l of [...LAY_LAYERS, MARKER_LAYER]) {
      const buf = await solid(l.width, l.height, l.rgb);
      fs.writeFileSync(path.join(images, l.file), buf);
      placed.push({ input: buf, left: l.x, top: l.y, main: l !== MARKER_LAYER });
    }
    fs.writeFileSync(
      path.join(images, "lay-flat.png"),
      await sharpLib(bgBase).composite(placed.filter((p) => p.main).map(({ input, left, top }) => ({ input, left, top }))).png().toBuffer(),
    );
    fs.writeFileSync(
      path.join(images, "lay-flat-marker.png"),
      await sharpLib(bgBase).composite(placed.filter((p) => !p.main).map(({ input, left, top }) => ({ input, left, top }))).png().toBuffer(),
    );
  }

  // Left half red, right half blue: where the camera ends up is readable from pixels alone.
  fs.writeFileSync(
    path.join(root, "public", "images", "halves.png"),
    await sharpLib({ create: { width: 1920, height: 1080, channels: 3, background: { r: 220, g: 30, b: 30 } } })
      .composite([{ input: await sharpLib({ create: { width: 960, height: 1080, channels: 3, background: { r: 30, g: 60, b: 230 } } }).png().toBuffer(), left: 960, top: 0 }])
      .png()
      .toBuffer(),
  );

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

#!/usr/bin/env node
// collage-broll: the halftone paper-collage b-roll primitive (#122), from the motion primitives registry.
// Installed into a scaffolded project with add_motion_primitive, then measured in real frames: the empty
// colour field before the first piece, every piece at its target at the end, pieces arriving in the stated
// order (structure, people, connectors, result, whatever order they are listed in), no fade and no zoom,
// two renders of one frame identical.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, check, skip, finish } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, rgb, sameBytes, sharp } from "./_stem.mjs";

const { runAddMotionPrimitive, runCatalogMotionPrimitives } = require(path.join(distDir, "tools", "motionPrimitives.js"));
const BG = [217, 80, 63]; // #D9503F
const near = (c, t, tol) => c.every((v, i) => Math.abs(v - t[i]) <= tol);

console.log("\n== the catalog finds it ==");
{
  const found = runCatalogMotionPrimitives({ query: "halftone collage b-roll" });
  check("catalog_motion_primitives finds collage-broll for a halftone collage query", found.primitives[0]?.name === "collage-broll" && found.primitives[0].componentName === "CollageBroll");
  const src = require(path.join(distDir, "primitives", "registry.js")).findMotionPrimitive("collage-broll").source;
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  check("it imports only react, remotion and core", imports.length === 3 && imports.every((i) => ["react", "remotion", "@openvidstudio/core"].includes(i)));
  check("it uses no random numbers (a pure function of the frame)", !/Math\.random/.test(src));
}

const SCENE = `import React from "react";
import { staticFile } from "remotion";
import { CollageBroll } from "../primitives/CollageBroll";

// Listed out of assembly order on purpose: the result and the connector come before the people.
export const CollageScene: React.FC = () => (
  <CollageBroll
    background="#D9503F"
    at={10}
    stagger={12}
    pieces={[
      { shape: "card", tone: "blue", x: 0.3, y: 0.4, width: 0.3, aspect: 0.8, role: "structure" },
      { shape: "card", tone: "cream", x: 0.7, y: 0.4, width: 0.3, aspect: 0.8, role: "structure" },
      { shape: "circle", tone: "yellow", x: 0.5, y: 0.14, width: 0.16, role: "result" },
      { shape: "arrow", tone: "green", x: 0.5, y: 0.4, width: 0.14, aspect: 0.5, role: "connector" },
      { shape: "person", tone: "halftone", x: 0.3, y: 0.75, width: 0.16, aspect: 1.2, role: "people" },
      { src: staticFile("images/photo.png"), x: 0.7, y: 0.75, width: 0.2, aspect: 1, role: "people" },
    ]}
  />
);
`;
// targets: index -> [x, y] as fractions; arrival order expected by role then listing order
const TARGETS = [[0.3, 0.4], [0.7, 0.4], [0.5, 0.14], [0.5, 0.4], [0.3, 0.75], [0.7, 0.75]];
const EXPECTED_ORDER = [0, 1, 4, 5, 3, 2];

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({ prefix: `ovs-collage-${width}x${height}-`, width, height, mode: "standard", scenes: { "collage-scene": { source: SCENE, duration: 150 } } });
  // A stand-in photo with real contrast: a dark left half, a light right half and a coloured disc across them.
  fs.mkdirSync(path.join(project.root, "public", "images"), { recursive: true });
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100" height="200" fill="#101010"/><rect x="100" width="100" height="200" fill="#f4f4f4"/><circle cx="100" cy="100" r="50" fill="#ff5030" fill-opacity="0.8"/></svg>`))
    .png()
    .toFile(path.join(project.root, "public", "images", "photo.png"));
  const added = runAddMotionPrimitive({ projectRoot: project.root, videoName: "lesson", name: "collage-broll" });
  check("add_motion_primitive installs it into the project", added.written === true && fs.existsSync(added.path) && added.componentName === "CollageBroll");

  await inBrowser(project, async ({ comp, page, seek, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const centres = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-collage-piece]")).map((el) => {
          const r = el.getBoundingClientRect();
          return { i: Number(el.getAttribute("data-collage-piece")), cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, opacity: Number.parseFloat(getComputedStyle(el).opacity) };
        }),
      );

    // the empty field
    const empty = await frame("collage-scene", 0);
    const before = await frame("collage-scene", 9);
    let off = 0;
    for (let i = 0; i < empty.data.length; i += empty.channels) if (!near([empty.data[i], empty.data[i + 1], empty.data[i + 2]], BG, 16)) off++;
    console.log(`  pixels off the colour field before the first piece: ${off}`);
    check("before the first piece's `at` the frame is the empty colour field (every pixel within the paper grain of it)", off === 0);
    check("...and frame 9 is the same field, nothing has moved yet", sameBytes(empty, before));

    // arrival: the first frame each piece's centre is at its target, and stays
    const arrived = new Array(6).fill(null);
    const widths = new Map();
    let minOpacity = 1;
    for (let f = 0; f <= 140; f++) {
      await seek("collage-scene", f);
      for (const c of await centres()) {
        minOpacity = Math.min(minOpacity, c.opacity);
        (widths.get(c.i) ?? widths.set(c.i, []).get(c.i)).push(c.w);
        const [tx, ty] = TARGETS[c.i];
        const there = Math.hypot(c.cx - tx * width, c.cy - ty * height) <= 1.5;
        if (there && arrived[c.i] === null) arrived[c.i] = f;
        if (!there) arrived[c.i] = null;
      }
    }
    console.log(`  arrival frames by piece: ${JSON.stringify(arrived)}`);
    check("every piece is at its target position at the end", arrived.every((a) => a !== null));
    const order = arrived.map((a, i) => [a, i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[1]);
    check("pieces arrive in the stated order: structure, then people, then connectors, then the result", JSON.stringify(order) === JSON.stringify(EXPECTED_ORDER));
    check("a piece that arrives first is not simply the first listed: the result (listed third) arrives last", arrived[2] === Math.max(...arrived));
    check("no fade: every piece is fully opaque in every frame", minOpacity === 1);
    check("no zoom: every piece keeps one width in every frame", [...widths.values()].every((ws) => Math.max(...ws) - Math.min(...ws) < 0.5));

    // mid flight is not at the target (a control that would fail if the test could not tell)
    await seek("collage-scene", 14);
    const mid = (await centres()).find((c) => c.i === 0);
    check("control: a piece is off its target while it is on its way (frame 14)", Math.hypot(mid.cx - 0.3 * width, mid.cy - 0.4 * height) > 40);
    check("...and it is outside the frame when it starts, entering from empty space", await (async () => { await seek("collage-scene", 10); const c = (await centres()).find((x) => x.i === 0); return c.cx < -10 || c.cx > width + 10 || c.cy < -10 || c.cy > height + 10; })());

    // the finished picture
    const end = await frame("collage-scene", 145);
    const at = (i, dx = 0, dy = 0) => rgb(end, TARGETS[i][0] * width + dx, TARGETS[i][1] * height + dy);
    check("the blue cardstock is blue at its target", near(at(0), [46, 111, 216], 24));
    check("the cream card is cream", near(at(1), [242, 232, 213], 24));
    check("the yellow circle is yellow", near(at(2), [242, 194, 48], 24));
    check("the green connector is green", near(at(3), [47, 163, 107], 24));
    const photo = [];
    for (let dy = -width * 0.06; dy <= width * 0.06; dy += 5) for (let dx = -width * 0.06; dx <= width * 0.06; dx += 5) photo.push(at(5, dx, dy));
    check("the image is cut out in black and white (no colour left in it)", photo.every(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= 14));
    check("...with real halftone: it holds both near-black and near-white", photo.some((c) => c[0] < 60) && photo.some((c) => c[0] > 200));
    const again = await frame("collage-scene", 145);
    check("two renders of the same frame are identical", sameBytes(end, again));
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

if (!haveNodeModules) skip("collage-broll", "no resolvable node_modules to scaffold a renderable project from");
else {
  await run(1920, 1080);
  await run(1080, 1920);
}
finish();

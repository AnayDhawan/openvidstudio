#!/usr/bin/env node
// Renders the gallery stills for @openvidstudio/styles into packages/docs/img/api/styles-<name>.png.
//
//   node scripts/build-styles-gallery.mjs        (needs: pnpm --filter @openvidstudio/capture build, and Chromium)
//
// The package is bundled with esbuild, drawn on a real canvas in headless Chromium (launched through the capture
// package's launchChromium), and each still is read back, downscaled and written as a palette PNG with sharp.
// One still per narrator pose, plus a parallax scene, a floor grid scene and a vertical 720x1280 layout example.
// They are the kit as it renders, so re-run this when a look changes.

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openStylesPage } from "../packages/styles/scripts/browser.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "packages", "docs", "img", "api");
const sharp = require(path.join(root, "packages", "mcp-server", "node_modules", "sharp"));

const session = await openStylesPage({ width: 720, height: 1280 });
if (session.error) {
  console.error(`Cannot render the styles gallery: ${session.error}`);
  process.exit(2);
}
const { page } = session;
fs.mkdirSync(outDir, { recursive: true });

async function save(name, size, width) {
  const url = await page.evaluate(() => document.getElementById("c").toDataURL("image/png"));
  const png = Buffer.from(url.split(",")[1], "base64");
  const file = path.join(outDir, `styles-${name}.png`);
  await sharp(png)
    .resize({ width, kernel: "nearest" })
    .png({ palette: true, quality: 90, colours: 128, dither: 0.6, compressionLevel: 9 })
    .toFile(file);
  console.log(`  ${path.relative(root, file)}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
}

const resize = (w, h) =>
  page.evaluate(
    ({ w, h }) => {
      const c = document.getElementById("c");
      c.width = w;
      c.height = h;
    },
    { w, h },
  );

// One still per pose: the narrator on a dark ground with a pixel shadow, a prop, and the pose's name in pixel text.
const POSES = [
  ["idle", "ruler", "physics"],
  ["talk", "battery", "math"],
  ["point", "bridge", "cs"],
  ["think", "ball", "chemistry"],
  ["celebrate", "bat", "biology"],
];
await resize(240, 320);
for (const [pose, prop, subject] of POSES) {
  await page.evaluate(
    ({ pose, prop, subject, t }) => {
      const ctx = document.getElementById("c").getContext("2d");
      const accent = OVS.ACCENTS[subject];
      ctx.fillStyle = OVS.VOID;
      ctx.fillRect(0, 0, 240, 320);
      OVS.drawFloorGrid(ctx, { x: 0, y: 230, w: 240, h: 90 }, 0, { horizon: 230, color: accent, rows: 6, cols: 10, lineWidth: 1, fog: 0.6 });
      OVS.drawShadow(ctx, 100, 276, 52, 8, 0.5);
      OVS.drawNarrator(ctx, pose, 100 - 8 * 8, 276 - 22 * 8, 8, t, accent);
      const p = OVS.getProp(prop);
      OVS.drawProp(ctx, prop, 180 - Math.floor((p.width * 4) / 2), 276 - p.height * 4, 4, t);
      const label = pose.toUpperCase();
      OVS.drawPixelText(ctx, label, Math.round((240 - OVS.measurePixelText(label, 3)) / 2), 14, 3, accent);
    },
    // t picks the animation frame: the second frame of each pose where it has one
    { pose, prop, subject, t: pose === "think" ? 1.6 : pose === "talk" ? 0.13 : pose === "idle" ? 0.2 : 0.25 },
  );
  await save(`narrator-${pose}`, 240, 240);
}

// A parallax scene: four layers, the camera mid-dolly, the narrator on the ground.
await resize(720, 1280);
await page.evaluate(() => {
  const W = 720;
  const H = 1280;
  const ctx = document.getElementById("c").getContext("2d");
  const accent = OVS.ACCENTS.cs;
  const par = new OVS.Parallax({ width: W, height: H, seed: 21, accent, speed: 60 });
  ctx.fillStyle = OVS.VOID;
  ctx.fillRect(0, 0, W, H);
  const t = 2.5;
  par.draw(ctx, t, OVS.dolly(t, { to: { scale: 1.25, x: 80, y: 0 }, duration: 4 }));
  ctx.fillStyle = OVS.withAlpha(accent, 0.12);
  ctx.fillRect(0, par.horizon, W, H - par.horizon);
  OVS.drawFog(ctx, { x: 0, y: 0, w: W, h: H }, par.horizon, { strength: 0.6 });
  OVS.drawShadow(ctx, 360, 900, 96, 16, 0.5);
  OVS.drawNarrator(ctx, "point", 360 - 8 * 10, 900 - 22 * 10, 10, t, accent);
});
await save("parallax", 720, 360);

// A floor grid scene: the perspective grid, fog at the horizon and a prop standing on it.
await page.evaluate(() => {
  const W = 720;
  const H = 1280;
  const ctx = document.getElementById("c").getContext("2d");
  const accent = OVS.ACCENTS.physics;
  ctx.fillStyle = OVS.VOID;
  ctx.fillRect(0, 0, W, H);
  const horizon = 520;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, OVS.VOID);
  sky.addColorStop(1, OVS.withAlpha(accent, 0.22));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);
  OVS.drawFloorGrid(ctx, { x: 0, y: horizon, w: W, h: H - horizon }, 0.4, { horizon, color: accent, rows: 16, cols: 18 });
  OVS.drawFog(ctx, { x: 0, y: 0, w: W, h: H }, horizon, { strength: 0.85 });
  OVS.drawShadow(ctx, 360, 860, 70, 12, 0.5);
  OVS.drawProp(ctx, "ball", 360 - 4 * 12, 860 - 8 * 12 - 20, 12, 0);
});
await save("floorgrid", 720, 360);

// The vertical layout: safe area outlined, headline fitted, narrator, key number, caption band.
await page.evaluate(() => {
  const W = OVS.LOGICAL_WIDTH;
  const H = OVS.LOGICAL_HEIGHT;
  const ctx = document.getElementById("c").getContext("2d");
  const accent = OVS.ACCENTS.math;
  const s = OVS.safeArea(W, H);
  ctx.fillStyle = OVS.VOID;
  ctx.fillRect(0, 0, W, H);
  // The unsafe bands, shaded so the still shows what is kept clear.
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, 0, W, s.y);
  ctx.fillRect(0, s.y + s.h, W, H - s.y - s.h);
  ctx.strokeStyle = OVS.withAlpha(accent, 0.5);
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.strokeRect(s.x, s.y, s.w, s.h);
  ctx.setLineDash([]);
  const hl = OVS.fitTextLayout(ctx, "Why do heavy and light balls land together?", s.w, 3, 96, "headline");
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "top";
  hl.lines.forEach((l, i) => ctx.fillText(l, s.x + 8, s.y + 16 + i * Math.round(hl.size * 1.2)));
  OVS.drawShadow(ctx, 200, 780, 70, 12, 0.5);
  OVS.drawNarrator(ctx, "talk", 200 - 8 * 8, 780 - 22 * 8, 8, 0.13, accent);
  const n = OVS.fitTextLayout(ctx, "9.81", s.w / 2 - 20, 1, 200, "number");
  ctx.fillStyle = accent;
  ctx.fillText("9.81", s.x + s.w / 2 + 20, 600);
  const lab = OVS.fitTextLayout(ctx, "metres per second squared", s.w / 2 - 20, 2, 36, "label");
  ctx.fillStyle = "#FFFFFF";
  lab.lines.forEach((l, i) => ctx.fillText(l, s.x + s.w / 2 + 20, 600 + n.size + 12 + i * Math.round(lab.size * 1.25)));
  ctx.font = `700 ${n.size}px sans-serif`;
  OVS.drawCaption(ctx, "Both reach the ground at the same moment.", W, H);
});
await save("vertical-layout", 720, 360);

await session.close();

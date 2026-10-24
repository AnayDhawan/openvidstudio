#!/usr/bin/env node
// styles-depth: the @openvidstudio/styles depth kit. A parallax scene is a pure function of t (identical pixels
// for the same t, different pixels for a different t), the floor grid really converges on the horizon, fog and
// shadows draw where they should, far layers are pre-blurred, a 720x1280 frame fits the 30 ms budget, and nothing
// in the package source reaches for the platform's global random generator. Drawn in real headless Chromium.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { check, skip, finish } from "./_harness.mjs";
import { openStylesPage, stylesRoot } from "../../../styles/scripts/browser.mjs";

const W = 720;
const H = 1280;

const session = await openStylesPage({ width: W, height: H });
if (session.error) {
  skip("depth drawing in Chromium", session.error);
} else {
  const { page } = session;
  await page.evaluate(
    ({ W, H }) => {
      const ctx = document.getElementById("c").getContext("2d", { willReadFrequently: true });
      window.ctx = ctx;
      window.hash = () => {
        const d = ctx.getImageData(0, 0, W, H).data;
        let a = 0x811c9dc5;
        let b = 5381;
        for (let i = 0; i < d.length; i++) {
          a = Math.imul(a ^ d[i], 16777619) >>> 0;
          b = (Math.imul(b, 33) + d[i]) >>> 0;
        }
        return `${a.toString(16)}-${b.toString(16)}`;
      };
      window.colours = (x, y, w, h) => {
        const d = ctx.getImageData(x, y, w, h).data;
        const s = new Set();
        for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        return s.size;
      };
      window.makeScene = (seed, layers) => {
        const par = new OVS.Parallax({ width: W, height: H, seed, accent: OVS.ACCENTS.physics, layers });
        return (t) => {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = OVS.VOID;
          ctx.fillRect(0, 0, W, H);
          const cam = OVS.dolly(t, { to: { scale: 1.2, x: 60, y: 0 }, duration: 4 });
          par.draw(ctx, t, cam);
          const area = OVS.safeArea(W, H);
          OVS.drawFloorGrid(ctx, { x: 0, y: par.horizon, w: W, h: H - par.horizon }, t, { horizon: par.horizon, color: OVS.ACCENTS.physics });
          OVS.drawFog(ctx, { x: 0, y: 0, w: W, h: H }, par.horizon);
          OVS.drawShadow(ctx, 360, 900, 70, 14);
          OVS.drawNarrator(ctx, "talk", 360 - 8 * 8, 900 - 23 * 8 + 6, 8, t, OVS.ACCENTS.physics);
          OVS.drawProp(ctx, "ball", 520, 840, 6, t);
          OVS.drawCaption(ctx, "A scene is a pure function of t", W, H);
          void area;
        };
      };
    },
    { W, H },
  );

  console.log("\n== a parallax scene is a pure function of t ==");
  const same = await page.evaluate(() => {
    const draw = window.makeScene(7);
    draw(1.25);
    const a = window.hash();
    draw(3.5);
    draw(1.25);
    const b = window.hash();
    window.makeScene(7)(1.25);
    const c = window.hash();
    draw(1.75);
    const d = window.hash();
    window.makeScene(8)(1.25);
    const e = window.hash();
    return { a, b, c, d, e };
  });
  check("the same t drawn twice gives identical pixels", same.a === same.b);
  check("a fresh scene with the same seed gives the same pixels", same.a === same.c);
  check("a different t gives different pixels", same.a !== same.d);
  check("control: a different seed gives different pixels", same.a !== same.e);

  console.log("\n== the camera dolly ==");
  const cam = await page.evaluate(() => {
    const o = { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.5, x: 100, y: -20 }, start: 1, duration: 2 };
    return { before: OVS.dolly(0, o), mid: OVS.dolly(2, o), after: OVS.dolly(9, o), again: OVS.dolly(2, o) };
  });
  check("before it starts the camera is at the start pose", cam.before.scale === 1 && cam.before.x === 0);
  check("half way through the move it is half way (ease in and out is symmetric)", Math.abs(cam.mid.scale - 1.25) < 1e-9 && Math.abs(cam.mid.x - 50) < 1e-9);
  check("after it ends it holds the end pose", cam.after.scale === 1.5 && cam.after.y === -20);
  check("the same t gives the same camera", JSON.stringify(cam.mid) === JSON.stringify(cam.again));

  console.log("\n== layers: three to five, far ones pre-blurred ==");
  const layers = await page.evaluate(() => {
    const spec = (n) => Array.from({ length: n }, (_, i) => ({ kind: "hills", color: "#334", depth: i / n }));
    const tryN = (n) => {
      try {
        return new OVS.Parallax({ width: 720, height: 1280, layers: spec(n) }).layerCount;
      } catch (e) {
        return "refused";
      }
    };
    const draw = (blur) => {
      const par = new OVS.Parallax({
        width: 720,
        height: 1280,
        seed: 3,
        layers: [
          { kind: "stars", color: "#FFFFFF", depth: 0.05, count: 200, blur },
          { kind: "hills", color: "#223", depth: 0.4 },
          { kind: "hills", color: "#334", depth: 0.8 },
        ],
      });
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 720, 1280);
      par.draw(ctx, 0);
      return window.colours(0, 0, 720, 400);
    };
    return { n2: tryN(2), n3: tryN(3), n5: tryN(5), n6: tryN(6), sharp: draw(0), blurred: draw(5), default: new OVS.Parallax({ width: 720, height: 1280 }).layerCount };
  });
  check("two layers is refused", layers.n2 === "refused");
  check("three and five layers are accepted", layers.n3 === 3 && layers.n5 === 5);
  check("control: six layers is refused", layers.n6 === "refused");
  check(`the default set has 3-5 layers (${layers.default})`, layers.default >= 3 && layers.default <= 5);
  check(`a pre-blurred far layer has soft edges: ${layers.blurred} colours against ${layers.sharp} when sharp`, layers.blurred > layers.sharp * 3);

  console.log("\n== the floor grid converges on the horizon ==");
  const grid = await page.evaluate(() => {
    const horizon = 600;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 720, 1280);
    OVS.drawFloorGrid(ctx, { x: 0, y: horizon, w: 720, h: 680 }, 0.3, { horizon, color: "#FFFFFF", fog: 0 });
    let d = ctx.getImageData(0, 0, 720, 1280).data;
    const lit = (x, y) => d[(y * 720 + x) * 4] > 30;
    const rowSpread = (target) => {
      // The nearest row that holds only radiating lines (a horizontal line would light most of the row).
      for (let off = 0; off < 40; off++) {
        for (const y of [target + off, target - off]) {
          let min = 1e9, max = -1, n = 0;
          for (let x = 0; x < 720; x++) if (lit(x, y)) { n++; min = Math.min(min, x); max = Math.max(max, x); }
          if (n > 0 && n < 120) return { y, spread: max - min, n };
        }
      }
      return { y: target, spread: -1, n: -1 };
    };
    let above = 0;
    for (let y = 0; y < horizon - 1; y++) for (let x = 0; x < 720; x++) if (lit(x, y)) above++;
    const near = rowSpread(600 + Math.round(680 * 0.2));
    const far = rowSpread(600 + Math.round(680 * 0.5));
    let below = 0;
    for (let y = horizon; y < 1280; y++) for (let x = 0; x < 720; x++) if (lit(x, y)) below++;
    // Control scene: parallel vertical lines, which must measure as the same width at both depths.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 720, 1280);
    ctx.fillStyle = "#FFF";
    for (let x = 100; x < 620; x += 40) ctx.fillRect(x, horizon, 2, 680);
    d = ctx.getImageData(0, 0, 720, 1280).data;
    const flat = { near: rowSpread(600 + Math.round(680 * 0.2)), far: rowSpread(600 + Math.round(680 * 0.5)) };
    return { above, near, far, below, flat };
  });
  check("nothing is drawn above the horizon", grid.above === 0);
  check(`the grid lights pixels below it (${grid.below})`, grid.below > 1000);
  check(`the radiating lines spread out toward the viewer (${grid.near.spread}px at 20% down, ${grid.far.spread}px at 50%)`, grid.near.spread > 0 && grid.far.spread > grid.near.spread * 1.8);
  check(`control: parallel lines do not pass that test (${grid.flat.near.spread}px against ${grid.flat.far.spread}px)`, !(grid.flat.far.spread > grid.flat.near.spread * 1.8));

  console.log("\n== fog and shadows ==");
  const fx = await page.evaluate(() => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, 720, 1280);
    OVS.drawFog(ctx, { x: 0, y: 0, w: 720, h: 1280 }, 600, { color: "#000000", strength: 1 });
    const px = (y) => ctx.getImageData(10, y, 1, 1).data[0];
    const fog = { top: px(5), horizon: px(600), bottom: px(1275) };
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, 720, 1280);
    OVS.drawShadow(ctx, 360, 640, 60, 12, 0.5, 2);
    const d = ctx.getImageData(0, 0, 720, 1280).data;
    const seen = new Set();
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < 1280; y++) for (let x = 0; x < 720; x++) {
      const v = d[(y * 720 + x) * 4];
      seen.add(v);
      if (v < 255) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    return { fog, shades: [...seen], box: [minX, maxX, minY, maxY] };
  });
  check(`fog is full strength at the horizon and gone at the ends (${JSON.stringify(fx.fog)})`, fx.fog.horizon < 40 && fx.fog.top === 255 && fx.fog.bottom === 255);
  check(`a shadow is a hard-edged pixel ellipse: two shades only (${fx.shades.join(",")})`, fx.shades.length === 2);
  check(`a shadow stays within its radii (${fx.box.join(",")})`, fx.box[0] >= 300 && fx.box[1] <= 420 && fx.box[2] >= 628 && fx.box[3] <= 652);

  console.log("\n== a 720x1280 frame draws in under 30 ms ==");
  const timing = await page.evaluate(() => {
    const draw = window.makeScene(11);
    const frames = [];
    for (let i = 0; i < 6; i++) draw(i * 0.04);
    for (let i = 0; i < 21; i++) {
      const t0 = performance.now();
      draw(0.3 + i / 30);
      window.ctx.getImageData(0, 0, 1, 1);
      frames.push(performance.now() - t0);
    }
    const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const slow = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      while (performance.now() - t0 < 40);
      slow.push(performance.now() - t0);
    }
    return { median: median(frames), max: Math.max(...frames), slowMedian: median(slow) };
  });
  console.log(`  median ${timing.median.toFixed(2)} ms, worst ${timing.max.toFixed(2)} ms over 21 warm frames`);
  check(`the median frame takes ${timing.median.toFixed(1)} ms, under 30`, timing.median < 30);
  check(`control: a frame that takes 40 ms is over the budget (${timing.slowMedian.toFixed(0)} ms)`, !(timing.slowMedian < 30));

  await session.close();
}

console.log("\n== no use of the platform random generator anywhere in the package ==");
{
  const needle = "Math" + ".random";
  const scan = (dir) => {
    const hits = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) hits.push(...scan(full));
      else if (fs.readFileSync(full, "utf8").includes(needle)) hits.push(path.relative(stylesRoot, full));
    }
    return hits;
  };
  const files = [];
  (function list(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      e.isDirectory() ? list(path.join(dir, e.name)) : files.push(e.name);
    }
  })(stylesRoot);
  check(`the scan looks at real files (${files.length} in packages/styles)`, files.length >= 10);
  check(`no file under packages/styles contains the text "${needle}"`, scan(stylesRoot).length === 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-styles-grep-"));
  fs.writeFileSync(path.join(tmp, "bad.ts"), `const x = ${needle}();\n`);
  fs.writeFileSync(path.join(tmp, "good.ts"), "const x = 1;\n");
  check("control: the scan does find the text in a file that has it", fs.readFileSync(path.join(tmp, "bad.ts"), "utf8").includes(needle) && !fs.readFileSync(path.join(tmp, "good.ts"), "utf8").includes(needle));
  fs.rmSync(tmp, { recursive: true, force: true });
}

finish();

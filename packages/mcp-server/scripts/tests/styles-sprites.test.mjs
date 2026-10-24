#!/usr/bin/env node
// styles-sprites: @openvidstudio/styles draws palette-indexed sprites as crisp integer blocks (exact pixels at
// scales 1, 2 and 4, no smoothing, no blending), the narrator has all five poses with a gallery still each, and
// the prop registry is extendable. Drawing runs in real headless Chromium; the package is bundled from src/.

import * as fs from "node:fs";
import * as path from "node:path";
import { monorepoRoot, check, skip, finish } from "./_harness.mjs";
import { openStylesPage } from "../../../styles/scripts/browser.mjs";

const POSES = ["idle", "talk", "point", "think", "celebrate"];
const FIXTURE = ["R..GG..B", ".R.GG.B.", "..RGGB..", "GGGGGGGG", "BBBRRGGG", "...RR...", "R......R", "BGBGBGBG"];
const PALETTE = { R: "#ff0000", G: "#00ff00", B: "#0000ff" };
const BG = [16, 32, 48];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** True when every pixel of the 64x64 readback is exactly the sprite pixel it should be, or the background. */
function exact(px, scale, ox, oy) {
  const W = 64;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const got = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      const c = Math.floor((x - ox) / scale);
      const r = Math.floor((y - oy) / scale);
      let want = [...BG, 255];
      if (x >= ox && y >= oy && c < 8 && r < 8) {
        const ch = FIXTURE[r][c];
        if (ch !== ".") want = [...hex(PALETTE[ch]), 255];
      }
      if (got.some((v, k) => v !== want[k])) return false;
    }
  }
  return true;
}

const session = await openStylesPage({ width: 64, height: 64 });
if (session.error) {
  skip("sprite drawing in Chromium", session.error);
} else {
  const { page } = session;

  console.log("\n== an 8x8 fixture draws as exact blocks at scales 1, 2 and 4 ==");
  const draw = (scale, x, y) =>
    page.evaluate(
      ({ fixture, palette, bg, scale, x, y }) => {
        const c = document.getElementById("c");
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 64, 64);
        // Smoothing is deliberately left ON here: drawSprite must switch it off itself.
        ctx.imageSmoothingEnabled = true;
        const sprite = OVS.makeSprite(palette, [fixture]);
        OVS.drawSprite(ctx, sprite, x, y, scale, 0);
        return Array.from(ctx.getImageData(0, 0, 64, 64).data);
      },
      { fixture: FIXTURE, palette: PALETTE, bg: `rgb(${BG.join(",")})`, scale, x, y },
    );
  for (const s of [1, 2, 4]) {
    const px = await draw(s, 5, 7);
    check(`scale ${s}: every pixel is exactly the palette colour or the background`, exact(px, s, 5, 7));
    const colours = new Set();
    for (let i = 0; i < px.length; i += 4) colours.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    check(`scale ${s}: only 4 distinct colours on the canvas (no blended edge pixels), got ${colours.size}`, colours.size === 4);
  }
  const frac = await draw(2.6, 5.4, 7.4);
  check("a fractional scale and position round to whole pixels (2.6 draws as 3, 5.4 as 5)", exact(frac, 3, 5, 7));

  console.log("\n== controls meant to fail ==");
  const s2 = await draw(2, 5, 7);
  check("control: a scale-2 drawing does not pass as scale 4", !exact(s2, 4, 5, 7));
  check("control: a drawing at (5,7) does not pass as drawn at (6,7)", !exact(s2, 2, 6, 7));
  const blurred = await page.evaluate(
    ({ fixture, palette, bg }) => {
      const c = document.getElementById("c");
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 64, 64);
      const small = document.createElement("canvas");
      small.width = 8;
      small.height = 8;
      OVS.drawSprite(small.getContext("2d"), OVS.makeSprite(palette, [fixture]), 0, 0, 1, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(small, 5.5, 7.5, 32, 32);
      return Array.from(ctx.getImageData(0, 0, 64, 64).data);
    },
    { fixture: FIXTURE, palette: PALETTE, bg: `rgb(${BG.join(",")})` },
  );
  check("control: the same sprite upscaled with smoothing on fails the exact-pixel check", !exact(blurred, 4, 5, 7));

  console.log("\n== sprites reject bad grids ==");
  const errs = await page.evaluate(() => {
    const t = (fn) => {
      try {
        fn();
        return "no error";
      } catch (e) {
        return String(e.message);
      }
    };
    return {
      ragged: t(() => OVS.makeSprite({ a: "#fff" }, [["aa", "a"]])),
      unknown: t(() => OVS.makeSprite({ a: "#fff" }, [["ab"]])),
      empty: t(() => OVS.makeSprite({ a: "#fff" }, [])),
      ok: t(() => OVS.makeSprite({ a: "#fff" }, [["a."]])),
    };
  });
  check("a ragged row is refused", /wide/.test(errs.ragged));
  check("a character missing from the palette is refused", /not in the palette/.test(errs.unknown));
  check("a sprite with no frames is refused", /at least one frame/.test(errs.empty));
  check("control: a valid sprite is accepted", errs.ok === "no error");

  console.log("\n== the narrator has five poses, animated by t, and an extendable prop set ==");
  const info = await page.evaluate((poses) => {
    const out = { poses: {}, same: true, props: OVS.propNames() };
    for (const p of poses) {
      const s = OVS.narratorSprite(p);
      out.poses[p] = { w: s.width, h: s.height, n: s.frames.length, f0: s.frames[0].join("|"), fa: OVS.narratorFrame(p, 0.31), fb: OVS.narratorFrame(p, 0.31) };
    }
    out.talkAt = [0, 0.13, 0.26, 0.39].map((t) => OVS.narratorFrame("talk", t));
    out.accentDiffers = OVS.narratorSprite("idle", "#FF4D5E").palette.b !== OVS.narratorSprite("idle", "#5CC8FF").palette.b;
    let dup = "no error";
    try {
      OVS.registerProp("ball", OVS.makeSprite({ a: "#fff" }, [["a"]]));
    } catch (e) {
      dup = "refused";
    }
    OVS.registerProp("beaker", OVS.makeSprite({ a: "#7CFFB2", o: "#14172B" }, [["oaao", "oaao", "oooo"]]));
    out.dup = dup;
    out.afterRegister = OVS.propNames();
    out.beakerW = OVS.getProp("beaker").width;
    return out;
  }, POSES);
  check("all five poses exist at the same size", POSES.every((p) => info.poses[p].w === info.poses[p].w && info.poses[p].w === 16 && info.poses[p].h === 23));
  check("no two poses share their first frame", new Set(POSES.map((p) => info.poses[p].f0)).size === 5);
  check("animated poses have more than one frame (talk, think, celebrate, point, idle)", POSES.every((p) => info.poses[p].n >= 2));
  check("the frame is a pure function of t (same t, same frame)", POSES.every((p) => info.poses[p].fa === info.poses[p].fb));
  check(`talk cycles through different frames over time (${info.talkAt.join(",")})`, new Set(info.talkAt).size > 1);
  check("the accent recolours the shirt", info.accentDiffers);
  check("the six built-in props exist (ball, ruler, battery, cable, bridge, bat)", ["ball", "ruler", "battery", "cable", "bridge", "bat"].every((n) => info.props.includes(n)));
  check("control: a built-in name cannot be silently replaced", info.dup === "refused");
  check("a lesson can register its own prop", info.afterRegister.includes("beaker") && info.beakerW === 4);

  await session.close();
}

console.log("\n== every narrator pose has a gallery still, described in API.md ==");
{
  const imgDir = path.join(monorepoRoot, "packages", "docs", "img", "api");
  const api = fs.readFileSync(path.join(monorepoRoot, "packages", "docs", "API.md"), "utf8").replace(/\r\n/g, "\n");
  const embeds = [...api.matchAll(/!\[([^\]]*)\]\(img\/api\/([^)]+\.png)\)/g)].map((m) => ({ alt: m[1], file: m[2] }));
  const stillFor = (pose) => `styles-narrator-${pose}.png`;
  for (const pose of POSES) {
    const file = stillFor(pose);
    const e = embeds.find((x) => x.file === file);
    check(`${pose}: ${file} exists, is small, and API.md embeds it with alt text of 8+ words`, fs.existsSync(path.join(imgDir, file)) && fs.statSync(path.join(imgDir, file)).size < 160 * 1024 && !!e && e.alt.trim().split(/\s+/).length >= 8);
  }
  check("control: a pose that was never made has no still", !fs.existsSync(path.join(imgDir, stillFor("dance"))) && !embeds.some((x) => x.file === stillFor("dance")));
}

finish();

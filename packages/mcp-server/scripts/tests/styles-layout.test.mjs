#!/usr/bin/env node
// styles-layout: the vertical 720x1280 helpers in @openvidstudio/styles (#157). safeArea has the right numbers,
// fitText never returns below the role minimum (headline 44, label 28, key number 64), and a fixture frame at
// 720x1280 draws nothing in the unsafe top and bottom bands (captions sit inside the safe area). Real headless
// Chromium canvas.

import { check, skip, finish } from "./_harness.mjs";
import { openStylesPage } from "../../../styles/scripts/browser.mjs";

const W = 720;
const H = 1280;

const session = await openStylesPage({ width: W, height: H });
if (session.error) {
  skip("layout drawing in Chromium", session.error);
} else {
  const { page } = session;

  console.log("\n== safeArea ==");
  const sa = await page.evaluate(() => ({
    reel: OVS.safeArea(720, 1280),
    land: OVS.safeArea(1280, 720),
    small: OVS.safeArea(360, 640),
    size: OVS.LOGICAL_SIZE,
    inside: OVS.insideSafeArea(720, 1280, { x: 40, y: 200, w: 600, h: 700 }),
    outside: OVS.insideSafeArea(720, 1280, { x: 40, y: 100, w: 600, h: 700 }),
    band: OVS.captionBand(720, 1280),
  }));
  check("the logical size is 720x1280", sa.size.width === 720 && sa.size.height === 1280);
  check(`at 720x1280 the top 14% (179 px) and bottom 22% (282 px) are clear: y ${sa.reel.y}, h ${sa.reel.h}`, sa.reel.y === 179 && sa.reel.y + sa.reel.h === 1280 - 282 && sa.reel.h === 819);
  check(`the sides keep a 5% margin (x ${sa.reel.x}, w ${sa.reel.w})`, sa.reel.x === 36 && sa.reel.w === 648);
  check("it is right for other sizes: 360x640 is the same rectangle at half scale (to rounding)", Math.abs(sa.small.y * 2 - sa.reel.y) <= 2 && Math.abs(sa.small.h * 2 - sa.reel.h) <= 2);
  check("it follows the proportions on a landscape canvas too (top 14% of 720 is 101)", sa.land.y === 101 && sa.land.y + sa.land.h === 720 - 158);
  check("a rectangle inside the safe area is reported inside", sa.inside === true);
  check("control: a rectangle poking into the top band is reported outside", sa.outside === false);
  check(`the caption band sits at the bottom of the safe area (ends at ${sa.band.y + sa.band.h})`, sa.band.y + sa.band.h === sa.reel.y + sa.reel.h && sa.band.y >= sa.reel.y && sa.band.w === sa.reel.w);

  console.log("\n== fitText ==");
  const LONG = "Why does a heavier ball not fall faster than a lighter one when both are dropped together from the same height";
  const fit = await page.evaluate(
    ({ LONG }) => {
      const ctx = document.getElementById("c").getContext("2d");
      const box = OVS.safeArea(720, 1280).w;
      const out = {};
      out.longHeadline = OVS.fitTextLayout(ctx, "Why does a heavier ball not fall faster than a lighter one?", box, 3, 96, "headline");
      out.overlong = OVS.fitTextLayout(ctx, LONG, box, 3, 96, "headline");
      out.shortHeadline = OVS.fitTextLayout(ctx, "Free fall", box, 2, 96, "headline");
      out.number = OVS.fitTextLayout(ctx, "9.81 m/s2", box, 1, 200, "number");
      out.hugeNumber = OVS.fitTextLayout(ctx, "6.02214076e23 particles per mole", box, 1, 200, "number");
      out.label = OVS.fitTextLayout(ctx, "Both reach the ground at the same moment", box / 2, 2, 40, "label");
      out.labelLong = OVS.fitTextLayout(ctx, "Both reach the ground at the same moment, whatever the mass", box / 2, 2, 40, "label");
      out.tiny = OVS.fitText(ctx, LONG, box, 3, 10, "headline");
      out.asNumber = typeof OVS.fitText(ctx, "Hi", box, 1, 60, "headline");
      out.min = OVS.ROLE_MIN_SIZE;
      return out;
    },
    { LONG },
  );
  check("the role minimums are headline 44, label 28, key number 64", fit.min.headline === 44 && fit.min.label === 28 && fit.min.number === 64);
  check(`a long headline over three lines fits at ${fit.longHeadline.size}px, not below 44`, fit.longHeadline.fits && fit.longHeadline.size >= 44 && fit.longHeadline.lines.length <= 3);
  check(`a short headline keeps the start size (${fit.shortHeadline.size})`, fit.shortHeadline.size === 96);
  check(`a number fits on one line at ${fit.number.size}px, not below 64`, fit.number.fits && fit.number.size >= 64 && fit.number.lines.length === 1);
  check(`a number too wide for its box stops at the key-number minimum (${fit.hugeNumber.size}) and reports that it does not fit`, fit.hugeNumber.size === 64 && !fit.hugeNumber.fits);
  check(`a two-line label fits at ${fit.label.size}px, not below 28`, fit.label.fits && fit.label.size >= 28 && fit.label.lines.length <= 2);
  check(`a longer two-line label never goes below 28 (${fit.labelLong.size})`, fit.labelLong.size >= 28);
  check(`a start size below the role minimum is lifted to it (asked for 10, got ${fit.tiny})`, fit.tiny >= 44);
  check(`a headline too long for three lines stops at 44 and reports that it does not fit (${fit.overlong.size})`, fit.overlong.size === 44 && !fit.overlong.fits);
  check("fitText returns a plain number", fit.asNumber === "number");
  check("control: the long headline does not fit at 44 on one line", await page.evaluate(({ LONG }) => {
    const ctx = document.getElementById("c").getContext("2d");
    return !OVS.fitTextLayout(ctx, LONG, 648, 1, 96, "headline").fits;
  }, { LONG }));
  check("control: the largest size is chosen, one more would not fit", await page.evaluate(({ LONG }) => {
    const ctx = document.getElementById("c").getContext("2d");
    const T = "Why does a heavier ball not fall faster than a lighter one?";
    const r = OVS.fitTextLayout(ctx, T, 648, 3, 96, "headline");
    if (r.size === 96 || r.size === 44) return false;
    // Re-wrap at size+1: either too many lines or a line too wide.
    ctx.font = `700 ${r.size + 1}px sans-serif`;
    const words = T.split(" ");
    let line = "", lines = 0, wide = false;
    for (const w of words) {
      const next = line ? line + " " + w : w;
      if (line && ctx.measureText(next).width > 648) { lines++; line = w; } else line = next;
    }
    lines++;
    return lines > 3 || ctx.measureText(line).width > 648 || wide;
  }, { LONG }));

  console.log("\n== a 720x1280 fixture draws nothing in the unsafe bands except captions ==");
  // Draws a lesson-like frame inside safeArea, the caption in the caption band, and reads back the bands.
  const bands = (extra) =>
    page.evaluate(
      ({ extra }) => {
        const ctx = document.getElementById("c").getContext("2d", { willReadFrequently: true });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = OVS.VOID;
        ctx.fillRect(0, 0, 720, 1280);
        const s = OVS.safeArea(720, 1280);
        const hl = OVS.fitTextLayout(ctx, "Why do heavy and light balls land together?", s.w, 3, 88, "headline", "sans-serif");
        ctx.fillStyle = "#FFFFFF";
        ctx.textBaseline = "top";
        hl.lines.forEach((l, i) => ctx.fillText(l, s.x, s.y + i * hl.size * 1.2));
        OVS.drawNarrator(ctx, "point", s.x + 40, s.y + 330, 10, 0.2, OVS.ACCENTS.physics);
        OVS.drawProp(ctx, "ball", s.x + 400, s.y + 420, 8, 0);
        OVS.drawPixelText(ctx, "9.81", s.x, s.y + s.h - 330, 12, OVS.ACCENTS.physics);
        const cap = OVS.drawCaption(ctx, "Both land at the same moment.", 720, 1280);
        if (extra) {
          ctx.fillStyle = "#FF00FF";
          ctx.fillRect(100, 40, 200, 30);
        }
        const d = ctx.getImageData(0, 0, 720, 1280).data;
        const bg = [11, 13, 20];
        const dirty = (y0, y1) => {
          let n = 0;
          for (let y = y0; y < y1; y++) for (let x = 0; x < 720; x++) {
            const i = (y * 720 + x) * 4;
            if (d[i] !== bg[0] || d[i + 1] !== bg[1] || d[i + 2] !== bg[2]) n++;
          }
          return n;
        };
        const total = dirty(s.y, s.y + s.h);
        return { top: dirty(0, s.y), bottom: dirty(s.y + s.h, 1280), inside: total, caption: cap.rect, captionFits: cap.fits, safe: s };
      },
      { extra },
    );
  const ok = await bands(false);
  check(`the top band (0 to ${ok.safe.y}) is untouched`, ok.top === 0);
  check(`the bottom band (${ok.safe.y + ok.safe.h} to 1280) is untouched`, ok.bottom === 0);
  check(`the frame did draw (${ok.inside} lit pixels in the safe area)`, ok.inside > 20000);
  check("the caption fits and lies inside the safe area", ok.captionFits && ok.caption.y >= ok.safe.y && ok.caption.y + ok.caption.h <= ok.safe.y + ok.safe.h);
  const bad = await bands(true);
  check(`control: a stray rectangle in the top band is caught (${bad.top} lit pixels)`, bad.top > 0);

  await session.close();
}

finish();

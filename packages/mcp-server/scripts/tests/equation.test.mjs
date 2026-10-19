#!/usr/bin/env node
// equation: the Equation primitive (#111), measured in real frames at 1920x1080 and 1080x1920.
//
// MathJax 4 with the Fira maths font renders it (see SUPERNOVA.md for why, against KaTeX), from the
// project's own public/mathjax/, so there is no network. The tests check that it draws something,
// that a fully revealed equation has every glyph (compared pixel for pixel with an unrevealed
// reference render of the same TeX), that the reveal goes term by term, left to right, and that
// `spoken` is required by the types and exposed for the script lint.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { packageRoot, check, skip, finish, monorepoRoot } from "./_harness.mjs";
import { lessonProject, inBrowser, haveNodeModules, luma, meanLuma, sameBytes } from "./_stem.mjs";

const TEX = String.raw`\frac{d}{dx}\left(x^{2}+1\right)=2x`;
const SPOKEN = "d by d x of x squared plus one equals two x";

const EQ_SCENE = `import React from "react";
import { AbsoluteFill } from "remotion";
import { Equation } from "@openvidstudio/stem";

export const EqScene: React.FC = () => (
  <AbsoluteFill style={{ background: "#07060B" }}>
    <Equation tex={String.raw\`${TEX}\`} spoken="${SPOKEN}" at={10} stagger={6} />
  </AbsoluteFill>
);
`;

// The reference: the same TeX typeset by the same renderer and placed the same way, with no reveal.
const REF_SCENE = `import React, { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, useVideoConfig } from "remotion";
import { texToSvg } from "@openvidstudio/stem";

export const RefScene: React.FC = () => {
  const { width, height } = useVideoConfig();
  const [svg, setSvg] = useState<string | null>(null);
  const [handle] = useState(() => delayRender("reference equation"));
  useEffect(() => {
    texToSvg(String.raw\`${TEX}\`).then((s) => { setSvg(s); continueRender(handle); });
  }, [handle]);
  const px = Math.round(Math.min(width, height) * 0.085);
  return (
    <AbsoluteFill style={{ background: "#07060B" }}>
      {svg && <div style={{ position: "absolute", left: width / 2, top: height / 2, transform: "translate(-50%, -50%)", fontSize: px, color: "#F3EFE6", lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />}
    </AbsoluteFill>
  );
};
`;

// A TeX string written without String.raw: "\\frac" in a JavaScript string is a form feed followed by "rac".
// MathJax keeps the TeX in a data-latex attribute, so the markup then holds a control character, and an XML
// parser rejects it. It must render (here as the odd text it spells), not throw.
const ESCAPE_SCENE = `import React from "react";
import { AbsoluteFill } from "remotion";
import { Equation } from "@openvidstudio/stem";

export const EscapeScene: React.FC = () => (
  <AbsoluteFill style={{ background: "#07060B" }}>
    <Equation tex={"\\frac{1}{2}+x"} spoken="one half plus x" />
  </AbsoluteFill>
);
`;

const inkBox = (img, threshold = 40) => {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1, count = 0, sx = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (luma(img, x, y) > threshold) {
        count++;
        sx += x;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return count === 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, count, cx: sx / count };
};

async function run(width, height) {
  console.log(`\n== ${width}x${height} ==`);
  const project = lessonProject({
    prefix: `ovs-equation-${width}x${height}-`,
    width,
    height,
    scenes: { "eq-scene": { source: EQ_SCENE, duration: 120 }, "ref-scene": { source: REF_SCENE, duration: 30 }, "escape-scene": { source: ESCAPE_SCENE, duration: 60 } },
  });
  check("the MathJax runtime was copied into the project's public/mathjax", fs.existsSync(path.join(project.root, "public", "mathjax", "tex-svg-nofont.js")) && fs.existsSync(path.join(project.root, "public", "mathjax", "fira", "svg.js")) && fs.existsSync(path.join(project.root, "public", "mathjax", "fira", "svg", "dynamic", "latin-i.js")));

  await inBrowser(project, async ({ comp, page, frame, errors }) => {
    check(`the composition is ${width}x${height}`, comp.width === width && comp.height === height);
    const glowing = () => page.evaluate(() => document.querySelectorAll("[data-ovs-glow]").length);
    const remote = [];
    page.on("request", (r) => {
      if (!/^(http:\/\/localhost|http:\/\/127\.0\.0\.1|blob:|data:)/.test(r.url())) remote.push(r.url());
    });

    const before = await frame("eq-scene", 5);
    check("before `at` the frame is blank (no ink at all)", inkBox(before) === null);

    // reveal: ink grows term by term, left to right
    const f = {};
    for (const local of [11, 14, 22, 34, 52, 100]) f[local] = await frame("eq-scene", local);
    const ink = Object.fromEntries(Object.entries(f).map(([k, img]) => [k, inkBox(img)]));
    console.log(`  ink (pixels) by frame: ${Object.entries(ink).map(([k, b]) => `${k}:${b ? b.count : 0}`).join("  ")}`);
    const counts = [11, 14, 22, 34, 52, 100].map((k) => ink[k]?.count ?? 0);
    check("something is drawn once the first term arrives", counts[1] > 0);
    check("the reveal only ever adds ink, frame after frame", counts.every((v, i) => i === 0 || v >= counts[i - 1]));
    check("it is term by term, not the whole equation at once (the first term is under half the ink, and there are three or more steps on the way)", counts[1] > 0 && counts[1] < counts[5] * 0.5 && new Set(counts.slice(1, 5)).size >= 3 && counts[3] < counts[5]);
    check("terms arrive left to right (the ink's centre of mass moves right as it fills)", ink[14] && ink[34] && ink[100] && ink[14].cx < ink[34].cx && ink[34].cx < ink[100].cx);
    check("every term has arrived by frame 100, and the frame then holds still", sameBytes(f[100], await frame("eq-scene", 110)) && counts[4] >= counts[5] * 0.99);
    // The markup for a frame must be the same every time, whatever frame was visited before it: that is
    // what "a pure function of the frame" means. The pixels of a term that is part-way through fading can
    // differ by a few levels between visits (the browser's own raster state), so they are held to that.
    const domOf = async (k) => {
      await frame("eq-scene", k);
      return page.evaluate(() => document.querySelector("[data-ovs-equation]")?.innerHTML ?? "");
    };
    const markupAfter14 = await domOf(14).then(() => domOf(22));
    const markupAfter110 = await domOf(110).then(() => domOf(22));
    check("the markup for frame 22 is identical whichever frame was visited just before (a pure function of the frame)", markupAfter14.length > 1000 && markupAfter14 === markupAfter110);
    const again = await frame("eq-scene", 22);
    let againMax = 0;
    for (let i = 0; i < again.data.length; i++) againMax = Math.max(againMax, Math.abs(again.data[i] - f[22].data[i]));
    console.log(`  frame 22 visited again: largest pixel difference ${againMax} levels`);
    check("...and the pixels of a re-render stay within 8 levels everywhere", againMax <= 8);

    check("the maths is sans-serif: a glyph from the family, not a fallback (the font cache is off, so the ink is vector paths)", await page.evaluate(() => document.querySelectorAll("[data-ovs-equation] svg path, [data-ovs-equation] svg use").length > 0));

    // exposed for the script lint
    const spoken = await page.evaluate(() => document.querySelector("[data-ovs-equation]")?.getAttribute("data-spoken") ?? null);
    check("`spoken` is exposed on the element as data-spoken, for check_script to read", spoken === SPOKEN);


    // fully revealed == the unrevealed reference: every glyph is drawn, in the same place
    const ref = await frame("ref-scene", 5);
    const full = f[100];
    const refInk = inkBox(ref);
    const fullInk = inkBox(full);
    console.log(`  reference ink ${refInk?.w}x${refInk?.h} (${refInk?.count} px), revealed ${fullInk?.w}x${fullInk?.h} (${fullInk?.count} px)`);
    check("the reference render is not blank", refInk !== null && refInk.count > 2000);
    const px = Math.round(Math.min(width, height) * 0.085);
    check(`the equation is the expected pixel height for a ${px}px font (between 1.3 and 3 times the font size, a fraction on top of a line)`, fullInk !== null && fullInk.h > px * 1.3 && fullInk.h < px * 3);
    check("...and it is the same size as the reference to the pixel", refInk && fullInk && refInk.w === fullInk.w && refInk.h === fullInk.h);
    let diff = 0;
    for (let i = 0; i < full.data.length; i++) if (Math.abs(full.data[i] - ref.data[i]) > 8) diff++;
    console.log(`  pixels differing from the reference by more than 8: ${diff}`);
    check("every glyph is drawn: the fully revealed equation matches the reference render pixel for pixel", diff === 0);
    check("it sits on the centre of the frame (within 60px)", fullInk && Math.abs((fullInk.x0 + fullInk.x1) / 2 - width / 2) < 60 && Math.abs((fullInk.y0 + fullInk.y1) / 2 - height / 2) < 60);
    const escaped = await frame("escape-scene", 40);
    check("TeX with a control character in it (a string with an unescaped backslash) still renders, as the text it spells", inkBox(escaped) !== null && inkBox(escaped).count > 500);

    check("nothing was fetched from outside the project (no network needed)", remote.length === 0);
    if (remote.length) console.log(`  remote requests: ${JSON.stringify(remote.slice(0, 4))}`);
    check("an Equation does not glow", (await glowing()) === 0);
    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

console.log("\n== spoken is required by the types ==");
{
  const stem = path.join(monorepoRoot, "packages", "stem");
  const tsc = path.join(stem, "node_modules", ".bin", "tsc");
  const dir = path.join(stem, ".type-test");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ extends: "../tsconfig.json", include: ["./*.tsx", "../src"] }));
  const compile = (source) => {
    fs.writeFileSync(path.join(dir, "probe.tsx"), source);
    return spawnSync(tsc, ["--noEmit", "-p", dir], { encoding: "utf8", cwd: stem });
  };
  try {
    const missing = compile(`import { Equation } from "../src";\nexport const A = <Equation tex="x" />;\n`);
    check("an Equation with no `spoken` does not typecheck", missing.status !== 0 && /spoken/.test(missing.stdout));
    const given = compile(`import { Equation } from "../src";\nexport const A = <Equation tex="x" spoken="x" />;\n`);
    check("control: the same Equation with `spoken` typechecks", given.status === 0);
    if (given.status !== 0) console.log(given.stdout.slice(0, 600));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (!haveNodeModules) {
  skip("equation", "no resolvable node_modules to scaffold a renderable project from");
} else {
  await run(1920, 1080);
  await run(1080, 1920);
}

finish();

#!/usr/bin/env node
// extract-brand: Part 40 (split out of the former single manual-test.mjs; see _harness.mjs)

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  require,
  __dirname,
  packageRoot,
  distDir,
  monorepoRoot,
  monorepoTemplateDir,
  check,
  skip,
  listFilesRecursive,
  setQuiet,
  finish,
} from "./_harness.mjs";

console.log("\n== Part 40: extract_brand finds a palette in the logo when there are no CSS design tokens (A10) ==");

{
  const { runExtractBrand } = require(path.join(distDir, "tools", "extractBrand.js"));

  // The graded case: openvidstudio's own repo root, which has no globals.css/Tailwind
  // config at all, but brand/logo-lockup.svg visibly carries a real palette.
  const ownResult = await runExtractBrand({
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-own-")),
    sourceRepo: monorepoRoot,
    dryRun: true,
  });
  const ownColors = new Set(ownResult.found.map((f) => f.value));
  check(
    "extract_brand against this repo's own root finds all four logo colours",
    ["#8b5cf6", "#f87171", "#3b82f6", "#2dd4bf"].every((c) => ownColors.has(c)),
  );
  check(
    "...every one of them sourced from the logo SVG specifically",
    ownResult.found.filter((f) => ["#8b5cf6", "#f87171", "#3b82f6", "#2dd4bf"].includes(f.value)).every((f) => f.from === "brand/logo-lockup.svg"),
  );
  check("...and the background rect is picked up as bg0", ownColors.has("#0a0a0a"));
  check("...with the note naming the logo, not a CSS file", ownResult.note.includes("from the logo"));

  // A synthetic repo with a deterministic ranking (area, not just count), so the rank ->
  // role mapping (accent, accentAlt, success, danger) can be pinned exactly rather than
  // just checked for "contains these colours somewhere".
  const svgRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-svg-"));
  const brandDir = path.join(svgRepo, "brand");
  fs.mkdirSync(brandDir, { recursive: true });
  // viewBox 0 0 100 100: a full-bleed background rect, then four accent rects of
  // decreasing area (40000, 30000, 20000, 10000px^2) so rank order is unambiguous. Nothing
  // else in this SVG, so there is no tie at the top of the ranking to resolve by accident.
  fs.writeFileSync(
    path.join(brandDir, "logo-mark.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<rect x="0" y="0" width="100" height="100" fill="#111111"/>` + // full-bleed -> bg0
      `<rect x="0" y="0" width="200" height="200" fill="#00ff00"/>` + // area 40000 (rank 1)
      `<rect x="0" y="0" width="200" height="150" fill="#ff0000"/>` + // area 30000 (rank 2)
      `<rect x="0" y="0" width="200" height="100" fill="#0000ff"/>` + // area 20000 (rank 3)
      `<rect x="0" y="0" width="100" height="100" fill="#ffff00"/>` + // area 10000 (rank 4)
      `</svg>`,
    "utf8",
  );
  const svgResult = await runExtractBrand({
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-svg-out-")),
    sourceRepo: svgRepo,
    dryRun: true,
  });
  const svgByToken = Object.fromEntries(svgResult.found.map((f) => [f.token, f.value]));
  check("a full-bleed rect (exactly the viewBox size) becomes bg0", svgByToken.bg0 === "#111111");
  check(
    "the four accent colours rank by total area into accent/accentAlt/success/danger, in that order",
    svgByToken.accent === "#00ff00" && svgByToken.accentAlt === "#ff0000" && svgByToken.success === "#0000ff" && svgByToken.danger === "#ffff00",
  );
  check(
    "every logo-derived finding names the logo file, not a CSS file",
    svgResult.found.every((f) => f.from === "brand/logo-mark.svg"),
  );
  fs.rmSync(svgRepo, { recursive: true, force: true });

  // A large rect that is NOT full-bleed (offset from the origin) must not be mistaken for
  // the background just because it has the most area -- only an exact x=0,y=0,full-size
  // match counts, matching a real page's body background rather than a big decorative panel.
  const offsetRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-offset-"));
  fs.mkdirSync(path.join(offsetRepo, "brand"), { recursive: true });
  fs.writeFileSync(
    path.join(offsetRepo, "brand", "logo-mark.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<rect x="10" y="10" width="90" height="90" fill="#abcabc"/>` + // biggest shape, but not full-bleed
      `<rect x="0" y="0" width="10" height="10" fill="#defdef"/>` +
      `</svg>`,
    "utf8",
  );
  const offsetResult = await runExtractBrand({
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-offset-out-")),
    sourceRepo: offsetRepo,
    dryRun: true,
  });
  check(
    "an offset (non-full-bleed) rect is never treated as the background, however large",
    !offsetResult.found.some((f) => f.token === "bg0") && offsetResult.found.some((f) => f.token === "accent" && f.value === "#abcabc"),
  );
  fs.rmSync(offsetRepo, { recursive: true, force: true });

  // A repo with CSS custom properties present: the SVG fallback must stay OFF, since a real
  // design token is a more reliable source than pixels ever are.
  const cssRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-css-"));
  fs.mkdirSync(path.join(cssRepo, "src", "app"), { recursive: true });
  fs.writeFileSync(
    path.join(cssRepo, "src", "app", "globals.css"),
    `:root { --accent: #123456; }`,
    "utf8",
  );
  fs.mkdirSync(path.join(cssRepo, "brand"), { recursive: true });
  fs.writeFileSync(
    path.join(cssRepo, "brand", "logo-mark.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#654321"/></svg>`,
    "utf8",
  );
  const cssResult = await runExtractBrand({
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-css-out-")),
    sourceRepo: cssRepo,
    dryRun: true,
  });
  check(
    "a repo with a real CSS token never falls back to logo pixels",
    cssResult.found.some((f) => f.value === "#123456") && !cssResult.found.some((f) => f.value === "#654321"),
  );
  fs.rmSync(cssRepo, { recursive: true, force: true });

  // @fontsource/* package.json fallback, for a repo with no CSS var and no next/font import.
  const fontRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-font-"));
  fs.writeFileSync(
    path.join(fontRepo, "package.json"),
    JSON.stringify({ dependencies: { "@fontsource/inter": "^5.0.0", "@fontsource/jetbrains-mono": "^5.0.0" } }),
    "utf8",
  );
  const fontResult = await runExtractBrand({
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a10-font-out-")),
    sourceRepo: fontRepo,
    dryRun: true,
  });
  check(
    "@fontsource/* dependencies resolve real font names when nothing else did",
    fontResult.fonts.ui === "Inter" && fontResult.fonts.mono === "JetBrains Mono" && fontResult.fonts.from === "package.json (@fontsource)",
  );
  fs.rmSync(fontRepo, { recursive: true, force: true });
}

finish();

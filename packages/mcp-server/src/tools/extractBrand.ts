import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot } from "../util";
import { runTool } from "./mcp";

/**
 * Reads a repo's own visual identity and points the video at it.
 *
 * A first render used to look like openvidstudio: the same navy stage, the same Inter
 * and JetBrains Mono, regardless of whose product was on screen. That is the single
 * loudest signal that a video came out of a template, and it is avoidable, because
 * almost every web project already states its palette and fonts somewhere machine
 * readable. Tailwind v4 puts them in an @theme block, older Tailwind in a config file,
 * everything else in CSS custom properties on :root.
 *
 * What it does not do is guess. Every value it returns carries the file it came from,
 * and anything it cannot find is left at the openvidstudio default rather than being
 * invented, because a confidently wrong brand colour is worse than an honest fallback.
 */

const CSS_CANDIDATES = [
  "src/app/globals.css",
  "app/globals.css",
  "src/styles/globals.css",
  "styles/globals.css",
  "src/index.css",
  "src/app.css",
  "app/global.css",
];

const TW_CANDIDATES = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.cjs",
];

const LOGO_DIRS = ["brand", "public/brand", "public", "assets", "src/assets", "docs/media"];
const LOGO_HINTS = /(wordmark|logo|lockup|brandmark|mark)\b/i;
const LOGO_EXT = [".svg", ".png", ".webp"];

/** Hex, rgb() and hsl() all appear in the wild. Keep whatever form the repo used. */
const COLOR_VALUE = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|oklch\([^)]+\))/;

export interface ExtractBrandInput {
  projectRoot?: string;
  /** The repo whose identity the video should wear. Defaults to the video project. */
  sourceRepo: string;
  /** Skip writing src/brand.ts and just report what was found. */
  dryRun?: boolean;
}

export interface BrandFinding {
  token: string;
  value: string;
  from: string;
}

export interface ExtractBrandResult {
  sourceRepo: string;
  found: BrandFinding[];
  fonts: { ui?: string; mono?: string; from?: string };
  logo?: { copiedTo: string; from: string };
  brandFile?: string;
  unresolved: string[];
  note: string;
  nextStep: string;
}

function readIf(file: string): string | null {
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

/**
 * Pulls custom properties out of :root and Tailwind v4's @theme. Both are just
 * `--name: value;` declarations, so one pass handles them.
 */
function cssVars(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--([a-zA-Z0-9-_]+)\s*:\s*([^;}]+)[;}]/g)) {
    const name = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/**
 * Maps a repo's own naming onto the token names scenes use. Ordered: the first pattern
 * that hits wins, so specific names beat generic ones.
 */
const TOKEN_PATTERNS: [keyof typeof TOKEN_LABEL, RegExp[]][] = [
  ["bg0", [/^(color-)?(ground|bg0|background|bg-base|base)$/, /^(color-)?bg$/]],
  ["bg1", [/^(color-)?(bg1|surface|background-alt|elevated)$/]],
  ["panel", [/^(color-)?(panel|card|surface-2|muted-bg)$/]],
  ["panelBorder", [/^(color-)?(hairline|border|ring|divider|panel-border)$/]],
  ["textPrimary", [/^(color-)?(ink|foreground|text|text-primary|fg)$/]],
  ["textSecondary", [/^(color-)?(ink-muted|muted|text-secondary|fg-muted|subtle)$/]],
  ["accent", [/^(color-)?(primary|accent|brand)$/, /^(color-)?(violet|blue|indigo)$/]],
  ["accentAlt", [/^(color-)?(secondary|accent-2|accent-alt)$/, /^(color-)?(teal|cyan|purple)$/]],
  ["success", [/^(color-)?(success|green|positive|ok)$/]],
  ["warn", [/^(color-)?(warn|warning|amber|yellow)$/]],
  ["danger", [/^(color-)?(danger|error|destructive|red|coral)$/]],
];

const TOKEN_LABEL = {
  bg0: 1, bg1: 1, panel: 1, panelBorder: 1, textPrimary: 1, textSecondary: 1,
  accent: 1, accentAlt: 1, success: 1, warn: 1, danger: 1,
} as const;

interface SvgShapeColor {
  color: string;
  /** Rect: width*height. Circle/ellipse: pi*rx*ry. Anything else (path, polygon): 1 -- its
   * true rendered area isn't computed here, so it counts once toward frequency rather than
   * vanishing from the ranking entirely. */
  area: number;
  /** True only for a rect with a real width/height, which is what background detection needs. */
  hasBox: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

function svgAttr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
}

/**
 * Hex (3/6/8 digit) and rgb()/rgba() to a lowercase 6-digit hex, so "​#FFF", "#ffffff" and
 * "rgb(255, 255, 255)" all group as the same colour when ranking. Named colours (e.g.
 * "black"), currentColor, none, transparent and gradient/pattern refs (url(#id)) are left
 * unresolved rather than guessed: a wrong colour is worse than one that stays unresolved.
 */
function normalizeColor(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || /^(none|transparent|currentcolor)$/i.test(v) || v.startsWith("url(")) return null;
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(v);
  if (hex) {
    let h = hex[1].toLowerCase();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 8) h = h.slice(0, 6); // drop alpha -- role-mapping doesn't need it
    return `#${h}`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (rgb) {
    const hex6 = [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex6}`;
  }
  return null;
}

/** viewBox's own w/h when present (the coordinate space shapes are actually drawn in), else the root `<svg>`'s width/height. */
function parseSvgViewport(svg: string): { width: number; height: number } | null {
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svg);
  if (vb) return { width: parseFloat(vb[1]), height: parseFloat(vb[2]) };
  const root = /<svg\b([^>]*)>/i.exec(svg);
  if (root) {
    const w = svgAttr(root[1], "width");
    const h = svgAttr(root[1], "height");
    if (w && h) {
      const width = parseFloat(w);
      const height = parseFloat(h);
      if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
    }
  }
  return null;
}

/**
 * Every filled shape in an SVG, each carrying the colour it's actually filled with (never
 * a stroke) and, for rect/circle/ellipse, its own area -- a regex-based reader intentionally
 * limited to the shapes a real logo SVG overwhelmingly uses (icon grids, pixel-art marks,
 * geometric brandmarks), not a full SVG renderer.
 */
function extractSvgShapes(svg: string): SvgShapeColor[] {
  const shapes: SvgShapeColor[] = [];

  for (const m of svg.matchAll(/<rect\b([^>]*)\/?>/gi)) {
    const color = normalizeColor(svgAttr(m[1], "fill"));
    if (!color) continue;
    const x = parseFloat(svgAttr(m[1], "x") ?? "0") || 0;
    const y = parseFloat(svgAttr(m[1], "y") ?? "0") || 0;
    const width = parseFloat(svgAttr(m[1], "width") ?? "0") || 0;
    const height = parseFloat(svgAttr(m[1], "height") ?? "0") || 0;
    shapes.push({ color, area: width * height || 1, hasBox: width > 0 && height > 0, x, y, width, height });
  }

  for (const m of svg.matchAll(/<(?:circle|ellipse)\b([^>]*)\/?>/gi)) {
    const color = normalizeColor(svgAttr(m[1], "fill"));
    if (!color) continue;
    const r = parseFloat(svgAttr(m[1], "r") ?? "0") || 0;
    const rx = parseFloat(svgAttr(m[1], "rx") ?? String(r)) || r;
    const ry = parseFloat(svgAttr(m[1], "ry") ?? String(r)) || r;
    shapes.push({ color, area: rx > 0 && ry > 0 ? Math.PI * rx * ry : 1, hasBox: false, x: 0, y: 0, width: 0, height: 0 });
  }

  for (const m of svg.matchAll(/<(?:path|polygon|polyline)\b([^>]*)\/?>/gi)) {
    const color = normalizeColor(svgAttr(m[1], "fill"));
    if (!color) continue;
    shapes.push({ color, area: 1, hasBox: false, x: 0, y: 0, width: 0, height: 0 });
  }

  return shapes;
}

/** In rank order, the roles the top colours (after the background, if any, is set aside) fill. */
const SVG_ACCENT_ROLES = ["accent", "accentAlt", "success", "danger"] as const;

/**
 * The fallback for a repo with no CSS design tokens at all: parse the fill colours out of
 * the logo SVG runExtractBrand already chose, rank them by total pixel area, and map the
 * top few onto the same semantic roles CSS tokens would have filled. A rect that exactly
 * covers the SVG's own canvas (x=0, y=0, full width/height) is treated as the background
 * rather than an accent colour and reported as `bg0`, mirroring what a real page's
 * full-bleed body background would be.
 */
function extractColorsFromSvg(svg: string, from: string): BrandFinding[] {
  const viewport = parseSvgViewport(svg);
  const shapes = extractSvgShapes(svg);

  let background: string | undefined;
  if (viewport) {
    for (const shape of shapes) {
      if (
        shape.hasBox &&
        Math.abs(shape.x) < 0.5 &&
        Math.abs(shape.y) < 0.5 &&
        Math.abs(shape.width - viewport.width) < 0.5 &&
        Math.abs(shape.height - viewport.height) < 0.5
      ) {
        background = shape.color;
        break; // first full-bleed rect in source order is the intended background
      }
    }
  }

  const totals = new Map<string, number>();
  for (const shape of shapes) {
    if (shape.color === background) continue;
    totals.set(shape.color, (totals.get(shape.color) ?? 0) + shape.area);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);

  const findings: BrandFinding[] = [];
  if (background) findings.push({ token: "bg0", value: background, from });
  for (let i = 0; i < Math.min(ranked.length, SVG_ACCENT_ROLES.length); i++) {
    findings.push({ token: SVG_ACCENT_ROLES[i], value: ranked[i], from });
  }
  return findings;
}

function mapTokens(vars: Map<string, string>, from: string): BrandFinding[] {
  const found: BrandFinding[] = [];
  const taken = new Set<string>();

  for (const [token, patterns] of TOKEN_PATTERNS) {
    if (taken.has(token)) continue;
    for (const [name, value] of vars) {
      if (!patterns.some((re) => re.test(name))) continue;
      const hit = COLOR_VALUE.exec(value);
      // A var that points at another var is not a colour we can resolve here.
      if (!hit) continue;
      found.push({ token: String(token), value: hit[1], from: `${from} (--${name})` });
      taken.add(String(token));
      break;
    }
  }
  return found;
}

/** next/font, @font-face and plain font-family all appear; try each. */
function findFonts(repo: string, css: string | null): { ui?: string; mono?: string; from?: string } {
  const out: { ui?: string; mono?: string; from?: string } = {};

  if (css) {
    const vars = cssVars(css);
    for (const [name, value] of vars) {
      const fam = value.replace(/var\([^)]*\)/g, "").split(",")[0].replace(/["']/g, "").trim();
      if (!fam || fam.startsWith("--")) continue;
      if (!out.mono && /mono/.test(name)) out.mono = fam;
      else if (!out.ui && /(font-sans|font-ui|font-body|^font$)/.test(name)) out.ui = fam;
    }
    if (out.ui || out.mono) out.from = "css custom properties";
  }

  // next/font declarations name the family directly and are the most reliable source.
  for (const rel of ["src/app/layout.tsx", "app/layout.tsx", "src/app/layout.jsx"]) {
    const src = readIf(path.join(repo, rel));
    if (!src) continue;
    for (const m of src.matchAll(/import\s*\{\s*([A-Za-z0-9_,\s]+)\}\s*from\s*["']next\/font\/google["']/g)) {
      for (const raw of m[1].split(",")) {
        const fam = raw.trim().replace(/_/g, " ");
        if (!fam) continue;
        if (/mono/i.test(fam)) out.mono = fam;
        else out.ui = out.ui ?? fam;
      }
      out.from = rel;
    }
  }

  // Last resort: no CSS custom property and no next/font import named a family. @fontsource
  // ships one npm package per font, so the dependency name IS the font name (kebab-cased),
  // and a package.json that depends on it is as reliable a signal as a CSS var would be.
  if (!out.ui && !out.mono) {
    const fromPkg = fontsourceFonts(repo);
    if (fromPkg.ui || fromPkg.mono) return fromPkg;
  }
  return out;
}

/** A curated handful of well-known fonts whose real capitalization naive title-casing gets wrong. */
const FONT_NAME_WORD_EXCEPTIONS: Record<string, string> = {
  jetbrains: "JetBrains",
  ibm: "IBM",
  dm: "DM",
};

/** "jetbrains-mono" -> "JetBrains Mono", "inter" -> "Inter", "ibm-plex-sans" -> "IBM Plex Sans". */
function fontsourceFamilyName(slug: string): string {
  return slug
    .split("-")
    .map((word) => FONT_NAME_WORD_EXCEPTIONS[word] ?? (word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function fontsourceFonts(repo: string): { ui?: string; mono?: string; from?: string } {
  const pkgText = readIf(path.join(repo, "package.json"));
  if (!pkgText) return {};
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(pkgText) as typeof pkg;
  } catch {
    return {};
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const out: { ui?: string; mono?: string; from?: string } = {};
  for (const name of Object.keys(deps)) {
    const m = /^@fontsource(?:-variable)?\/(.+)$/.exec(name);
    if (!m) continue;
    const family = fontsourceFamilyName(m[1]);
    if (/mono/i.test(m[1])) out.mono = out.mono ?? family;
    else out.ui = out.ui ?? family;
  }
  if (out.ui || out.mono) out.from = "package.json (@fontsource)";
  return out;
}

function findLogo(repo: string): { file: string; rel: string } | null {
  const scored: { file: string; rel: string; score: number }[] = [];
  for (const dir of LOGO_DIRS) {
    const abs = path.join(repo, dir);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(abs);
    } catch {
      continue;
    }
    for (const e of entries) {
      const ext = path.extname(e).toLowerCase();
      if (!LOGO_EXT.includes(ext)) continue;
      if (!LOGO_HINTS.test(e)) continue;
      // Prefer a wordmark over a bare mark, and svg over raster.
      let score = 0;
      if (/wordmark|lockup/i.test(e)) score += 3;
      if (ext === ".svg") score += 2;
      if (/primary|full/i.test(e)) score += 1;
      scored.push({ file: path.join(abs, e), rel: `${dir}/${e}`, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

function renderBrandFile(
  found: BrandFinding[],
  fonts: { ui?: string; mono?: string; from?: string },
  logo: string | undefined,
  sourceRepo: string,
): string {
  const colorLines = found.map((f) => `    ${f.token}: "${f.value}", // ${f.from}`);
  const fontLines: string[] = [];
  if (fonts.ui) fontLines.push(`    ui: ${JSON.stringify(fonts.ui)},`);
  if (fonts.mono) fontLines.push(`    mono: ${JSON.stringify(fonts.mono)},`);

  return `// GENERATED by extract_brand from ${sourceRepo}.
//
// Root.tsx imports this module first so these values are in place before any scene
// evaluates. Re-run extract_brand to refresh it, or edit by hand: nothing regenerates
// this file unless you ask for it.
//
// Anything absent below stayed at the openvidstudio default, because extract_brand
// reports what it can actually find rather than inventing a plausible colour.

import { applyBrand } from "@openvidstudio/core";

applyBrand({
${colorLines.length ? `  color: {\n${colorLines.join("\n")}\n  },` : "  // no palette resolved"}
${fontLines.length ? `  font: {\n${fontLines.join("\n")}\n  },` : "  // no fonts resolved"}
${logo ? `  logo: ${JSON.stringify(logo)},` : "  // no logo found"}
  source: ${JSON.stringify(sourceRepo)},
});
`;
}

export async function runExtractBrand(input: ExtractBrandInput): Promise<ExtractBrandResult> {
  const root = resolveProjectRoot(input.projectRoot);
  const repo = path.resolve(input.sourceRepo);
  if (!fs.existsSync(repo)) {
    throw new Error(`sourceRepo does not exist: ${repo}`);
  }

  const found: BrandFinding[] = [];
  let cssText: string | null = null;
  let cssFrom = "";

  for (const rel of CSS_CANDIDATES) {
    const text = readIf(path.join(repo, rel));
    if (!text) continue;
    cssText = text;
    cssFrom = rel;
    found.push(...mapTokens(cssVars(text), rel));
    break;
  }

  // Older Tailwind keeps colours in the config rather than in CSS.
  if (found.length === 0) {
    for (const rel of TW_CANDIDATES) {
      const text = readIf(path.join(repo, rel));
      if (!text) continue;
      const vars = new Map<string, string>();
      for (const m of text.matchAll(/([a-zA-Z0-9-]+)\s*:\s*["'](#[0-9a-fA-F]{3,8})["']/g)) {
        vars.set(m[1].toLowerCase(), m[2]);
      }
      found.push(...mapTokens(vars, rel));
      if (found.length) break;
    }
  }

  const fonts = findFonts(repo, cssText);

  let logoResult: { copiedTo: string; from: string } | undefined;
  let logoStatic: string | undefined;
  const logo = findLogo(repo);

  // No CSS design token and no Tailwind config gave us a palette. Rather than leave the
  // video on openvidstudio's own defaults, parse the fill colours straight out of whichever
  // logo findLogo already chose: a real logo almost always carries the actual brand palette,
  // just as pixels instead of as a named variable.
  let colorsFromLogo = false;
  if (found.length === 0 && logo && /\.svg$/i.test(logo.file)) {
    const svgText = readIf(logo.file);
    if (svgText) {
      const svgFindings = extractColorsFromSvg(svgText, logo.rel);
      if (svgFindings.length > 0) {
        found.push(...svgFindings);
        colorsFromLogo = true;
      }
    }
  }

  if (logo && !input.dryRun) {
    const destDir = path.join(root, "public", "brand");
    fs.mkdirSync(destDir, { recursive: true });
    const base = path.basename(logo.file);
    fs.copyFileSync(logo.file, path.join(destDir, base));
    logoStatic = `brand/${base}`;
    logoResult = { copiedTo: logoStatic, from: logo.rel };
  } else if (logo) {
    logoResult = { copiedTo: `brand/${path.basename(logo.file)}`, from: logo.rel };
  }

  const resolved = new Set(found.map((f) => f.token));
  const unresolved = Object.keys(TOKEN_LABEL).filter((t) => !resolved.has(t));
  if (!fonts.ui) unresolved.push("font.ui");
  if (!fonts.mono) unresolved.push("font.mono");
  if (!logo) unresolved.push("logo");

  let brandFile: string | undefined;
  if (!input.dryRun) {
    const srcDir = path.join(root, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    brandFile = path.join(srcDir, "brand.ts");
    fs.writeFileSync(brandFile, renderBrandFile(found, fonts, logoStatic, repo), "utf8");
  }

  const note =
    found.length === 0 && !fonts.ui && !fonts.mono
      ? `Nothing machine readable was found in ${repo}. Looked for CSS custom properties in ` +
        `${CSS_CANDIDATES.join(", ")}, a Tailwind config, and next/font imports in the layout. ` +
        `Set the values by hand in src/brand.ts rather than leaving the video on the defaults.`
      : `Resolved ${found.length} colour${found.length === 1 ? "" : "s"}` +
        (colorsFromLogo
          ? ` from the logo (no CSS design tokens were found)`
          : cssFrom
            ? ` from ${cssFrom}`
            : "") +
        `${fonts.from ? `, fonts from ${fonts.from}` : ""}` +
        `${logo ? `, and a logo at ${logo.rel}` : ""}. ` +
        `Everything unresolved stayed at the openvidstudio default.`;

  const nextStep = input.dryRun
    ? "Dry run, nothing written. Re-run without dryRun to write src/brand.ts."
    : "Add `import \"./brand\";` as the FIRST import in src/Root.tsx, above the video imports, " +
      "so the override lands before scene modules evaluate. Then check a contact_sheet: the " +
      "stage should be the product's own colours, not openvidstudio navy.";

  return {
    sourceRepo: repo,
    found,
    fonts,
    logo: logoResult,
    brandFile,
    unresolved,
    note,
    nextStep,
  };
}

export function registerExtractBrand(server: McpServer): void {
  server.registerTool(
    "extract_brand",
    {
      title: "Read a repo's own palette, fonts and logo, and theme the video with them",
      description:
        "Point this at the repo being filmed and the video wears that product's identity instead " +
        "of openvidstudio's defaults. It reads Tailwind v4 @theme blocks and :root custom " +
        "properties from the usual globals.css locations, falls back to a tailwind.config file, " +
        "picks fonts out of next/font imports in the layout or, failing that, @fontsource/* " +
        "dependencies in package.json, and copies the best wordmark or logo it can find into the " +
        "video project. If no CSS design token turned up a palette at all, it parses the fill " +
        "colours straight out of that chosen logo SVG, ranks them by pixel area, and maps the top " +
        "ones to accent/accentAlt/success/danger (plus a background token, if one shape is an " +
        "exact full-bleed rect) -- a real logo almost always carries the actual brand palette, just " +
        "as pixels instead of a named variable. It writes src/brand.ts, which calls applyBrand and " +
        "must be the first import in Root.tsx so the values land before any scene module " +
        "evaluates. Run this before scaffold_scene. Every value it returns names the file (and, for " +
        "a logo-derived colour, the logo specifically) it came from, and anything it cannot find is " +
        "left at the default rather than guessed, so check the unresolved list and fill those in by " +
        "hand if they matter. This is the difference between a video that looks like the team's own " +
        "and one that looks like a template.",
      inputSchema: {
        projectRoot: z.string().optional(),
        sourceRepo: z.string().min(1),
        dryRun: z.boolean().optional(),
      },
    },
    async (input) => runTool("extract_brand", () => runExtractBrand(input)),
  );
}

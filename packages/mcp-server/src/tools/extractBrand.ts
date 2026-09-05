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
        (cssFrom ? ` from ${cssFrom}` : "") +
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
        "picks fonts out of next/font imports in the layout, and copies the best wordmark or logo " +
        "it can find into the video project. It writes src/brand.ts, which calls applyBrand and " +
        "must be the first import in Root.tsx so the values land before any scene module " +
        "evaluates. Run this before scaffold_scene. Every value it returns names the file it came " +
        "from, and anything it cannot find is left at the default rather than guessed, so check " +
        "the unresolved list and fill those in by hand if they matter. This is the difference " +
        "between a video that looks like the team's own and one that looks like a template.",
      inputSchema: {
        projectRoot: z.string().optional(),
        sourceRepo: z.string().min(1),
        dryRun: z.boolean().optional(),
      },
    },
    async (input) => runTool("extract_brand", () => runExtractBrand(input)),
  );
}

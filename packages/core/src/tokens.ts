// Design tokens: single source for every scene. Per-video themes may override via themes/.
//
// These are mutable on purpose. extract_brand reads the target repo's own palette,
// fonts and logo, writes src/brand.ts, and that module calls applyBrand() to overwrite
// what is here. A video then looks like the product it is filming rather than like
// openvidstudio, which is the difference between a demo that reads as the team's own
// and one that reads as a template.
//
// Because these objects are mutated rather than replaced, anything that copies a value
// out at module scope (const MONO = font.mono) captures the default and never sees the
// brand. Read tokens inside the component instead. src/brand.ts is imported first in
// Root.tsx so the override lands before any scene module evaluates.

export const color = {
  // dark stage
  bg0: "#0B0E14",
  bg1: "#11151F",
  panel: "#151A24",
  panelBorder: "#232B3A",
  textPrimary: "#E6EAF2",
  textSecondary: "#8A94A6",
  // accents
  accent: "#4E9EFF",
  accentAlt: "#9D6BFF",
  success: "#3ECF8E",
  warn: "#F5A623",
  danger: "#F26D6D",
  // light scenes
  lightBg: "#F4F6F9",
  lightCard: "#FFFFFF",
  lightShadow: "rgba(15,23,42,0.12)",
};

export const font = {
  ui: "Inter",
  mono: "JetBrains Mono",
};

/**
 * Font stacks, read at call time.
 *
 * These exist because the obvious thing (const MONO = `"${font.mono}", monospace`) runs
 * at module scope, which is before src/brand.ts has applied anything, so a scene written
 * that way silently keeps the openvidstudio defaults no matter what extract_brand found.
 * Calling these inside the component reads the current value instead.
 */
export const monoStack = (): string => `"${font.mono}", ui-monospace, monospace`;
export const uiStack = (): string => `"${font.ui}", system-ui, sans-serif`;

/** The repo's own identity, as far as extract_brand could determine it. */
export interface Brand {
  color?: Partial<typeof color>;
  font?: Partial<typeof font>;
  /** staticFile path to a wordmark or logo the target repo already ships. */
  logo?: string;
  /** Where the values came from, so a wrong colour is traceable. */
  source?: string;
}

export const brandAssets: { logo?: string; source?: string } = {};

/**
 * Overwrite the default tokens with a repo's own brand. Called by the generated
 * src/brand.ts, which Root.tsx imports before anything else so the values are in place
 * before scenes evaluate.
 *
 * Mutates rather than reassigns, because every scene imports these bindings directly and
 * a reassignment would leave them pointing at the old object.
 */
export function applyBrand(brand: Brand): void {
  if (brand.color) Object.assign(color, brand.color);
  if (brand.font) Object.assign(font, brand.font);
  if (brand.logo) brandAssets.logo = brand.logo;
  if (brand.source) brandAssets.source = brand.source;
}

export const glow = (c: string, strength = 1) => ({
  textShadow: `0 0 ${8 * strength}px ${c}88, 0 0 ${24 * strength}px ${c}44`,
});

export const panelShadow = (dark = true) =>
  dark
    ? "0 24px 80px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.4)"
    : `0 24px 80px ${color.lightShadow}, 0 4px 16px rgba(15,23,42,0.08)`;

export const radius = {
  window: 12,
  card: 10,
  pill: 999,
} as const;

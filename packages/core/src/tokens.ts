// Design tokens: single source for every scene. Per-video themes may override via themes/.

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
} as const;

export const font = {
  ui: "Inter",
  mono: "JetBrains Mono",
} as const;

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

export type Subject = "math" | "physics" | "cs" | "chemistry" | "biology";

/** One accent per subject. */
export const ACCENTS: Record<Subject, string> = {
  math: "#5CC8FF",
  physics: "#FFB347",
  cs: "#B58CFF",
  chemistry: "#FF4D5E",
  biology: "#7CFFB2",
};

export const SUBJECTS = Object.keys(ACCENTS) as Subject[];

/** The flat dark ground the kit is designed against. */
export const VOID = "#0B0D14";

export function accentFor(subject: Subject): string {
  return ACCENTS[subject];
}

/** "#RRGGBB" to [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** An "rgba(...)" string for a hex colour at an alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

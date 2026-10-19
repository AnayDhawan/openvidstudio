import { color as coreColor, defineDesignSystem, font as coreFont, type DesignSystem } from "@openvidstudio/core";

/**
 * Supernova's Void + Spark design system: light is meaning. Everything is dark and flat except
 * the one thing the viewer must look at, so there is one accent per subject and nothing else glows.
 */

export type Subject = "math" | "physics" | "cs" | "chemistry" | "biology";
export const SUBJECTS: readonly Subject[] = ["math", "physics", "cs", "chemistry", "biology"];

/** The base tokens shared by every subject. Text is warm white, never pure white. */
export const VOID = {
  base: "#07060B",
  panel: "#0E0C16",
  /** Hairline grid: 5% white. */
  hairline: "rgba(255,255,255,0.05)",
  text: "#F3EFE6",
  textDim: "#8C8799",
} as const;

/** One accent per subject, so a profile grid of lessons reads as a spectrum. */
export const SUBJECT_ACCENT: Record<Subject, { accent: string; accentAlt: string; name: string }> = {
  math: { accent: "#5CC8FF", accentAlt: "#5CC8FF", name: "blue giant" },
  physics: { accent: "#FFB347", accentAlt: "#FF7A3D", name: "solar amber, with ember as the second" },
  cs: { accent: "#B58CFF", accentAlt: "#B58CFF", name: "nebula violet" },
  chemistry: { accent: "#FF4D5E", accentAlt: "#FF4D5E", name: "red dwarf" },
  biology: { accent: "#7CFFB2", accentAlt: "#7CFFB2", name: "aurora" },
};

/** Display face (headlines, equations' labels) and body face. Both load from local files. */
export const DISPLAY_FONT = "Space Grotesk";
export const BODY_FONT = "Inter";

export const displayStack = (): string => `"${DISPLAY_FONT}", ui-sans-serif, system-ui, sans-serif`;
export const bodyStack = (): string => `"${BODY_FONT}", ui-sans-serif, system-ui, sans-serif`;

/** The stage Supernova videos render at, and the Reels safe zones (PIPELINE.md, about 14% top, 22% bottom). */
export const SUPERNOVA_STAGE = { width: 1080, height: 1920 } as const;
export const SUPERNOVA_GRID = { marginX: 108, marginTop: 270, marginBottom: 420 } as const;

export interface SupernovaDesignSystem extends DesignSystem {
  subject: Subject;
  /** The display face's family name, which DesignSystem's own `font` has no slot for. */
  display: string;
}

/**
 * The design system for one subject's lesson. Call it from the video's design.ts:
 * `export const design = supernovaDesignSystem("physics")`.
 */
export function supernovaDesignSystem(subject: Subject): SupernovaDesignSystem {
  const tone = SUBJECT_ACCENT[subject];
  if (!tone) throw new Error(`supernovaDesignSystem: unknown subject "${subject}", expected one of ${SUBJECTS.join(", ")}.`);
  const ds = defineDesignSystem({
    stage: SUPERNOVA_STAGE,
    color: {
      ...coreColor,
      bg0: VOID.base,
      bg1: VOID.panel,
      panel: VOID.panel,
      panelBorder: VOID.hairline,
      textPrimary: VOID.text,
      textSecondary: VOID.textDim,
      accent: tone.accent,
      accentAlt: tone.accentAlt,
    },
    font: { ...coreFont, ui: BODY_FONT },
    grid: { ...SUPERNOVA_GRID },
    motif: "void-spark",
    // A lesson moves slowly and one thing at a time.
    motion: { easing: "drift", staggerMs: 90, cameraEnergy: "subtle", cutRhythmSeconds: [4, 12] },
    texture: { grainOpacity: 0.03, vignetteStrength: 0.45 },
    transitions: ["cut", "fade"],
  });
  return { ...ds, subject, display: DISPLAY_FONT };
}

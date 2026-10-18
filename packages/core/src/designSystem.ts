// Design system as code (C2). A per-video DesignSystem is a self-contained object a scene
// reads from directly, layered ON TOP of the global brand tokens (tokens.ts's color/font,
// already mutated by applyBrand if extract_brand ran) rather than replacing them: brand
// tokens seed a design system, they don't dictate it. The agent writes
// src/videos/<name>/design.ts calling defineDesignSystem(overrides) from the brief
// (C1) -- a signature motif derived from the brand, a type pairing and scale, the layout
// grid, texture, transition vocabulary and a motion personality. Components (C4's
// primitive library, hand-authored bespoke scenes) import that video's design.ts and read
// from it; validators (C7) check contrast and minimum text size against its own typeScale,
// not a hardcoded global.
//
// Same "read at call time, not module scope" rule as tokens.ts's font/color: a design
// system built at module scope in design.ts runs before applyBrand has mutated anything
// it seeds from, so design.ts should export a DesignSystem *value* built by calling
// defineDesignSystem() at its own module scope is fine (design.ts is imported after
// brand.ts, same Root.tsx import order tokens.ts already relies on) -- the rule that
// matters is: don't build a SECOND, earlier design system before brand.ts has run.

import { color as defaultColor, font as defaultFont, type Brand } from "./tokens";

export interface TypeScale {
  /** [min, max] px, for the biggest on-screen text: a hook's slammed title, a stat callout. */
  display: [number, number];
  /** [min, max] px, section headers and card titles. */
  headline: [number, number];
  /** [min, max] px, body copy and captions. */
  body: [number, number];
  /** [min, max] px, terminal/code text. */
  mono: [number, number];
}

export interface LayoutGrid {
  /** Side margins, px, at the 1920x1080 stage. */
  marginX: number;
  marginTop: number;
  /** Bottom margin, reserved for a ChapterHud or caption bar even when neither is present. */
  marginBottom: number;
}

export type CameraEnergy = "subtle" | "normal" | "energetic";

export interface MotionPersonality {
  /** Name of an E.* preset from motion.ts (e.g. "drift", "pop", "spring"), looked up by the
   * component, not a function reference, so a DesignSystem stays JSON-serializable. */
  easing: string;
  /** Milliseconds between staggered element reveals (word-by-word text, card lists). */
  staggerMs: number;
  cameraEnergy: CameraEnergy;
  /** [min, max] seconds a shot holds before the next cut, per STYLE.md's cut-rhythm rule. */
  cutRhythmSeconds: [number, number];
}

/**
 * A signature motif lifted from the brand: the visual idea a transition or a recurring
 * shape expresses. "pixel-grid" pairs with PixelWipe/PixelLogo (C4) for a brand whose logo
 * is built from square rects; the others are named for extract_brand (A10) to map a brand's
 * shape language onto, and for a bespoke scene to key off deliberately.
 */
export type Motif = "pixel-grid" | "rounded-soft" | "geometric" | "editorial";

export interface Texture {
  /** 0-1. STYLE.md's default range is 0.04-0.06. */
  grainOpacity: number;
  /** 0-1 edge darkening. STYLE.md's default range is 0.25-0.40. */
  vignetteStrength: number;
}

export interface DesignSystem {
  color: typeof defaultColor;
  font: typeof defaultFont;
  typeScale: TypeScale;
  grid: LayoutGrid;
  motif: Motif;
  motion: MotionPersonality;
  /** Named transitions this video actually uses, in preference order. A bespoke scene or a
   * motif-aware primitive (C4) picks from this list rather than inventing a new one per cut. */
  transitions: string[];
  texture: Texture;
}

export const DEFAULT_TYPE_SCALE: TypeScale = {
  display: [120, 220],
  headline: [56, 84],
  body: [26, 34],
  mono: [15, 22],
};

export const DEFAULT_GRID: LayoutGrid = {
  marginX: 150,
  marginTop: 130,
  marginBottom: 110,
};

export const DEFAULT_MOTION: MotionPersonality = {
  easing: "drift",
  staggerMs: 60,
  cameraEnergy: "normal",
  cutRhythmSeconds: [1.5, 5],
};

export const DEFAULT_TEXTURE: Texture = {
  grainOpacity: 0.05,
  vignetteStrength: 0.3,
};

export const DEFAULT_TRANSITIONS = ["cut", "whip", "fade"];

/**
 * Builds a video's DesignSystem. Call this from src/videos/<name>/design.ts with whatever
 * the brief (C1) decided to override; everything else falls back to the current brand
 * tokens (color/font, already brand-applied if extract_brand ran before this module
 * evaluates) and the STYLE.md-matching defaults above. The result is a plain object, not a
 * live binding into tokens.ts -- a design system is frozen at the point design.ts is
 * imported, which is deliberate: unlike the global brand tokens (meant to apply uniformly
 * forever), a per-video design system is a one-time creative decision, not something a
 * later applyBrand call should silently reach into.
 */
export function defineDesignSystem(overrides: Partial<DesignSystem> = {}): DesignSystem {
  return {
    color: { ...defaultColor, ...overrides.color },
    font: { ...defaultFont, ...overrides.font },
    typeScale: { ...DEFAULT_TYPE_SCALE, ...overrides.typeScale },
    grid: { ...DEFAULT_GRID, ...overrides.grid },
    motif: overrides.motif ?? "rounded-soft",
    motion: { ...DEFAULT_MOTION, ...overrides.motion },
    transitions: overrides.transitions ?? [...DEFAULT_TRANSITIONS],
    texture: { ...DEFAULT_TEXTURE, ...overrides.texture },
  };
}

/**
 * Relative luminance -> WCAG contrast ratio between two hex colours, for C7's render-based
 * validator (and anything else that wants to check a DesignSystem's own colour pairings
 * before render, not after). Returns a value from 1 (no contrast) to 21 (black on white).
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminance = (hex: string): number => {
    const n = hex.replace("#", "");
    const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const [l1, l2] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Re-exported so design.ts can seed from a brand without importing tokens.ts directly. */
export type { Brand };

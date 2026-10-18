// The pixel-grid family: a 5x7 dot-matrix font, a logo assembler built from the same kind
// of rect data extract_brand already parses out of an SVG, and the wipe transition that
// pairs with both. Ported from reference/launch-video's lib/dots.tsx and the PixelWipe half
// of lib/fx.tsx, generalized: no hardcoded video palette or logo file, pixel.json's shape
// replaced by a plain array of { x, y, width, height, color } rects.

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { DesignSystem } from "./designSystem";
import { E, jitter, pop, SPRING, tween } from "./motion";
import { color } from "./tokens";

const GLYPH_5X7: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "10001", "01010", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "%": ["11000", "11001", "00010", "00100", "01000", "10011", "00011"],
  "→": ["00000", "00100", "00010", "11111", "00010", "00100", "00000"],
};

type DotPixel = { x: number; y: number; c: string; i: number };

function layoutDots(text: string, colors: string[], solid?: string): { pixels: DotPixel[]; width: number } {
  const pixels: DotPixel[] = [];
  let cx = 0;
  let li = 0;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPH_5X7[ch] ?? GLYPH_5X7[" "];
    const col = solid ?? colors[li % colors.length];
    glyph.forEach((row, y) =>
      row.split("").forEach((bit, x) => {
        if (bit === "1") pixels.push({ x: cx + x, y, c: col, i: pixels.length });
      }),
    );
    cx += ch === " " ? 4 : 6;
    if (ch !== " ") li++;
  }
  return { pixels, width: cx - 1 };
}

/** The four-color cycle DotText/PixelWipe fall back to when no explicit palette is given. */
const defaultCycle = (): string[] => [color.accent, color.accentAlt, color.success, color.warn];

/**
 * 5x7 dot-matrix text, built pixel by pixel instead of drawn with a font file -- the same
 * "ground truth" bias as the rest of this library, just applied to type instead of capture.
 * `build="wipe"` sweeps left to right, `build="scatter"` flies pixels in from random
 * offsets, `build="none"` renders flat once `at` has passed.
 */
export const DotText: React.FC<{
  text: string;
  at: number;
  /** px per cell */
  px?: number;
  /** a fixed palette, cycled per character, or "cycle" for the design/token default four */
  colors?: string[] | "cycle";
  /** overrides `colors` with one flat color for every pixel */
  solid?: string;
  build?: "scatter" | "wipe" | "none";
  /** frame the exit starts */
  out?: number;
  glow?: number;
  seed?: number;
}> = ({ text, at, px = 14, colors = "cycle", solid, build = "wipe", out, glow = 0.6, seed = 3 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const resolvedColors = colors === "cycle" ? defaultCycle() : colors;
  const { pixels, width } = layoutDots(text, resolvedColors, solid);
  const cell = px;
  const size = px * 0.8;
  return (
    <div style={{ position: "relative", width: width * cell, height: 7 * cell }}>
      {pixels.map((p) => {
        const r = jitter(p.i, seed);
        const d = build === "wipe" ? at + p.x * 0.55 + r * 4 : build === "scatter" ? at + r * 14 : at;
        const s = build === "none" ? (frame >= at ? 1 : 0) : pop(frame, fps, d, SPRING.pop);
        if (frame < d) return null;
        const scatter = build === "scatter" ? 1 - s : 0;
        const o = out !== undefined ? tween(frame, [out + r * 10, out + r * 10 + 8], [0, 1], E.snap) : 0;
        if (o >= 1) return null;
        const dx = scatter * (jitter(p.i, seed + 7) - 0.5) * 900;
        const dy = scatter * (jitter(p.i, seed + 11) - 0.5) * 600;
        return (
          <div
            key={p.i}
            style={{
              position: "absolute",
              left: p.x * cell,
              top: p.y * cell,
              width: size,
              height: size,
              borderRadius: size * 0.18,
              background: p.c,
              transform: `translate(${dx}px, ${dy - o * 30}px) scale(${Math.max(0, Math.min(1.15, s)) * (1 - o)})`,
              boxShadow: glow ? `0 0 ${size * 1.2 * glow}px ${p.c}88` : undefined,
            }}
          />
        );
      })}
    </div>
  );
};

/**
 * One filled shape a pixel-grid logo is built from -- deliberately the same field names
 * `extractSvgShapes` (packages/mcp-server/src/tools/extractBrand.ts) already produces for a
 * rect it finds in a logo SVG, so that tool's output can be handed to `PixelLogo` as-is
 * (it carries a couple of extra extraction-time fields, `area`/`hasBox`, which `PixelLogo`
 * simply ignores). Wiring extract_brand to call this is a future integration; this is just
 * making the shapes it already has line up with what renders them.
 */
export type PixelShape = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

/**
 * Assembles a pixel-grid logo from its own rect shapes, each flying in from a ring around
 * the mark (`build="scatter"`) or rendered flat (`build="none"`). The center and spread of
 * that ring are computed from the shapes' own bounding box, so this works for any pixel-grid
 * logo, not just one fixed layout.
 */
export const PixelLogo: React.FC<{
  shapes: PixelShape[];
  at: number;
  /** output px per source (viewBox) unit */
  scale?: number;
  build?: "scatter" | "none";
  glow?: number;
  /** frame the exit starts */
  out?: number;
  seed?: number;
  style?: React.CSSProperties;
}> = ({ shapes, at, scale = 1, build = "scatter", glow = 0.9, out, seed = 5, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (shapes.length === 0) return null;

  const minX = Math.min(...shapes.map((s) => s.x));
  const minY = Math.min(...shapes.map((s) => s.y));
  const maxX = Math.max(...shapes.map((s) => s.x + s.width));
  const maxY = Math.max(...shapes.map((s) => s.y + s.height));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const spread = Math.max(maxX - minX, maxY - minY) / 2 || 1;

  if (build !== "none" && frame < at) return null;

  return (
    <div style={{ position: "relative", width: (maxX - minX) * scale, height: (maxY - minY) * scale, ...style }}>
      {shapes.map((s, i) => {
        const r = jitter(i, seed);
        const dist = Math.hypot(s.x + s.width / 2 - centerX, s.y + s.height / 2 - centerY) / spread;
        const d = at + dist * 10 + r * 6;
        const popped = build === "none" ? 1 : Math.min(1.08, pop(frame, fps, d, SPRING.soft));
        const k = build === "none" ? 0 : 1 - Math.min(1, popped);
        const angle = jitter(i, seed + 4) * Math.PI * 2;
        const radius = 700 + jitter(i, seed + 8) * 900;
        const o = out !== undefined ? tween(frame, [out + r * 8, out + r * 8 + 10], [0, 1], E.whip) : 0;
        const flash = tween(frame, [d + 4, d + 20], [1, 0], E.cinematic);
        const w = s.width * scale;
        const h = s.height * scale;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: (s.x - minX) * scale,
              top: (s.y - minY) * scale,
              width: w,
              height: h,
              borderRadius: Math.min(w, h) * 0.16,
              background: s.color,
              opacity: 1 - o,
              transform: `translate(${Math.cos(angle) * radius * k}px, ${Math.sin(angle) * radius * k}px) rotate(${k * 180 * (r - 0.5)}deg) scale(${0.4 + 0.6 * Math.min(1, popped) + flash * 0.25})`,
              boxShadow: glow ? `0 0 ${Math.min(w, h) * (glow + flash * 1.5)}px ${s.color}${flash > 0.05 ? "cc" : "77"}` : undefined,
            }}
          />
        );
      })}
    </div>
  );
};

/**
 * Pixel wipe transition pair. mode "in": the frame starts fully covered by cells that
 * clear. mode "out": cells cover the frame, finishing exactly at the scene's last frame.
 * Call both ends of a cut with the same `cell`/`seed` so the out and the following in read
 * as one continuous move across the cut rather than two unrelated effects.
 *
 * `design` (optional) only informs the default tint palette and background -- pixel-grid
 * (`design.motif === "pixel-grid"`) is this transition's natural home, but nothing about its
 * own mechanics depends on that motif, so it works as a standalone wipe for any project.
 */
export const PixelWipe: React.FC<{
  mode: "in" | "out";
  at?: number;
  dur?: number;
  cell?: number;
  seed?: number;
  bg?: string;
  tint?: string[];
  design?: DesignSystem;
}> = ({ mode, at, dur = 12, cell = 60, seed = 1, bg, tint, design }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const bgColor = bg ?? design?.color.bg0 ?? color.bg0;
  const tintColors = tint ?? (design ? [design.color.accent, design.color.accentAlt, design.color.success, design.color.warn] : defaultCycle());
  const start = at ?? (mode === "in" ? 0 : durationInFrames - dur - 1);
  if (frame < start - 1 || frame > start + dur + 2) {
    if (mode === "out" && frame > start + dur) return <AbsoluteFill style={{ background: bgColor }} />;
    return null;
  }
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const diag = (x / cols) * 0.55 + (y / rows) * 0.25 + jitter(i, seed) * 0.35;
      const t0 = start + diag * dur * 0.75;
      const p = tween(frame, [t0, t0 + dur * 0.35], [0, 1], E.snap);
      const cover = mode === "out" ? p : 1 - p;
      if (cover <= 0.01) continue;
      const tintHit = jitter(i, seed + 4) > 0.86 ? tintColors[i % tintColors.length] : bgColor;
      const flicker = tintHit !== bgColor && cover > 0.2 && cover < 0.95;
      cells.push(
        <div
          key={i}
          style={{
            position: "absolute",
            left: x * cell,
            top: y * cell,
            width: cell + 1,
            height: cell + 1,
            background: flicker ? tintHit : bgColor,
            transform: `scale(${cover})`,
          }}
        />,
      );
    }
  }
  return <AbsoluteFill style={{ pointerEvents: "none" }}>{cells}</AbsoluteFill>;
};

// Kinetic text primitives: masked per-word reveals and a typing effect. Ported from
// reference/launch-video's lib/type.tsx (the openvidstudio launch video's own scene
// library) and generalized: no hardcoded video palette, and the word stagger can come
// from a video's own DesignSystem instead of a fixed constant.

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { DesignSystem } from "./designSystem";
import { E, tween } from "./motion";
import { color, uiStack } from "./tokens";

/**
 * Per-word masked text reveal. Never a plain opacity fade (STYLE.md): each word clips in
 * from below on its own stagger delay, and -- if `out` is set -- clips back out the same
 * way. `accent` recolors (and glows) individual words by index, for a line that needs one
 * word to land harder than the rest.
 */
export const Words: React.FC<{
  text: string;
  /** frame the first word starts revealing */
  at: number;
  /** frame the exit starts. Omit to leave the line on screen. */
  out?: number;
  size?: number;
  weight?: number;
  color?: string;
  /** word index -> accent color for just that word */
  accent?: Record<number, string>;
  /**
   * Frames between word starts. Explicit `stagger` always wins. Otherwise, when `design`
   * is passed, this reads `design.motion.staggerMs` and converts it to frames at the
   * composition's own fps, so a video's motion personality (DEFAULT_MOTION.staggerMs is
   * 60ms) drives every `Words` call instead of a value copied by hand into each one.
   * With neither, falls back to a plain 3 frame stagger.
   */
  stagger?: number;
  design?: DesignSystem;
  align?: "left" | "center" | "right";
  font?: string;
  tracking?: string;
  lineHeight?: number;
  maxWidth?: number;
  glow?: string;
  italic?: boolean;
  style?: React.CSSProperties;
}> = ({
  text,
  at,
  out,
  size = 72,
  weight = 800,
  color: textColor = color.textPrimary,
  accent = {},
  stagger,
  design,
  align = "left",
  font,
  tracking = "-0.035em",
  lineHeight = 1.08,
  maxWidth,
  glow,
  italic,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const effectiveStagger =
    stagger ?? (design ? Math.max(1, Math.round((design.motion.staggerMs / 1000) * fps)) : 3);
  const effectiveFont = font ?? uiStack();
  if (frame < at) return null;
  if (out !== undefined && frame > out + 14) return null;
  const words = text.split(" ");
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        columnGap: size * 0.26,
        rowGap: size * 0.02,
        fontFamily: effectiveFont,
        fontWeight: weight,
        fontSize: size,
        letterSpacing: tracking,
        lineHeight,
        color: textColor,
        maxWidth,
        fontStyle: italic ? "italic" : undefined,
        ...style,
      }}
    >
      {words.map((w, i) => {
        const d = at + i * effectiveStagger;
        const p = tween(frame, [d, d + 11], [0, 1], E.snap);
        const o = out !== undefined ? tween(frame, [out + i * 1.5, out + i * 1.5 + 9], [0, 1], E.whip) : 0;
        const c = accent[i] ?? textColor;
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.12, marginBottom: -size * 0.12 }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - p) * 105 - o * 105}%)`,
                color: c,
                textShadow: glow || accent[i] ? `0 0 ${size * 0.35}px ${(accent[i] ?? glow) + "55"}` : undefined,
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/**
 * Typewriter hook: returns the visible slice of `text` at the current frame plus the
 * per-character reveal frames, so a caller can drive `TypingSfx` (from ./sfx) off the same
 * numbers the visible text uses, keeping sound and motion frame-exact.
 */
export const useTyped = (text: string, at: number, cps = 22) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fpc = fps / cps;
  const charFrames = Array.from({ length: text.length }, (_, i) =>
    Math.round(at + i * fpc + (Math.sin(i * 12.9898) * 0.5 + 0.5) * fpc * 0.5),
  );
  const n = charFrames.filter((f) => f <= frame).length;
  return { visible: text.slice(0, n), done: n >= text.length, charFrames, end: charFrames[charFrames.length - 1] ?? at };
};

/** Blinking text caret, sized to a line height. Pair with `useTyped` for a typed line. */
export const Caret: React.FC<{ h?: number; color?: string; blink?: boolean }> = ({
  h = 40,
  color: caretColor = color.textPrimary,
  blink = true,
}) => {
  const frame = useCurrentFrame();
  const on = !blink || Math.floor(frame / 9) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: h * 0.5,
        height: h,
        background: on ? caretColor : "transparent",
        verticalAlign: "text-bottom",
        marginLeft: 4,
      }}
    />
  );
};

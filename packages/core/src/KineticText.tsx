// Kinetic typography: word-staggered title slams + caption bars.
// Mask/clip reveals only, plain opacity fades are banned (STYLE.md).

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { pop, SPRING, staggerDelay, tween, E } from "./motion";
import { Blip } from "./sfx";
import { color } from "./tokens";

// System-safe fallback stack, not the @remotion/google-fonts network loader: that loader fetches
// from fonts.gstatic.com at render time, which hangs the whole render (30s timeout, then a fatal
// crash-loop) with no internet. Same visual family, no network dependency.
const uiFamily = "Inter, -apple-system, Segoe UI, Roboto, sans-serif";

/** Big title: each word slams in with a spring + clip wipe. */
export const TitleSlam: React.FC<{
  text: string;
  at: number;
  fontSize?: number;
  color?: string;
  glowColor?: string;
  align?: "center" | "left";
  sfx?: boolean;
}> = ({
  text,
  at,
  fontSize = 120,
  color: textColor = color.textPrimary,
  glowColor,
  align = "center",
  // Off by default: a blip per word, four frames apart, is a rapid tick under every title.
  sfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  if (frame < at) return null;
  return (
    <div
      style={{
        display: "flex",
        gap: fontSize * 0.28,
        justifyContent: align === "center" ? "center" : "flex-start",
        flexWrap: "wrap",
        fontFamily: uiFamily,
        fontWeight: 900,
        fontSize,
        letterSpacing: "-0.03em",
        color: textColor,
        textShadow: glowColor
          ? `0 0 24px ${glowColor}66, 0 0 80px ${glowColor}33`
          : undefined,
      }}
    >
      {words.map((w, i) => {
        const d = at + staggerDelay(i, 4);
        const s = pop(frame, fps, d, SPRING.pop);
        const wipe = tween(frame, [d, d + 6], [100, 0], E.snap);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `scale(${0.7 + s * 0.3}) translateY(${(1 - s) * 40}px)`,
              clipPath: `inset(0 ${wipe}% 0 0)`,
            }}
          >
            {w}
          </span>
        );
      })}
      {sfx ? words.map((_, i) => <Blip key={i} at={at + staggerDelay(i, 4)} volume={0.18} />) : null}
    </div>
  );
};

export type CaptionPosition = "bottom" | "top" | "left" | "right" | "auto";
export type CaptionRect = { x: number; y: number; width: number; height: number };

/** Gap between a caption card and the frame edge, in px. */
const CAPTION_MARGIN = 84;
/** The whole word-by-word reveal finishes this many frames after `at`, however many words there are. */
const CAPTION_SETTLE_FRAMES = 8;
/** One word's wipe. */
const CAPTION_WIPE_FRAMES = 5;

/**
 * Which edge a caption sits on and how wide its card may grow, for a composition of this size.
 *
 * "auto" looks at `avoid` (the part of the frame that carries the product, in composition px) and
 * takes the edge with the most free room beside that rect, so the caption lands where it covers
 * nothing. A side only counts if the card actually fits there; with no `avoid` it stays at the
 * bottom. Ties go bottom, top, right, left.
 */
export const captionLayout = (
  position: CaptionPosition,
  avoid: CaptionRect | undefined,
  videoWidth: number,
  videoHeight: number,
  fontSize: number,
): { side: "bottom" | "top" | "left" | "right"; maxWidth: number } => {
  const columnWidth = Math.min(640, 0.34 * videoWidth);
  let side: "bottom" | "top" | "left" | "right" = position === "auto" ? "bottom" : position;
  if (position === "auto" && avoid) {
    const room = {
      bottom: videoHeight - (avoid.y + avoid.height) - CAPTION_MARGIN,
      top: avoid.y - CAPTION_MARGIN,
      right: videoWidth - (avoid.x + avoid.width) - CAPTION_MARGIN,
      left: avoid.x - CAPTION_MARGIN,
    };
    // Two lines of text plus padding, or a full column.
    const need = { bottom: fontSize * 3.4, top: fontSize * 3.4, right: columnWidth, left: columnWidth };
    const order = ["bottom", "top", "right", "left"] as const;
    const fits = order.filter((s) => room[s] >= need[s]);
    side = (fits.length ? fits : order).reduce((best, s) => (room[s] > room[best] ? s : best));
  }
  const sideways = side === "left" || side === "right";
  return { side, maxWidth: sideways ? columnWidth : Math.min(1400, 0.9 * videoWidth) };
};

/**
 * Caption card with a per-word clip reveal and an auto-out. Defaults to the bottom edge; `position`
 * moves it to another edge and "auto" picks the edge farthest from `avoid` (composition px).
 * Every word is fully revealed within 8 frames of `at`, whatever the word count, so a caption is
 * never caught half-typed on a frame someone reviews.
 */
export const Caption: React.FC<{
  text: string;
  at: number;
  out?: number;
  fontSize?: number;
  position?: CaptionPosition;
  avoid?: CaptionRect;
}> = ({ text, at, out, fontSize = 34, position = "bottom", avoid }) => {
  const frame = useCurrentFrame();
  const { width: videoWidth, height: videoHeight } = useVideoConfig();
  const words = text.split(" ");
  if (frame < at || (out !== undefined && frame > out + 10)) return null;
  const exit =
    out !== undefined ? tween(frame, [out, out + 10], [0, 1], E.snap) : 0;
  const { side, maxWidth } = captionLayout(position, avoid, videoWidth, videoHeight, fontSize);
  // Stagger so the last word's wipe ends exactly at the settle frame; a short caption keeps the
  // 2-frame stagger it always had.
  const step = words.length > 1 ? Math.min(2, (CAPTION_SETTLE_FRAMES - CAPTION_WIPE_FRAMES) / (words.length - 1)) : 0;
  const travel = exit * 24;
  const anchor: React.CSSProperties =
    side === "bottom"
      ? { bottom: CAPTION_MARGIN, left: 0, right: 0, justifyContent: "center", transform: `translateY(${travel}px)` }
      : side === "top"
        ? { top: CAPTION_MARGIN, left: 0, right: 0, justifyContent: "center", transform: `translateY(${-travel}px)` }
        : side === "left"
          ? { top: 0, bottom: 0, left: CAPTION_MARGIN, alignItems: "center", transform: `translateX(${-travel}px)` }
          : { top: 0, bottom: 0, right: CAPTION_MARGIN, alignItems: "center", justifyContent: "flex-end", transform: `translateX(${travel}px)` };
  return (
    <div
      data-ovs-caption=""
      data-ovs-caption-side={side}
      style={{
        position: "absolute",
        display: "flex",
        opacity: 1 - exit,
        ...anchor,
      }}
    >
      <div
        data-ovs-caption-card=""
        style={{
          fontFamily: uiFamily,
          fontWeight: 500,
          fontSize,
          color: color.textPrimary,
          // Use the same mutable brand tokens as the caption text. A hardcoded dark bar
          // makes a light brand's dark text unreadable after extract_brand runs.
          background: color.panel,
          backdropFilter: "blur(18px) saturate(1.3)",
          WebkitBackdropFilter: "blur(18px) saturate(1.3)",
          border: `1px solid ${color.panelBorder}`,
          boxShadow: `0 8px 40px ${color.bg0}80`,
          borderRadius: 14,
          padding: `${fontSize * 0.45}px ${fontSize * 0.9}px`,
          display: "flex",
          gap: fontSize * 0.26,
          flexWrap: "wrap",
          justifyContent: side === "left" || side === "right" ? "flex-start" : "center",
          boxSizing: "border-box",
          maxWidth,
        }}
      >
        {words.map((w, i) => {
          const d = at + i * step;
          const wipe = tween(frame, [d, d + CAPTION_WIPE_FRAMES], [100, 0], E.snap);
          return (
            <span
              key={i}
              data-ovs-caption-word=""
              style={{
                clipPath: `inset(0 ${wipe}% 0 0)`,
                display: "inline-block",
                textShadow: "0 1px 3px rgba(0,0,0,0.6)",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
};

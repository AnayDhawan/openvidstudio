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
  sfx = true,
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

/** Bottom caption bar: single line, word-stagger clip reveal, auto-out. */
export const Caption: React.FC<{
  text: string;
  at: number;
  out?: number;
  fontSize?: number;
}> = ({ text, at, out, fontSize = 34 }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  if (frame < at || (out !== undefined && frame > out + 10)) return null;
  const exit =
    out !== undefined ? tween(frame, [out, out + 10], [0, 1], E.snap) : 0;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 84,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        transform: `translateY(${exit * 24}px)`,
        opacity: 1 - exit,
      }}
    >
      <div
        style={{
          fontFamily: uiFamily,
          fontWeight: 500,
          fontSize,
          color: color.textPrimary,
          // glassmorphism caption bar — opaque enough to read over white browser-chrome
          // recordings (was 0.45, washed out against BrowserFrame's white body)
          background: "rgba(12,15,22,0.82)",
          backdropFilter: "blur(18px) saturate(1.3)",
          WebkitBackdropFilter: "blur(18px) saturate(1.3)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: `${fontSize * 0.45}px ${fontSize * 0.9}px`,
          display: "flex",
          gap: fontSize * 0.26,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 1400,
        }}
      >
        {words.map((w, i) => {
          const d = at + staggerDelay(i, 2);
          const wipe = tween(frame, [d, d + 5], [100, 0], E.snap);
          return (
            <span
              key={i}
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

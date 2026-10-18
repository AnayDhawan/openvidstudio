// Background and transition primitives: soft drifting color fields, a faint texture grid,
// a hit flash, a hard black hold, and letterbox bars. Ported from reference/launch-video's
// lib/fx.tsx (minus PixelWipe, which pairs with the pixel-grid family in pixel.tsx) and
// generalized: colors come from this package's tokens by default, not one video's palette.

import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { E, tween } from "./motion";
import { color } from "./tokens";

/** Soft drifting color fields behind everything. One radial blob per color, slowly orbiting. */
export const Atmosphere: React.FC<{
  intensity?: number;
  colors?: string[];
  seed?: number;
}> = ({ intensity = 1, colors = [color.accent, color.accentAlt, color.success, color.warn], seed = 2 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {colors.map((c, i) => {
        const ph = frame / 240 + i * 1.7 + seed;
        const x = 50 + Math.sin(ph) * 32;
        const y = 50 + Math.cos(ph * 0.8 + i) * 28;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: 900,
              height: 900,
              marginLeft: -450,
              marginTop: -450,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${c}${Math.round(34 * intensity).toString(16).padStart(2, "0")} 0%, transparent 65%)`,
              filter: "blur(40px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** A faint dot grid on the stage, for a texture pass behind constructed (non-capture) panels. */
export const DotGrid: React.FC<{
  gap?: number;
  color?: string;
  opacity?: number;
  w?: number;
  h?: number;
}> = ({ gap = 36, color: dotColor = "#ffffff", opacity = 0.05, w = 1920, h = 1080 }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      width: w,
      height: h,
      opacity,
      backgroundImage: `radial-gradient(${dotColor} 1.4px, transparent 1.6px)`,
      backgroundSize: `${gap}px ${gap}px`,
    }}
  />
);

/** Brief exposure flash on a hard hit (a cut, a reveal landing). */
export const Flash: React.FC<{
  at: number;
  color?: string;
  strength?: number;
  dur?: number;
}> = ({ at, color: flashColor = "#ffffff", strength = 0.55, dur = 10 }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > at + dur) return null;
  const o = tween(frame, [at, at + dur], [strength, 0], E.cinematic);
  return <AbsoluteFill style={{ background: flashColor, opacity: o, mixBlendMode: "screen", pointerEvents: "none" }} />;
};

/** Holds solid black (a hard cut to nothing) from `from` until `to`, or forever if omitted. */
export const Black: React.FC<{ from: number; to?: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  if (frame < from || (to !== undefined && frame >= to)) return null;
  return <AbsoluteFill style={{ background: "#000" }} />;
};

/** Letterbox bars for a cinematic moment. `amount` scales the bar height, 1 = full 64px. */
export const Letterbox: React.FC<{ amount?: number }> = ({ amount = 1 }) => (
  <>
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 64 * amount, background: "#000" }} />
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 64 * amount, background: "#000" }} />
  </>
);

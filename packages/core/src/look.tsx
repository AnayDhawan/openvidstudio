// Global look pass: film grain (animated), vignette, subtle color grade.
// Always rendered by CinematicScene on top of scene content. Cheap on purpose:
// grain = static SVG-turbulence tile jittered per frame; vignette/grade = gradient overlays.

import React from "react";
import { useCurrentFrame } from "remotion";
import { jitter } from "./motion";

// 256px noise tile as inline SVG (no binary assets needed)
const NOISE_TILE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
      `<feColorMatrix type='saturate' values='0'/></filter>` +
      `<rect width='256' height='256' filter='url(#n)'/></svg>`,
  );

export const FilmGrain: React.FC<{ opacity?: number }> = ({
  opacity = 0.05,
}) => {
  const frame = useCurrentFrame();
  const ox = Math.floor(jitter(frame, 1) * 256);
  const oy = Math.floor(jitter(frame, 2) * 256);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage: `url("${NOISE_TILE}")`,
        backgroundRepeat: "repeat",
        backgroundPosition: `${ox}px ${oy}px`,
        opacity,
        mixBlendMode: "overlay",
      }}
    />
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({
  strength = 0.32,
}) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      background: `radial-gradient(ellipse 75% 65% at 50% 48%, transparent 55%, rgba(0,0,0,${strength}) 100%)`,
    }}
  />
);

/** Subtle grade: cool shadows, slight warm lift top-left (warm/cool contrast per STYLE.md). */
export const ColorGrade: React.FC<{ warmth?: number }> = ({
  warmth = 0.06,
}) => (
  <>
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: `linear-gradient(135deg, rgba(255,170,90,${warmth}) 0%, transparent 45%)`,
        mixBlendMode: "soft-light",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: `linear-gradient(315deg, rgba(60,110,255,${warmth * 1.2}) 0%, transparent 50%)`,
        mixBlendMode: "soft-light",
      }}
    />
  </>
);

export const LookPass: React.FC<{
  grain?: number;
  vignette?: number;
  warmth?: number;
}> = ({ grain = 0.05, vignette = 0.32, warmth = 0.06 }) => (
  <>
    <ColorGrade warmth={warmth} />
    <FilmGrain opacity={grain} />
    <Vignette strength={vignette} />
  </>
);

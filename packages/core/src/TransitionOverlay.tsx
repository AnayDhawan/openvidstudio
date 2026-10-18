// Transition overlays: drawn ON TOP of a hard cut, never in place of it.
//
// A cut moves no scene and shifts no beat boundary, so the Series, the bar-snapped timing and
// every audio join stay exactly where beats.json put them. stitch_composition mounts one of
// these in a Sequence centred on a beat's start; the first frame of the new scene is the
// overlay's peak, which is why a hard cut underneath it can't be seen. The overlay is a pure
// function of frame and of the colour tokens, so it renders the same on every machine and
// follows a brand applied with applyBrand.

import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { E } from "./motion";
import { color } from "./tokens";

export type TransitionType = "fade" | "whip" | "push" | "wipe" | "light-leak";

/** Every name beats.json's `transition` field may carry, "cut" being the absence of an overlay. */
export const TRANSITION_TYPES = ["cut", "whip", "fade", "push", "wipe", "light-leak"] as const;

/**
 * How present the overlay is at a frame: 0 at its first and last frames, 1 on the cut frame
 * (the middle of the overlay). Reaching 0 one frame early on each side, rather than on the
 * frame the Sequence unmounts, is what keeps the overlay from popping off: the last frame it
 * is mounted on is already invisible.
 */
export function transitionEnvelope(frame: number, length: number): number {
  const half = length / 2;
  const reach = Math.max(1, half - 1);
  return 1 - Math.min(1, Math.abs(frame - half) / reach);
}

/** "#rgb" or "#rrggbb" to [r, g, b], or null when the token is not plain hex. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : hex;
}

/** Hue in degrees of a hex colour, or a warm orange when the token is not plain hex. */
function hueOf(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 28;
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 28;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Which way a travelling panel is on its way: in before the cut, out after it. */
const side = (frame: number, length: number) => (frame < length / 2 ? 1 : -1);

/**
 * A transition drawn over the cut. Mount it in a Sequence that starts `length / 2` frames
 * before the cut, `layout="none"`; the cut is then local frame `length / 2`.
 *
 *  - fade: dips to the brand background and back.
 *  - whip: heavy backdrop blur and an accent streak that crosses the frame at the cut.
 *  - push: a panel slides in from the right, covers the frame at the cut, leaves to the left.
 *  - wipe: a skewed band with an accent edge crosses left to right.
 *  - light-leak: warm light, hue taken from the accent, drifts across and peaks at the cut.
 *
 * `length` is the overlay's total frames, centred on the cut. It defaults to the surrounding
 * Sequence's length, which is what stitch_composition sizes it to.
 */
export const TransitionOverlay: React.FC<{ type: TransitionType | "cut"; length?: number }> = ({ type, length }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const total = length ?? durationInFrames;
  const k = clamp01(transitionEnvelope(frame, total));
  if (k <= 0) return null;

  if (type === "fade") {
    return <AbsoluteFill style={{ background: color.bg0, opacity: clamp01(E.drift(k)), pointerEvents: "none" }} />;
  }

  if (type === "whip") {
    // The ease makes the blur arrive late and leave early, so the frames beside the cut are
    // the ones that sell the speed.
    const kw = clamp01(E.whip(k));
    const sweep = interpolate(frame, [0, total], [-0.4, 1.4], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const accent = color.accent;
    return (
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          backdropFilter: `blur(${Math.round(64 * kw * 10) / 10}px)`,
          WebkitBackdropFilter: `blur(${Math.round(64 * kw * 10) / 10}px)`,
        }}
      >
        <AbsoluteFill style={{ background: withAlpha(accent, 0.28 * kw) }} />
        <div
          style={{
            position: "absolute",
            top: -height * 0.1,
            bottom: -height * 0.1,
            left: `${sweep * 100}%`,
            width: "58%",
            transform: "translateX(-50%) skewX(-18deg)",
            opacity: clamp01(kw * 1.5),
            mixBlendMode: "screen",
            background: `linear-gradient(90deg, ${withAlpha(accent, 0)} 0%, ${withAlpha(accent, 0.75)} 34%, rgba(255,255,255,0.95) 50%, ${withAlpha(accent, 0.75)} 66%, ${withAlpha(accent, 0)} 100%)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (type === "push" || type === "wipe") {
    // The wipe uses the symmetric ease: a ballistic one covers the frame in two frames and reads as
    // a black flash rather than a band crossing it.
    const s = clamp01(type === "push" ? E.cinematic(k) : E.drift(k));
    if (type === "push") {
      // A panel exactly the frame's size: fully covering at the cut, fully off screen at the edges.
      const tx = side(frame, total) * (1 - s) * width;
      return (
        <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translateX(${tx}px)`,
              background: color.bg1,
              boxShadow: `${-side(frame, total) * 60}px 0 120px rgba(0,0,0,0.5)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                ...(side(frame, total) > 0 ? { left: 0 } : { right: 0 }),
                width: 8,
                background: color.accent,
              }}
            />
          </div>
        </AbsoluteFill>
      );
    }
    // Wipe: a band wide enough that its skewed corners still cover the frame at the cut.
    const skew = 12;
    const lean = Math.tan((skew * Math.PI) / 180) * height;
    const bandWidth = width + lean * 2 + 40;
    const travel = (width + bandWidth) / 2 + lean / 2 + 20;
    const tx = -side(frame, total) * (1 - s) * travel;
    const edge = 10;
    return (
      <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            top: -4,
            bottom: -4,
            left: (width - bandWidth) / 2,
            width: bandWidth,
            transform: `translateX(${tx}px) skewX(${-skew}deg)`,
            background: color.bg0,
          }}
        >
          <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: edge, background: color.accent, boxShadow: `0 0 40px ${withAlpha(color.accent, 0.8)}` }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: edge, background: color.accent, opacity: 0.6 }} />
        </div>
      </AbsoluteFill>
    );
  }

  if (type === "light-leak") {
    const o = clamp01(E.drift(k));
    const t = frame / Math.max(1, total);
    const hue = hueOf(color.accent);
    const hsla = (h: number, sat: number, light: number, a: number) => `hsla(${Math.round(h) % 360}, ${sat}%, ${light}%, ${a})`;
    // Three overlapping lights that slide in opposite directions, plus a hot core that carries
    // the peak, so the frame at the cut is bright enough to hide whatever is underneath.
    const a = `radial-gradient(ellipse 85% 120% at ${12 + 70 * t}% ${28 + 22 * Math.sin(t * Math.PI)}%, ${hsla(hue, 100, 62, 0.95)} 0%, ${hsla(hue, 100, 55, 0.55)} 38%, ${hsla(hue, 100, 50, 0)} 74%)`;
    const b = `radial-gradient(ellipse 75% 110% at ${96 - 76 * t}% ${74 - 20 * Math.sin(t * Math.PI)}%, ${hsla(hue + 28, 100, 60, 0.9)} 0%, ${hsla(hue + 28, 100, 52, 0.5)} 40%, ${hsla(hue + 28, 100, 50, 0)} 72%)`;
    const core = `radial-gradient(ellipse 130% 160% at 50% 50%, ${hsla(hue + 14, 95, 86, 0.92)} 0%, ${hsla(hue + 14, 100, 70, 0.7)} 55%, ${hsla(hue + 14, 100, 60, 0.4)} 100%)`;
    return (
      <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "screen", opacity: o, background: `${a}, ${b}, ${core}` }} />
    );
  }

  return null;
};

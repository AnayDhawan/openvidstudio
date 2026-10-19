import React from "react";

/**
 * The glow budget: one glowing element at a time (Void + Spark's rule that light is meaning).
 * Everything in this package that glows draws that glow through <Glow>, which tags its element
 * with `data-ovs-glow`, so a check can count the glowing elements in a rendered frame by reading
 * the DOM instead of guessing from pixels. validate_scenes' render mode does exactly that.
 *
 * An element counts as glowing while its `data-ovs-glow-level` (0 to 1, the intensity at this
 * frame) is above GLOW_VISIBLE_LEVEL. Not drawn at all, or faded out, is not glowing.
 */
export const GLOW_ATTR = "data-ovs-glow";
export const GLOW_LEVEL_ATTR = "data-ovs-glow-level";
export const GLOW_VISIBLE_LEVEL = 0.05;

export type GlowKind = "spark" | "nova";

/** A soft radial bloom centred on (x, y), `radius` px to where it has faded out. */
export const Glow: React.FC<{
  kind: GlowKind;
  x: number;
  y: number;
  radius: number;
  color: string;
  /** 0 to 1. Scales the bloom's opacity and is what the budget check reads. */
  level?: number;
  children?: React.ReactNode;
}> = ({ kind, x, y, radius, color, level = 1, children }) => (
  <div
    {...{ [GLOW_ATTR]: kind, [GLOW_LEVEL_ATTR]: level.toFixed(3) }}
    style={{
      position: "absolute",
      left: x - radius,
      top: y - radius,
      width: radius * 2,
      height: radius * 2,
      borderRadius: "50%",
      opacity: Math.max(0, Math.min(1, level)),
      background: `radial-gradient(circle, ${color}d9 0%, ${color}66 28%, ${color}1f 52%, ${color}00 72%)`,
      pointerEvents: "none",
    }}
  >
    {children}
  </div>
);

/** The number of glowing elements under `root` (default: the whole document), kinds optional. */
export function countGlowing(root: ParentNode = document, kind?: GlowKind): number {
  return Array.from(root.querySelectorAll(`[${GLOW_ATTR}${kind ? `="${kind}"` : ""}]`)).filter(
    (el) => Number.parseFloat(el.getAttribute(GLOW_LEVEL_ATTR) ?? "0") > GLOW_VISIBLE_LEVEL,
  ).length;
}

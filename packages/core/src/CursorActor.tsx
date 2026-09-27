// Cursor as an actor (STYLE.md rule 4): oversized macOS cursor gliding between keyframes
// with cinematic easing, click = press-scale + expanding ring + click SFX.

import React from "react";
import { useCurrentFrame } from "remotion";
import { E, tween } from "./motion";
import { Click } from "./sfx";
import { color } from "./tokens";

export type CursorKeyframe = { frame: number; x: number; y: number };

/**
 * Cursor position at an arbitrary frame, by the same clamp-and-interpolate rule the actor
 * itself renders with. Pulled out so a click ring can ask "where was the cursor AT FRAME c"
 * once, and freeze that answer, instead of the actor's per-frame render reading whatever the
 * live position happens to be on the frame the ring is drawn.
 */
function positionAt(sorted: CursorKeyframe[], frame: number): { x: number; y: number } {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (frame <= first.frame) return { x: first.x, y: first.y };
  if (frame >= last.frame) return { x: last.x, y: last.y };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].frame >= frame) {
      const a = sorted[i - 1];
      const b = sorted[i];
      return {
        x: tween(frame, [a.frame, b.frame], [a.x, b.x], E.cinematic),
        y: tween(frame, [a.frame, b.frame], [a.y, b.y], E.cinematic),
      };
    }
  }
  return { x: last.x, y: last.y };
}

export const CursorActor: React.FC<{
  path: CursorKeyframe[];
  /** frames at which a click happens (ring + press + sfx) */
  clicks?: number[];
  scale?: number;
  sfx?: boolean;
}> = ({ path, clicks = [], scale = 1.6, sfx = true }) => {
  const frame = useCurrentFrame();
  const sorted = [...path].sort((a, b) => a.frame - b.frame);
  if (frame < sorted[0].frame) return null;

  const { x, y } = positionAt(sorted, frame);

  // press scale near a click
  const press = clicks.reduce((acc, c) => {
    if (frame >= c && frame <= c + 8) {
      return Math.min(acc, 1 - 0.18 * Math.sin(((frame - c) / 8) * Math.PI));
    }
    return acc;
  }, 1);

  return (
    <>
      {/* click rings: anchored at the cursor's position AT ITS OWN CLICK FRAME, computed
          once per click and frozen there. Reading live x/y here instead would let a ring
          still fading out on a later frame visibly slide off the target the cursor has
          since moved on from. */}
      {clicks.map((c, i) => {
        if (frame < c || frame > c + 22) return null;
        const anchor = positionAt(sorted, c);
        const p = tween(frame, [c, c + 22], [0, 1], E.snap);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: anchor.x - 60 * p,
              top: anchor.y - 60 * p,
              width: 120 * p,
              height: 120 * p,
              borderRadius: "50%",
              border: `3px solid ${color.accent}`,
              opacity: 1 - p,
              boxShadow: `0 0 24px ${color.accent}66`,
            }}
          />
        );
      })}
      {/* macOS arrow cursor */}
      <svg
        width={28 * scale}
        height={40 * scale}
        viewBox="0 0 28 40"
        style={{
          position: "absolute",
          left: x,
          top: y,
          transform: `scale(${press})`,
          transformOrigin: "top left",
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))",
        }}
      >
        <path
          d="M2 2 L2 32 L10 25 L15 37 L20 35 L15 23 L26 23 Z"
          fill="#FFFFFF"
          stroke="#000000"
          strokeWidth={2}
        />
      </svg>
      {sfx ? clicks.map((c, i) => <Click key={i} at={c} />) : null}
    </>
  );
};

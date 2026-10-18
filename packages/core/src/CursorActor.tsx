// Cursor as an actor (STYLE.md rule 4): oversized macOS cursor gliding between keyframes
// with cinematic easing along a slight arc, click = press-scale + expanding ring + click SFX.

import React from "react";
import { useCurrentFrame } from "remotion";
import { E, tween } from "./motion";
import { Click } from "./sfx";
import { color } from "./tokens";

export type CursorKeyframe = { frame: number; x: number; y: number };

/** How far a segment bows sideways at its widest, as a fraction of the segment's length. */
const ARC = 0.06;
/** How far past the target the cursor swings before settling, as a fraction of the segment's length. */
const OVERSHOOT = 0.025;

/**
 * Cursor position at an arbitrary frame, by the same clamp-and-interpolate rule the actor
 * itself renders with. Pulled out so a click ring can ask "where was the cursor AT FRAME c"
 * once, and freeze that answer, instead of the actor's per-frame render reading whatever the
 * live position happens to be on the frame the ring is drawn.
 *
 * A hand does not move in a straight line. Each segment bows to one side (by up to 6% of its
 * length, alternating sides from one segment to the next so a run of moves does not lean one way),
 * and the cursor swings a little past the target before it settles, which reads as a person
 * aiming. The progress along the segment is still E.cinematic, and the position on a keyframe's
 * own frame is exactly that keyframe.
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
      const progress = tween(frame, [a.frame, b.frame], [0, 1], E.cinematic);
      const t = (frame - a.frame) / (b.frame - a.frame);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) return { x: b.x, y: b.y };
      const side = i % 2 === 1 ? 1 : -1;
      const bow = ARC * length * Math.sin(Math.PI * progress) * side;
      // The overshoot rides the last 45% of the segment's time and is zero again on arrival.
      const overshoot = t > 0.55 ? OVERSHOOT * length * Math.sin((Math.PI * (t - 0.55)) / 0.45) : 0;
      const along = progress * length + overshoot;
      return {
        x: a.x + (dx / length) * along + (-dy / length) * bow,
        y: a.y + (dy / length) * along + (dx / length) * bow,
      };
    }
  }
  return { x: last.x, y: last.y };
}

/** The cursor's position at `frame` along `path`, exactly as CursorActor draws it. */
export const cursorPositionAt = (path: CursorKeyframe[], frame: number): { x: number; y: number } =>
  positionAt([...path].sort((a, b) => a.frame - b.frame), frame);

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

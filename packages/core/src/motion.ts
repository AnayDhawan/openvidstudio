// Easing + spring presets. Linear easing is banned (STYLE.md). Always pick from here.

import { Easing, interpolate, spring } from "remotion";

export const E = {
  // default cinematic move: slow-out, soft landing
  cinematic: Easing.bezier(0.33, 0.0, 0.13, 1.0),
  // aggressive whip (cuts, fast pans)
  whip: Easing.bezier(0.8, 0.0, 0.1, 1.0),
  // gentle drift (ambient motion inside a shot)
  drift: Easing.bezier(0.4, 0.0, 0.6, 1.0),
  // snappy UI reaction (button press, blip reveal)
  snap: Easing.bezier(0.2, 0.9, 0.25, 1.0),
} as const;

export const SPRING = {
  soft: { damping: 26, stiffness: 90, mass: 1 },
  pop: { damping: 14, stiffness: 160, mass: 0.8 },
  heavy: { damping: 30, stiffness: 60, mass: 1.4 },
} as const;

/** interpolate with a mandatory named easing and clamped edges. */
export const tween = (
  frame: number,
  range: [number, number],
  out: [number, number],
  easing: (t: number) => number = E.cinematic,
) =>
  interpolate(frame, range, out, {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** spring entrance helper */
export const pop = (
  frame: number,
  fps: number,
  delay = 0,
  config: { damping: number; stiffness: number; mass: number } = SPRING.pop,
) => spring({ frame: frame - delay, fps, config });

/** deterministic per-frame pseudo-random (for grain jitter etc.) */
export const jitter = (frame: number, seed = 1) => {
  const x = Math.sin(frame * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x); // 0..1
};

/** stagger helper: frame offset for item i */
export const staggerDelay = (i: number, step = 3) => i * step;

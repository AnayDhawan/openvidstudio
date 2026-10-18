// Handheld sway and impact shake: small, deterministic camera motion on top of a move.
// A locked-off camera on a screenshot reads as a slideshow; a few pixels of drift reads as a person
// holding the camera. Both effects are pure functions of the frame (never Math.random, which would
// differ per render process and flicker), so the same frame is the same everywhere.

import { useCurrentFrame, useVideoConfig } from "remotion";

export interface ShakeOffset {
  /** Horizontal and vertical offset in px. */
  x: number;
  y: number;
  /** Roll in degrees. */
  rot: number;
}

/** Roll, in degrees, that goes with each px of sway or shake. Small: a camera rolls far less than it shifts. */
export const HANDHELD_ROLL_PER_PX = 0.03;
export const SHAKE_ROLL_PER_PX = 0.04;
/** Peak shake in px at 1080p, and the time constant (in frames) the hit dies away with. */
export const DEFAULT_SHAKE_AMPLITUDE = 12;
export const DEFAULT_SHAKE_DECAY = 8;

const TAU = Math.PI * 2;

/** A stable pseudo-random phase in [0, 2pi) for a seed and an axis. */
const phase = (seed: number, axis: number): number => {
  const x = Math.sin(seed * 127.1 + axis * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * TAU;
};

/**
 * Handheld sway at a frame. Each axis is two sines at unrelated frequencies (0.11 and 0.28 rad per
 * frame, about 0.5 Hz and 1.3 Hz at 30 fps), so the path never visibly repeats and the axes do not
 * move in lockstep. `amount` is the largest offset in px, `seed` picks a different path.
 */
export const handheldOffset = (frame: number, amount: number, seed = 1): ShakeOffset => {
  const axis = (k: number, slow: number, fast: number) =>
    0.62 * Math.sin(frame * slow + phase(seed, k)) + 0.38 * Math.sin(frame * fast + phase(seed, k + 1));
  return {
    x: amount * axis(0, 0.113, 0.277),
    y: amount * axis(2, 0.137, 0.331),
    rot: amount * HANDHELD_ROLL_PER_PX * axis(4, 0.091, 0.223),
  };
};

/**
 * 1 where sway runs freely, 0 inside any `holds` window ([from, to] inclusive, in frames), and a
 * smooth ramp over `ramp` frames on either side. A hold is the moment the camera is "set down":
 * a cursor click, a text block the viewer has to read.
 */
export const holdWeight = (frame: number, holds: [number, number][] = [], ramp = 6): number => {
  let weight = 1;
  for (const [from, to] of holds) {
    if (frame >= from && frame <= to) return 0;
    const distance = frame < from ? from - frame : frame - to;
    const t = Math.min(1, distance / ramp);
    weight = Math.min(weight, t * t * (3 - 2 * t));
  }
  return weight;
};

/**
 * Handheld sway for the current frame, scaled for the composition height (`amount` is px at 1080p)
 * and eased to exactly zero inside the `holds` windows.
 */
export const useHandheld = (
  amount: number,
  options: { holds?: [number, number][]; seed?: number; ramp?: number } = {},
): ShakeOffset => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const weight = holdWeight(frame, options.holds, options.ramp);
  const k = height / 1080;
  const o = handheldOffset(frame, amount, options.seed ?? 1);
  return { x: o.x * weight * k, y: o.y * weight * k, rot: o.rot * weight };
};

/**
 * Shake from impacts at the given frames. Before an impact it contributes exactly nothing; on the
 * impact frame it is at full `amplitude` (px); after that it rings at about 9 Hz while a decaying
 * envelope (time constant `decay` frames) takes it below 5% of the amplitude by 3 x decay.
 * Each impact kicks in its own direction, taken from its frame number.
 */
export const impactShake = (
  frame: number,
  impactFrames: number[],
  options: { amplitude?: number; decay?: number } = {},
): ShakeOffset => {
  const amplitude = options.amplitude ?? DEFAULT_SHAKE_AMPLITUDE;
  const decay = Math.max(1, options.decay ?? DEFAULT_SHAKE_DECAY);
  let x = 0;
  let y = 0;
  let rot = 0;
  for (const hit of impactFrames) {
    const age = frame - hit;
    if (age < 0) continue;
    const swing = amplitude * Math.exp(-age / decay) * Math.cos(age * 1.9);
    const dir = phase(hit, 7);
    x += swing * Math.cos(dir);
    y += swing * Math.sin(dir);
    rot += swing * SHAKE_ROLL_PER_PX * (Math.sin(dir) >= 0 ? 1 : -1);
  }
  return { x, y, rot };
};

/** Impact shake for the current frame, scaled for the composition height. */
export const useImpactShake = (
  impactFrames: number[],
  options: { amplitude?: number; decay?: number } = {},
): ShakeOffset => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const s = impactShake(frame, impactFrames, options);
  const k = height / 1080;
  return { x: s.x * k, y: s.y * k, rot: s.rot };
};

// Shot vocabulary: the handful of camera moves a director actually asks for, as named presets.
// A preset is plain data (zoom, where the camera starts and ends, tilt, easing, length, blur),
// resolved by a pure function, so `<DirectedShot shot="whip" />` and a unit-style readout see
// exactly the same numbers. Anything passed explicitly to DirectedShot wins over the preset.

import { E } from "./motion";

export type ShotName = "pushIn" | "pullOut" | "pan" | "whip" | "orbit" | "dutch" | "hold" | "drift";

export const SHOT_NAMES: readonly ShotName[] = ["pushIn", "pullOut", "pan", "whip", "orbit", "dutch", "hold", "drift"];

export interface ShotOptions {
  /** The point of interest, in capture pixels. Defaults to the middle of the capture. */
  focus?: { x: number; y: number };
  /** Overrides the preset's zoom, relative to fitting the whole capture (1 = the whole capture). */
  push?: number;
  /** The capture's natural size in pixels. Default 1920x1080. */
  captureWidth?: number;
  captureHeight?: number;
}

export interface ResolvedShot {
  /** Zoom at the start of the move, relative to fitting the whole capture. */
  startScale: number;
  /** Zoom at the end of the move, same units. */
  endScale: number;
  /** Where the camera is centred at the start, in capture pixels. DirectedShot clamps it inside the capture. */
  startFocus: { x: number; y: number };
  /** Where the camera is centred at the end, in capture pixels. */
  endFocus: { x: number; y: number };
  /** Rotation in degrees at the start of the move. */
  startTilt: { x: number; y: number; z: number };
  /** Rotation in degrees at the end of the move. */
  tilt: { x: number; y: number; z: number };
  easing: (t: number) => number;
  /** How many frames the move runs when the caller does not say. */
  moveFrames: number;
  /** Whether the move should carry motion blur. Only the whip does. */
  blur: boolean;
}

const level = { x: 0, y: 0, z: 0 };

/**
 * The numbers behind a shot name.
 *
 * Tilted shots (orbit, dutch, drift) start already zoomed or ramp their tilt from level, because a
 * rotated plane shrinks the area it covers: rotateZ(3.5deg) on a full-frame capture shows empty
 * stage in the corners unless the zoom is about 1.1 or more by then.
 */
export const resolveShot = (name: ShotName, options: ShotOptions = {}): ResolvedShot => {
  const W = options.captureWidth ?? 1920;
  const H = options.captureHeight ?? 1080;
  const centre = { x: W / 2, y: H / 2 };
  const focus = options.focus ?? centre;
  const push = options.push;

  switch (name) {
    case "pushIn":
      return {
        startScale: 1, endScale: push ?? 1.4, startFocus: centre, endFocus: focus,
        startTilt: level, tilt: level, easing: E.cinematic, moveFrames: 90, blur: false,
      };
    case "pullOut":
      // Starts close on the point of interest and backs out to the whole capture.
      return {
        startScale: push ?? 1.5, endScale: 1, startFocus: focus, endFocus: centre,
        startTilt: level, tilt: level, easing: E.cinematic, moveFrames: 90, blur: false,
      };
    case "pan": {
      // Same zoom throughout; the camera slides sideways onto the focus.
      const scale = push ?? 1.35;
      return {
        startScale: scale, endScale: scale, startFocus: { x: focus.x - W * 0.22, y: focus.y }, endFocus: focus,
        startTilt: { x: 0, y: 2, z: 0 }, tilt: { x: 0, y: -2, z: 0 }, easing: E.cinematic, moveFrames: 75, blur: false,
      };
    }
    case "whip": {
      // A fast slide from well off to one side. Short, hard easing, with motion blur.
      const scale = push ?? 1.5;
      return {
        startScale: scale, endScale: scale, startFocus: { x: focus.x - W * 0.5, y: focus.y }, endFocus: focus,
        startTilt: level, tilt: level, easing: E.whip, moveFrames: 18, blur: true,
      };
    }
    case "orbit":
      // The camera swings around the focus: rotY crosses from one sign to the other.
      return {
        startScale: 1.15, endScale: push ?? 1.35, startFocus: centre, endFocus: focus,
        startTilt: { x: 2, y: -5, z: 0 }, tilt: { x: 2, y: 5, z: 0 }, easing: E.cinematic, moveFrames: 120, blur: false,
      };
    case "dutch":
      // A pushIn that rolls the horizon off level.
      return {
        startScale: 1, endScale: push ?? 1.35, startFocus: centre, endFocus: focus,
        startTilt: level, tilt: { x: 0, y: 0, z: 3.5 }, easing: E.cinematic, moveFrames: 90, blur: false,
      };
    case "hold":
      // The whole capture, with a 2% creep so the frame is never dead. For shots where the action is
      // inside the frame: a cursor, typing, a counter.
      return {
        startScale: 1, endScale: push ?? 1.02, startFocus: centre, endFocus: centre,
        startTilt: level, tilt: level, easing: E.drift, moveFrames: 60, blur: false,
      };
    case "drift":
      // Ambient: a long, small move toward the focus with a sub-degree wander in the tilt.
      return {
        startScale: 1, endScale: push ?? 1.06,
        startFocus: centre, endFocus: { x: centre.x + (focus.x - centre.x) * 0.25, y: centre.y + (focus.y - centre.y) * 0.25 },
        startTilt: { x: -0.5, y: 0.7, z: -0.2 }, tilt: { x: 0.5, y: -0.7, z: 0.2 },
        easing: E.drift, moveFrames: 150, blur: false,
      };
  }
};

// Motion blur for a move, applied only while the move is happening.
// Remotion's CameraMotionBlur renders its children several times at sub-frame offsets and blends
// them, which is exactly what a real shutter does and costs `samples` times the render work. A
// shot is still for most of its length, so blurring all of it would pay that cost and soften a
// frame that has nothing to smear. MotionBlur switches the wrapper on only inside a frame window.

import React from "react";
import { useCurrentFrame } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";

export interface MotionBlurOptions {
  /** Shutter angle in degrees (0 to 360). 180 is the film default; larger smears more. */
  shutterAngle?: number;
  /** How many sub-frame renders are blended. More is smoother and slower. Default 8. */
  samples?: number;
}

export const MotionBlur: React.FC<
  MotionBlurOptions & {
    /** First frame (local to the scene) of the blur window. Default 0. */
    from?: number;
    /** Last frame of the blur window, inclusive. Default: never ends. */
    to?: number;
    children: React.ReactNode;
  }
> = ({ from = 0, to = Number.POSITIVE_INFINITY, shutterAngle = 180, samples = 8, children }) => {
  const frame = useCurrentFrame();
  // Outside the window the children render as they would without this component, byte for byte.
  if (frame < from || frame > to) return <>{children}</>;
  return (
    <CameraMotionBlur shutterAngle={shutterAngle} samples={samples}>
      {children}
    </CameraMotionBlur>
  );
};

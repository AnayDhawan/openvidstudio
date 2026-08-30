// Camera rig: renders children on an oversized "stage" and moves a virtual camera over it.
// The camera is defined by keyframes (focal point on stage + zoom + tilt). Between keyframes,
// values interpolate with a cinematic easing per segment. Layers can opt into parallax + DoF blur.

import React, { createContext, useContext } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "./motion";

export type CamKeyframe = {
  frame: number;
  /** focal point on the stage, in stage px, this point lands at frame center */
  x: number;
  y: number;
  /** zoom: 1 = stage px == output px; 1.6 = 160% close-up */
  scale: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  /** easing INTO this keyframe (from the previous one) */
  easing?: (t: number) => number;
};

type CamState = Required<Omit<CamKeyframe, "easing" | "frame">>;

const CameraContext = createContext<CamState | null>(null);

const resolve = (kfs: CamKeyframe[], frame: number): CamState => {
  const sorted = [...kfs].sort((a, b) => a.frame - b.frame);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const base = (k: CamKeyframe): CamState => ({
    x: k.x,
    y: k.y,
    scale: k.scale,
    rotX: k.rotX ?? 0,
    rotY: k.rotY ?? 0,
    rotZ: k.rotZ ?? 0,
  });
  if (frame <= first.frame) return base(first);
  if (frame >= last.frame) return base(last);
  let a = first;
  let b = sorted[1];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].frame >= frame) {
      a = sorted[i - 1];
      b = sorted[i];
      break;
    }
  }
  const ease = b.easing ?? E.cinematic;
  const A = base(a);
  const B = base(b);
  const lerp = (ka: number, kb: number) =>
    tween(frame, [a.frame, b.frame], [ka, kb], ease);
  return {
    x: lerp(A.x, B.x),
    y: lerp(A.y, B.y),
    scale: lerp(A.scale, B.scale),
    rotX: lerp(A.rotX, B.rotX),
    rotY: lerp(A.rotY, B.rotY),
    rotZ: lerp(A.rotZ, B.rotZ),
  };
};

export const CameraRig: React.FC<{
  keyframes: CamKeyframe[];
  /** stage size in px; content is laid out at this size, camera crops into it */
  stageWidth?: number;
  stageHeight?: number;
  children: React.ReactNode;
}> = ({ keyframes, stageWidth = 1920, stageHeight = 1080, children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const cam = resolve(keyframes, frame);

  return (
    <CameraContext.Provider value={cam}>
      <div
        style={{
          width,
          height,
          overflow: "hidden",
          perspective: 1400,
          perspectiveOrigin: "50% 50%",
        }}
      >
        <div
          style={{
            width: stageWidth,
            height: stageHeight,
            transformOrigin: "0 0",
            transformStyle: "preserve-3d",
            transform: [
              `translate(${width / 2}px, ${height / 2}px)`,
              `rotateX(${cam.rotX}deg)`,
              `rotateY(${cam.rotY}deg)`,
              `rotateZ(${cam.rotZ}deg)`,
              `scale(${cam.scale})`,
              `translate(${-cam.x}px, ${-cam.y}px)`,
            ].join(" "),
          }}
        >
          {children}
        </div>
      </div>
    </CameraContext.Provider>
  );
};

export const useCamera = () => useContext(CameraContext);

/**
 * Parallax + depth-of-field layer. depth 0 = focal plane (sharp, no parallax).
 * Positive depth = "behind" (moves less, blurred). Negative = foreground (moves more, blurred).
 */
export const Layer: React.FC<{
  depth?: number;
  /** max blur in px applied at |depth| = 1 */
  maxBlur?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ depth = 0, maxBlur = 10, style, children }) => {
  const cam = useCamera();
  const parallax = 0.06; // fraction of camera offset transferred per unit depth
  const dx = cam ? (cam.x - 960) * depth * parallax : 0;
  const dy = cam ? (cam.y - 540) * depth * parallax : 0;
  const blur = Math.abs(depth) * maxBlur;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `translate(${dx}px, ${dy}px)`,
        filter: blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

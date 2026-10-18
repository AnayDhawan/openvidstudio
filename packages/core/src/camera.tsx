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

/** What useCamera() returns: the camera plus the size of the stage it is looking at. */
export type CameraInfo = CamState & { stageWidth: number; stageHeight: number };

const CameraContext = createContext<CameraInfo | null>(null);

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

/** Where the camera is at `frame`, by the same interpolation CameraRig renders with. */
export const resolveCamera = resolve;

/** The rig's CSS perspective, in px. Layer's depth compensation and projectToScreen both use it. */
export const CAMERA_PERSPECTIVE = 1400;

/**
 * Where a point on the stage lands on screen, through the same chain of transforms CameraRig
 * applies (translate to the frame centre, rotateX/Y/Z, scale, translate by the focal point) and
 * the same perspective. Pure, so overlays that must line up with the picture (a blur mask, a
 * protected region) can place themselves without measuring the DOM.
 */
export const projectToScreen = (
  cam: Pick<CamState, "x" | "y" | "scale" | "rotX" | "rotY" | "rotZ">,
  viewportWidth: number,
  viewportHeight: number,
  px: number,
  py: number,
): { x: number; y: number } => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  let x = (px - cam.x) * cam.scale;
  let y = (py - cam.y) * cam.scale;
  let z = 0;
  // CSS applies the transform list right to left, so the point meets rotateZ, then rotateY, then rotateX.
  const cz = Math.cos(rad(cam.rotZ));
  const sz = Math.sin(rad(cam.rotZ));
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const cy = Math.cos(rad(cam.rotY));
  const sy = Math.sin(rad(cam.rotY));
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cx = Math.cos(rad(cam.rotX));
  const sx = Math.sin(rad(cam.rotX));
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const k = CAMERA_PERSPECTIVE / Math.max(1, CAMERA_PERSPECTIVE - z);
  return { x: viewportWidth / 2 + x * k, y: viewportHeight / 2 + y * k };
};

export const CameraRig: React.FC<{
  keyframes: CamKeyframe[];
  /** stage size in px; content is laid out at this size, camera crops into it */
  stageWidth?: number;
  stageHeight?: number;
  /**
   * The size of the window the camera looks through. Defaults to the composition's own size;
   * a rig nested inside a smaller box (DirectedShot) passes that box's size instead.
   */
  viewportWidth?: number;
  viewportHeight?: number;
  children: React.ReactNode;
}> = ({ keyframes, stageWidth = 1920, stageHeight = 1080, viewportWidth, viewportHeight, children }) => {
  const frame = useCurrentFrame();
  const video = useVideoConfig();
  const width = viewportWidth ?? video.width;
  const height = viewportHeight ?? video.height;
  const cam = resolve(keyframes, frame);

  return (
    <CameraContext.Provider value={{ ...cam, stageWidth, stageHeight }}>
      <div
        style={{
          width,
          height,
          overflow: "hidden",
          perspective: CAMERA_PERSPECTIVE,
          perspectiveOrigin: "50% 50%",
        }}
      >
        <div
          data-ovs-camera-stage=""
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

/** How far back (in px) one unit of Layer depth sits. Larger is a deeper scene and stronger parallax. */
export const Z_STEP = 170;

/**
 * A layer at a place in space: depth 0 is the focal plane, positive depth sits behind it, negative
 * depth in front. Parallax comes from the rig's real CSS perspective, so a layer 1 unit back moves
 * 1400 / (1400 + 170) = 0.89 as far as the focal plane when the camera pans, 2 units back 0.80, and
 * a foreground layer moves more than 1.
 *
 * Each layer is scaled about the stage centre by the amount the perspective shrinks (or grows) it,
 * so with the camera at rest on the stage centre every depth shows the same picture. Layers also
 * blur with distance from the focal plane (`maxBlur` px per unit of depth; 0 turns it off).
 *
 * Layers have to be direct children of the rig's stage: a plain wrapper div in between flattens
 * the depth. Depth orders layers in space, so a layer behind stays behind however the JSX is ordered.
 */
export const Layer: React.FC<{
  depth?: number;
  /** max blur in px applied at |depth| = 1 */
  maxBlur?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ depth = 0, maxBlur = 10, style, children }) => {
  const blur = Math.abs(depth) * maxBlur;
  const z = -depth * Z_STEP;
  // Behind, the perspective divides by (P + |z|) / P; scaling by exactly that cancels it at rest.
  const compensate = (CAMERA_PERSPECTIVE - z) / CAMERA_PERSPECTIVE;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: depth === 0 ? undefined : `translateZ(${z}px) scale(${compensate})`,
        filter: blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

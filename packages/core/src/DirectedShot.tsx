// DirectedShot (C4): a nested camera rig that turns a flat capture into a directed move.
// A screenshot or recording on its own is a rectangle. This pushes into the part that matters,
// tilts the plane slightly so the move reads as depth, softens everything away from the focal
// point, and lets the cursor act inside the capture, all in the capture's own pixel space.
//
//   <DirectedShot
//     src={staticFile("images/dashboard.png")}
//     focus={{ x: 1180, y: 410 }}           // capture pixels
//     push={1.5}                            // end zoom, relative to fitting the whole capture
//     tilt={{ y: -5, x: 3 }}                // degrees at the end of the move
//     move={{ from: 6, to: 84 }}            // frames the move runs over
//     cursor={{ path: [...], clicks: [60] }}
//   />
//
// It owns its own CameraRig, so it nests inside a CinematicScene (or anywhere else) without
// touching that scene's camera.

import React from "react";
import { Img, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraRig, resolveCamera } from "./camera";
import type { CamKeyframe } from "./camera";
import { CursorActor } from "./CursorActor";
import type { CursorKeyframe } from "./CursorActor";

export interface DirectedShotProps {
  /** Image URL of the capture, usually staticFile("images/<beat>.png"). Use children for anything else. */
  src?: string;
  /** Anything laid out at captureWidth x captureHeight, used when `src` is not given. */
  children?: React.ReactNode;
  /** Natural size of the capture in pixels. Defaults to 1920x1080. */
  captureWidth?: number;
  captureHeight?: number;
  /** The point in the capture, in capture pixels, that the move pushes into. */
  focus: { x: number; y: number };
  /** End zoom relative to fitting the whole capture in the box. 1 holds the full frame. Default 1.4. */
  push?: number;
  /** Rotation at the end of the move, in degrees. Small values (2 to 6) read as depth, larger ones as a gimmick. */
  tilt?: { x?: number; y?: number; z?: number };
  /** The frames, local to the scene, the move runs over. Default 0 to 90. */
  move?: { from?: number; to?: number; easing?: (t: number) => number };
  /** Blur in px applied away from the focal point. 0 turns it off. Default 6. */
  depthOfField?: number;
  /** Cursor path and click frames, in capture pixels. */
  cursor?: { path: CursorKeyframe[]; clicks?: number[] };
  /** The box the shot fills. Defaults to the composition frame. */
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}

// Keep the camera inside the capture: past an edge the viewer sees empty stage, which reads as
// a mistake. When the capture is smaller than the window at this zoom there is no edge to hit,
// so the camera simply centres.
const clampCenter = (value: number, viewport: number, scale: number, size: number): number => {
  const half = viewport / 2 / scale;
  if (size <= half * 2) return size / 2;
  return Math.min(Math.max(value, half), size - half);
};

export const DirectedShot: React.FC<DirectedShotProps> = ({
  src,
  children,
  captureWidth = 1920,
  captureHeight = 1080,
  focus,
  push = 1.4,
  tilt,
  move,
  depthOfField = 6,
  cursor,
  width,
  height,
  style,
}) => {
  const frame = useCurrentFrame();
  const video = useVideoConfig();
  const W = width ?? video.width;
  const H = height ?? video.height;

  const fit = Math.min(W / captureWidth, H / captureHeight);
  const endScale = fit * push;
  const from = move?.from ?? 0;
  const to = Math.max(from + 1, move?.to ?? 90);

  const keyframes: CamKeyframe[] = [
    { frame: from, x: captureWidth / 2, y: captureHeight / 2, scale: fit },
    {
      frame: to,
      x: clampCenter(focus.x, W, endScale, captureWidth),
      y: clampCenter(focus.y, H, endScale, captureHeight),
      scale: endScale,
      rotX: tilt?.x ?? 0,
      rotY: tilt?.y ?? 0,
      rotZ: tilt?.z ?? 0,
      easing: move?.easing,
    },
  ];

  // Where the focal point is on screen right now, so the sharp region follows it through the move.
  const cam = resolveCamera(keyframes, frame);
  const focusX = W / 2 + (focus.x - cam.x) * cam.scale;
  const focusY = H / 2 + (focus.y - cam.y) * cam.scale;
  const mask = `radial-gradient(ellipse ${Math.round(W * 0.34)}px ${Math.round(H * 0.4)}px at ${Math.round(focusX)}px ${Math.round(focusY)}px, transparent 0%, transparent 55%, #000 100%)`;

  return (
    <div data-ovs-directed-shot="" style={{ position: "relative", width: W, height: H, overflow: "hidden", ...style }}>
      <CameraRig keyframes={keyframes} stageWidth={captureWidth} stageHeight={captureHeight} viewportWidth={W} viewportHeight={H}>
        {src ? (
          <Img src={src} style={{ position: "absolute", left: 0, top: 0, width: captureWidth, height: captureHeight }} />
        ) : (
          children
        )}
        {cursor ? <CursorActor path={cursor.path} clicks={cursor.clicks} /> : null}
      </CameraRig>
      {depthOfField > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backdropFilter: `blur(${depthOfField}px)`,
            WebkitBackdropFilter: `blur(${depthOfField}px)`,
            maskImage: mask,
            WebkitMaskImage: mask,
          }}
        />
      ) : null}
    </div>
  );
};

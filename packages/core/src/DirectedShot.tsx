// DirectedShot (C4): a nested camera rig that turns a flat capture into a directed move.
// A screenshot or recording on its own is a rectangle. This pushes into the part that matters,
// tilts the plane slightly so the move reads as depth, optionally softens everything away from
// the focal point (off by default: blur smears the text a product video is selling), and lets
// the cursor act inside the capture, all in the capture's own pixel space.
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
import { CameraRig, projectToScreen, resolveCamera } from "./camera";
import type { CamKeyframe } from "./camera";
import { CursorActor } from "./CursorActor";
import type { CursorKeyframe } from "./CursorActor";
import { E, tween } from "./motion";
import { resolveShot } from "./shots";
import type { ShotName } from "./shots";

/** A rectangle in capture pixels. */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DirectedShotProps {
  /** Image URL of the capture, usually staticFile("images/<beat>.png"). Use children for anything else. */
  src?: string;
  /** Anything laid out at captureWidth x captureHeight, used when `src` is not given. */
  children?: React.ReactNode;
  /** Natural size of the capture in pixels. Defaults to 1920x1080. */
  captureWidth?: number;
  captureHeight?: number;
  /** The point in the capture, in capture pixels, that the move pushes into. Defaults to the middle. */
  focus?: { x: number; y: number };
  /** End zoom relative to fitting the whole capture in the box. 1 holds the full frame. Default 1.4. */
  push?: number;
  /**
   * A named camera move (see shots.ts): pushIn, pullOut, pan, whip, orbit, dutch, hold, drift. It
   * supplies the zoom, start and end position, tilt, easing and length. `push`, `tilt` and `move`
   * given explicitly override the preset.
   */
  shot?: ShotName;
  /** Rotation at the end of the move, in degrees. Small values (2 to 6) read as depth, larger ones as a gimmick. */
  tilt?: { x?: number; y?: number; z?: number };
  /** The frames, local to the scene, the move runs over. Default 0 to 90. */
  move?: { from?: number; to?: number; easing?: (t: number) => number };
  /**
   * Blur in px applied away from the focal point. Default 0 (off): blur smears product text, so it
   * is something to ask for, not something every shot pays for. Never put it on a shot whose text
   * has to be read, or list those regions in `protect`.
   */
  depthOfField?: number;
  /** Regions of the capture, in capture pixels, that stay sharp under `depthOfField`. Hard edged. */
  protect?: CaptureRect[];
  /** Rack focus: the sharp region slides from `focus` to this point, in capture pixels, across the move. */
  rackTo?: { x: number; y: number };
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

export interface DirectedKeyframeOptions {
  /** The box the shot fills, in px. */
  W: number;
  H: number;
  captureWidth: number;
  captureHeight: number;
  focus?: { x: number; y: number };
  push?: number;
  tilt?: { x?: number; y?: number; z?: number };
  move?: { from?: number; to?: number; easing?: (t: number) => number };
  shot?: ShotName;
}

/**
 * The two camera keyframes a DirectedShot renders with. Pure, so a readout or a test can ask where
 * the camera is at any frame (with resolveCamera) without mounting the component. A shot name
 * supplies the defaults; every explicit option wins over it.
 */
export const directedKeyframes = (o: DirectedKeyframeOptions): CamKeyframe[] => {
  const { W, H, captureWidth, captureHeight } = o;
  const centre = { x: captureWidth / 2, y: captureHeight / 2 };
  const focus = o.focus ?? centre;
  const plan = o.shot ? resolveShot(o.shot, { focus, push: o.push, captureWidth, captureHeight }) : null;

  const fit = Math.min(W / captureWidth, H / captureHeight);
  const startScale = fit * (plan ? plan.startScale : 1);
  const endScale = fit * (plan ? plan.endScale : (o.push ?? 1.4));
  const from = o.move?.from ?? 0;
  const to = Math.max(from + 1, o.move?.to ?? (plan ? from + plan.moveFrames : 90));
  const startAt = plan ? plan.startFocus : centre;
  const endAt = plan ? plan.endFocus : focus;

  return [
    {
      frame: from,
      x: clampCenter(startAt.x, W, startScale, captureWidth),
      y: clampCenter(startAt.y, H, startScale, captureHeight),
      scale: startScale,
      rotX: plan?.startTilt.x ?? 0,
      rotY: plan?.startTilt.y ?? 0,
      rotZ: plan?.startTilt.z ?? 0,
    },
    {
      frame: to,
      x: clampCenter(endAt.x, W, endScale, captureWidth),
      y: clampCenter(endAt.y, H, endScale, captureHeight),
      scale: endScale,
      rotX: o.tilt?.x ?? plan?.tilt.x ?? 0,
      rotY: o.tilt?.y ?? plan?.tilt.y ?? 0,
      rotZ: o.tilt?.z ?? plan?.tilt.z ?? 0,
      easing: o.move?.easing ?? plan?.easing,
    },
  ];
};

export const DirectedShot: React.FC<DirectedShotProps> = ({
  src,
  children,
  captureWidth = 1920,
  captureHeight = 1080,
  focus: focusProp,
  push,
  tilt,
  move,
  shot,
  depthOfField = 0,
  protect,
  rackTo,
  cursor,
  width,
  height,
  style,
}) => {
  const frame = useCurrentFrame();
  const video = useVideoConfig();
  const W = width ?? video.width;
  const H = height ?? video.height;
  const focus = focusProp ?? { x: captureWidth / 2, y: captureHeight / 2 };

  const keyframes = directedKeyframes({ W, H, captureWidth, captureHeight, focus, push, tilt, move, shot });
  const from = keyframes[0].frame;
  const to = keyframes[1].frame;

  // The sharp region starts on `focus` and, with rackTo, slides to it across the move.
  const cam = resolveCamera(keyframes, frame);
  const rack = rackTo ? tween(frame, [from, to], [0, 1], keyframes[1].easing ?? E.cinematic) : 0;
  const sharpAt = rackTo
    ? { x: focus.x + (rackTo.x - focus.x) * rack, y: focus.y + (rackTo.y - focus.y) * rack }
    : focus;
  const sharp = projectToScreen(cam, W, H, sharpAt.x, sharpAt.y);
  const mask = `radial-gradient(ellipse ${Math.round(W * 0.34)}px ${Math.round(H * 0.4)}px at ${Math.round(sharp.x)}px ${Math.round(sharp.y)}px, transparent 0%, transparent 55%, #000 100%)`;

  // Protected regions are holes in the blur layer. Each rect is projected corner by corner so the
  // hole follows the picture through the move and through a tilt.
  const holes = (protect ?? []).map((r) => {
    const corners = [
      projectToScreen(cam, W, H, r.x, r.y),
      projectToScreen(cam, W, H, r.x + r.width, r.y),
      projectToScreen(cam, W, H, r.x + r.width, r.y + r.height),
      projectToScreen(cam, W, H, r.x, r.y + r.height),
    ];
    return `M${corners.map((c) => `${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" L")} Z`;
  });
  const clip = holes.length ? `path(evenodd, "M0 0 H${W} V${H} H0 Z ${holes.join(" ")}")` : undefined;

  return (
    <div data-ovs-directed-shot="" style={{ position: "relative", width: W, height: H, overflow: "hidden", ...style }}>
      <CameraRig keyframes={keyframes} stageWidth={captureWidth} stageHeight={captureHeight} viewportWidth={W} viewportHeight={H}>
        {src ? (
          <Img src={src} style={{ position: "absolute", left: 0, top: 0, width: captureWidth, height: captureHeight }} />
        ) : (
          children
        )}
      </CameraRig>
      {depthOfField > 0 ? (
        <div
          data-ovs-dof=""
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backdropFilter: `blur(${depthOfField}px)`,
            WebkitBackdropFilter: `blur(${depthOfField}px)`,
            maskImage: mask,
            WebkitMaskImage: mask,
            clipPath: clip,
          }}
        />
      ) : null}
      {/* The cursor rides a second rig with the same keyframes, above the blur layer. The camera is
          a pure function of the frame, so it lands exactly where it would have inside the first rig,
          and depth of field can never smear the one thing the viewer is following. */}
      {cursor ? (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <CameraRig keyframes={keyframes} stageWidth={captureWidth} stageHeight={captureHeight} viewportWidth={W} viewportHeight={H}>
            <CursorActor path={cursor.path} clicks={cursor.clicks} />
          </CameraRig>
        </div>
      ) : null}
    </div>
  );
};

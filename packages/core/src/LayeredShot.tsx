// LayeredShot: a DirectedShot whose picture is a stack of separate layers instead of one flat image.
// When the capture side can split a page into a background plus the elements that float above it
// (a header bar, a card, a modal), each element keeps its own depth, so a push and a tilt make
// them slide against each other the way real objects at different distances do. At rest the stack
// composites to the same picture as the flat capture, so nothing looks different until it moves.
//
//   <LayeredShot
//     manifest={{ width: 1920, height: 1080, background: staticFile("images/bg.png"),
//                 layers: [{ src: staticFile("images/card.png"), x: 900, y: 300, width: 400, height: 250, depth: -0.5 }] }}
//     focus={{ x: 1100, y: 420 }}
//     shot="pushIn"
//   />

import React from "react";
import { Img } from "remotion";
import { Layer } from "./camera";
import { DirectedShot } from "./DirectedShot";
import type { DirectedShotProps } from "./DirectedShot";

/** One element of the capture, placed in capture pixels. depth > 0 is behind the focal plane, < 0 in front. */
export interface ShotLayer {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

/** The shape the capture side writes: the capture's size, the flat background and the layers over it. */
export interface LayerManifest {
  width: number;
  height: number;
  background: string;
  layers: ShotLayer[];
}

export interface LayeredShotProps extends Omit<DirectedShotProps, "src" | "children"> {
  /** The capture's layers. Alternatively give `background`, `layers` and the capture size separately. */
  manifest?: LayerManifest;
  background?: string;
  layers?: ShotLayer[];
  /** Depth of the background plane. Default 1: a notch behind the focal plane. */
  backgroundDepth?: number;
  /**
   * Blur per unit of depth, in px. Default 0: the layers are real UI, and blurring text to suggest
   * distance is how a product video ends up unreadable. Parallax already carries the depth.
   */
  maxBlur?: number;
}

export const LayeredShot: React.FC<LayeredShotProps> = ({
  manifest,
  background,
  layers,
  backgroundDepth = 1,
  maxBlur = 0,
  captureWidth,
  captureHeight,
  ...shot
}) => {
  const bg = manifest?.background ?? background;
  const stack = manifest?.layers ?? layers ?? [];
  const cw = manifest?.width ?? captureWidth ?? 1920;
  const ch = manifest?.height ?? captureHeight ?? 1080;
  return (
    <DirectedShot {...shot} captureWidth={cw} captureHeight={ch}>
      {bg ? (
        <Layer depth={backgroundDepth} maxBlur={maxBlur}>
          <Img src={bg} style={{ position: "absolute", left: 0, top: 0, width: cw, height: ch }} />
        </Layer>
      ) : null}
      {stack.map((l, i) => (
        <Layer key={i} depth={l.depth} maxBlur={maxBlur}>
          <Img src={l.src} style={{ position: "absolute", left: l.x, top: l.y, width: l.width, height: l.height }} />
        </Layer>
      ))}
    </DirectedShot>
  );
};

// Mandatory wrapper for every scene (STYLE.md): dark radial stage + camera rig + look pass.
// Content renders on an oversized stage; camera keyframes drive the shot.

import React from "react";
import { AbsoluteFill } from "remotion";
import { CameraRig, CamKeyframe } from "./camera";
import { LookPass } from "./look";
import { color } from "./tokens";

export const CinematicScene: React.FC<{
  camera: CamKeyframe[];
  stageWidth?: number;
  stageHeight?: number;
  /** dark (default) or light stage */
  variant?: "dark" | "light";
  grain?: number;
  vignette?: number;
  /** screen-space layer (captions, title cards, dips/fades), NOT camera-transformed */
  overlay?: React.ReactNode;
  children: React.ReactNode;
}> = ({
  camera,
  stageWidth = 1920,
  stageHeight = 1080,
  variant = "dark",
  grain = 0.05,
  vignette = 0.32,
  overlay,
  children,
}) => {
  const bg =
    variant === "dark"
      ? `radial-gradient(ellipse 90% 80% at 50% 40%, ${color.bg1} 0%, ${color.bg0} 100%)`
      : color.lightBg;
  return (
    <AbsoluteFill style={{ background: bg }}>
      <CameraRig
        keyframes={camera}
        stageWidth={stageWidth}
        stageHeight={stageHeight}
      >
        {children}
      </CameraRig>
      {overlay ? (
        <div style={{ position: "absolute", inset: 0 }}>{overlay}</div>
      ) : null}
      <LookPass
        grain={grain}
        vignette={variant === "light" ? vignette * 0.5 : vignette}
      />
    </AbsoluteFill>
  );
};

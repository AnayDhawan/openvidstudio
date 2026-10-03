// A fixed, representative composition preflight's render benchmark times: real camera
// motion (CinematicScene's grain/vignette/grade plus a push-in/drift keyframe pair) over a
// real DOM-rendered panel (ChecklistPanel), the same shape as a normal scaffolded scene.
// Registered once by init_project into src/videos/.registry.json under videoName
// "__preflight__", which stitch_composition's registry filter (by real videoName) never
// touches, so this survives every re-stitch of every real video in the project.
//
// Never hand-edit this file's registration out of Root.tsx: stitch_composition
// regenerates Root.tsx from the registry on every call, so an edit there is lost on the
// next stitch of any video. Change the registry entry (see initProject.ts) instead.

import React from "react";
import { CinematicScene, Layer, ChecklistPanel, E } from "@openvidstudio/core";

export const PreflightBenchmark: React.FC = () => {
  return (
    <CinematicScene
      camera={[
        { frame: 0, x: 960, y: 540, scale: 1.04, rotZ: -0.4 },
        { frame: 150, x: 960, y: 548, scale: 1.18, rotZ: 0.4, easing: E.drift },
      ]}
    >
      <Layer depth={0}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 180px",
          }}
        >
          <ChecklistPanel
            title="Preflight benchmark"
            width={860}
            fontSize={27}
            items={[
              { label: "Camera motion", flipAt: 20 },
              { label: "Grain and vignette", flipAt: 50 },
              { label: "DOM text reveal", flipAt: 80 },
              { label: "A real frame, timed", flipAt: 110 },
            ]}
          />
        </div>
      </Layer>
    </CinematicScene>
  );
};

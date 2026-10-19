// Scene for beat "start-demo", scaffolded by scaffold_scene in "starter" mode: no
// layout imposed. Compose this beat from @openvidstudio/core's primitive library
// (see docs/API.md) against this video's own design.ts (none written yet -- see design.ts's own header in `@openvidstudio/core`'s DesignSystem type), not a fixed template shape.
//
// VO: "Narration for start demo."
// Visual direction: The start-demo beat

import React from "react";
import { CinematicScene, Layer, E } from "@openvidstudio/core";

export const StartDemo: React.FC = () => {
  return (
    <CinematicScene
      camera={[
        { frame: 0, x: 960, y: 540, scale: 1.04, rotZ: -0.4 },
        { frame: 90, x: 960, y: 548, scale: 1.15, rotZ: 0.35, easing: E.drift },
      ]}
    >
      <Layer depth={0}>
        {/* Build this beat's shot here. Motion never stops (STYLE.md): keep or extend
            the camera push above, don't freeze it. */}
        <div />
      </Layer>
    </CinematicScene>
  );
};

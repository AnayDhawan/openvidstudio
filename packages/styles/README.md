# @openvidstudio/styles

A pixel narrator, a depth-feel background kit and vertical 720x1280 layout helpers for canvas explainers in
[openvidstudio](https://github.com/AnayDhawan/openvidstudio). Plain TypeScript that draws to a 2D canvas context: no
React, no WebGL, no dependencies.

- Sprites: palette-indexed string grids drawn with integer-scale `fillRect`, smoothing off (`drawSprite`).
- One recurring narrator with `idle`, `talk`, `point`, `think` and `celebrate` poses, and a prop set (ball, ruler,
  battery, cable, bridge, bat) that a lesson extends with `registerProp`.
- Depth: `Parallax` (three to five layers, far ones pre-blurred), a perspective floor grid, depth fog, a camera
  `dolly`, drop shadows.
- Accent tokens per subject, a 5x7 bitmap pixel font, and a chip-style sound palette as plain data.
- Vertical layout: `safeArea`, `fitText` (never below the role minimum: headline 44, label 28, key number 64) and a
  caption band. Reframe-by-cropping is deliberately not offered.

Everything is a pure function of `t`; randomness is a seeded generator (`createRng`), never the platform's.

```ts
import { Parallax, drawNarrator, drawFloorGrid, safeArea, ACCENTS } from "@openvidstudio/styles";

const par = new Parallax({ width: 720, height: 1280, seed: 1, accent: ACCENTS.physics });
function frame(ctx: CanvasRenderingContext2D, t: number) {
  par.draw(ctx, t);
  drawNarrator(ctx, "talk", 280, 700, 8, t, ACCENTS.physics);
}
```

The package ships TypeScript source (`main` is `src/index.ts`), so bundle it with your explainer. Every function has a
rendered still in
[API.md](https://github.com/AnayDhawan/openvidstudio/blob/main/packages/docs/API.md#pixel-narrator-and-depth-kit-openvidstudiostyles).

Apache-2.0. The pixel font drawn by `drawPixelText` is written for this package. `PIXEL_FONT` only names Press Start 2P
(SIL Open Font License 1.1) for lessons that load it themselves.

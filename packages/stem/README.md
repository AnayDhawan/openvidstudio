# @openvidstudio/stem

Supernova mode: the Void + Spark design system and the primitives for short STEM lessons in
[openvidstudio](https://github.com/AnayDhawan/openvidstudio).

- `Spark` and `Nova`: a glowing point that draws, carries and points, and the payoff on the aha.
- `Axes`, `Plot`, `NumberLine`: graphs with tangents, shaded area and marked points.
- `Equation`: sans-serif maths that appears term by term, with a required spoken form.
- `FreeBody` and `ArrayViz`: force arrows with exact lengths, and cells with pointers.
- `supernovaDesignSystem(subject)`: a flat dark Void with one accent per subject.

You do not normally install this on its own. `init_project` with `mode: "supernova"` in
[`@openvidstudio/mcp-server`](https://www.npmjs.com/package/@openvidstudio/mcp-server) copies it into
the lesson project. The process is in
[SUPERNOVA.md](https://github.com/AnayDhawan/openvidstudio/blob/main/packages/docs/SUPERNOVA.md), and
every primitive has a rendered still in
[API.md](https://github.com/AnayDhawan/openvidstudio/blob/main/packages/docs/API.md).

Peer dependencies: `@openvidstudio/core`, `remotion`, `react` and `react-dom`. The package ships
TypeScript source, so it is meant to be bundled by Remotion.

Apache-2.0. The Space Grotesk font is SIL OFL (its license is in `public/fonts/`). Equations use MathJax 4
with its Fira maths font, copied into a lesson project by `init_project`. Remotion has its own license:
https://www.remotion.pro/license

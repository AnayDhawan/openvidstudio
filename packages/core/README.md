# @openvidstudio/core

The scene components every openvidstudio video project is built from: the camera rig and the shot
moves (`DirectedShot`, `LayeredShot`), transitions, motion helpers, sound, the look pass, panels and
kinetic text.

You do not normally install this on its own. The `init_project` tool in
[`@openvidstudio/mcp-server`](https://www.npmjs.com/package/@openvidstudio/mcp-server) copies it into
the project as `openvidstudio-core`.

Every primitive, with a rendered still, is in
[API.md](https://github.com/AnayDhawan/openvidstudio/blob/main/packages/docs/API.md).

The package ships TypeScript source (`main` is `src/index.ts`), so it is meant to be bundled by
Remotion, not imported from plain Node.

Apache-2.0. Remotion has its own license: https://www.remotion.pro/license

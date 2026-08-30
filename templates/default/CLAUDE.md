# CLAUDE.md: this project's video pipeline

This project was scaffolded with openvidstudio: a Remotion + Playwright
video-generation add-on driven via MCP tools. If you're an AI coding agent
about to build a video for this project, read `PLANNING.md` first. That's
step 0, before you touch `beats.json` or write a single scene.

## Docs

These ship in the `@openvidstudio/docs` package and resolve at
`node_modules/@openvidstudio/docs/` once that package is a dependency of
this project (same shape as `@openvidstudio/core`, which already is one).
If that path doesn't resolve in your setup, ask the dev where the docs
package is installed rather than guessing.

- `node_modules/@openvidstudio/docs/PLANNING.md`: start here. Guided
  intake to beats.json protocol, capture-method decision tree, the
  mandatory approval gate.
- `node_modules/@openvidstudio/docs/PIPELINE.md`: beats.json, scenes,
  composition, QC loop.
- `node_modules/@openvidstudio/docs/STYLE.md`: binding art-direction
  rules.
- `node_modules/@openvidstudio/docs/CAPTURE.md`: real-screenshot protocol.
- `node_modules/@openvidstudio/docs/SCRIPT.md`: VO pacing and writing
  rules.
- `node_modules/@openvidstudio/docs/OVERVIEW.md`: conceptual overview;
  read this if you're unsure why any of the rules below exist.
- `node_modules/@openvidstudio/docs/HIGGSFIELD.md`: AI b-roll tier
  protocol (not written yet).

## Rules a scene-writing agent must never violate

These are QC-fail rules, not defaults, pulled from `STYLE.md` and
`PIPELINE.md` and restated here because they're the ones most likely to get
silently broken while writing a scene:

- **No linear easing, ever.** Use the eased/spring presets
  `@openvidstudio/core` exports from its motion helpers. A static,
  non-eased move fails QC.
- **Every scene wrapped in `CinematicScene`.** No screen ever renders
  outside it (grain, vignette, and grade are always on).
- **Motion never stops.** Every shot needs at least a subtle push-in. A
  frozen frame is a QC fail.
- **No em dashes**, on screen or in VO, anywhere.

## Components

Reach for `@openvidstudio/core`'s components before building anything new:
`CinematicScene`, `CameraRig`/`Layer`, `BrowserFrame`, `TerminalReplay`,
`CodePanel`, `ChecklistPanel`, `CursorActor`, `RepoCta`,
`TitleSlam`/`Caption`. Only build a new component when a beat truly needs
one, then keep it generic: it's a candidate for `@openvidstudio/core`
itself, not just this project.

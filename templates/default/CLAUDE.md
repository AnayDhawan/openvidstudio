# CLAUDE.md: this project's video pipeline

This project was scaffolded with openvidstudio: a Remotion + Playwright
video-generation add-on driven via MCP tools. If you're an AI coding agent
about to build a video for this project, read `PLANNING.md` first. That's
step 0, before you touch `beats.json` or write a single scene.

## Docs

`init_project` copies these into this project's own `docs/` directory
when it scaffolds the project shell (it never overwrites a file you've
already edited, so a second `init_project` call for a second video won't
clobber local edits here). If a doc listed below is missing, re-run
`init_project` rather than guessing where it lives.

- `./docs/PLANNING.md`: start here. Guided intake to beats.json protocol,
  capture-method decision tree, the mandatory approval gate.
- `./docs/PIPELINE.md`: beats.json, scenes, composition, QC loop.
- `./docs/STYLE.md`: binding art-direction rules.
- `./docs/CAPTURE.md`: real-screenshot protocol.
- `./docs/SCRIPT.md`: VO pacing and writing rules.
- `./docs/OVERVIEW.md`: conceptual overview; read this if you're unsure
  why any of the rules below exist.
- `./docs/HIGGSFIELD.md`: AI b-roll tier protocol.
- `./docs/API.md`: every prop of every `@openvidstudio/core` component. Read
  this instead of opening the library source.
- `./docs/NARRATION.md`: voice, music and sound effects, and why generated
  voiceover usually sounds synthetic.

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

## Before you hand-write a scene

`scaffold_scene` emits a scene that renders, using that beat's own copy and
duration. Start from it and edit the content rather than composing a scene
from primitives: it already has correct camera keyframes, a safe content
width, and the right shape for the beat's capture method.

Then run `validate_scenes`. The commonest mistake in this pipeline is
invisible: content laid out at full stage width gets cropped once the camera
pushes in, and the render does not warn.

## Components

Reach for `@openvidstudio/core`'s components before building anything new:
`CinematicScene`, `CameraRig`/`Layer`, `BrowserFrame`, `TerminalReplay`,
`CodePanel`, `ChecklistPanel`, `CursorActor`, `RepoCta`,
`TitleSlam`/`Caption`. Only build a new component when a beat truly needs
one, then keep it generic: it's a candidate for `@openvidstudio/core`
itself, not just this project.

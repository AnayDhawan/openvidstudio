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
- `./docs/CREATIVE.md`: how to make the video good: the story, the hook, a
  motif from the brand, on-screen copy, pacing to music, camera, and the
  review rubric. Read it before writing a brief at peak or mid level.
- `./docs/TOOLS.md`: every MCP tool with a one-line purpose, generated from
  the server's own registry.

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

## Before you write a scene: read the brief first

Read `src/videos/<name>/brief.json` (and `brief.md`) before writing a single
scene. It names the creative level this video is being made at, and that
decides how you get to a scene file:

- **peak and mid: author scenes.** Compose from `@openvidstudio/core`'s
  primitive library (`Words`, `PixelLogo`, `DotText`, `ChapterHud`,
  `Window`, and the rest -- see `./docs/API.md`) against the video's
  own `src/videos/<name>/design.ts` (its `DesignSystem`: palette roles,
  type scale, motif, motion personality). `scaffold_scene` with `mode:
  "starter"` gives you a scene file already wired to that design system
  and the beat's real facts, with no layout imposed, as a faster starting
  point than a blank file; `mode: "blank"` registers the beat for
  `stitch_composition` without writing anything, if you'd rather start
  from nothing. Either way, the structure, pacing and composition are
  your creative decisions, not a template's.
- **literal, or a tight time budget: `scaffold_scene` with `mode:
  "template"` (the default)** is the fast path: a scene that renders
  immediately, using that beat's own copy and duration, with correct
  camera keyframes and a safe content width already handled. Start from
  it and edit the content. This is a shortcut for when the brief calls
  for exactly what's specified and nothing more, not the default way to
  build a scene at every level.

Whichever path, every scene still has to pass `STYLE.md`'s hard rules (no
linear easing, `CinematicScene` always, motion never stops, no em dashes)
and claim-obligates-visual (`SCRIPT.md`).

Review before any full render, at every level. `render_stills` with
`perBeat: "review"` writes five frames per beat and one labelled contact
grid, and returns numeric findings (cropping, text size, reading time,
contrast, em dashes, safe area, HUD overlap, dead frames) so an agent that
cannot view images can still review. Look, fix, and render again with the
next `round`, until the rubric in `CREATIVE.md` passes. Numbers shown on
screen come from `facts.json` or a capture, never from memory.

Then run `validate_scenes`. It reads the scene source statically: camera
scale against the content widths declared in the file, a camera that
never moves, missing capture assets, a settle-sidecar timeout, leftover
TODOs, a beat with no narration file. The commonest mistake in this
pipeline is invisible otherwise: content laid out at full stage width
gets cropped once the camera pushes in, and a plain render does not
warn. A static read can still miss a real-render-only problem (the
validator's own source says so plainly); render a still and look
whenever a scene's framing is at all in doubt.

## Components

Reach for `@openvidstudio/core`'s components before building anything new:
`CinematicScene`, `CameraRig`/`Layer`, `BrowserFrame`, `TerminalReplay`,
`CodePanel`, `ChecklistPanel`, `CursorActor`, `RepoCta`,
`TitleSlam`/`Caption`. Only build a new component when a beat truly needs
one, then keep it generic: it's a candidate for `@openvidstudio/core`
itself, not just this project.

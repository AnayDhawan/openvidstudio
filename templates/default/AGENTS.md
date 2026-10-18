# AGENTS.md: this project's video pipeline

This project was scaffolded with openvidstudio: a Remotion + Playwright
video-generation add-on driven via MCP tools. If you're an AI coding agent
about to build a video for this project, read `./docs/PLANNING.md` first.
That's step 0, before you touch `beats.json` or write a single scene. This
file is a short pointer for agents that look for `AGENTS.md` specifically;
`CLAUDE.md` in this same directory covers the identical ground in more
detail and is kept in sync with this file by hand.

## The order

```
preflight -> plan_production -> extract_brand -> write_brief -> plan_beats -> [write VO]
  -> validate_beats -> APPROVAL GATE -> write_beats_file -> captures -> [compose_score]
  -> scenes -> render_stills -> validate_scenes -> stitch_composition -> render_video
  -> finalize_video -> qc_extract_frames
```

`./docs/CREATIVE.md` is the craft: read it before writing a brief at peak or mid level.
`./docs/TOOLS.md` lists every tool. Review with `render_stills` (`perBeat: "review"`) before
any full render, at every level: it returns a contact grid and numeric findings.

## Before you write a scene: read the brief first

Read `src/videos/<name>/brief.json` before writing a single scene. It names
the creative level this video is being made at:

- **peak and mid: author scenes.** Compose from `@openvidstudio/core`'s
  primitive library against the video's own `src/videos/<name>/design.ts`.
  `scaffold_scene` with `mode: "starter"` gives a scene file wired to that
  design system with no layout imposed; `mode: "blank"` registers the beat
  and leaves the file to you. The structure and pacing are your creative
  decisions, not a template's.
- **literal, or a tight time budget: `scaffold_scene` with `mode:
  "template"` (the default).** A scene that renders immediately, using
  that beat's own copy and duration. This is a shortcut, not the default
  way to build a scene at every level.

Every scene still has to pass `./docs/STYLE.md`'s hard rules (no linear
easing, `CinematicScene` always, motion never stops, no em dashes) and
claim-obligates-visual (`./docs/SCRIPT.md`). Then run `validate_scenes`:
a static read of the scene source for camera-scale cropping, a camera
that never moves, missing capture assets, a settle-sidecar timeout,
leftover TODOs, a beat with no narration file. A static read can still
miss a real-render-only problem, so render a still and look whenever a
scene's framing is in doubt.

## Docs

`./docs/PLANNING.md`, `PIPELINE.md`, `STYLE.md`, `CAPTURE.md`, `SCRIPT.md`,
`OVERVIEW.md`, `HIGGSFIELD.md`, `API.md`, `NARRATION.md`. `init_project`
copies these in and never overwrites a file you've already edited.

## Rules that fail QC

- **No linear easing, ever.** Use `@openvidstudio/core`'s eased/spring
  presets.
- **Every scene wrapped in `CinematicScene`.**
- **Motion never stops.** A frozen frame fails.
- **No em dashes**, on screen or in VO, anywhere.

---
name: openvidstudio
description: Use when the user wants a demo video, launch video, screencast or product walkthrough for a software project, or says "make a demo video", "record a demo", "video for my repo", "show my project", or mentions openvidstudio. Drives the openvidstudio MCP server to capture a real running app and render a cinematic demo video. Not for editing existing footage.
---

# openvidstudio

Build a demo video from a project's real running app. Every screen comes off the
actual product; nothing is generated.

## Before anything

Run `preflight`. It checks node, ffmpeg, Playwright's Chromium, whether the app is
actually responding, and whether a narration engine exists. Each failure names the
fix. Skipping this means a missing dependency surfaces after a long render.

If the tools are not registered, the server is not installed. Point the user at this in their MCP config, then a client restart:

```json
{ "mcpServers": { "openvidstudio": { "command": "npx", "args": ["-y", "@openvidstudio/mcp-server"] } } }
```

## The order

```
preflight -> extract_brand -> plan_beats -> [write VO] -> validate_beats -> APPROVAL GATE
  -> write_beats_file -> capture_screenshot -> scaffold_scene -> validate_scenes
  -> [plan_sound_effects] -> generate_narration -> stitch_composition -> contact_sheet
  -> render_video -> qc_extract_frames
```

## 1. Intake

**Work it out before you ask.** The usual request is "make a demo video of this
project" and nothing else. That is the whole brief, and it is enough.

Start by reading the repo rather than interviewing the user:

- `README.md` says what the product is and often what matters about it
- `package.json` scripts say how to start it, and the dev script usually names the port
- the routes or pages say what there is to film

Then start the app yourself and confirm it responds. Do not ask the user for a URL
they have to look up; find the dev command, run it, and check it. Ask only if starting
it needs something you cannot know, like a missing `.env` or a database that is not up.

What is genuinely worth asking, because the repo cannot tell you:

- how long the video should be
- which two or three things it should show, if the repo has many
- who it is for, a landing page visitor or someone already installing

**One question at a time, and only questions the repo cannot answer.** A wall of six
questions at the start is the fastest way to make this feel like work. `docs/PLANNING.md`
has the full decision tree if a case is unclear.

End the job by showing the result: the mp4 path, its length, and a `contact_sheet` or a
few `qc_extract_frames` stills. A render nobody looks at is not a delivered video.

## 1b. Wear the repo's brand

`extract_brand` with `sourceRepo` set to the repo being filmed. It reads Tailwind v4
`@theme` blocks and `:root` custom properties, picks fonts out of `next/font` imports,
copies the best logo it finds, and writes `src/brand.ts`.

Run it **before** `scaffold_scene`. A video themed after the fact means re-scaffolding.

Check the `unresolved` list it returns and fill in anything that matters by hand. It
reports only what it can actually find rather than inventing a plausible colour, so an
unresolved token is a real gap, not a failure.

One rule this imposes on hand-written scenes: read tokens inside the component, not at
module scope. `applyBrand` mutates the shared token objects, so `const MONO =
\`"${font.mono}"\`` at the top of a file captures the default and never sees the brand.
Use `monoStack()` and `uiStack()` instead.

## 2. Plan the beats

`plan_beats` with the target duration and the features. It returns a contiguous
skeleton with a capture method and a **word budget per beat**.

Write the narration to that budget. `validate_beats` enforces 2.3 to 2.9 words per
second as a hard floor *and* ceiling per beat, so a line can be rejected for being
too sparse. Writing to the stated number avoids the round trip.

Every `screenshot` beat also needs `visual.url` and `visual.interactions` (an array,
possibly empty). No other doc states this up front.

## 3. The approval gate

**Show the user the full beats file, not a summary, and wait for an explicit yes.**
Nothing goes to disk before that. This is a protocol rule, not a suggestion, and it
is the point where a wrong video costs a sentence instead of an hour.

Then `write_beats_file`.

## 4. Capture

`capture_screenshot` per screenshot beat. It compensates for a per-origin Chrome
zoom desync that otherwise produces small, soft or misframed captures.

Pass a `wait` interaction if the page has entrance animations, or the shot catches
them mid-flight and looks broken rather than obviously wrong.

## 5. Scenes

`scaffold_scene` per beat. It emits a scene that **renders as-is**, using that beat's
own copy and duration. Edit the content; do not rebuild the structure.

Then `validate_scenes`. It catches the failure that renders successfully and is
simply wrong: content laid out at full stage width gets cropped once the camera
pushes in, because the visible area is the stage divided by the camera scale. It also
flags static cameras, missing assets and beats with no narration.

Read `docs/API.md` for props. Do not read the library source.

## 6. Narration

`generate_narration`. It writes one clip per beat where `stitch_composition` looks,
and clamps time-stretching to a range that stays natural rather than fitting clips to
beats at any cost. When it says a beat does not fit, fix the script or the beat
duration; do not stretch further.

## 6b. Sound, only if the built-ins do not cover it

The synthesized pack already ships clicks, keystrokes, a bell, a blip, a success tone,
a whoosh and a music bed, and it carries no third-party rights because ffmpeg generates
it. Prefer it.

If the video genuinely needs something else, **ask the user what sounds they want**, then
`plan_sound_effects` with one entry per sound. It tells you which requests the built-ins
already cover and returns a Pixabay search link plus an exact save path for the rest.

It does not download from Pixabay, and neither should you. Pixabay's terms prohibit
automated collection and say the API is for real human requests, and they publish no
sound-effects endpoint. The user downloads; you verify. Call the tool again with
`verify: true` afterwards to confirm each file is real audio and normalize the formats.

`provider: "freesound"` fetches automatically instead, but only with the user's own API
token, and every clip it takes is recorded in `ATTRIBUTION.md`. Anything in that file has
to reach the video description or the licence is breached.

## 7. Assemble and check

`stitch_composition`, then `contact_sheet` before rendering. The contact sheet is two
frames per beat in one image and takes a fraction of a full render, which matters
because a five minute video is 9000 frames.

`render_video` with `draft: true` first. Full quality only once the draft looks
right.

Then `qc_extract_frames` and work `docs/PIPELINE.md`'s checklist.

## Rules that fail QC

From `docs/STYLE.md`, restated because they are the ones most often broken:

- **No linear easing.** Use the `E.*` presets.
- **Every scene inside `CinematicScene`.**
- **Motion never stops.** A static frame is a fail.
- **No em dashes**, on screen or in narration.
- **Captions go in `overlay`**, not `children`, or they drift off screen as the
  camera moves.
- **Screenshots only inside `BrowserFrame`.** Recordings and AI clips must not be,
  or generated footage acquires the visual signature of a real capture.

## What not to claim

Real product UI, whether DOM-rendered, screenshotted or recorded, is ground truth. AI
generated clips are atmosphere only and never carry product text. If narration
asserts something, the visual has to show it; if it cannot, rewrite the line.

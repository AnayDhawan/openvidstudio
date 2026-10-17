---
name: openvidstudio-director
description: Use when making a peak or mid creative-level launch video, promo, trailer or "make it look great" demo with openvidstudio, where the video should be directed (a story, a designed look, an original score, hand-built scenes) rather than assembled from templates. Covers the whole process from intake to the final description file. Use the plain openvidstudio skill for literal, exactly-as-specified videos.
---

# openvidstudio-director

The process for a directed video. Procedural on purpose: each step says what to do, which tool
does the mechanical part, and what "done" means. The craft behind the steps is in
`docs/CREATIVE.md`; read it before step 4 and again before step 9.

Every number and claim in the video comes from a real capture or a real tool result. If the
product cannot show something, build a labelled sample, film it for real, and disclose it.

## 1. Intake: level and budget

- Ask for the creative level (peak: full creative liberty, bespoke everything; mid: strong
  defaults, mostly authored scenes; literal: exactly what was specified) and a time budget.
  Use elicitation if the client has it, otherwise ask.
- `plan_production` with both and the target length. Show the plan and its time estimate at the
  approval gate. If `fitsBudget` is false, show `cutFirst` and let the user choose.
- Done when: level, budget and a measured time estimate are agreed.

## 2. Read the repo before asking anything

- README, changelog, recent commit subjects, issue titles, the product's real outputs, the dev
  command. Start the app and confirm it responds.
- Ask only what the repo cannot tell you: length, the two or three things to show, the audience.
- `preflight` once. Done when it passes.

## 3. Brand

- `extract_brand` with `sourceRepo` set to the repo. Fill in anything it lists as unresolved.
- Done when `src/brand.ts` exists and its colours show in a rendered frame (step 9 checks this).

## 4. The brief

- Find the story (`CREATIVE.md` §1). Write the logline, audience, the one feeling, the story
  device and why it fits, the arc (hook, tension, turn, proof, payoff, call to action), the
  design rationale (palette roles, motif and where it appears, type pair, motion personality),
  the music plan (bpm, key, section map, impact points), and a shot list marking each shot real
  or constructed with its focal point.
- `write_brief` with the prose and the JSON. It validates shape and refuses em dashes.
- Done when the brief is written. **Show the user the whole brief and get an explicit yes first.**

## 5. Beats and the approval gate

- `plan_beats`, with `snapToBars` and the score's bpm when the video is cut to music.
- Write narration to each beat's word budget. `validate_beats`.
- **Show the full beats file and wait for an explicit yes.** Then `write_beats_file`.
- Done when `beats.json` is on disk.

## 6. Captures and facts

- A capture tool per beat: `capture_screenshot`, `capture_screen_recording`, `capture_terminal`,
  `capture_desktop` or `capture_mobile`. Add a `wait` interaction for entrance animations.
- Run the product's own commands and tools for real outputs, then `collect_facts` to merge every
  tool result into `src/videos/<name>/facts.json`. Scenes import facts instead of retyping.
- Done when every beat that needs a capture has one and `facts.json` exists.

## 7. Design system

- Write `src/videos/<name>/design.ts` with `defineDesignSystem`, from the brief. Components and
  validators read it. Brand tokens seed it; they do not dictate it.
- Done when scenes can import it and nothing needs a hard-coded colour.

## 8. Score

- `compose_score` with `mode: "bed"` for narrated video or `"music"` for music-only. It writes
  the track, a cues file exact by construction, and a spectrogram, and reports band balance,
  clicks and per-section loudness in numbers. Read them; you cannot listen.
- Or use a bed through `find_music_bed` and `import_music_bed`, then `plan_music_cues`.
- Done when the checks are clean and cues exist.

## 9. Scenes and the review loop

- Author scenes in `scenes/` from `@openvidstudio/core`'s primitives and `design.ts`, using
  `useMusicClock(beatId)` to land hits on the score and `DirectedShot` for captures. Start from
  `scaffold_scene` with `mode: "starter"` or `"blank"`. Write your own component when the motif
  needs one. Mid level may use a template for a beat that does not need more.
- Loop, until the rubric in `CREATIVE.md` §9 passes:
  1. `render_stills` with `perBeat: "review"` and the next `round`.
  2. Look at the contact grid. Read the numeric findings that came with it.
  3. Fix the worst problem. Repeat.
- Done when a round has no errors and each rubric question has a yes.

## 10. Gates

- `validate_scenes` with `render: true`: cropping, text size, reading time, contrast, em dashes,
  safe area, HUD overlap, dead frames, palette. Errors block the render. Warnings need a decision.
- `validate_beats` again if the beats changed. `generate_narration` if the video has a voice.
- `stitch_composition`. Done when every gate is green or consciously waived.

## 11. Render and assemble

- `render_video` with `draft: true`, then full quality. It runs async; poll `job_status`.
- `finalize_video`: loudness to -14 LUFS with a -1.5 dBTP ceiling, a poster frame, a size-capped
  share copy, and `output/<name>-DESCRIPTION.md`.
- `qc_extract_frames`, and work `docs/PIPELINE.md`'s checklist.

## 12. Hand over

- Show the user the mp4 path, its length, the poster, and a contact grid.
- Point at the description file. Say which shots are constructed, and what in it needs a human
  decision (a credit, a link). A render nobody looked at is not a delivered video.

## Rules that never relax

- No em dashes, on screen or in narration. No linear easing. Every scene inside
  `CinematicScene`. Motion never stops.
- Nothing is written to disk or rendered before the user approves the brief and the beats.
- Never invent a feature, number or quote. A missing shot beats a made-up one.

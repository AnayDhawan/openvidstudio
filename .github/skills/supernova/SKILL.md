---
name: supernova
description: Use when making a short animated STEM lesson video (a maths, physics or computer science concept explained in 60 to 90 seconds, vertical, narrated) with openvidstudio, or when the user says "Supernova", "lesson video", "explain this concept as a reel" or "teaching video". Script first: a concept card, an approved lesson script, then voice, scenes, review and finalize. Not for product demos (use openvidstudio or openvidstudio-director).
---

# supernova

How to make a lesson video, in order. A lesson is one concept in 60 to 90 seconds at 1080x1920, narrated and
captioned. **The script is the product; the visuals illustrate it.** Read `docs/SUPERNOVA.md` (the design
system, the primitives, the voice) and `docs/SCRIPT.md` (the lesson script rules) before step 3.

Everything in a lesson is constructed on purpose, so nothing here is footage and nothing is captured. The
numbers on screen come from the concept card's worked example or from an equation, never from memory.

## 1. Set up

- `init_project` with `mode: "supernova"` (and the lesson's `name`). It stores `production.mode`, makes the
  frame 1080x1920, and installs `@openvidstudio/stem` with its fonts and the maths renderer.
- `preflight` once. Done when it passes.
- `plan_production` with a time budget (a lesson has no creative level; it is never asked for one). Show the plan.

## 2. The concept card

Write `src/videos/<name>/concept.json` (template and a worked example in `docs/SUPERNOVA.md`): `goal` (what the viewer can
do afterwards: "tell why a derivative is a slope"), `terms` (the two or three that need defining) and `example`
(the one worked example the lesson keeps returning to, with its real numbers).

Also decide the subject (`math`, `physics`, `cs`, `chemistry`, `biology`: it sets the accent) and the syllabus
code it maps to. A big topic is a series ("Part 2 of 4") and each part ends on the next question.

## 3. The lesson script

Draft the narration beat by beat to the rules in `SCRIPT.md`: a hook in the first sentence (a question or a
surprising fact, never "in this video"), intuition and a concrete example before any formula, every term defined
at first use with at most two new terms a beat, one idea per beat, sentences of about 14 words or fewer, maths
written as it is spoken, a one-line recap and then a check question at the end.

- `plan_beats` for the word budget per beat. Scenes are sized to the sentence, not the other way round.
- `validate_beats` (pace is 2.3 to 2.9 words per second) and `check_script` (pass the draft as `beatsJson` and the
  card as `conceptCard`). Fix every error and read every warning.
- **Show the user the whole script and get an explicit yes before any scene is built.** Then `write_beats_file`.

## 4. Voice

- `generate_narration` with the fixed lesson voice from `SUPERNOVA.md` (edge-tts). It also writes word timings
  for each beat, so a scene can point at the word being said. Do not change the voice between lessons.
- If a beat does not fit, shorten the line or lengthen the beat. Do not stretch it: the clamp is 0.9 to 1.12.
- Done when every beat has a clip and the result reports no overruns.

## 5. Scenes

- `scaffold_scene` in `"starter"` mode per beat, or write the file by hand. Build each one from
  `@openvidstudio/stem` (`Spark`, `Nova`, `Axes`, `Plot`, `NumberLine`, `Equation`, `FreeBody`, `ArrayViz`) against
  the video's `design.ts`: `export const design = supernovaDesignSystem("<subject>")`.
- One idea on screen at a time, at most two things moving, **one glowing element at a time**. The Nova is used once,
  on the aha sentence. Every `Equation` carries a `spoken` string that appears in its beat's narration.
- Keep key content inside the Reels safe zones (`SUPERNOVA.md`). Sizes come from `useVideoConfig()`.
- `compose_score` with `percussion: "none"` for a quiet pad under the voice. `stitch_composition`.

## 6. Review

- `check_script` again, now that the scenes exist: it compares each `Equation`'s `spoken` string with the narration.
- `validate_scenes` with `render: true`: crop, text size, contrast, the glow budget, numbers.
- `render_stills` and `contact_sheet`: look at the frames. Then `render_video` with `draft: true`, and **listen**.
- Done when there are no errors, the Nova lands on the aha sentence, and every beat sounds like one person.

## 7. Finalize

- `render_video`, then `finalize_video` (it must report no `audio-tick`).
- `write_brief` with `mode: "supernova"` if you want one, then `write_description`: it says in one line that the
  video is a constructed explanation, not footage.
- Done when the final file and the description are in `output/`.

---
name: supernova
description: Use when making a short animated STEM lesson video (a maths, physics or computer science concept explained in up to two minutes, vertical, narrated) with openvidstudio, or when the user says "Supernova", "lesson video", "explain this concept as a reel" or "teaching video". Script first, always the same seven-beat arc: a concept card, a derived-and-verified script, then voice, scenes, review and finalize. Not for product demos (use openvidstudio or openvidstudio-director).
---

# supernova

How to make a lesson video, in order. A lesson is **one concept in up to two minutes** at 1080x1920, narrated and
captioned, and every lesson has the same shape. **The script is the product; the visuals illustrate it.** Read
`docs/SUPERNOVA.md` (design system, primitives, voice, captions) and `docs/SCRIPT.md` (the arc and the rules) before step 3.

Everything in a lesson is constructed on purpose, so nothing here is footage and nothing is captured. The numbers
on screen are computed by code from the concept card's worked example, never typed from memory.

## The arc (constant)

Hook, picture, set up, derive, use it, aha, close. In that order, every lesson. Times for 120 s are in SCRIPT.md.

1. **Hook**: a beginner's question or a surprising fact in sentence one. Then say where the lesson sits (the card's `referenceSpoken`: a chapter code or "Part 2 of 4").
2. **Picture**: the diagram starts here, before any formula, inside the first 15 s. Everyday words; define each term at first use.
3. **Set up**: symbols, units, assumptions, drawn on the diagram.
4. **Derive**: the formula built line by line with one `Derivation`: a step per line, each with its `spoken` form and a `because`, each step justified.
5. **Use it**: one worked example with the real numbers and units.
6. **Aha**: the result that generalises or surprises, and where it stops being true.
7. **Close**: one-line recap, then the check question. End on the question; hold the last frame.

## 1. Set up

- `init_project` with `mode: "supernova"` (and the lesson's `name`). It stores `production.mode`, makes the frame
  1080x1920, and installs `@openvidstudio/stem` with its fonts and the maths renderer.
- `preflight` once. Its `edge-tts` check speaks one word, so a refused connection (7.2.8 gets a 403) shows up here with the fix, `pip install -U edge-tts`.
- `plan_production` with a time budget (a lesson has no creative level). Show the plan.

## 2. The concept card

Write `src/videos/<name>/concept.json`: `goal`, `terms` (the two or three that need defining), `example` (the one
worked example, with its real numbers), plus `reference` and `referenceSpoken` (where the lesson sits) and
`maxSeconds` (default 120). Decide the subject (`math`, `physics`, `cs`, `chemistry`, `biology`: it sets the accent).
A big topic is a series; each part ends on the next question.

## 3. The script, derived and verified

- Write `derivation.md` first: one line per step with its reason, the assumptions, one place the result fails.
- **Check the maths with code** (plain Python or sympy): the symbolic result, the worked example, the units. Generate the
  numbers the scenes show from that code. Do not type a number twice.
- Draft the narration beat by beat to the arc and the rules in `SCRIPT.md`. Sentences of about 14 words or fewer,
  maths written as it is spoken, at most two new terms a beat, about 270 to 330 words in all.
- `plan_beats` for provisional lengths; `validate_beats` (2.3 to 2.9 words per second) and `check_script` (pass
  `beatsJson` and `conceptCard`). Fix every error, read every warning.
- **Show the user the whole script and the derivation and get an explicit yes before any scene is built.** Then `write_beats_file`.

## 4. Voice

- `generate_narration` with the fixed lesson voice from `SUPERNOVA.md` (edge-tts). It writes word timings per beat.
- **Fit the beats to the voice**: run `fit_beats` (`dryRun: true` first if you want to see the lengths). It sets each beat
  to the measured `spokenSeconds` plus half a second inside the pace window, and lists in `unfittable` any line to shorten.
  Then run `generate_narration` again with `overwrite: true`. Do not stretch outside 0.9 to 1.12.
- Done when every beat has a clip, the result reports no overrun, and the lesson is at most `maxSeconds`.

## 5. Scenes

- `scaffold_scene` in `"starter"` mode per beat, or write the file by hand. Build each from `@openvidstudio/stem`
  (`Spark`, `Nova`, `Axes`, `Plot`, `NumberLine`, `Equation`, `Derivation`, `FreeBody`, `ArrayViz`, `LessonCaptions`) against the video's `design.ts`:
  `export const design = supernovaDesignSystem("<subject>")`.
- One idea on screen at a time, at most two things moving, **one glowing element at a time**. The Nova is used once,
  on the aha. Every `Equation` and every `Derivation` step carries a `spoken` string that appears in its beat's narration, in the order spoken.
- Key content stays inside the Reels safe zones. Sizes come from `useVideoConfig()`. Captions: one line per beat,
  `<LessonCaptions beatId="hook" text={vo} />` (see "Captions" in `SUPERNOVA.md`), so they break at sentence ends.
- `compose_score` with `percussion: "none"` for a quiet pad under the voice. `stitch_composition`.

## 6. Review

- `check_script` again with the scenes present, then `validate_scenes` with `render: true`. Besides framing, numbers and glow it checks the arc: `diagram-late` (nothing drawn beyond the background and captions by 15 s) and `static-stretch` (nothing changes for 8 s). Fix both before posting.
- `render_stills` and `contact_sheet`: look at the frames, then `render_video`, and **listen**.
- Done when there are no errors, the diagram starts early, the Nova lands on the aha, and every beat sounds like one person.

## 7. Finalize

- `finalize_video` (it must report no `audio-tick`). `write_description`: one line saying the video is a constructed explanation, not footage.
- Done when the final file and the description are in `output/`.

# CREATIVE.md: principles for making the video good

`PLANNING.md` decides what to make, `PIPELINE.md` says which tool runs when, and `STYLE.md` holds
the hard rules a render must not break. This file is about the part none of them can mechanize:
what makes a launch video worth watching. It is a set of principles, not a template. Two videos
made from it should not look alike.

Everything here is a default for **peak** and **mid** creative levels. In **literal** mode the
brief restates what the user asked for and adds nothing, so most of this does not apply.

## 1. Find the story in the repo

A product video that is a feature list is a screen recording with a voice. Find the one thing
that makes this product different, then build the video around it.

- Read in this order: `README.md` (how the authors describe it), the changelog (what they were
  proudest to ship), the last 30 commit subjects (what they actually work on), the issue titles
  (what users ask for), the real outputs of the product.
- Write the logline before anything else, in one sentence a stranger could repeat: "who has what
  problem, and what changes". If it needs "and" three times, it is two videos.
- Name the one feeling the viewer should leave with: relief, curiosity, the itch to try it. A
  video with no feeling in mind drifts toward "informative", which is the same as forgettable.
- Pick the story device for this product, and justify it in the brief. Candidates: a ticking
  clock, a before and after, a character's day, a mystery reveal, a build-up montage, a "made
  with itself" twist. None is mandatory, and a plain demonstration beats a forced device.
- If the product cannot show the thing on its own (a library with no UI, a service with no
  data), build a small labelled sample and film it for real, then disclose it. `write_brief`'s
  `shotList` marks every constructed shot `real: false` with the reason, and `write_description`
  repeats that in the video's description. Never present a constructed demo as the real product.

## 2. Hooks that earn attention honestly

- The hook lands inside two seconds, and it is something the product actually did.
- A claim obligates a visual (`SCRIPT.md`): if the narration says it, the frame shows it.
- Open on the interesting moment, not the logo. The logo is the last frame, not the first.
- Good hooks: a number the viewer did not expect (from `facts.json`, never retyped), the problem
  in its worst moment, the finished result before any explanation, a question the video answers.
- Weak hooks: "In this video we will", a title card, a slow fade from black, a mission statement.
- Do not promise what the video does not pay off. A hook is a debt; section 3 is how it is paid.

## 3. Tension and payoff

The arc in the brief has six slots: hook, tension, turn, proof, payoff, call to action.

- **Tension** is a cost the viewer recognizes: time lost, a manual step, a wrong number found
  late. Show the cost on screen, not just in the narration.
- **The turn** is the single moment the product changes the situation. One turn per video.
- **Proof** is real output: the actual command, the actual diff, the actual rendered result.
- **Payoff resolves the hook.** If the hook asked a question, the payoff answers it in the same
  words. This is the cheapest way to make a video feel finished.
- **The call to action** is one thing: where to get it. Not three links and a hashtag.
- Cut everything that is not tension, turn, proof or payoff. Information that does not move the
  arc belongs in the docs.

## 4. Deriving a motif from a brand

A motif is the visual idea the whole video repeats, so a viewer could recognize one frame as
belonging to it. Lift it from the product, never from a mood board.

- Look at the logo and the product's own UI: a dot-matrix mark gives a pixel grid; rounded
  pills and soft shadows give a rounded-soft language; hard rules and columns give an editorial
  one; strict angles give a geometric one. `defineDesignSystem` knows these four as `motif`.
- Use the motif in at least three places: the transition between beats, one background element,
  and one typographic treatment. Once is decoration, three times is a system.
- `extract_brand` gives the palette; the brief's mood words choose the roles. Brand tokens seed
  the design system, they do not dictate it. A brand with a saturated accent and a neutral body
  usually wants the accent on one thing per frame, not everywhere.
- Pair one display face with one body face. Two families, a clear scale, nothing in between.
- Write `design.ts` from the brief, then build scenes against it. A scene that hard-codes a hex
  value is a scene that will not survive a palette change.

## 5. On-screen copy

- **One idea per card.** If a card has a "and", split it.
- **Use the product's own words.** Take labels, command names and error messages from the real
  UI, not a paraphrase. They are also the words the viewer will search for.
- **Hold long enough to read.** The gate is about 3.5 words a second plus 0.8 seconds to land on
  the text, the same budget `validate_beats` and `validate_scenes` apply. Cut words before you
  lengthen the beat.
- **Large and short.** Body text at or above the type scale's minimum, readable at phone size.
  If it needs a second line, it needs fewer words.
- **No em dashes**, anywhere, on screen or in narration. A comma, a colon or a new sentence does
  the same job.
- **Numbers come from facts or a capture.** `collect_facts` merges real tool output into
  `facts.json`; a scene imports it. `validate_scenes` warns about numbers typed into copy.
- Keep the text clear of the chapter HUD and inside the title-safe area.

## 6. Pacing to music

Cuts on the beat feel intentional; cuts between beats feel accidental.

- Decide the music before the beats. `compose_score` writes an original score from the brief's
  music plan (bpm, key, section map, impact points) plus a cues file that is exact by
  construction. `mode: "bed"` targets -15 LUFS under narration, `"music"` -14 for music-only.
- Put impact points where the arc turns: the reveal, the payoff. Let the section map follow the
  arc: tension builds, the reveal lands on an impact, the peak carries the proof, the outro
  resolves.
- `plan_beats` with `snapToBars` puts every beat boundary on a downbeat. `useMusicClock(beatId)`
  gives a scene `at(bar, beat)` as a local frame, plus `beatPulse()`, `onBeat()` and
  `onDownbeat()`, so a reveal can land on the impact and a glow can breathe with the pulse.
- Beds from the CC0 catalogs or the user still go through `plan_music_cues` and give the same
  grid.
- No drum machine under a voiceover. Evenly repeated short hits read as a ticking clock;
  `compose_score` defaults to no percussion for that reason, and `finalize_video` warns when
  the final audio still ticks.
- Let the music rest. A bar of near silence before the payoff makes the payoff louder.
- Narration sits on top: keep the bed under it, and do not let a hit fall on a stressed word.

## 7. Camera grammar

- **Motion never stops.** Every shot has at least a slow drift; a frozen frame fails QC.
- **Push in on what matters**, pull out to reveal context, hold still only when something is
  happening inside the frame (typing, a cursor, a counter).
- **Ease every move.** No linear easing, ever. The `E.*` presets exist so you never pick one.
- **Tilt sparingly.** Two to six degrees reads as depth; more reads as a gimmick.
- **Keep text sharp.** Push 105 to 160 percent on a capture with text; past that the words go soft.
  Depth of field is off unless you ask for it (`depthOfField` defaults to 0), and it never goes on
  anything the viewer has to read. If a shot really wants a soft background, keep the blur under
  4px, list every region with words in `protect`, and check a still at phone size before you keep it.
- **Carry depth some other way.** A slight tilt (`tilt`), handheld sway (`handheld`), and parallax
  between layers (`LayeredShot`, or `Layer` depth in a hand-built scene) read as depth without
  touching a single pixel of text. A rack focus (`rackTo`) moves the sharp point from one thing to
  the next; the blur still stays off the words.
- **A capture is a flat rectangle until you direct it.** `DirectedShot` pushes into the part of a
  screenshot that matters, tilts it slightly and lets the cursor act, in the capture's own pixels.
  Name the move with `shot` instead of tuning numbers (table below).
- **One focal point per shot.** If the eye has two places to go, the viewer picks neither.
- Parallax (`Layer` depth) is for scenes with real foreground and background, not for one panel.

### The shot vocabulary

`<DirectedShot shot="..." />` takes one of these names. Explicit `push`, `tilt` and `move` still win.

| Shot | Use it for |
|---|---|
| `pushIn` | The default: from the whole capture in to the one thing that matters |
| `pullOut` | Ending on the whole product after a close detail; the reveal of context |
| `pan` | Moving from one part of a wide capture to the next at constant zoom |
| `whip` | A cut or a jump between two places on the page; short (18 frames), with motion blur |
| `orbit` | A hero moment on one panel; the camera swings around it a few degrees |
| `dutch` | Tension or a problem beat; the horizon rolls off level. One per video at most |
| `hold` | Something inside the frame is doing the work (a cursor, typing, a counter); the camera barely moves |
| `drift` | Ambient motion under a long hold, a slow breath in and a sub-degree wander |

### Handheld and impact shake

- `handheld` on a `DirectedShot` is a few pixels of drift (3 to 8 at 1080p). It makes a capture
  read as filmed. Past about 10 it reads as shaky footage, which is a choice, not a default.
- `shake` takes the local frames of impacts, a click that lands or a hit on the score's impact
  point (`useMusicClock(...).impact("reveal")`). The shot jolts and settles within a second. Use it
  two or three times in a video, not on every click.
- For anything that is not a `DirectedShot`, `useHandheld(amount, { holds })` gives the same sway
  and is exactly zero inside the `holds` windows, so the frame is still while a cursor clicks or a
  line is read.

### Captions

- Vary the placement. The same spot in every scene covers the same part of the product every time,
  and a caption in the same place twice in a row reads as a template. Alternate `position`
  (`bottom`, `top`, `left`, `right`) beat to beat, never the same spot twice in a row.
- When you know where the product sits, use `position="auto"` with `avoid` set to that rect, in
  composition pixels, and the caption takes the side with the most free room.
- A caption is whole within 8 frames of `at`, whatever its length, so a still never catches it
  half-typed. Keep it to one thought; a long line wraps inside 90% of the frame width.

## 8. An SFX map

Sound sells motion. The built-in pack is synthesized, so it needs no licence and no credit.

| Moment | Sound |
|---|---|
| A cursor click | `Click` or `SoftClick`, on the click frame |
| Typing | `TypingSfx` driven by the real keystroke frames |
| A whip or hard transition | `Whoosh` on the move, not after it |
| A new panel or card arriving | `Blip` |
| The payoff | `SuccessChime` or `Bell`, once |
| A heavy reveal | `Bong` or `Drop`, on the music's impact point |

- Fewer, cleaner sounds beat a dense track. If a sound is not tied to something visible, cut it.
- Anything from outside the pack goes through `plan_sound_effects`, which records provenance.
  A licence that asks for credit lands in the description's Credits section.

## 9. The review rubric

Review is mandatory in every mode, and it happens before any full render. The loop is: author
a scene, `render_stills`, look, fix, repeat until the rubric passes.

1. **Focal point.** Is it clear within one second of the frame appearing?
2. **Readable at phone size.** Hold the contact grid at arm's length. Can you read the text?
3. **Nothing cropped.** No text or UI cut at an edge, nothing inside the title-safe margin.
4. **Motif present.** Can you tell which video this frame belongs to?
5. **No two adjacent beats share a composition.** Same layout twice in a row reads as a mistake.
6. **Cuts are motivated.** Each cut lands on a beat, a reveal or a change of idea.

How to run a round:

- `render_stills` with `perBeat: "review"` renders five frames per beat, with the first and last
  just inside the beat so adjacent beats show both sides of every cut. It tiles them into one
  labelled contact grid, one row per beat. Pass `round` so each round's grid is kept.
- Look at the grid once, as a viewer. Then read the numeric findings that come back with it.
  They are the same measurements `validate_scenes` makes in render mode: cropping, text size,
  reading time, contrast, em dashes, safe area, HUD overlap, dead frames, palette.
- If you cannot view images, the findings and the rubric questions answered from the scene source
  are the review. Do not skip it.
- Fix the worst thing first and render again. Three short rounds beat one long one.

## 10. When not to be clever

- A plain demonstration of a good product beats a clever video about a vague one.
- If the device needs explaining, drop it.
- If a transition draws attention to itself, it is the wrong transition.
- If the motif appears once, it is decoration; either use it three times or remove it.
- If a scene is the same in a template and in your hand-built version, use the template. Templates
  are the right call for literal briefs and tight budgets.
- Do not invent a feature, a number or a quote. A missing shot is better than a made-up one.
- Stop when the rubric passes. Polish past that point costs time and rarely changes how the
  video is received.

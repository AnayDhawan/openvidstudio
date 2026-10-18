# PLANNING.md: guided intake to beats.json

This is step 0 of building any video with openvidstudio. Read this before
touching `beats.json`. It defines: the production-mode intake (creative level,
time budget), the fixed intake question set, how to handle free-form pasted
material instead, the per-feature capture-method decision tree, the full
`captureMethod` field spec, and the mandatory approval gate before anything
gets written to disk.

## 0. Creative level and time budget (added 2026-10, ask this first)

Before §1's fixed questions, before drafting anything: ask two questions.

1. **Creative level**, one of:
   - **peak**: full creative liberty. A cold-open hook, tension, a problem,
     a reveal, chapters, a payoff, an optional twist. A bespoke design
     system and motion language derived from the brand. An original,
     arc-matched score (`compose_score`, see `NARRATION.md`). Custom scenes, not
     templates. Three or more rounds of stills review.
   - **mid**: strong defaults. The arc from §3 below (hook, problem, demo
     x2-3, differentiator, cta). The built-in ambient `music-bed.mp3` or a CC0
     track. A mix of templates and the occasional custom scene where a
     template genuinely falls short. One or two review rounds.
   - **literal**: do exactly what's specified. No added beats, no
     embellished copy, no effects beyond this doc's own hard rules. When
     the spec is ambiguous, ask rather than invent.
2. **Time budget**: 15 minutes, 1 hour, 3 hours, no limit, or a number of
   minutes. This is the wall-clock time the dev is willing to wait for the
   finished video, not a deadline for the conversation.

**How to ask.** Check whether the connected MCP client supports elicitation
(a server-initiated structured prompt back to the user). If it does, use it
for these two questions. If it doesn't, ask them directly in conversation,
the same as every other intake question in this file; there is no
behavioral difference downstream, only in how the question reaches the dev.

**Then call `plan_production`** with the level, the budget, and a target
duration (from §1.3 below, or a sensible default if that hasn't been asked
yet). It returns a concrete plan (arc, how many beats get a bespoke scene
versus a template, the score strategy, how many stills-QC rounds, the
render passes) and a time estimate per phase, based on this machine's real
measured render speed. Persisted as `production: { creativeLevel,
timeBudgetMinutes }` in `openvidstudio.config.json`, and mirrored into that
video's `beats.json` so a tool reading the manifest alone still knows the
level.

**Show the plan and its estimate at the approval gate** (§5), alongside the
drafted `beats.json`. If `plan_production` reports `fitsBudget: false`,
show `cutFirst` (what gets dropped, cheapest first) and let the dev choose,
rather than silently downgrading the level or the duration. If it reports
an `infeasibleWarning` (even one final render doesn't fit), say so plainly
and offer the concrete alternatives it names (a shorter target duration,
draft-only quality, a longer budget) instead of proceeding anyway.

In `literal` mode, this step still happens (the time budget still matters
for render passes), but the arc and scene mix are fixed by the dev's own
spec, not by the level's defaults.

## 1. Fixed intake question set

Ask the dev, in order, before drafting anything:

1. **Product name and one-liner.** What is it, in one sentence?
2. **3-6 features to demo.** The specific things the video should show,
   not a full feature list; pick the ones that carry the pitch.
3. **Target video length.** Total seconds (or a range); this bounds the
   beat arc chosen in `PIPELINE.md` (Simple demo vs. Packed-hook,
   multi-feature).
4. **Higgsfield access: yes or no.** Determines whether `higgsfield` is an
   available `captureMethod` for this video at all. If no, every "not
   product UI" beat either gets dropped or reworked as `dom-demo`.
5. **Brand info.** Colors, fonts, logo, if the project has its own and
   wants it over openvidstudio's default palette/type (`STYLE.md`).
6. **Existing assets to reference.** Screenshots, recordings, a deployed
   URL, a design file; anything that saves a capture step later.

## 2. Free-form pasted material

If the dev instead pastes a README, a feature list, a Slack thread, or
similar material, don't force the fixed question set on top of it. Read
the paste and extract the same six things from it instead:

- Product name/one-liner: usually the README's title plus its first
  paragraph.
- Feature candidates: bullet lists, headers, or a "Features" section map
  directly to feature candidates; pick 3-6 that carry the pitch, same as
  question 2 above.
- Target length: often absent from a paste; ask this one directly if it's
  missing, don't guess it.
- Higgsfield access: always ask directly; a paste never answers this.
- Brand info: look for a design-tokens file, a Tailwind config, a
  `theme.ts`, or explicit brand colors mentioned in the paste; ask only
  for what's genuinely missing.
- Existing assets: URLs, screenshot paths, or asset folders mentioned in
  the paste count directly.

Only ask the dev to fill in whatever the paste didn't already answer. The
goal is one pass of the fixed question set's information, not necessarily
one pass of its literal questions.

## 3. Per-feature capture-method decision tree

Run this once per feature/claim the video will make. It's meant to be
followed mechanically, not judged holistically.

**Step 0, asked once for the whole video, not per feature: does the product's frontend load
and work in Chrome under Playwright?** If yes, the tree below applies and the browser path
is the default for everything it can reach. If no, this tool is the wrong tool and the
honest answer is to say so rather than routing every beat to `dom-demo`, which produces a
video of drawings for a product whose pitch is that nothing on screen is drawn. The desktop,
mobile and terminal sources exist for individual beats a browser cannot reach inside an
otherwise browser-driven video, not as a way to film a product that has no web frontend at
all.

1. Does this claim describe real, working functionality in a running
   instance of the product right now (not "will do," not roadmap, not
   something a real screenshot would contradict)?
   - No: go to step 4 (`dom-demo`).
   - Yes: go to step 2.
2. Is the important part of this feature a single held state (one screen,
   one panel, nothing essential changes while the viewer watches), or does
   understanding it require seeing something change over time (typing,
   dragging, a live update, an animation intrinsic to the feature)?
   - Single held state: `captureMethod: "screenshot"`. Capture per
     `CAPTURE.md`.
   - Needs visible change over time: go to step 3.
3. Can that change be captured by actually interacting with the real,
   running product on screen, within v1's fixed full-viewport scope (no
   post-hoc DOM-rect cropping of a moving recording, see `PIPELINE.md`)?
   - Yes: `captureMethod: "recording"`. Capture per `CAPTURE.md`'s
     recording section. Two judgement calls belong to you here, and the
     tool will not make them for you. **Speed:** real interaction is often
     too slow to watch (a form being filled, a long scroll) and
     occasionally too quick to follow (a state flip, a toast). Pass
     `speed` on the capture, above 1 to compress dead time and below 1
     when the thing worth seeing happens in three frames. **Settling:**
     captures wait for fonts, images and finite animations by default, so
     a clip opens on the product working rather than on the page still
     assembling itself. Turn that off only when catching a page
     mid-transition is the actual point of the beat.
   - No, the motion needed isn't something the product's own UI can
     produce at all (an atmosphere shot, a desk/hands shot, an abstract
     visual metaphor with no real UI in it): go to step 4, but check
     Higgsfield access from intake question 4 first. If access is "no,"
     this beat either gets dropped or reworked as a still `dom-demo`
     instead of the motion originally wanted.
4. `dom-demo`: build a hand-coded panel using the project's real design
   tokens/copy (question 5's brand info, or `STYLE.md`'s defaults if none
   was given). Reuse real copy, real claim IDs, or real UI conventions
   from an actual screenshot elsewhere in the same video where possible,
   so it reads as a continuation, not an invention. Where a real adjacent
   screenshot genuinely backs part of the claim, use the real capture for
   that part and confine the constructed part to just the aspirational
   connection. Never build a `dom-demo` that contradicts a real,
   capturable page's own on-screen copy: if a real page says the opposite
   of the claim, that's a sign the claim needs rewriting, not a signal to
   avoid screenshotting that page.
   - If step 3 routed here because Higgsfield access is "yes" and the
     beat genuinely isn't product UI (atmosphere/b-roll), use
     `captureMethod: "higgsfield"` instead; see `HIGGSFIELD.md`.

## 4. The captureMethod field spec

Every beat's `visual` block carries a `captureMethod` field:

```
"captureMethod": "screenshot" | "recording" | "dom-demo" | "higgsfield"
```

Method-specific fields:

| Method | Extra fields | Notes |
|---|---|---|
| `screenshot` | `url`, `interactions` | `interactions` is an ordered array of steps (click/fill/select/hover/scroll/wait, the exact set `capture_screenshot`/`capture_screen_recording` replay) to reach the exact state the beat needs |
| `recording` | `url`, `interactions` | same shape as `screenshot`; the interactions happen while recording, not before |
| `dom-demo` | none | the beat's visual is authored directly in its scene file, no capture step |
| `higgsfield` | `higgsfieldPrompt` | the AI-generation prompt for the b-roll clip; must not request on-screen product text or real UI |

See section 6 below for a concrete `beats.json` fragment with one full,
working example of each of these four shapes.

## 4.5. Two optional per-beat fields: `transition` and `artifacts` (added 2026-09-08)

`beats.json` is the reviewable product boundary: a dev should be able to read the file
alone and know exactly what will play and where its assets live, without opening
capture.ts or guessing a path convention. Two fields close that gap, both optional:

```
"transition": "cut" | "whip" | "fade" | "push" | "wipe" | "light-leak"
"artifacts": { "screenshotPath"?: string, "recordingPath"?: string, "voPath"?: string }
```

- **`transition`**: the way into this beat. Omit it and `"cut"` is assumed. `stitch_composition`
  draws anything else as an overlay on top of the hard cut (core's `TransitionOverlay`), centred
  on the beat's first frame, about 0.2s either side at any fps, so no beat start or duration
  moves and the bar-snapped timing and the audio joins are untouched. Picking one is a creative
  call, not a default; a video that dissolves every cut reads as a slideshow.
  - `fade`: dips to the brand background and back. The quiet one, for a change of subject.
  - `whip`: heavy blur and an accent streak across the frame. Pairs with the `Whoosh` SFX
    (`PIPELINE.md` §2), which is a separate cue the scene still calls itself.
  - `push`: a panel slides in from the right, covers the frame on the cut, leaves to the left.
  - `wipe`: a skewed band with an accent edge crosses left to right.
  - `light-leak`: warm light in the accent's hue drifts across and peaks on the cut. The one
    for a reveal or a beat landing on the score.
  The overlay is not drawn on the first beat (there is no cut into it) and is clamped when the
  first beat is shorter than the overlay. A scene that wants a transition drawn differently can
  leave `transition` as `"cut"` and animate its own entrance.
- **`artifacts`**: explicit overrides of this beat's output paths. Every capture tool
  already defaults to the convention path (`PIPELINE.md`'s Asset conventions table:
  `public/images/<id>.png`, `public/video/<id>.mp4`, `public/audio/vo/<id>.mp3`) and
  `capture_screenshot`/`capture_screen_recording` already accept an `outPath` override
  and report it back in their result -- `artifacts` is what records that override, or
  just the convention path itself, on the beat so it's readable straight off the
  manifest. Omit a key (or the whole object) and the convention path is assumed; no
  existing `beats.json` needs to change to stay valid.

Pacing across beats is checked too: with four or more beats, `validate_beats` warns when the
longest is under 2.5 times the shortest (a warning, never an error). Uniform lengths read as a
metronome, so plan one long hold and one short punch before assigning frames, not after.

`artifacts` changes nothing about how capture or render run; it exists so the manifest alone
describes the finished video's shape. Making render/capture
independently rerunnable against an edited manifest (patch one field, rerun one
stage, no full regenerate) is the next piece of this work, not part of this addition.

## 4.6. Capture sources: filming software that has no URL (added 2026-09-09)

§3's decision tree assumes the product is a web page. Plenty of real software is not,
and until now every beat about a desktop app, a phone app, a CLI tool, or an operating
system collapsed into `dom-demo`, a hand-drawn panel standing in for software that
could perfectly well have been filmed. A validation run against two of the most starred
projects on GitHub, a Linux distribution and a terminal agent, produced shot plans in
which **100% of beats were reconstructions**, against a product whose whole pitch is
that nothing on screen is generated.

A `recording` beat now carries an optional `source`:

```
"source": "browser" | "desktop" | "mobile" | "terminal"
```

**Omit it and it means `browser`**, so every `beats.json` written before this is still
valid and still behaves identically. Each source has its own required fields and its own
capture tool:

| `source` | Tool | Required | For |
|---|---|---|---|
| `browser` (default) | `capture_screenshot` / `capture_screen_recording` | `url`, `interactions` | Web apps |
| `desktop` | `capture_desktop` | `durationSeconds` (+ optional `window`, `region`, `display`) | Desktop apps, native windows, an OS shell |
| `mobile` | `capture_mobile` | `device`, `durationSeconds` (+ optional `deviceId`) | Android devices, iOS Simulators |
| `terminal` | `capture_terminal` | `command` (+ optional `args`, `cwd`, `script`) | CLIs, agents, build tools |

**Extending §3's decision tree.** At step 1, first ask *what kind of software is this*.
If it has no URL a browser can navigate to, do not fall through to `dom-demo`; pick the
source that matches the product and film it for real. `dom-demo` is for a claim no
capture can back, not for a product this pipeline merely found inconvenient.

**Choosing between `terminal` and `desktop` for a CLI.** Prefer `terminal`. It records
timed text rather than pixels, so the result is resolution-independent, picks up the
palette `extract_brand` resolved, and replays through `TerminalReplay`. Reach for
`capture_desktop` against the terminal window only when the program draws a full-screen
TUI by addressing the cursor (vim, htop, a rich agent TUI), because `capture_terminal`
pipes stdout and stderr rather than allocating a pty.

**`existing-asset`, a fifth captureMethod.** Some projects already publish real
screenshots of themselves. Those are real, and there was previously no honest way to use
one: the capture methods all mean "film it now," so an existing image had to masquerade
as a `dom-demo`.

```
{
  "captureMethod": "existing-asset",
  "assetPath": "public/images/manual-theme.png",
  "attribution": "from the project's own manual"
}
```

`attribution` is **required**, not optional. A frame this pipeline did not capture is
only honest on screen if the video can say where it came from, and an unattributed
borrowed image reads to a viewer as a real capture. This is the same rule as everywhere
else in this document, applied to a new case.

## 4.7. Translated narration (added 2026-09-11)

A beat can carry `voTranslations`, an object keyed by BCP-47 language tag:

```json
"vo": "Every frame here is a capture of the real product.",
"voTranslations": {
  "hi": "yahan har frame asli product ka capture hai",
  "pt-BR": "cada quadro aqui e uma captura do produto real"
}
```

The lines are drafted by you, the calling agent, and go through the same
approval gate as the original script (§5). The server does not translate: a
translation is content, and content that will be spoken over someone's product
gets seen by a human first.

`validate_beats` checks the shape and the language tags, since a tag becomes a
directory name. It deliberately does **not** apply `SCRIPT.md`'s 2.3-2.9
words/sec budget to a translation. That is an English number: the same sentence
runs 20 to 30 percent longer in German or Hindi, and holding a translation to it
would reject correct translations. `generate_narration` reports an overrun
instead, where the fix is a shorter translation rather than a faster read.

## 4.8. Vertical reformat hints (added 2026-09-11)

A beat can carry `vertical`, which only `reformat_vertical` reads:

```json
"vertical": { "focus": "left" }
"vertical": { "crop": { "x": 240, "y": 0, "width": 1200, "height": 1080 } }
```

Omit it and the crop is inferred from the beat itself: a `source: "terminal"`
beat crops left, because a terminal is text pinned to the left margin and a
centre crop cuts the command in half; a `source: "mobile"` beat is already
portrait and gets fitted rather than cropped; a `dom-demo` panel is centred.
Set it when the content sits to one side for a reason the manifest cannot see.
Both forms are validated, because a typo here would be silent: the reformat
would fall back to the inferred crop and look almost right.

## 4.9. The creative brief (added 2026-10, write_brief)

Once the capture-method decisions above are made, before drafting
`beats.json` itself: write the creative brief. It is the one place the
*why* behind the video lives, so a later tool, or a later session, reads
the reasoning instead of re-deriving it from the beats.

Call `write_brief` with two things, written together:

- `briefMarkdown`: free-form prose, the actual creative reasoning, written
  verbatim and never validated. Explain the call: why this story device,
  why this arc shape, why this design motif, anything a future reader
  would otherwise have to guess at.
- `briefJson`: structured and validated, mirroring the prose. Required:
  `creativeLevel` (mirrors §0); `logline`, `audience`, `feeling`;
  `storyDevice` (`{ device, reason }`, a deliberately chosen device such
  as a ticking clock, a before/after, a character's day, a mystery
  reveal, a build-up montage, a "made with itself" twist, or something
  else entirely, never defaulted); `arc` (`{ hook, tension, turn, proof,
  payoff, cta }`, the hook must land within 2 seconds per `STYLE.md` and
  the payoff must resolve the hook); `designSystem` (the WHY behind this
  video's `src/videos/<name>/design.ts`: palette rationale, motif,
  motif/motion rationale, never a duplicate of design.ts's actual values,
  which live only there); `music` (bpm, key, a labeled section arc,
  impact points); `shotList` (one entry per beat: whether it is a real
  capture or constructed, and why, the one focal point, and optionally
  `deliberateHold: true` for a beat that is meant to hold still, so
  `validate_scenes` does not report its unchanging frames as dead).

The brief is also where the music is decided: `compose_score` reads its
`music` field and composes an original score to the section map and impact
points, and `plan_beats` with `snapToBars` plans the beat boundaries onto the
score's downbeats. Decide the music before the beats, not after.

Optional: `styleOverrides` (any `STYLE.md` default this video deliberately
breaks, and why) and `sampleContent` (any beat whose "real" capture is
actually of constructed sample content, a fictional app/dataset/repo built
specifically to film, rather than the real product, and why). A non-empty
`sampleContent` is not just internal bookkeeping: `write_description` (C9)
refuses to let it go unmentioned in the shipped description file.

In `literal` mode the brief is still shaped the same way, but should be
honest about having nothing to add: it restates the dev's own spec rather
than inventing a story device or arc beyond what was asked for.

Like `write_beats_file`, `write_brief` only enforces schema validity, not
dev approval. Show the dev both files in full and get explicit approval
before calling it, merged into the same approval pass as `beats.json`
itself (§5): one sign-off covering the brief and the beats, not two.

## 5. The mandatory approval gate

Once every beat has a decided `captureMethod` and the full `beats.json` is
drafted (and, per §4.9, the brief alongside it): show the dev the full
file or files, not a summary, and get explicit approval before persisting
any of it. This applies even to a small, obviously fine-looking draft.

The `write_beats_file` and `write_brief` MCP tools will refuse to write
anything `validate_beats`/`validate_brief` hasn't passed, but that's
schema/structural validation, not dev approval. The human-approval step
itself is a protocol rule for the calling agent, not something any tool
enforces. Skipping it because the tool would technically allow the write
is a protocol violation.

## 6. Worked example (fictional product, anonymized)

**Product:** "Loomcard," a spaced-repetition flashcard app for technical
interview prep.

**Intake answers (abbreviated):**
- One-liner: "Loomcard turns your notes into spaced-repetition flashcards
  and schedules review so you actually remember them."
- Features to demo: card review flow, confidence-based scheduling that
  adjusts in real time, CSV/Anki import (not wired up yet, a roadmap
  item).
- Higgsfield access: yes.

**Resulting beats.json fragment** (hook / demo / differentiator / cta, one
of each `captureMethod` so the shapes above are all represented):

```json
{
  "fps": 30,
  "title": "Loomcard",
  "beats": [
    {
      "id": "hook",
      "start": 0,
      "duration": 180,
      "vo": "Loomcard turns your notes into spaced-repetition flashcards, and schedules review so you actually remember them.",
      "visual": {
        "captureMethod": "higgsfield",
        "higgsfieldPrompt": "slow push-in on a warm desk scene, hands resting near a closed notebook, soft morning light, no screens or readable text in frame, cinematic shallow depth of field"
      }
    },
    {
      "id": "demo-review",
      "start": 180,
      "duration": 90,
      "vo": "Flip a card, and Loomcard scores your confidence.",
      "visual": {
        "captureMethod": "screenshot",
        "url": "https://app.loomcard.example/review",
        "interactions": [
          { "type": "click", "selector": "[data-testid=flip-card]" },
          { "type": "click", "selector": "[data-testid=confidence-4]" }
        ]
      }
    },
    {
      "id": "demo-schedule",
      "start": 270,
      "duration": 240,
      "vo": "That confidence score adjusts your next review date live, so easy cards fade back and hard ones come around sooner.",
      "transition": "whip",
      "visual": {
        "captureMethod": "recording",
        "url": "https://app.loomcard.example/review",
        "interactions": [
          { "type": "click", "selector": "[data-testid=confidence-1]" },
          { "type": "wait", "ms": 600 }
        ]
      },
      "artifacts": {
        "recordingPath": "public/video/demo-schedule.mp4"
      }
    },
    {
      "id": "cta",
      "start": 510,
      "duration": 180,
      "vo": "Loomcard is free and open source. Star it, try it, or send a pull request.",
      "visual": {
        "captureMethod": "dom-demo"
      }
    }
  ]
}
```

The beat lengths are 6s, 3s, 8s and 6s on purpose: `validate_beats` warns when four or more
beats have a longest under 2.5x the shortest, because evenly sized shots read as a metronome.

Note the `demo-schedule` beat: the CSV/Anki import feature from intake was
dropped, not shown, because it isn't wired up yet and no real capture or
honest `dom-demo` was worth building for a roadmap item this early in the
pitch. A beat that claimed it anyway would have failed the
claim-obligates-visual rule (`SCRIPT.md`). The `cta` beat uses `dom-demo`
because `RepoCta` is a hand-authored scene built from real repo data, not
a captured screenshot of anything. `demo-schedule` also shows both optional
fields from §4.5: `transition: "whip"` records the cut choice into that beat
explicitly, and `artifacts.recordingPath` records where its capture landed
(here just the convention path spelled out, not overridden). Every other
beat in this example omits both fields on purpose: `"cut"` and the
convention paths are assumed.

## 7. Tone (added 2026-09-18)

`beats.json` can carry a top-level `tone`:

```json
{ "title": "Loomcard", "tone": "release", "beats": [ ... ] }
```

Omit it and `"default"` is assumed, matching every `beats.json` written before this
existed. `SCRIPT.md`'s Tone section defines the preset vocabulary (`default`, `release`,
`walkthrough`, `quiet`) and what each one changes about pacing and register; nothing here
enforces the value, it exists so a video with several beats, written across more than one
session, reads like one person wrote all of it instead of drifting line to line.

Ask about tone at intake alongside target length (§1.3) when it isn't obviously the
default: a release/changelog video and a full walkthrough want different registers from
the same product.

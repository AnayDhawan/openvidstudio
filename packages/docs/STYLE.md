# STYLE.md: Art Direction Bible

Binding rules for every video built with openvidstudio. If a scene violates
a rule here, it fails QC.

## What good cinematography for this pipeline looks like (decoded)

1. **Camera lives INSIDE the UI.** Never show a flat full-screen
   screenshot. The camera is always zoomed into a region (105-160% scale
   on a capture with text; constructed panels with nothing to read can go
   further), slightly tilted (1-4 degrees rotateZ, 2-8 degrees rotateX/Y
   perspective), and moving (push-in, drift, pan). Past 160% the product
   text goes soft. UI is rendered oversized on a stage; the camera crops
   into it.
2. **Depth without blur.** One focal plane per shot. Depth comes from
   parallax (`Layer` depth, `LayeredShot`), a slight tilt and handheld
   sway, not from smearing the frame. Blur is opt-in (`depthOfField`
   defaults to 0), is never applied to text the viewer has to read (list
   those regions in `protect`), and stays under about 4px when used.
   Focus can still rack from one point to another mid-shot (`rackTo`).
3. **Low-key lighting.** Dark scenes: deep vignette, soft glow accents on
   the key element (accent-colored text-shadow/box-shadow). Light scenes:
   soft large-radius drop shadows, floating cards, generous negative
   space.
4. **Cursor is an actor.** Oversized cursor, eased movement (never
   linear), click = ripple ring + glow pulse on the target. Buttons
   visibly react.
5. **The montage shot.** Isometric-tilted grid of floating UI windows,
   depth-stacked, edges blurred, slow drift. Used for hooks/outros.
6. **Warm/cool contrast.** Cool UI (blues, slate) against warm accent
   lighting or warm desk tones.
7. **Motion never stops.** Every shot has at least a subtle push-in (2-5%
   scale over the shot). Static frame = dead frame = QC fail.

## Non-negotiables, and strong defaults

This file has two kinds of rule.

**Non-negotiable.** No brief overrides these, at any creative level:

- Product UI and product text on screen come only from real captures or real tool output;
  anything constructed is clearly non-product or disclosed. AI-generated clips never show
  product UI.
- Every claim in on-screen text or narration is backed by something shown in the same beat or an
  adjacent one.
- No em dashes on screen or in narration.
- The quality gates pass before the final render: nothing cropped or outside the safe area, text
  at or above the minimum size and on screen long enough to read, no dead frames (unless the brief
  marks the hold as deliberate), contrast passing, loudness on target.
- The user approves the brief and the beats before anything is written or rendered.

**Strong defaults.** Everything else below (a camera that always moves, no linear easing, grain
and vignette, the palette and type, cut rhythm, the SFX map) is how a video made with this
pipeline looks unless the brief says otherwise. The brief may override any of them with a stated
reason, recorded in its `styleOverrides` (`{ rule, reason }`), so the departure is a decision
someone made and not an accident. At literal level, or without a brief, the defaults stand.

## Hard rules

The rules in this section are the ones most often broken. They are QC failures. The provenance
rule and the no-em-dash rule are non-negotiable; for the others, a brief may record an override
with a reason.

- NO linear easing. Ever. Use `@openvidstudio/core`'s `E.*` presets
  (cinematic bezier / springs).
- Every scene wrapped in `CinematicScene` (grain + vignette + grade always
  on).
- **On-screen text and UI is real by provenance, not by medium.** The
  earlier version of this rule was "all text is DOM text," reasoned from
  medium: anything not literally re-rendered as DOM inside the composition
  wasn't trusted. That rule was a refinement waiting to happen: a genuine
  screen recording of the real, running product isn't AI-hallucinated,
  it's ground truth exactly like a screenshot is, so a medium-based rule
  would have wrongly forbidden a legitimate capture method. The restated
  rule: real product UI/text, whether DOM-rendered, screenshotted, or
  screen-recorded, is always allowed on screen, because it's ground truth
  by provenance. Screenshots may only appear inside `BrowserFrame`;
  recordings composite as an `OffthreadVideo` inside a `Layer`, the same
  camera-keyframe pattern. Both are captured per `CAPTURE.md`'s protocol
  (a plain "set DPR to 2x" isn't enough on its own; the Playwright profile
  can carry a per-origin zoom desync that silently shrinks/misframes an
  uncompensated capture, and `CAPTURE.md`'s viewport-compensation plus
  DOM-rect-crop steps are the actual fix). AI-generated clips (Higgsfield
  or any future model) never carry on-screen product text or real UI:
  b-roll/atmosphere only, see `HIGGSFIELD.md`.
- One focal point per shot. If two things matter, that's two shots.
- Text enters via mask reveal / clip-path wipe / per-word stagger, never
  plain opacity fade.
- Cut rhythm: shots 1.5-5s. Hold longer only when content itself animates
  (typing, install cascade).
- Terminal is always `TerminalReplay` (DOM), never screen-recorded HTML.
- SFX on every interaction: keystrokes (low volume 0.12-0.2), UI blips on
  reveals, whoosh on camera moves/cuts, click ring + click sound together.
- Shot list per video lives in the video's own brief; camera keyframes
  reference it.

## Palette + type (defaults; per-video themes may override)

- Stage/dark bg: #0B0E14 to #11151F radial. Panel: #151A24. Border:
  #232B3A.
- Text: #E6EAF2 primary, #8A94A6 secondary.
- Accent: #4E9EFF (cool blue) + #9D6BFF (violet), glow accents. Success:
  #3ECF8E. Warn: #F5A623.
- Light scenes: bg #F4F6F9, cards #FFFFFF, shadow rgba(15,23,42,0.12)
  large radius.
- Fonts: Inter (UI), JetBrains Mono (terminal/code), bundled locally (see
  `packages/core/src/localFonts.ts`) rather than fetched from Google Fonts at render
  time, so a render with no network access still gets the real glyphs.
- Grain: 4-6% opacity, animated (re-seeded translate per frame). Vignette:
  25-40% edge darkening.

## The hook

The first 2 seconds decide whether anyone watches the rest. Plan the hook beat before any
other beat, not last. It must be built from a real capture or a labeled `dom-demo`, same
as every other beat: an exciting hook that overclaims fails the claim-obligates-visual
rule (`SCRIPT.md`) just as much as a boring one would.

No generic SaaS language anywhere in VO or on-screen text: "streamline your workflow,"
"powerful," "seamless," "unlock." Use the product's own copy and claims instead. If the
product's README doesn't say it that way, the video shouldn't either.

## Beat-locked cuts

When a video's music bed is a `compose_score` track (or any other track `plan_music_cues`
has a grid for), scene cuts can land on the beat instead of at an arbitrary second. Read
the `<stem>.cues.json` next to a composed track, or call `plan_music_cues` for any other
track, before writing `beats.json`'s `start` values.

- `strongCues` are the sparse, strong moments (bar downbeats for a composed score). Snap a
  handful of major reveals here: a hard cut into a new scene, a hero reveal, the outro
  logo landing. Shift the reveal's start to within about 0.15s of the nearest strong cue.
- `beats` is the full beat grid. Snap sequential reveals here: cards or stats arriving one
  after another, a list filling in. Snap each to within about 0.10s of a consecutive beat.
- Lock at most a handful of moments per video, not every cut. A video where everything
  is beat-locked reads as rigid, not musical.
- Readability outranks the grid. If snapping to a cue would cut off a line of text before
  it's readable, use the natural timing instead and skip that lock.
- Mark a locked cut in the brief so a later edit doesn't silently drift off the beat:
  `// beat-locked: 12.86s`.

## Deferred (do not attempt in pure Remotion)

- Live-action beats (desk/keyboard shots, ambient texture): text-free, so
  these are the Higgsfield/AI-footage slot; see `HIGGSFIELD.md`. Still skip
  by default: design scenes so they aren't needed unless a brief
  specifically calls for a live-action beat, and never let an AI-generated
  clip carry on-screen product text or real UI.
- Music beds (added with VO in post, or looped under a baked-in VO mix,
  see `SCRIPT.md`). Chromatic aberration + real bloom passes (perf;
  revisit).

# STYLE.md: Art Direction Bible

Binding rules for every video built with openvidstudio. If a scene violates
a rule here, it fails QC.

## What good cinematography for this pipeline looks like (decoded)

1. **Camera lives INSIDE the UI.** Never show a flat full-screen
   screenshot. The camera is always zoomed into a region (120-250% scale),
   slightly tilted (1-4 degrees rotateZ, 2-8 degrees rotateX/Y
   perspective), and moving (push-in, drift, pan). UI is rendered oversized
   on a stage; the camera crops into it.
2. **Shallow depth of field.** One focal plane per shot. Everything else
   (background layers, edge regions, sidebars) carries gaussian blur.
   Focus can rack between layers mid-shot.
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

## Hard rules

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
- Fonts: Inter (UI), JetBrains Mono (terminal/code) via
  `@remotion/google-fonts`.
- Grain: 4-6% opacity, animated (re-seeded translate per frame). Vignette:
  25-40% edge darkening.

## Deferred (do not attempt in pure Remotion)

- Live-action beats (desk/keyboard shots, ambient texture): text-free, so
  these are the Higgsfield/AI-footage slot; see `HIGGSFIELD.md` (not
  written yet, reserved filename, a later task builds it). Still skip by
  default: design scenes so they aren't needed unless a brief specifically
  calls for a live-action beat, and never let an AI-generated clip carry
  on-screen product text or real UI.
- Music beds (added with VO in post, or looped under a baked-in VO mix,
  see `SCRIPT.md`). Chromatic aberration + real bloom passes (perf;
  revisit).

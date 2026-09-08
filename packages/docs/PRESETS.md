# PRESETS.md: fixed recipes over the same tool chain

Five shapes come up often enough to name: a silent GIF for a README, a fast
screen-recording-only cut, a pure motion-graphics piece with no capture at all, a
capped two-minute demo, and a full walkthrough. Each preset below is a thin,
pre-decided path through the same MCP tools every other video uses
(`init_project` → `extract_brand` → `plan_beats`/hand-drafted `beats.json` →
`write_beats_file` → `scaffold_scene` → `capture_screenshot`/
`capture_screen_recording` → `stitch_composition` → `render_video`), not a new
tool or a new code path. Nothing here calls an LLM or makes a creative choice on
its own; a preset just answers `PLANNING.md`'s intake questions in advance so the
calling agent doesn't re-derive them every time, and PLANNING.md's rules
(claim-obligates-visual, the human-approval gate, no invented functionality)
still apply in full to every preset.

All five presets are speced below; a sixth candidate is flagged, not scoped, at
the end.

## gif-demo

**Answers to PLANNING.md's intake, pre-decided:**
- Target length: under 15 seconds (450 frames at 30fps), hard ceiling.
- Beat count: 1, occasionally 2 for a before/after. A GIF this short doesn't
  support a hook/demo/differentiator/cta arc; pick the single most
  differentiating real moment and show only that.
- Higgsfield: never used. A README GIF is expected to be a real capture; an
  AI-generated shot here would be the exact "vibecoded" failure mode the whole
  zero-vibecode standing rule exists to catch, at the one spot most likely to be
  publicly linked.
- No narration, no music: don't run a narration engine and don't drop a file at
  `public/audio/music-bed.mp3`. Nothing in the schema needs to change for this,
  `stitch_composition` already only adds an Audio layer when the convention path
  actually has a file at it (`PIPELINE.md`'s Asset conventions table); a gif-demo
  beat's `vo` field still gets real text (captions still render, and
  `validate_beats`'s pacing check still runs against it), it's just never voiced.

**Recipe:** `init_project` → `extract_brand` (brand-lock gate applies here same
as any render) → draft the one beat, real `captureMethod` (`screenshot` or
`recording`, whichever actually shows the moment; `dom-demo` only if genuinely
nothing capturable exists, per `PLANNING.md`'s decision tree) → `validate_beats`
→ show the dev, get approval → `write_beats_file` → `scaffold_scene` →
`capture_screenshot`/`capture_screen_recording` → `stitch_composition` →
`render_video` with `outPath` ending `.gif` (Remotion's CLI selects the GIF
codec from the output extension, no new flag needed).

## screenrec-only

**The fastest path, and the one with the sharpest tradeoff.** `STYLE.md`/
`PIPELINE.md`'s QC checklist requires camera motion on every scene (min: subtle
push-in) and there is currently only one scene template for a captured
recording (`recording`, `PIPELINE.md` §2's camera-over-video pattern) — there is
no zero-motion "just play the file" template today, and adding one is a real
scene-template change, not a preset recipe, so it's out of scope here. What
"skip Remotion animation entirely" means in practice for this preset: **one
continuous recording, one beat, one scene**, not per-beat choreography across
several captures. No multi-beat authoring loop, no per-beat camera planning,
just a single `capture_screen_recording` spanning the whole interaction
sequence you want shown, one `recording` scene over it (still one subtle push,
per the style rule above, not literally static), light caption overlays burned
in via the beat's own `vo`/on-screen text, nothing else.

**Answers to PLANNING.md's intake, pre-decided:**
- Beat count: 1 (occasionally 2, for a hard cut between two separate flows).
- captureMethod: always `recording`. No `screenshot`, no `dom-demo`, no
  `higgsfield` — this preset exists specifically for "I have a real flow to
  show and don't want to plan beats," so if any part of it needs a constructed
  panel, this isn't the right preset for that part.
- Target length: as long as the real interaction actually takes, capped by
  `PLANNING.md`'s existing per-arc guidance (don't let it drift past the
  brief's stated ceiling "for completeness").

**Recipe:** `init_project` → `extract_brand` → draft the single `recording`
beat, real `url` + `interactions` → `validate_beats` → approval →
`write_beats_file` → `scaffold_scene` (`recording` template) →
`capture_screen_recording` → `stitch_composition` → `render_video`. No
`plan_beats` multi-beat planning step: there's only one beat to plan.

## remotion-only

Pure motion graphics, no capture step of any kind. Every beat is `dom-demo`
(hand-authored from the project's real design tokens/copy per `PLANNING.md` §3
step 4) or `higgsfield` (for a genuine non-UI b-roll shot, access permitting).
Use this when the piece being made isn't a demo of a specific running product at
all: a conceptual explainer, a brand piece, a recap video assembled from claims
already proven in a real capture elsewhere. `PLANNING.md`'s claim-obligates-
visual rule still applies in full: a `dom-demo` beat still can't assert
something the product doesn't really do.

**Recipe:** `init_project` → `extract_brand` → draft beats (`dom-demo`/
`higgsfield` only) → `validate_beats` → approval → `write_beats_file` →
`scaffold_scene` per beat → `stitch_composition` → `render_video`.
`capture_screenshot` and `capture_screen_recording` are never called, there is
nothing for them to capture.

## 2min-demo

**Fixed 6-beat structure, capped at 2:00 (3600 frames at 30fps).** Hook, three
demo beats (one per claimed feature, per `PLANNING.md`'s claim-obligates-visual
rule), differentiator, cta. This is `PIPELINE.md`'s existing "Packed-hook,
multi-feature" arc with the demo-beat count pinned at exactly 3 rather than
left open, so the preset has one fixed shape instead of a range to plan around
each time.

**Unlike gif-demo/screenrec-only, narration is mandatory, not silent.** Every
beat needs a real VO file at `public/audio/vo/<beatId>.mp3` (`generate_narration`,
or a dev-provided recording) before `stitch_composition` runs, plus captions
burned in per the usual QC checklist. A 2min-demo missing narration on a beat
fails the same silent-omission trap `PIPELINE.md` already warns about (the
Audio layer just gets skipped, no error), so treat "did every beat's VO file
land" as an explicit check for this preset, not an assumption.

**Recipe:** `init_project` → `extract_brand` → `plan_beats` (6 beats: hook +
3 demo + differentiator + cta, total ≤3600 frames) → `validate_beats` →
approval → `write_beats_file` → `scaffold_scene` per beat → capture per beat's
real `captureMethod` → `generate_narration` for every beat → `stitch_composition`
→ `render_video`.

## 5min-demo

Extends the six-chapter structure `EA\launch_plans\TODO.md` proved out for
openvidstudio's own human-recorded launch video (modeled on Crynta's Terax
video, 4:40 total) into a fixed beat arc for a fully agent-generated ~5:00
demo of *any* project, not just openvidstudio's own site. Same six roles, same
order, scaled from that brief's 280s total to a 300s (9000 frame) target:

| # | Chapter (beat id) | Target | Role |
|---|---|---|---|
| 1 | `cold-open` | ~27s | Name the product, then the one number that earns attention, inside the first 15s. No intro, no logo sting. |
| 2 | `why-built` | ~54s | Name the real alternatives out loud, then the gap this product closes. |
| 3 | `walkthrough` | ~102s | The whole real flow in one pass, in order, as a sequence not a feature list. The longest chapter, and the only one allowed real waiting in it. |
| 4 | `why-real` | ~54s | Make chapter 1's claim checkable: name the actual mechanism behind what was just shown (the stack, the real integration, whatever makes it not-generated). |
| 5 | `current-state` | ~37s | Where the project actually is: what's shipped, what's still rough. Naming the weak spot here is what makes the rest credible, don't skip it. |
| 6 | `outro` | ~27s | Ask for the real next step (star, comment, try it), then close on the product's own output, not a static card. |

This preset requires narration+captions like 2min-demo, and real capture for
every chapter that claims something the product actually does (`walkthrough`
and `why-real` especially: per `PLANNING.md`'s decision tree, a claim this
central to the pitch needs a real screenshot or recording behind it, not a
`dom-demo` standing in).

**Recipe:** same as 2min-demo, with `plan_beats` targeting these six chapter
roles and a 9000-frame total instead of six generic demo beats.

## Not yet scoped: vertical reformat with speaker tracking

Real, independently validated ask from the r/reactjs feedback (Opening-Dentist-
1556, cited in the plan's OVS Community signal section): horizontal-to-vertical
reformatting with active-speaker detection, auto-tracking who's talking and
placing the vertical crop accordingly. This needs real face/speaker-detection
work, not just a recipe over the existing tool chain like the five presets
above, so it isn't a preset yet. Flagging it here as the 6th candidate rather
than dropping it; scoping and building it is separate work, not done as part
of this pass.

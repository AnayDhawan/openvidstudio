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

Two presets ship today: **gif-demo** and **screenrec-only**. Three more
(**remotion-only**, **2min-demo**, **5min-demo**) are speced but not yet built,
plus a sixth candidate flagged, not scoped, at the end.

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

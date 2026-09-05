# PIPELINE.md: how a new video gets made

Brief in, video out. Follow in order; `STYLE.md`'s rules are binding at
every step. Beat authoring itself is driven by `PLANNING.md`'s guided
intake process: read that first, before hand-writing a `beats.json`.

## 0. Prereqs (once per machine)
- Install dependencies for the scaffolded project (`@openvidstudio/core`
  plus Remotion/React, see the project's own `package.json`).
- An SFX pack exists at `public/sfx/` (regen: `bash scripts/gen-sfx.sh`,
  needs ffmpeg). Anything you import from outside the pack goes in
  `public/imported_audios/` instead, kept separate so it is always clear
  which sounds carry licence terms. See `NARRATION.md`.

## 1. Beats file (the single source of truth)
Create `<video>/beats.json`:
- `fps`, `title`, `beats[]`: each beat has `id`, `start` (frame),
  `duration` (frames), `visual`, `vo`.
- Beats must be contiguous (`start` = previous `start + duration`). 30 fps.
- This file drives: scene sequencing, the markers/SRT export, and the VO
  script table.
- **`captureMethod`**: every beat's `visual` block now carries one of
  `"screenshot"` | `"recording"` | `"dom-demo"` | `"higgsfield"`, decided
  per `PLANNING.md`'s decision tree during intake. At a glance:
  `screenshot` is a real captured still of the running product;
  `recording` is a real captured full-viewport screen recording of the
  running product; `dom-demo` is a hand-authored scene built from the
  project's real design tokens/copy, for a claim the real product can't
  currently back with a capture; `higgsfield` is an AI-generated b-roll
  clip for a shot that isn't product UI at all. `PLANNING.md` owns the
  full field spec and decision tree; this file just needs every beat to
  carry the field.
- Two beat arcs, pick by product complexity:
  - **Simple demo** (single core feature): hook (8s), problem (11s), demo
    x2-3 (12-14s each), differentiator (10s), cta (9s). 60-75s total.
  - **Packed-hook, multi-feature**: one dense ~15s hero beat whose VO
    states every core thing the product does in one pass (what it is,
    what a user can do, how it's verified/differentiated) before any demo
    beat, written so a judge or cold viewer understands the whole pitch
    from audio alone in the first 15s, even muted-video-unaware. Then one
    demo beat per feature claimed in the hook (so nothing gets asserted in
    VO without being shown), differentiator recap, cta. Total scales with
    feature count but stays under whatever hard ceiling the brief sets:
    budget ~10-20s/demo beat and check the running total as you add
    beats, don't let it creep past the brief's stated limit "for
    completeness."
- No em dashes in any on-screen string or VO line (writing rule).
- **Claiming a feature in VO obligates showing it.** If a beat's VO
  asserts something the product does, either show the real thing or say
  so isn't wired yet and build a labeled `dom-demo` instead (see
  "Constructed mockups" below): never let VO overclaim past what the
  visual backs up. Full generalized version of this rule: `SCRIPT.md`.

## 2. Scenes
One file per beat. Rules:
- Any beat with `captureMethod: "screenshot"` or `"recording"`: capture it
  per **CAPTURE.md**, not ad hoc. That doc exists because uncorrected
  captures reliably come out small, soft, or bleed in content from a
  neighboring page section, both tracing to the same root cause (an
  uncompensated Chrome zoom desync in the Playwright profile).
- **Screen recordings** (`captureMethod: "recording"`): composite as an
  `OffthreadVideo` inside a `Layer`, the same camera-keyframe pattern as a
  static `<Img>`. The camera moves over the recording exactly like it
  would over a still. v1 scope is fixed full-viewport recordings only: no
  post-hoc DOM-rect cropping of a moving recording (that's future work; a
  moving recording can't be re-cropped to a DOM rect the way a still
  screenshot can, because the rect would need to track the content frame
  by frame).
- **Constructed mockups** (`captureMethod: "dom-demo"`), for a claim the
  product doesn't do yet, or where a real screenshot isn't available or
  would show something contradicting the claim: build it as a hand-coded
  panel using the project's real design tokens and colors, reusing real
  copy, real claim IDs, or real UI conventions from an actual screenshot
  elsewhere in the same video where possible, so it reads as a
  continuation, not an invention. For example: a fictional product's
  "export your data" beat, before that feature is wired up, might reuse
  the exact card style the viewer already saw in a real, captured
  screenshot two beats earlier: same panel, same accent color, same copy
  voice. Never screenshot a real page whose own on-screen copy contradicts
  the claim you're making about it. A real settings page stating "your
  data stays private, never shared" directly contradicts a beat's VO
  claiming a public-sharing feature; screenshotting it for that beat would
  put the opposite of the VO on screen. Where a real adjacent page
  genuinely backs part of the claim, use the real screenshot for that part
  and confine the constructed part to just the aspirational connection: a
  real screenshot of a real results page, bridged by one constructed
  arrow to a hand-built "share" panel, since the results page is real but
  the sharing wiring isn't.
- Every scene = `CinematicScene` with camera keyframes. Motion never stops
  (min: subtle push-in).
- Captions, title cards, dips/fades: always in the `overlay` prop
  (screen-space). Never inside the rig.
- Reuse the library first: `TerminalReplay`, `CodePanel`, `ChecklistPanel`,
  `BrowserFrame`, `KineticText` (`TitleSlam`/`Caption`), `CursorActor`,
  `RepoCta`. Build a new component only when a beat truly needs it, then
  keep it generic.
- Terminal windows: pick a title and slash-command convention and stay
  consistent within a video (see `OVERVIEW.md` for why this is now a
  documented default, not a hard rule).
- CTAs: `RepoCta`, no star action by default (see `OVERVIEW.md`).
- Camera keyframes derive from the terminal timeline
  (`computeTerminalTimeline`) where applicable, so cuts land frame-exact on
  content events.
- SFX: typing via `TerminalReplay` (built in), `Whoosh` on cuts/whips,
  `Blip` on reveals, `SuccessChime` on completion moments. Real
  third-party components the product actually uses (an embeddable widget,
  a real chart library, etc.): npm install and render them, never fake a
  screenshot.

## 3. Composition
`<video>/<Name>Demo.tsx`: `<Series>` mapping `beats.json` ids to scene
components. Register in the project's `Root.tsx` with duration from beats.

## 4. Preview + QC loop
- `npm run dev` for live preview while writing scenes.
- Render, then extract frames at each beat midpoint:
  `ffmpeg -nostdin -ss <t> -i output/<video>.mp4 -frames:v 1 -q:v 3 output/qc/<t>.jpg -y`
- QC checklist (all must pass):
  - [ ] Text crisp on a 1080p pause-frame at every zoom level
  - [ ] Zero linear easing; every scene has camera motion
  - [ ] Captions fully visible (screen-space) at all camera positions
  - [ ] No em dashes on screen
  - [ ] SFX lands on the visual events (spot-check typing + whip cuts)
  - [ ] Beat durations match beats.json
  - [ ] Glassmorphism on captions/cards; UI content detailed, not skeleton
  - [ ] Every real-screenshot or real-recording beat: camera `scale` in
        120-250% (STYLE.md), frame centered on the stage
        (`LEFT + FRAME_W/2 == 960`), no leftover dead space around a
        small, unzoomed shot
  - [ ] Pull a frame from the END of every real-screenshot/recording beat
        specifically, not just the midpoint: a static crop that looks fine
        early can push the important content (the actual payoff, not just
        the headline) off the bottom of frame once the camera has zoomed
        in
  - [ ] Every claim the VO makes has a matching visual in the same or an
        adjacent beat; if a beat is a `dom-demo`, confirm it isn't a
        screenshot of a real page whose own on-screen text contradicts the
        claim

## 5. Render + exports
- `npx remotion render <composition-id> output/<video>.mp4`
- `node scripts/markers.mjs <video>` writes `output/<video>-markers.json` and
  `output/<video>-vo.srt`
- The finished video, the contact sheet, and every QC still all land under
  `output/`. That folder is gitignored (renders are build output, not
  source) and is where an upload step should pick the finished mp4 up from.
- Write `<video>/script.md`: VO table (timestamps from markers), delivery
  notes, description draft. See `SCRIPT.md` for VO pacing/duration rules.

## Asset conventions

Every tool in this pipeline that reads or writes a beat's media agrees on
these paths (relative to the scaffolded project root). Get an asset onto
disk at the wrong path and the tool that's supposed to consume it either
errors (scenes reference a `staticFile` that 404s at render time) or, for
VO specifically, silently omits the layer with no warning:

| Asset | Path | Written by | Read by |
|---|---|---|---|
| Screenshot | `public/images/<beatId>.png` | `capture_screenshot` | the `real-screenshot` scene `scaffold_scene` generates |
| Recording / Higgsfield clip | `public/video/<beatId>.mp4` | `capture_screen_recording` / `import_higgsfield_clip` | the `real-recording` / `higgsfield-clip` scene `scaffold_scene` generates |
| VO narration | `public/audio/vo/<beatId>.mp3` | (dev-provided, e.g. an edge-tts run) | `stitch_composition`, only if the file exists at this exact path when it runs |
| Music bed | `public/audio/music-bed.mp3` | (dev-provided) | `stitch_composition`, only if the file exists at this exact path when it runs |
| Built-in SFX | `public/sfx/<name>.{wav,mp3}` | `scripts/gen-sfx.sh`, ships with the template | `@openvidstudio/core`'s `sfx.tsx` helpers |
| Imported SFX / music | `public/imported_audios/<id>.<ext>` | dropped in by hand, or `plan_sound_effects` (Freesound provider) | scenes, via `staticFile("imported_audios/<id>.<ext>")` |
| Rendered video, contact sheet, QC stills | `output/<video>.mp4`, `output/contact-sheet.jpg`, `output/qc/<video>/` | `render_video`, `contact_sheet`, `qc_extract_frames` | pick up / upload from here |

**VO omission is silent.** `stitch_composition` checks
`public/audio/vo/<beatId>.mp3` for every beat and just skips the Audio
layer for any beat where the file isn't there, no error, no warning. A
video with a beat missing its VO file renders fine and plays with no
narration for that beat; the QC checklist below is the actual backstop,
not a tool error.

## Known flakes
- Webpack "wasm-hash / Cannot read properties of undefined" on render:
  `rm -rf node_modules/.cache` and retry.
- `npx remotion skills add` fails on Windows (spawn EINVAL): use
  `npx -y skills@1.2.0 add remotion-dev/skills` directly.
- Run npm commands from the project's own directory (shell cwd resets
  between calls in some agent harnesses).

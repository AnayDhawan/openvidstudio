# PIPELINE.md: how a new video gets made

> **Before anything else:** this pipeline films a web frontend that loads and works in
> Chrome under Playwright. That is the requirement the whole chain rests on. The desktop,
> mobile and terminal backends exist for beats a browser genuinely cannot reach, and they
> are deliberately secondary: the browser path is the one that is tuned and tested end to
> end.

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
- **`transition`** and **`artifacts`** (both optional, `PLANNING.md` §4.5): the
  way into a beat (`cut`, `whip`, `fade`, `push`, `wipe` or `light-leak`; anything
  but a cut is drawn over the cut, see §3) and explicit overrides of that beat's
  output paths. Omit either and the default (`"cut"`, convention path) is assumed;
  every existing `beats.json` stays valid without them.
- **Editing an already-written `beats.json`**: run `diff_beats` (new draft in,
  persisted file on disk compared) before re-running anything. It reports, per beat,
  whether it's added/removed/unchanged/changed, which fields changed, whether
  capture or `scaffold_scene` actually need to rerun for it, and whether its output
  files exist on disk right now. Patch one beat's timing and `diff_beats` tells you
  that's the only one that needs `scaffold_scene --overwrite`, not the whole video.
  `render_video` still re-renders the full composition regardless (Remotion has no
  partial-render mode), so treat that as a single go/no-go signal, not per-beat.
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
- **Vary the shot lengths.** Four or more beats whose longest is under 2.5 times
  the shortest read as a metronome: a cut on the same count however much the
  content changes. `validate_beats` says so as a warning (never an error, and
  `write_beats_file` still writes the file). Give the strongest claim one long
  hold and make another beat a short punch. A deliberately even video can ignore
  the note.
- No em dashes in any on-screen string or VO line (writing rule).
- **Claiming a feature in VO obligates showing it.** If a beat's VO
  asserts something the product does, either show the real thing or say
  so isn't wired yet and build a labeled `dom-demo` instead (see
  "Constructed mockups" below): never let VO overclaim past what the
  visual backs up. Full generalized version of this rule: `SCRIPT.md`.

## 2. Scenes
One file per beat. **How a scene gets written depends on the creative level in the brief**
(`src/videos/<name>/brief.json`, see PLANNING.md 4.9):

- **peak and mid: author the scene.** Compose it from `@openvidstudio/core`'s primitives
  (API.md) against the video's own `design.ts`. `scaffold_scene` with `mode: "starter"` writes a
  minimal file wired to that design system with no layout imposed; `mode: "blank"` registers the
  beat for stitching and writes nothing. The primitives are building blocks, not a template: when
  the brief's motif needs something the library lacks, write the component, and consider
  proposing it for core afterwards. Use `useMusicClock(beatId)` to land hits on the score and
  `DirectedShot` to give a capture a move.
- **literal, or a tight time budget: use a template.** `scaffold_scene` in its default
  `"template"` mode emits a scene that renders as-is from the beat's own copy and duration.
- Either way the scene passes STYLE.md's hard rules, and any number it shows comes from
  `facts.json` (see Run records and facts below) or a capture, never from memory.
- Bespoke scenes live anywhere under the video folder; point the beat at the file with
  `scene: "./scenes/Whatever.tsx"` and `stitch_composition` wires it.

Rules for the scene files themselves:
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
- **Layered screenshots** (parallax). A flat capture can only be slid as one piece. Pass
  `layers` to `capture_screenshot` (selectors for the elements that should move
  separately, for example a sidebar, a card, a toast) and it also writes the page with those
  elements removed (`<id>-bg.png`), one transparent PNG per element, and
  `<id>.layers.json`, a manifest of where each piece sits in the capture and how far from the
  background it is (`depth`). `LayeredShot` (API.md) reads that manifest and moves the pieces
  at different rates under the camera. Layers are cut from the same pixels as the main
  image, so putting them back at their rectangles reproduces it. Details and limits are in
  `CAPTURE.md`.
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

**Transitions.** A beat's `transition` is drawn by core's `TransitionOverlay`, which
`stitch_composition` mounts in a `Sequence` centred on the beat's first frame: 6 frames
either side at 30 fps (scaled with fps, so about 0.2s whatever the frame rate), clamped at
frame 0 and to the beat's own length. It is drawn on top of a hard cut and never replaces
one, so no beat start or duration moves and the bar-snapped timing and the audio joins stay
where `beats.json` put them. The overlay is at its peak on the cut frame and clear on its
first and last frames, and it reads the colour tokens, so it follows a brand applied with
`applyBrand`:

| `transition` | What is drawn |
|---|---|
| `cut` (default) | nothing |
| `fade` | a dip to the brand background and back |
| `whip` | a heavy blur with an accent streak that crosses the frame on the cut |
| `push` | a panel in from the right that covers the frame on the cut and leaves to the left |
| `wipe` | a skewed band with an accent edge crossing left to right |
| `light-leak` | warm light in the accent's hue that drifts and peaks on the cut |

Nothing is emitted for a composition with no transitions, and none for the first beat
(there is no cut into it). To check one, `render_stills` with `perBeat: "review"` puts the
first and last stills of each beat 3 frames inside it, which is inside the overlay.

**Music-only videos** (`beats.json`'s top-level `narration: "none"`, see `SCRIPT.md`): pass
`stitch_composition` a `musicBed: { file, volume }` to control the bed and its mix level
directly; it otherwise defaults the bed to full volume with no narration to duck under.

**`<video>/overrides.tsx`** (optional): if this file exists, `stitch_composition` imports and
renders it as an extra layer on every stitch, without ever writing to it itself. This is the
place for a hand-added layer (an extra callout, a one-off effect) that needs to survive a
caption edit and re-stitch, since everything else in the generated composition file is
regenerated from `beats.json` on every run.

## 4. Preview + QC loop

### The review loop (mandatory, in every mode, before any full render)

Author a scene, `render_stills`, look, fix, repeat until the rubric in CREATIVE.md passes.
`render_stills` bundles the project once and renders real frames, about ten times faster than a
draft render:

- `perBeat: "review"` renders five frames per beat (start+3, 25%, mid, 75%, end-3); the first and
  last sit just inside the beat, so adjacent beats show both sides of every cut. `perBeat: N`
  spreads N frames start to end, `at` picks one, `frames` takes exact composition frames.
- `crop: { x, y, width, height }` (composition pixels) is for small text. Each still also gets
  `<name>-crop.png`, that region re-rendered at a higher scale (a whole number, nearest 960 px
  wide, at most 4x) rather than stretched from the 1x still, which would only show the blur. A
  region outside the composition is an error.
- It writes a labelled contact grid (one row per beat when `perBeat` is used: across is time
  within the beat, down is the cut to the next). `round` keeps each round in its own folder.
- It also returns the numeric findings `validate_scenes` makes in render mode (cropping, text
  size, reading time, contrast, em dashes, safe area, HUD overlap, dead frames, brand palette),
  so an agent without image input reviews from the numbers. A beat that cannot be mounted is
  reported as skipped, never as clean.

Then `validate_scenes` with `render: true` is the gate before stitching and rendering.

### Frame QC after a render
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
Every tool rejects an input it does not take, naming the key, listing the valid ones and suggesting
the closest, so `render_video { quality: "draft" }` fails at once instead of running a full render
(the option is `draft: true`).

- `npx remotion render <composition-id> output/<video>.mp4`
- After the first full render, prefer `render_video` with `incremental: true`.
  Each beat renders to `output/segments/<video>/<beatId>.mp4` and the segments
  are joined with ffmpeg's concat demuxer under stream copy, so a beat whose
  inputs did not change is not re-rendered and its bytes reach the final file
  untouched. A segment is reused only when the beat's JSON, its scene source,
  every artifact it references, its narration, and the project-wide inputs
  (`src/brand.ts`, the generated composition, the music bed) all hash the same.
  Editing one caption in a five minute video then costs that beat, not 9000
  frames. `diff_beats` tells you what changed; this is what acts on it.
- `node scripts/markers.mjs <video>` writes `output/<video>-markers.json` and
  `output/<video>-vo.srt`
- The finished video, the contact sheet, and every QC still all land under
  `output/`. That folder is gitignored (renders are build output, not
  source) and is where an upload step should pick the finished mp4 up from.
- Write `<video>/script.md`: VO table (timestamps from markers), delivery
  notes, description draft. See `SCRIPT.md` for VO pacing/duration rules.

### Final assembly

`finalize_video` is the last pass over a finished render. It measures the mix's
real integrated loudness, true peak and range, then normalises it two-pass with
ffmpeg's `loudnorm`: the first pass measures, the second applies a linear gain
computed from those numbers, and the video stream is copied, not re-encoded. The
written file is measured again, and the result says whether it landed within 1 LU
of the target. The target is **-14 LUFS integrated, -1.5 dBTP**. That is not the
-15 `compose_score` uses for `mode: "bed"`: that figure is the music alone sitting
under narration, while this is the finished mix, and -14 is the level the large
video platforms normalise to. Override it with `targetLufs` / `truePeakDb`.

It writes `output/<video>-final.mp4` (the original render is kept), a poster
frame, and a copy under a size cap (`shareMaxMB`, default 10). Pass `poster:
false` or `share: false` to skip either. A render with no audio track skips the
loudness step and says so.

It also writes `output/<video>-DESCRIPTION.md` through `write_description` (`description:
false` skips it): a YouTube-ready description with a Chapters list built from the beats (the
first at 0:00, each at least ten seconds, at least three, merging short beats forward; a beat
may carry an optional `chapter` title), a Credits section read from what is on disk (the music
source and licence, the narration engine, any sound effect whose licence asks for credit), and
the disclosure of every constructed sample-content shot in the brief's shot list. A finished
video is posted with it, which is why it is written on every run.

### Other outputs from the same render

The finished mp4 is one consumer of the beats, not the only one. All of these
read the render plus `beats.json`, so none of them can drift from the video:

- `export_rendition` with `format: "gif"` writes a README GIF through a real
  two-pass palette. A one-pass GIF falls back to a fixed 256 colour palette and
  bands flat UI into mud, which is most of what a product demo is.
- `export_rendition` with `format: "screenshots"` writes one frame per beat plus
  an index pairing each with that beat's narration, which is already written.
- `export_rendition` with `format: "store-frames"` writes App Store and Play
  Store images at the exact dimensions each store rejects submissions over.
- `export_rendition` with `format: "poster"` writes one still. By default it is
  the last beat's midpoint; with `posterPick: "auto"` every beat's midpoint is
  scored (luma entropy and contrast, penalising near-black and blown-out frames)
  and the best one wins, so the thumbnail is not a fade or a call-to-action card
  by accident.
- `export_rendition` with `format: "share"` writes a copy under a hard size cap
  (`maxMB`, default 10, where 1MB is 1,000,000 bytes). The bitrate comes from the
  cap and the duration, the largest resolution that bitrate can carry without
  blocking is chosen, it is encoded two-pass H.264, and the file on disk is
  measured and re-encoded smaller if it came out over. When the cap cannot be met
  it says so rather than reporting success.
- `export_rendition` with `format: "reels"` packages a render that is already
  1080x1920 as an Instagram Reels file: H.264 + AAC at 30fps, moov atom first.
  It re-encodes only what the source is not already and refuses a 16:9 render
  rather than cropping it. See "Native vertical (9:16)" below.
- `reformat_vertical` writes a 9:16 cut with the crop chosen per beat from the
  manifest rather than by taking the middle of the frame. It crops a finished
  16:9 render, so for content that has to be seen whole render natively instead
  ("Native vertical (9:16)" below).

### Keeping it true after it ships

- `visual_regression` diffs this render's beats against the last accepted one
  and returns markdown ready to post on a pull request. Scaffolded projects get
  a workflow for it at `.github/workflows/visual-regression.yml`; the baseline
  lives in `.openvidstudio/visual-baseline/<video>/` and is meant to be
  committed, so accepting a visual change is an ordinary commit.
- `docs_drift` re-captures the pages the beats came from and names the clips
  that no longer match them. Run it on a schedule.
- `release_diff` takes two refs and a running instance of each, and drafts a
  before/after manifest covering only the routes that actually changed on
  screen. It does not write the narration and does not install the manifest:
  both go through the approval gate in `PLANNING.md` §5.

## Native vertical (9:16)

For Reels, Shorts and TikTok there are two ways to get a 1080x1920 file, and they are not
interchangeable.

| | Native vertical | `reformat_vertical` |
|---|---|---|
| What it does | Renders the composition at 1080x1920 and lays every scene out for that frame | Crops a finished 1920x1080 render, one crop per beat |
| Content wider than a phone | Designed to fit | Cut off: each crop is a 608x1080 slice, under a third of the frame width |
| Use it when | The video exists for a phone: diagrams, equations, a lesson where the picture has to be seen whole | A 16:9 render already exists and what matters sits at the left, centre or right (a terminal's left margin, a centred panel) |

`reformat_vertical` never re-lays anything out, so a diagram, a graph or a wide equation in
the 16:9 version is cropped, not reflowed. If the picture is the content, render natively.

### Setting up a native vertical project

1. `init_project` with `videoConfig: { fps: 30, width: 1080, height: 1920 }`. `stitch_composition`
   writes that size into the composition, and `validate_scenes` reads it from
   `openvidstudio.config.json`, so framing is judged against 1080 wide, not 1920.
2. Camera coordinates are stage pixels, and `CinematicScene`'s stage is the composition size, so
   the frame centre is `x: 540, y: 960` (not 960,540). `scaffold_scene` writes 960,540 into its
   starter and its templates, which are laid out for 1920x1080: in a vertical project change
   those keyframes, or write the scene by hand with a `scene` override on the beat.
3. In the video's `design.ts`, pass the stage so the layout grid scales to it: `defineDesignSystem({
   stage: { width: 1080, height: 1920 } })` gives margins of 84 / 231 / 196 instead of
   150 / 130 / 110. Set `grid` yourself for the safe zones below.
4. Run `validate_scenes` with `render: true` and look at stills (`render_stills`, `contact_sheet`)
   before a full render. The crop, safe-area and text-size checks measure the real 1080x1920 frame.
5. Package the finished render with `export_rendition` and `format: "reels"` (1080x1920 H.264 +
   AAC, 30fps, moov atom first). It re-encodes only what the file is not already, and it refuses
   a 16:9 render instead of cropping it.

### Reels safe zones

Instagram draws its own interface over a reel: the account and caption block along the bottom, the
action buttons down the right edge, the header along the top. Keep key content (text, the part of a
diagram being explained, a face) clear of those. Approximate figures for a 1080x1920 frame:

| Edge | Keep clear | In pixels |
|---|---|---|
| Top | about 14% | 270 |
| Bottom | about 22% | 420 |
| Right | about 10% | 108 |

These are rounded estimates, not Instagram's published numbers, and the interface changes. Check
them against Instagram's current guidance before relying on them, and against a real upload of a
test reel. Backgrounds and atmosphere can run to the edge; it is key content that stays inside.
A design system that follows them:

```ts
export const design = defineDesignSystem({
  stage: { width: 1080, height: 1920 },
  grid: { marginX: 108, marginTop: 270, marginBottom: 420 },
});
```

`validate_scenes`'s safe-area check is a floor (4% in from the sides, 5% from the top and bottom,
as fractions of the real frame), not this zone. The Reels zone is a design decision, so it is
checked by looking at a still.

### What follows the frame size

These read the composition size, so the same scene source works at 1920x1080 and at 1080x1920.
Each is checked at both sizes in `vertical.test.mjs`.

- `CinematicScene`: `stageWidth` and `stageHeight` default to the composition size.
- `DotGrid`: `w` and `h` default to the composition size, so the grid covers the whole frame.
- `Letterbox`: bars are 64/1080 of the frame height, about 114px at 1920 tall.
- `RepoCta`: laid out from the frame centre, so the card is centred in either shape.
- `defineDesignSystem`: the layout grid scales to the `stage` it is given.
- `validate_scenes`: the static framing check uses the project's `videoConfig`; render mode already
  measured the real composition.
- `export_rendition` with `format: "reels"`.

Anything not on this list has not been checked at 1080x1920. Measure it with `validate_scenes`
(`render: true`) and a still before trusting it in a vertical video.

## Run records and facts

A beat's text says what was intended. A run record says what actually happened. Each tool
that captures, composes, renders or validates writes one small JSON file to
`.openvidstudio/runs/<tool>-<timestamp>.json` when it finishes: a capture records what it
captured (URL or command, output path, real size on disk, whether the page settled), a render
records the size of the file that landed and which beats it rendered or reused from the cache,
a validator records its findings. Writing a record never fails the tool: an unwritable runs
directory is logged to stderr and the tool's own result is returned untouched.

`collect_facts` (one call per video) merges the records that belong to a video into
`src/videos/<video>/facts.json`, keyed by beat id, and compares them with `beats.json`:

- `provenance` per beat is `capture` (a capture tool ran for it), `construction` (the beat
  claims no capture, e.g. `dom-demo`) or `unverified` (it claims a capture and none ran).
- `discrepancies` lists a beat that claims a capture with no record behind it, and a recorded
  capture whose file is no longer on disk.
- Only the latest record per tool is kept per beat. Older records stay in the runs directory.

Per-beat records (captures) take no video name, so they belong to every video whose
`beats.json` has that beat id. Video-level records (render, validate, stitch) are matched by
`videoName`. `validate_beats` validates a draft that is not on disk, so it only writes a record
when you pass it `videoName`.

Not instrumented, on purpose: `plan_*`, `write_*`, `scaffold_scene` and the other tools that
draft something for approval produce intent, which beats.json and brief.json already hold;
`extract_brand`, `contact_sheet` and `qc_extract_frames` write their own artifacts, which are
the evidence. `render_stills`, `compose_score` and `write_description` are the judgment calls: they
write files the next tool reads, and nothing downstream checks a claim against them yet.

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
| Terminal cast | `public/terminal/<beatId>.json` | `capture_terminal` | a `TerminalReplay` scene |
| Translated VO | `public/audio/vo/<lang>/<beatId>.mp3` | `generate_narration` with `languages` | `stitch_composition`, as that language's composition |
| Beat segments and their cache | `output/segments/<video>/` | `render_video` with `incremental` | `render_video`, on the next run |
| Visual baseline | `.openvidstudio/visual-baseline/<video>/<beatId>.png` | `visual_regression` | `visual_regression`, on the next run. Commit these |
| Final master, poster, share copy | `output/<video>-final.mp4`, `output/<video>-poster.jpg`, `output/<video>-share.mp4` | `finalize_video` | pick up / upload from here |
| Run record | `.openvidstudio/runs/<tool>-<timestamp>.json` | `capture_screenshot`, `capture_screen_recording`, `capture_terminal`, `capture_desktop`, `capture_mobile`, `import_higgsfield_clip`, `stitch_composition`, `render_video`, `finalize_video`, `validate_scenes`, `validate_beats` (with `videoName`) | `collect_facts`. Local evidence, not source: gitignore `.openvidstudio/runs/` |
| Facts | `src/videos/<video>/facts.json` | `collect_facts` | a reviewer, or any check that wants to hold a claim up against what ran. Commit it if you want it reviewed |
| Layered capture | `public/images/<beatId>-bg.png`, `<beatId>-layer-<name>.png`, `<beatId>.layers.json` | `capture_screenshot` with `layers` | `LayeredShot`, from the manifest. Paths inside it are relative to `public/` |
| Capture sidecar | `<asset>.capture.json` (next to the screenshot it describes) | `capture_screenshot`, `capture_screen_recording`, `release_diff` | `docs_drift` / `release_diff`, to re-capture at the same CSS viewport and scale the reference actually used |

Every path in this table is also the default a beat's `artifacts` field
(`PLANNING.md` §4.5) resolves to when omitted; set `artifacts.screenshotPath` /
`recordingPath` / `voPath` / `terminalPath` explicitly only when overriding it.

**Non-browser captures write to the same paths.** `capture_desktop` and
`capture_mobile` both produce `public/video/<beatId>.mp4`, exactly like
`capture_screen_recording`, so a scene does not need to know which backend filmed it.
`capture_terminal` is the exception: it records timed text rather than pixels, so it
writes a JSON cast instead of an mp4. See `PLANNING.md` §4.6 for when to use each.

**One language per composition.** The base language keeps the flat
`public/audio/vo/<beatId>.mp3` path, so nothing that already has narration moves.
Every other language lives under its own tag, and `stitch_composition` with
`languages` emits one composition per language over a single shared scene tree.
`requireNarration` is then enforced per language: a video fully narrated in
English and half narrated in Hindi is a failure of the Hindi cut, and one
combined complaint would hide which cut broke.

**VO omission is reported (changed 2026-09-09).** `stitch_composition` still renders a
beat with no narration file rather than failing, because a deliberately silent beat is
legitimate. What changed is that it no longer says nothing: the result now carries
`voBeatsMissing` and a plain-language `warnings` entry naming every beat that will play
silent and the exact path it looked for. Pass `requireNarration: true` (which the
2min-demo and 5min-demo presets should) to turn that into a hard failure instead. The
old behaviour, described below, is why this exists.

**Historical note on why.** `stitch_composition` checks
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

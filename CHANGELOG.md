# Changelog

All notable changes to openvidstudio are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Docs

- **README and llms.txt now disclose Remotion's own license, not just openvidstudio's.**
  openvidstudio's code is Apache-2.0 and free for anyone, but it renders through Remotion,
  which is free only for individuals, non-profits, evaluation use, and for-profit companies
  with up to 3 employees; a larger company needs a paid Remotion Company License
  (remotion.pro) to render with it. The README's badge and llms.txt's tagline said
  openvidstudio was free without that caveat, which reads as "free to use" to a company
  evaluator when the Remotion dependency underneath it isn't, for them. Tech stack and
  License sections now state the split plainly.

### Fixed

- **`docs_drift` no longer treats a reference screenshot's pixel size as the CSS viewport
  to re-capture at.** A 1440x900 capture at the default 2x scale is a 2880x1800 PNG on
  disk; re-navigating to a 2880-wide viewport is a different, much wider layout, not the
  page that was actually captured, so every default-scale capture reported 26-40% drift on
  pages that never changed. `capture_screenshot`, `capture_screen_recording`, and
  `release_diff` now write a `<asset>.capture.json` sidecar (url, viewport,
  deviceScaleFactor, zoom, interactions, capturedAt) next to every capture; `docs_drift`
  resolves the viewport to re-capture at from an explicit binding, then that sidecar, and
  only falls back to a narrow heuristic (the reference's pixel size is exactly double a
  common CSS viewport) for a legacy asset with neither, otherwise asking for an explicit
  binding instead of guessing. Verified: v1.1 captures compared against v1.1 itself report
  0 drift; compared against v1.0, only the route an actual code change touched reports
  drift (9.70% changed), everything else 0.

- **`extract_brand` now finds a palette on a repo with no CSS design tokens, if the logo
  carries one.** It previously resolved nothing on such a repo even when the logo SVG
  visibly carried the brand's real colors. When no CSS token or Tailwind config yields a
  palette, it now parses the chosen logo SVG's fill colors, ranks them by pixel area, and
  maps the top ones to accent/accentAlt/success/danger (plus a background token for an
  exact full-bleed rect), naming the logo as the source. Fonts also now fall back to
  `@fontsource/*` package.json dependencies when no CSS variable or `next/font` import
  named one. Verified against this repo's own `brand/logo-lockup.svg`: resolves
  `#8b5cf6`, `#f87171`, `#3b82f6`, `#2dd4bf` on `#0a0a0a`, each attributed to the logo.

- **Renders no longer require network access.** `TerminalReplay`, `RepoCta`, and
  `ChecklistPanel` each called a `@remotion/google-fonts` loader at module scope, and
  every scaffolded scene imports the core index, so any render with no route to
  fonts.gstatic.com (an offline machine, a corporate proxy) crashed before producing a
  single frame. Inter (400-900) and JetBrains Mono (400, 700) now ship as bundled woff2
  files (`templates/default/public/fonts/`, sourced from `@fontsource/inter` and
  `@fontsource/jetbrains-mono`, regenerate with `packages/core/scripts/gen-fonts.sh`),
  loaded by a new `packages/core/src/localFonts.ts` via `FontFace` plus
  `delayRender`/`continueRender`. Every network font loader is gone from core. Verified
  with a real render, network blocked, of all three components: the delayRender handle
  clears in under 100ms per frame and the output shows real Inter/JetBrains Mono, not
  fallback glyphs. CI gained an `offline-render` job
  (`scripts/offline-render-check.mjs`) that fails if this regresses.

- **`render_video`'s incremental path no longer drifts audio out of sync with video.**
  Each per-beat segment's AAC track ran slightly longer than its video (encoder padding),
  and stream-copying every segment's audio under one concat pass stacked that drift beat
  over beat: a 16-beat, 5400-frame video came out ~0.85s audio-behind by the end. Video now
  concatenates from per-segment files with their audio isolated into a fresh container first
  (a segment's own container duration otherwise still reflects its longer audio track even
  after dropping the audio stream, so the old approach left a silent gap at every join
  instead of drift); audio is decoded to raw PCM per segment, trimmed/padded to exactly
  duration/fps samples, concatenated as samples, and encoded to AAC once at the end.
  Verified on a synthetic 16-beat composition: joined video and audio both land within 1ms
  of frames/fps, and a transient placed at a known offset lands within 1 frame of its
  expected time.

- **`capture_screen_recording` at the default `deviceScaleFactor` (2) no longer leaves
  3/4 of the frame grey.** Playwright's `recordVideo.size` is in the same CSS-pixel units
  as `viewport`, not physical pixels, and it only ever scales a painted frame *down* to
  fit that size, never up. The recording context was asking for a canvas pre-multiplied
  by `deviceScaleFactor`, i.e. larger than the page ever paints into, so the extra area
  was never filled. `recordVideo.size` is now the unscaled viewport; `deviceScaleFactor`
  alone drives the actual resolution Chromium renders at, same as `capture_screenshot`.
  **Output dimensions change for anyone already calling this.** A 1280x800 viewport at the
  default `deviceScaleFactor` used to produce a 2560x1600 file with content in one quarter
  of it; it now produces a filled 1280x800 file. Verified by recording a four-quadrant page
  before and after: before, three quadrants read flat grey (rgb 128,128,128); after, all
  four carry their real colours.

### Added

- **Music-only videos: `narration: "none"`, `stitch_composition`'s `musicBed`, and
  `overrides.tsx`.** `validate_beats` required every beat's `vo` and held it to the spoken
  words/sec budget, so a text-and-music video with no narration at all could never pass
  `write_beats_file`. `beats.json` gains an optional top-level `narration: "voice" | "none"`
  ("voice" assumed when omitted, so every existing file stays valid); under `"none"`, `vo`
  is optional and unpaced, and a new optional per-beat `onScreenText` is checked against a
  reading-time budget instead (see `SCRIPT.md`). `stitch_composition` gains
  `musicBed: { file, volume }` (volume defaults to 0.18 with narration, 1.0 without), and
  imports `src/videos/<name>/overrides.tsx` when present as a dev-authored extension point
  it only ever references, never writes, so a hand-added layer survives a re-stitch.

- **`deterministic` on `capture_screenshot`/`capture_screen_recording`, for a capture
  that is the same twice.** Opt-in (default off): freezes `Date.now()`/`new Date()`
  (`page.clock.setFixedTime`, which "keeps all the timers running" rather than pausing
  them, so `settle` and any real animation are unaffected) and seeds `Math.random()` via
  an init script, both before the page's own scripts run. Verified the way the issue asked:
  a page that prints `Date.now()`, `Math.random()` and eight randomly sized bars captures to
  two different PNGs with the flag off and to two byte-identical PNGs with it on. Screenshots
  are the provable half; an MP4 also depends on x264's own run-to-run behaviour, so a
  recording is closer to reproducible than it was, not guaranteed bit-exact. Does not force a
  CSS/JS animation to a specific phase -- that stays a separate, harder problem.
  `visual_regression` gained a matching `exact` flag that gates on any pixel difference
  (`pixelThreshold`/`changedRatio`/`meanDelta` all 0, compared at the baseline's own
  resolution instead of downscaled), meaningful once the beats being diffed were captured
  with `deterministic: true`. beats.json's `CaptureVisual.deterministic` mirrors the same
  flag on the manifest.
- **`catalog_motion_primitives` and `add_motion_primitive`, a first batch of reusable
  motion pieces.** `scaffold_scene`'s 10 templates are whole scenes; below that there was
  nothing reusable, so a beat that wanted a count-up number or a fanned card layout got
  that animation hand-derived from `motion.ts`'s tween/spring math again every time (the
  `stat` template's own counter is a literal hardcoded `"0"` for exactly this reason).
  `catalog_motion_primitives` searches a small, bundled, local registry (a count-up stat
  card, a fanned card stack, a logo outro, a typewriter line, a beat-timeline strip) by
  free-text query; `add_motion_primitive` writes the named entry's real `.tsx` source
  into `src/videos/<videoName>/primitives/`, ready to import into a scene unmodified. No
  hosted tier or account, same as the built-in SFX pack.
- **`openvidstudio` and `bgmusic` skills now mirrored to every tool directory**, not just
  `.claude/skills`: `.agents/skills`, `.cursor/skills`, `.github/skills`,
  `.opencode/skills` and `.windsurf/skills` now carry them alongside the vendored
  `remotion-*` skills. `scripts/sync-skills.mjs` generates the copies from
  `.claude/skills` (their one source of truth) and a `--check` run is wired into CI, so a
  skill added later can't silently stay `.claude`-only again.
- **`find_music_bed` and `import_music_bed`, real music without a licence problem.** Two
  CC0-1.0 catalogs are searchable from the server: `btahir/open-lofi` (166 lo-fi tracks
  with category metadata) and `SoundSafari/CC0-1.0-Music` (~9,200 tracks aggregated from
  freepd, chosic, Free Music Archive, freesound and Pixabay). `find_music_bed` matches
  mood words against titles and categories and caches its index at
  `output/music-index.json`; `import_music_bed` fetches the chosen track, trims it from
  a start point, fades both ends and normalizes to a LUFS target so the bed sits under
  narration, then writes a `<file>.source.json` and a `MUSIC-SOURCES.md` row. Both
  catalogs are public domain, so that record is provenance rather than an attribution
  obligation. Nothing is vendored: open-lofi ships its tracks only inside a 554MB release
  zip, so an import reads the zip's central directory over HTTP range requests and pulls
  just the chosen member's bytes. A `bgmusic` skill in `.claude/skills/` covers when to
  reach for this over the two synthesized beds.
- **Three CC0 sounds join the built-in pack.** `bong.wav`, `drop.wav` and `click_soft.wav`
  come from [Kenney](https://kenney.nl) under CC0 1.0, converted to the pack's 48kHz mono
  format, with `SoftClick`, `Bong` and `Drop` components in `@openvidstudio/core` and
  entries in `plan_sound_effects`. The pack stays free of any obligation, synthesized or
  public domain, and `public/sfx/CREDITS.md` now records which file is which and why.
- **`pulse-bed.mp3`, a beat-locked music bed.** A synthesized kick-and-hat bed at a fixed
  112bpm, joining the existing ambient `music-bed.mp3` in the built-in pack. Generated by
  `packages/core/scripts/generate-pulse-bed.mjs`, not recorded and not sourced from a
  third party, so its beat grid is exact by construction rather than detected: the file
  carries no rights of its own, same as the rest of the synthesized pack. `plan_sound_effects`
  matches it on "rhythmic"/"pulse"/"beat-locked", and `stitch_composition` prefers it over
  `music-bed.mp3` when a project has copied both into `public/audio/`.
- **`plan_music_cues`**: beats and strong cues, in seconds, for a music track. Reads
  `pulse-bed.mp3`'s cue grid straight off disk (a file it ships next to). For any other
  track it decodes the audio and estimates a grid from an RMS onset envelope and one
  autocorrelation pass, caching the result next to the track as `<stem>.cues.json`. See
  `STYLE.md`'s new "Beat-locked cuts" section for how a scene cut should use the result.
- **`export_rendition` gains a `"poster"` format.** Picks a beat's midpoint (or an exact
  timestamp) as the video's poster frame, writes it as a jpg, and, unless disabled, writes
  a second copy of the render with that frame baked in as the file's embedded thumbnail
  (an `attached_pic` stream, copied not re-encoded, so quality is untouched). Fixes the
  default idle thumbnail being whatever a video's first frame happens to be, usually black
  or mid-transition.
- **`tone`, an optional top-level `beats.json` field.** One of `SCRIPT.md`'s new Tone
  presets (`default`, `release`, `walkthrough`, `quiet`), read by nothing but documented so
  a multi-session video's narration reads as one register instead of drifting beat to
  beat. See `PLANNING.md` §7.
- **`@openvidstudio/capture`, a package of its own.** Zoom compensated browser capture,
  interaction replay, and the desktop, mobile and terminal backends, with no dependency
  on Remotion, React, or `@openvidstudio/core`. The hard, defensible part of this project
  is getting a true frame out of a running product, and it was welded to a video pipeline,
  so a team that wanted reliable capture and no video had to take everything or rebuild
  the hard part. `@openvidstudio/mcp-server` now consumes it.
- **Per-beat render caching.** `render_video` gains `incremental`: every beat renders to
  its own segment under `output/segments/<video>/`, and the segments are joined with
  ffmpeg's concat demuxer under stream copy, so a reused segment's bytes reach the final
  file untouched. A segment is reused only when the beat's JSON, its scene source, every
  artifact it references, its narration, and the project-wide inputs (brand tokens, the
  generated composition, the music bed) all hash identical. This is what makes `diff_beats`
  actionable: editing one caption in a ten beat video re-renders one beat.
- **`visual_regression`**: each beat's midpoint frame against a stored baseline, with a
  per-beat verdict, a diff image, and markdown ready to post on a pull request. The first
  run writes the baseline instead of failing. `templates/default` ships the workflow and
  the script, rendering in draft and incremental mode.
- **`docs_drift`**: re-captures the pages a video's beats came from and reports which
  clips have gone stale. Bindings are inferred from the manifest, since a browser
  screenshot beat already records its url and interactions.
- **`release_diff`**: given two refs and a running instance of each, works out which
  routes changed, captures both sides, drops the routes that did not actually change on
  screen, and drafts a before/after manifest. The filtering is the point: a what's-new
  clip showing four identical pages is worse than no clip.
- **`export_rendition`**: a README GIF through a real two-pass palette, a docs screenshot
  set with an index built from each beat's own narration, or App Store and Play Store
  frames at the exact dimensions each store demands. All three read the finished render,
  so the docs images cannot drift from the video.
- **`reformat_vertical`**: a 9:16 cut with the crop chosen per beat from the manifest. A
  terminal beat crops left, because a terminal is text pinned to the left margin and
  centring it cuts the command in half; a mobile recording is fitted and padded rather
  than cropped. Overridable per beat with `vertical.focus` or `vertical.crop`, both
  validated. Active speaker tracking is deliberately out of scope.
- **`plan_shots`**: ranks what a demo should show from the repository's own emphasis, with
  the evidence for every entry: README order, the newest changelog section, which routes
  exist and how often the docs link them, whether the package ships a command, and where
  the recent commits went. It feeds `PLANNING.md`'s intake rather than replacing it.
- **Multilingual narration.** `generate_narration` takes `languages`, reading translated
  lines from each beat's `voTranslations` and writing every non-base language to
  `public/audio/vo/<lang>/<beatId>.mp3`. `stitch_composition` emits one composition per
  language over a single shared scene tree, with `requireNarration` enforced per language.
  The `omnivoice` engine covers 600+ languages zero-shot and, given a reference clip, uses
  one cloned voice across all of them. Translations are not drafted here: a translation is
  content and goes through the same approval the original script did.
- **Wayland capture.** `capture_desktop` reads `XDG_SESSION_TYPE` and routes a Wayland
  session through ffmpeg's `pipewiregrab`, checking the local ffmpeg actually has the
  filter first. Wayland has no window-title selector, so `window` is refused there rather
  than silently capturing the whole screen, and the portal consent prompt is documented
  rather than engineered around.
- **A real pty for `capture_terminal`**, when the optional `node-pty` module is installed,
  so a program keeps its colour and cursor addressing. Falls back to pipes otherwise, and
  reports which mode produced the cast.
- **A programmatic export surface** on `@openvidstudio/mcp-server`, for callers with no
  agent in the loop (CI, cron). Deliberately short: the tools that draft or write a
  manifest need an agent's judgement and a human's approval.

- **Capture without a browser.** Three new tools remove the assumption that filmable
  software has a URL, which previously forced every beat about a desktop app, a phone,
  or a CLI to degrade into a hand-authored `dom-demo` panel:
  - `capture_desktop` records a window, a region, or a whole display through ffmpeg,
    using the right device per platform (gdigrab on Windows, avfoundation on macOS,
    x11grab or pipewiregrab on Linux depending on the session type). Output is forced to even dimensions, since h264/yuv420p cannot
    encode an odd-width region and a hand-picked rectangle very often is one.
  - `capture_mobile` records an Android device via adb screenrecord, or an iOS
    Simulator via `xcrun simctl`, remuxing both so Remotion can seek them. Refuses
    Android recordings over 180 seconds rather than returning the silently truncated
    file `screenrecord` would produce.
  - `capture_terminal` records a real command run as timed text rather than pixels,
    writing a JSON cast to `public/terminal/<beatId>.json` that replays through
    `TerminalReplay`, so one capture stays sharp at any resolution and picks up the
    brand palette. It uses a real pty when `node-pty` is installed and pipes
    stdout/stderr otherwise, reporting which.
- **`source` on a recording beat**: `"browser"` (default, so every existing
  `beats.json` is unchanged), `"desktop"`, `"mobile"`, or `"terminal"`, each with its
  own validated required fields. See `PLANNING.md` §4.6.
- **`existing-asset` captureMethod**, for real screenshots a project already publishes.
  `attribution` is required: an unattributed borrowed frame reads as a real capture,
  which is the exact dishonesty the rest of the pipeline is built to avoid.

- **Brand-lock gate**: `render_video` now refuses to run unless `src/brand.ts`
  exists (written by `extract_brand`), so a video never ships wearing
  openvidstudio's own default navy/Inter look by accident. Pass
  `skipBrandLock: true` when a project deliberately has no brand to extract.
  Result now also reports `brandLocked`.
- `PRESETS.md`: fixed recipes over the existing tool chain for five common
  video shapes. **gif-demo** (single-beat, no narration/music, capped under
  15s, real capture only, GIF output via the CLI's extension-based codec
  inference), **screenrec-only** (one continuous `capture_screen_recording`
  spanning the whole flow, one beat, no per-beat choreography, light
  captions), **remotion-only** (no capture step at all, pure `dom-demo`/
  `higgsfield` motion graphics), **2min-demo** (fixed 6-beat structure capped
  at 2:00, narration+captions mandatory), **5min-demo** (extends the real
  six-chapter structure `EA/launch_plans/TODO.md` proved out for the project's
  own launch video into a fixed ~5:00 beat arc for any project). A sixth
  candidate, vertical reformat with active-speaker tracking, is flagged as
  real and validated (r/reactjs feedback) but only half scoped: the manifest-driven
  crop shipped as `reformat_vertical`, and active-speaker tracking stays out, because it
  needs real face and audio analysis rather than a recipe over the existing tools.
- `diff_beats`: compares an edited `beats.json` draft against the version already on
  disk and returns a per-beat rerun plan (added/removed/unchanged/changed, which
  fields changed, whether capture or `scaffold_scene` need to rerun for that beat,
  whether its output files exist on disk). Read-only, writes nothing. Makes editing
  one beat in an already-built video a targeted rerun instead of redoing the whole
  pipeline. Superseded in part by `render_video`'s `incremental` mode above: the
  whole-video `rerenderNeeded` flag is now something that can actually be acted on per
  beat rather than only reported.
- Two optional per-beat `beats.json` fields, `transition` (`"cut"` | `"whip"` |
  `"fade"`, `"cut"` assumed if omitted) and `artifacts`
  (`screenshotPath`/`recordingPath`/`voPath` overrides of the convention output
  paths), both validated by `validate_beats`. First step of hardening the manifest
  into a fully reviewable product boundary: a dev can now read `beats.json` alone
  and know the transition and asset path for every beat, without opening
  capture.ts or relying on the path convention from memory. See `PLANNING.md` §4.5.
  Every existing `beats.json` stays valid unchanged, both fields are additive.
- `templates/default` now ships the official Remotion agent-skills bundle
  (`remotion-best-practices`, `remotion-markup`, `remotion-captions`,
  `remotion-render`, `remotion-saas`, `remotion-multimedia`,
  `remotion-interactivity`, `remotion-maps`, `remotion-studio`,
  `remotion-upgrade`, `remotion-create`, `remotion-docs`) for Claude Code,
  Cursor, Windsurf, OpenCode, and GitHub Copilot, so a coding agent writing
  scenes in a scaffolded project has the same Remotion knowledge base an
  agent working directly in a hand-built Remotion project would.
- `public/imported_audios/`: a scaffolded project's own folder for sound
  effects or music dropped in by hand or fetched via `plan_sound_effects`,
  kept separate from the synthesized, rights-free pack in `public/sfx/` so
  it's always clear which sounds carry licence terms. Documented in
  `NARRATION.md` and `PIPELINE.md`.

### Changed

- `render_video`, `contact_sheet`, and `qc_extract_frames` now write to
  `output/` by default instead of `out/`, a more discoverable name for the
  folder a finished render, contact sheet, or QC stills get picked up or
  uploaded from. `output/` ships with its own README and stays gitignored
  (renders are build output, not source).
- `plan_sound_effects` now saves and checks imported sounds in
  `public/imported_audios/` instead of alongside the built-in pack in
  `public/sfx/`; its `sfxDir` result field is renamed `importedAudiosDir`.
- **Typing sound is now one recording.** `typing-effect.mp3`, a copyright-free typing
  recording, replaces the four synthesized key sounds. `TypingSfx` plays it across each
  typed run instead of firing one sample per character, and loops it for long runs. The
  rest of the built-in pack is synthesized or CC0, so a rendered video still carries no
  audio obligations.

### Removed

- `key_a.wav`, `key_b.wav`, `key_c.wav` and `key_enter.wav`, with the `KeySound` and
  `EnterKey` components that played them. Use `TypingSfx` for typed text.

## [1.0.0] - 2026-09-02

Initial public release: the pnpm monorepo, the MCP server, and the public
site, built end to end.

### Added

- pnpm monorepo scaffold, with `@openvidstudio/core` extracted from the
  original private vidstudio pipeline and a `templates/default` project
  shell.
- `@openvidstudio/mcp-server`: the MCP server itself, exposing
  `init_project`, `validate_beats`, `write_beats_file`, `scaffold_scene`,
  `stitch_composition`, `render_video`, and `qc_extract_frames`.
- `capture_screenshot` and `capture_screen_recording` tools, with
  zoom-desync compensation so a capture comes out pixel-accurate regardless
  of a Playwright profile's per-origin zoom level.
- `import_higgsfield_clip`, gated behind a project's own
  `hasHiggsfield` config flag, plus `HIGGSFIELD.md` documenting that
  tier's scope and prerequisites.
- `apps/site`: the public Next.js site, built directly from
  `packages/docs/*.md` rather than a hand-copied duplicate.
- `/docs`, rendering all seven pipeline docs from their real source files.
- `/gallery`, with a real sample video built end to end by the pipeline
  itself (`init_project` through `render_video`), not hand-edited.
- Landing page: hero, feature tiers, and quickstart, with a composition
  pass tying every section to the rest of the site.

### Fixed

- Windows `npx.cmd` spawn `EINVAL` in `render_video`.
- `templates/default`'s tsconfig `lib` mismatched against
  `packages/core`; `@openvidstudio/core`'s package.json `type` field.
- `@openvidstudio/core` now vendored (not monorepo-relative) so a
  scaffolded project actually installs standalone, outside this repo.
- `beats.json`'s `Interaction` schema unified across tools; a failing
  worked example in `PLANNING.md` corrected.
- An undisclosed second hero gradient removed from the landing page.
- `/docs`' doc list now derived from a real directory read instead of a
  hardcoded list, so it can't silently go stale against `packages/docs/`.
- Final-review findings across `apps/site` and the `mcp-server` test suite.

### Changed

- Root workspace `workspaces` field corrected; em dashes stripped from
  `@openvidstudio/core`'s comments.
- Asset conventions (screenshot, recording, VO, music-bed paths)
  documented directly in `PIPELINE.md`; `BrowserFrame`'s provenance claim
  corrected to match what it actually renders.
- vidstudio's original private protocol docs ported into
  `packages/docs/` and generalized for a public, multi-project audience.

### Docs

- Review findings addressed across the doc set; the Motion.so comparison
  note restored; minor cross-reference fixes.

### Tests

- Real `render_video` invocation tests added to the mcp-server test suite.

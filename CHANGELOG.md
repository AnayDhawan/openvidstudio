# Changelog

All notable changes to openvidstudio are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

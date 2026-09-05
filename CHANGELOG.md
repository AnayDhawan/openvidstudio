# Changelog

All notable changes to openvidstudio are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

# Changelog

All notable changes to openvidstudio are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`init_project` no longer copies untracked files from the template's `output/` folder (#139).** `copy-template` now copies the template from what git tracks (and, outside a checkout, allows only `output/README.md` and `output/.gitignore`), and `init_project` skips any other file under `output/`, so a render left on one machine does not land in every new project.
- **`render_video` no longer blocks every Supernova project at the brand-lock gate (#136).** A project with `production.mode: "supernova"` skips the gate and reports `brandLocked: false` with a `brandLockSkipReason`; a standard project without `src/brand.ts` still gets the gate. The `skipBrandLock: true` workaround is gone from SUPERNOVA.md and the supernova skill.
- **`validate_scenes` no longer warns about camera keyframes on every Supernova scene (#137).** In a lesson the camera checks (fewer than two keyframes, a camera that never moves) are dropped; a standard project keeps both. The "ignore it" lines are gone from SUPERNOVA.md and the skill.

### Added

- **`preflight` checks that edge-tts can synthesize, and a refusal is reported with its cause (#140).** With the edge-tts engine, `preflight` shows the installed version and speaks one word to a temp file; on failure it shows the error line and `pip install -U edge-tts`. `generate_narration`'s "no usable audio" warning now ends with edge-tts's last stderr line. The version notes in NARRATION.md, SUPERNOVA.md and the skill now point at `preflight`.
- **`validate_scenes` checks a lesson's arc: `diagram-late` and `static-stretch` (#138).** In render mode, from the frames it already samples (no extra render pass), a Supernova lesson gets a warning when the first thing drawn beyond the background and the captions is later than 15 s (an error after 25 s), and a warning when sampled frames do not change, captions aside, for more than 8 s. The thresholds are the options `diagramWarnSeconds`, `diagramErrorSeconds` and `staticSeconds`. Captions are ignored by their `data-ovs-captions` box, or the bottom 22 percent.
- **`fit_beats`, a tool that sizes the beats from the measured voice (#135).** After `generate_narration` it sets each beat to the spoken length plus a pad (default 0.5 s), clamped into the 2.3 to 2.9 words per second window and rounded to whole frames, moves the later beats' starts, never changes `vo`, lists in `unfittable` any line that cannot fit with the words to cut or the frames to lengthen to, supports `dryRun`, and returns `validate_beats` on the result. The tool count is now 42 (43 with Higgsfield). `generate_narration`'s overrun note, NARRATION.md and the supernova skill point at it.

## [1.3.1] - 2026-10-19

The packages are ready for npm: each now ships a README, and `@openvidstudio/mcp-server` and `@openvidstudio/stem`
ship the Apache-2.0 LICENSE file, which they did not. Without them an npm page would have been blank. No code changes.

### Added

- **A README in `packages/mcp-server`, `packages/core` and `packages/stem`**, written for the npm page: what it is, how to add it to an MCP client with `npx -y @openvidstudio/mcp-server`, what the machine needs, where the docs are, and the Remotion license note.
- **The LICENSE file in `packages/mcp-server` and `packages/stem`**, as `capture` and `core` already had.

## [1.3.0] - 2026-10-19

Lessons get one shape. A Supernova lesson is now one concept in up to two minutes, in seven fixed beats,
and `check_script` checks the length and the chapter reference. No lesson has been published yet. Install
from a clone: the npm package is still 0.1.0 while publishing is blocked.

### Added

- **Every lesson has the same shape, and `check_script` holds two more lines of it.** A Supernova lesson is now one concept in up to two minutes, always in seven beats: hook, picture, set up, derive, use it, aha, close. SCRIPT.md gives the arc with times for a 120 second lesson, the rules (start the diagram inside 15 seconds, derive each formula line by line with a spoken form per line, say where the lesson sits, end on the check question) and a correctness routine (write `derivation.md`, check the symbolic result, the worked example and the units with code, name the assumptions, have someone who knows the subject read it). The concept card takes three optional fields: `reference` (a chapter code or "Part 2 of 4", as shown on screen), `referenceSpoken` (as said aloud) and `maxSeconds` (default 120). `check_script` now reports a `length` error when the beats add up to more than the budget, and a `reference` error when the first beat does not say `referenceSpoken` (a warning when it is missing, because then it cannot be checked). Ten new checks in `check-script.test.mjs`; the example script in SUPERNOVA.md is now the seven-beat arc and draws no finding.
- **SUPERNOVA.md says how to fit beats to the voice and how to caption them.** The voice reads plain prose at about 3 words per second and number-heavy lines at about 2.2, so beats are sized from each clip's `spokenSeconds`, then regenerated. Word timings carry no punctuation, so captions take their text from the beat's `vo` and break at sentence ends (a snippet is included). It also notes that `render_video` needs `skipBrandLock: true` for a lesson, and that `edge-tts` 7.2.8 gets a 403 from Microsoft: use 7.3 or newer.

### Changed

- **The lesson length is up to two minutes, not 60 to 90 seconds**, in the `supernova` skill (now the arc and a derive-and-verify step), SUPERNOVA.md, README and `llms.txt`.
- **`click.wav` is now a recorded double click (Mixkit, "Fast double click on mouse") instead of a 30 ms synthesized tick.** Trimmed so the first click lands on the cue frame, mono 48 kHz like the rest of the pack, peak -1.5 dBFS. `gen-sfx.sh` no longer generates it, `public/sfx/CREDITS.md` records the source and the Mixkit licence, and the docs no longer say the whole pack is licence-free: a rendered video still needs no credit. The licence text could not be read when this was added, so confirm its terms on redistribution before republishing the pack on its own.

### Docs

- **OVERVIEW.md's doc map listed six of the thirteen docs.** It now lists them all (CREATIVE, PRESETS, NARRATION, SUPERNOVA, API and TOOLS were missing), which is also where the site takes its index descriptions from.

## [1.2.0] - 2026-10-19

Supernova mode, the engine for short animated STEM lessons (built by @yakew7), a new tagline, and tools that
reject inputs they do not take. The engine is tested, but no finished lesson has been built and listened to yet
(that is #107). Install from a clone: the npm package is still 0.1.0 while publishing is blocked.

### Changed

- **The tagline is now "Code-based video generation", always with the line "Every frame of your product is a real capture, never a generated mockup."** The README headline, `llms.txt` and the GitHub description say it. The second line stays with it because "video generation" alone reads as AI video, and nothing here is generated by a model.
- **`@openvidstudio/stem` is now version 1.1.0, in step with the other packages**, and its peer range on `@openvidstudio/core` is `^1.1.0`. `release-version.test.mjs` checks all five packages share one version.

### Fixed

- **Three Windows test failures that were portability bugs, not product bugs.** `equation.test.mjs` ran `node_modules/.bin/tsc`, which on Windows is a `tsc.CMD` shim that needs a shell. `scaffold-vertical.test.mjs` compared generated files with golden files that git had checked out with CRLF line endings; it now normalises them. `graph.test.mjs` failed on one anti-aliased amber pixel from the "range 40 m" label, found past x = 40 in the 1080x1920 render; it now allows fewer than 8 amber pixels there (the curve would add dozens) and has a control that counts more than 40 where the curve is, between x = 30 and 35.

### Docs

- **The API gallery now has a picture for every new cinematic primitive, and the `DirectedShot` still has sharp text (#121).** `build-api-gallery.mjs` renders `TransitionOverlay` (one still per type: fade, whip, push, wipe, light-leak), `LayeredShot`, `MotionBlur` (a fast move, mid-way) and the six named shots (pushIn, pullOut, pan, whip, orbit, dutch), and `API.md` embeds each with alt text that says what it shows. `directedshot-start.png` and `directedshot-end.png` were re-rendered with the new sharp default (the old end still was rendered with a depth of field of 6 and smeared its text). `api-gallery.test.mjs` checks every embedded still exists, the new ones are embedded and described, each image is under 160KB, and measures the text in the `DirectedShot` still: the steepest edges in its text boxes are 198 of 255, against 41 in the old one.

### Fixed

- **`scaffold_scene` follows the project's frame size (#117).** The starter and every template hard-coded a 960,540 camera and a 1920x1080 layout, so in a 1080x1920 project scenes rendered off centre and cropped with no warning. Both now read `videoConfig` and generate the camera centre, frame position and safe width from it, and the split-panel and comparison templates stack in a portrait frame. 1920x1080 output is byte-identical to before (golden files in `scripts/tests/fixtures/scaffold-landscape/`). `ChapterHud` with no design now takes the grid for the composition size instead of the 1920x1080 one. A real-frame test scaffolds every template into a 1080x1920 project, finds no crop finding in `validate_scenes` render mode, and measures the camera centre at 540,960.
- **`plan_production`'s estimate now includes the terms it left out (#120).** The director-mode eval ran 56 minutes against an estimate of 18.5. The benchmark composition renders about 3.7x faster than a finished peak video, so the render terms now divide the measured fps by a per-level scene weight (peak 3.7 from that run, mid 2, literal 1 as before). New lines report a bundle per review round, the draft pass and the final render (preflight's benchmark now measures `bundleSeconds`), and capture time with a retry allowance. Each term is its own phase; the authoring term keeps its "engineering estimate" label. On the Acme run (60 s, peak, 3 rounds) the estimate is 38.2 minutes. The weights are calibrated on that one run and need recalibrating as more runs are timed.
- **Tools now reject an input they do not take, instead of silently dropping it (#119).** The MCP SDK builds a zod object from each tool's input shape and zod strips unknown keys, so `render_video { quality: "draft" }` (the option is `draft: true`) ran a full-quality render of about 15 minutes. Every tool is now registered with a strict schema: the error names the unknown key, lists the valid ones and suggests the closest ("did you mean `projectRoot`?").
- **`write_beats_file` now returns the `validate_beats` warnings on a successful write.** The result is `{ written: true, path, warnings }`, so an agent that goes straight to the write still sees notes such as "shot lengths are nearly uniform". Warnings never block the write (#118).

### Added

- **`CollageBroll`, a halftone paper-collage b-roll primitive (#122).** A drop-in entry in the motion primitives catalog (`catalog_motion_primitives` finds it, `add_motion_primitive` installs it; it imports only react, remotion and core): a flat colour field, black and white halftone cut-outs of images or built-in shapes, cardstock accents, cream keylines, soft shadows and fixed-seed paper grain, with pieces assembling structure first, then people, connectors and the result, each entering from empty space on a spring with no fade or zoom. A pure function of the frame, placed as fractions of the composition. A real-frame test checks the empty field before the first piece, every piece at its target at the end, the arrival order against a deliberately scrambled listing, no fade and no zoom, and identical re-renders, at both frame sizes. Documented in `API.md` with a still. Written from scratch; inspired by the look of `gbro-collage-broll`, not its prompts or text.
- **Supernova mode, part 9: the `supernova` skill, `SUPERNOVA.md` and a concept-card template (#116).** `.claude/skills/supernova/SKILL.md` (mirrored to the five tool directories by `sync-skills`) walks a lesson from `init_project` to `write_description` in order; `SUPERNOVA.md` holds the design system, the primitives, the fixed lesson voice (edge-tts, `en-US-AndrewNeural`, a proposal for the handle's owner to confirm), the Reels safe zones checked against current guidance (top 14% agrees across sources; the bottom varies from about 340 px to 35%, which is for ads), a concept-card template and a worked projectile-motion card and script. A test checks every tool the skill names is registered, that the example script passes `check_script`, and runs the steps in order on a real project through a `validate_scenes` render.
- **Supernova mode, part 8: `validate_scenes` and the disclosure rules know about lessons, plus a glow budget (#115).** In a supernova project the "numbers typed into copy without `facts.json`" check accepts a number that is in the concept card's worked example (`concept.json`) or in an `Equation`'s `tex`, and still flags one that appears nowhere; a standard project is judged exactly as before (asserted). The disclosure rule is replaced: `write_brief` needs no real or constructed split in a lesson's shot list, and `write_description` writes one line (the video is a constructed explanation, not footage) in place of the per-shot sample-content section. New in render mode, for lessons: a glow budget that counts the glowing elements (`data-ovs-glow`, from the helper in `@openvidstudio/stem`) in each sampled frame, warns above one, errors above two, and exempts a beat that holds a Nova. `ValidateScenesResult` gains `mode`.
- **Supernova mode, part 7: `generate_narration` writes word timings (#114).** With the edge-tts engine each clip gets `public/audio/vo/<beatId>.words.json`, `[{ word, startMs, endMs }]`, timed to the clip as written (every time is divided by the same 0.9 to 1.12 stretch factor). The word boundaries come from the `edge_tts` Python module through a new helper, `py/edge-words.py`: the `edge-tts` command in version 7 only writes sentence-level subtitles, not the word-level ones the issue assumed. Other engines write nothing and the result's `wordTimings` says so. `stitch_composition` copies the words next to the composition (only when some beat has them, so other compositions are unchanged) and mounts them with the new `NarrationWordsProvider`; the new `useNarrationWords(beatId)` hook in core gives `wordAt(frame)` and `frameOfWord(index)`. Tested against the real `edge-tts` service (skipped with a clear message when it is not installed), and the hook is rendered in a real browser. Documented in `NARRATION.md` and `API.md`.
- **Supernova mode, part 6: `check_script`, a lint for lesson scripts (#113).** A new tool (no model call) that reads `beats.json` and a small concept card (`concept.json`: `{ goal, terms, example }`) and reports findings with a severity, each pointing at a beat: sentence length, Flesch-Kincaid reading level, concept-card terms defined at first use, no more than two new terms a beat, each `Equation`'s `spoken` string present in its beat's narration, a hook that is a question or holds a number and does not open "in this video", words per second against the beat length (sharing `validate_beats`' own budget through a new exported `voPaceCheck`), and a last beat that ends with a question. A good script draws no finding; a deliberately bad one fires each of the eight checks once, and fixing one removes only its finding. The lesson script rules are in `SCRIPT.md`. Tools: 41 (42 with Higgsfield).
- **Supernova mode, part 5: `FreeBody` and `ArrayViz` (#112).** In `@openvidstudio/stem`: `FreeBody` (an object with labelled force arrows, each exactly `magnitude * scale` px long with a scale bar so the picture is honest, arriving one at a time, with an optional net-force arrow and a tilt for a block on a slope) and `ArrayViz` (cells holding values, named pointers, a highlighted range, a dimmed range, and a pointer that can be the Spark). Real-frame tests at 1920x1080 and 1080x1920 measure arrow lengths against the magnitudes, the highlight against the cells it was given, and pointer positions against the cell centres. The two sample scenes are a block on a slope and binary search. Documented in `API.md` with stills.
- **Supernova mode, part 4: `Equation`, with a spoken form, and the maths font decision (#111).** `Equation` in `@openvidstudio/stem` typesets TeX in sans-serif maths and reveals it term by term as a pure function of the frame. `spoken` (the equation as it is said) is required by the types and at runtime and is exposed as `data-spoken` for the script lint. Renderer: MathJax 4 with its Fira maths font (SVG output) over KaTeX, which leaves serif `sin`, `cos` and theta with `\mathsf`; the comparison, with two screenshots, is in `API.md`. It runs from the project's own `public/mathjax/` (copied by `init_project`, generated from the installed packages at build time, not checked in), with its speech worker switched off, so a render needs no network. `scripts/offline-render-check.mjs` now also renders an Equation and a Spark in a supernova project with the network blocked. A fully revealed equation matches an unrevealed reference render pixel for pixel; the real-frame tests run at 1920x1080 and 1080x1920.
- **Supernova mode, part 3: `Axes`, `Plot` and `NumberLine` (#110).** In `@openvidstudio/stem`: `Axes` (labelled axes, ticks, gridlines in the dim token, and a graph-to-screen mapping exposed through `useAxes()`), `Plot` (a sampled `y = f(x)` with a draw-on, a tangent at a given x, a shaded area between two x values and marked points) and `NumberLine` (ticks, labelled points, open or closed intervals, an arrow, and `useNumberLine()` so a Spark can ride it). Sizes come from the composition and no stroke is thinner than `lineWeight()`. Real-frame tests at 1920x1080 and 1080x1920 work out each expected pixel independently (`y = x squared` through (2, 4), the draw-on half-way and complete, a tangent slope measured from two points, projectile motion with its range and peak marked as the fixture). Documented in `API.md` with stills.
- **Supernova mode, part 2: `Spark` and `Nova` (#109).** In `@openvidstudio/stem`: `Spark` (a bright core, a bloom and a fading trail along a path of local time or keyframes) with the behaviours `trace`, `carry`, `orbit`, `split`, `fall` and `walk`, and `Nova` (nothing before `at`, a three-frame flash, a decelerating shockwave ring, the children condensing from particles; `at` or a named impact from the music clock). Both draw their glow through one `Glow` helper tagged `data-ovs-glow`, so the glow budget can be counted from a rendered frame. Scatter comes from a seeded hash, sizes from `useVideoConfig()`. Real-frame tests at 1920x1080 and 1080x1920 (positions, trail falloff, flash brightness, ring expansion, formed content, byte-identical re-renders). Documented in `API.md` with stills; `build-api-gallery.mjs` now also renders a 1080x1920 stem gallery.
- **Supernova mode, part 1: `packages/stem`, a production mode flag and the Void + Spark design system (#108).** New workspace package `@openvidstudio/stem` with `supernovaDesignSystem(subject)` (Void base `#07060B`, warm white text that is never pure white, one accent per subject: math, physics, cs, chemistry, biology), a new `void-spark` motif (added in `designSystem.ts` and `writeBrief.ts`), and Space Grotesk (SIL OFL) loaded from local files. `production.mode` (`"standard"` by default, `"supernova"`) is accepted by `init_project` and read by `validate_beats`, `write_brief` and `plan_production`; a lesson needs no creative level. `init_project` with `mode: "supernova"` vendors stem into the project (`copy-template.mjs`, as for core), copies the font, and defaults to 1080x1920; a standard project's files, config and `package.json` are unchanged (asserted).

## [1.1.0] - 2026-10-19

Director mode, a cinematic camera, native 9:16, and a score that does not tick. Lesson videos
(Supernova, tracked in #107) are not in this release. Install from a clone: the npm package is
still 0.1.0 while publishing is blocked.

### Docs

- **README and CONTRIBUTING rewritten to be plainer and more welcoming.** The README now explains
  what the tool does in five steps, leads the install with the clone route, and says outright that
  `npx -y @openvidstudio/mcp-server` installs 0.1.0 from September (about 27 tools, no director
  mode) while publishing is blocked. It no longer claims `@openvidstudio/capture` is published
  (it is not on npm) or that `npx` gives forty tools. Node is "20 or newer" everywhere, matching the
  packages' `engines` field and CI. CONTRIBUTING covers setup, where things live, how to run one
  test or all of them, and what a good pull request looks like. `llms.txt` and the package
  descriptions match.
- **README and llms.txt now disclose Remotion's own license, not just openvidstudio's.**
  openvidstudio's code is Apache-2.0 and free for anyone, but it renders through Remotion,
  which is free only for individuals, non-profits, evaluation use, and for-profit companies
  with up to 3 employees; a larger company needs a paid Remotion Company License
  (remotion.pro) to render with it. The README's badge and llms.txt's tagline said
  openvidstudio was free without that caveat, which reads as "free to use" to a company
  evaluator when the Remotion dependency underneath it isn't, for them. Tech stack and
  License sections now state the split plainly.

### Fixed

- **`validate_scenes` render mode read the wrong colour for SVG text.** SVG text is painted with `fill`, but the contrast check read the inherited CSS `color`, so axis labels in a graph were reported at 1.04:1 contrast. It now reads `fill` for SVG text (found by running the lesson steps end to end).

- **The brand palette now reaches the render (#61).** The template's `sideEffects: ["*.css"]`
  let the bundler drop `src/brand.ts`, so `applyBrand` never ran and every scene rendered in the
  default navy. It now lists `./src/brand.ts`, and `validate_scenes` warns when none of
  `brand.ts`'s colours appears in a rendered frame.
- **`stitch_composition` keeps a hand-picked music track on re-stitch (#64).** A chosen track and
  its level are preserved; an auto-detected bed still upgrades when a better one is added.
- **`capture_terminal` on Windows (#66).** Python output is unbuffered and UTF-8 (`PYTHONUNBUFFERED`,
  `PYTHONUTF8`, `PYTHONIOENCODING` in the child's environment), and a bare `bash`, which resolves
  to the WSL launcher, is flagged.
- **`spawnCapture` quotes a `.cmd` shim path that contains a space (#77).**
- **The tool counts in the README were wrong in three places (#69, #70, #81)** and are now
  generated and checked.

- **`contact_sheet` no longer always fails.** Its filtergraph fed `tile` one input label
  per frame (`[t0][t1]...tile=...`), but `tile` takes exactly one input stream, so every
  call errored with "More input link labels specified for filter 'tile' than it has
  inputs." Every scaled input is now concatenated into one stream first
  (`concat=n=N:v=1:a=0`), and only that single stream feeds `tile`. Verified with a real
  ffmpeg run producing correctly-dimensioned 4-beat and 16-beat sheets.

- **`qc_extract_frames`'s end-frame seek no longer lands on the next beat**, and no longer
  reports a path for a frame it never wrote. Timestamp-based seeking rounds a target frame
  to a time that accurate-seek can land just past, returning the following frame instead
  (and, for the last beat, writing nothing at all). Extraction is now by frame index
  (`select=eq(n,N)`); every output is verified to exist and be non-empty before being
  reported, with a `midError`/`endError` instead of a phantom path otherwise. Verified with
  a synthetic 3-beat render: every beat's mid and end stills show their own color, not a
  neighbor's, including the final beat.

- **`CursorActor`'s click rings no longer follow the cursor past the click.** A ring was
  drawn at the cursor's live position on every frame it's visible, so a path that kept
  moving after a click dragged the ring with it (~100px off target in a real repro). Rings
  now anchor at the cursor's position at its own click frame. Scaffolded recording scenes
  also now make the cursor arrive ~4 frames before a click and dwell ~7 frames after.

- **`scaffold_scene`'s cta template no longer ships `your-org`/`your-repo` placeholders**
  when real info is available: owner/name now come from the git remote or package.json's
  `repository` field, chips from `license` and a simple language guess.
  `validate_scenes` also no longer false-positives "fewer than two camera keyframes" on
  `RepoCta` and other components with their own internal camera.

- **`preflight`'s Chromium check no longer guesses fixed OS cache directories.** It ignored
  `PLAYWRIGHT_BROWSERS_PATH` (a false "no chromium" when browsers lived there instead) and
  could report OK on a different build than real capture would actually launch (a version
  mismatch between this server's playwright and an older build the project already had).
  It now resolves `chromium.executablePath()` from the exact same `@openvidstudio/capture`
  import real capture uses, checks that path exists, and on failure names the exact
  resolved (missing) path and the fix command. Verified: passes with browsers only under a
  custom `PLAYWRIGHT_BROWSERS_PATH`; fails with the right path and fix named when that
  directory is empty; passes again once the same build is copied there.

- **Four small ones:**
  - `Drop`, `Bong`, and `SoftClick` are now exported from `@openvidstudio/core`'s index;
    they existed in `sfx.tsx` but weren't exported, so importing them threw a React error.
  - README's tool count corrected to the real registered count (33, 34 with Higgsfield);
    a new check in `manual-test.mjs` fails if the two ever disagree again.
  - `find_music_bed` fetches only the requested catalog when `source` is `"lofi"` or
    `"cc0"`; with `"any"` (the default), each catalog is fetched independently, and one
    failing no longer fails the whole call; the result carries a `warnings` entry naming
    what degraded, falling back to a stale cached fetch of the failed catalog when one
    exists. (The earlier report of open-lofi's catalog.json 404ing was a sandbox proxy
    artifact; it's reachable on a normal network.)
  - New `render.browserExecutable` config: `render_video` passes it to Remotion as
    `--browser-executable` so a render reuses an already-installed browser (typically the
    same Playwright Chromium capture uses) instead of Remotion downloading its own, which
    fails with no network. `preflight` checks the configured path too, separately from its
    Playwright Chromium check.

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

- **Director mode.** At the peak and mid creative levels the agent works as a director, not a
  template filler: a creative brief first (`write_brief`), a design system as code
  (`defineDesignSystem`), an original score (`compose_score`), scenes written from core's
  primitives, a mandatory review loop (`render_stills`), render-mode quality gates
  (`validate_scenes` with `render: true`), a facts pipeline (`collect_facts`), and a final
  assembly (`finalize_video`, `write_description`). Production modes: peak, mid, literal.
  - `compose_score` composes an original, arc-matched score from the brief's music plan, with a
    cues file exact by construction, mastered to -15 LUFS under narration or -14 for music-only
    (`mode` is required, no default), and numeric checks an agent can read: band balance, clicks,
    per-section loudness, a spectrogram. Needs Python with numpy, scipy, soundfile, pyloudnorm
    and matplotlib.
  - `useMusicClock(beatId)` in core gives a scene `at(bar, beat)`, `beatPulse()`, `onBeat()`,
    `onDownbeat()`, `impact(label)` and `sectionAt(frame)` as scene-local frames.
    `stitch_composition` copies the bed's cue grid next to the composition and mounts the
    provider. `plan_beats` gains `snapToBars` to land every beat boundary on a downbeat.
  - `DirectedShot` in core turns a flat capture into a push-in with tilt, depth of field and a
    cursor. `Words`, `DotText`, `PixelLogo`, `PixelWipe`, `Atmosphere`, `DotGrid`, `Flash`,
    `Black`, `Letterbox`, `ChapterHud`, `Window`, `JsonView`, `ToolChip`, `Pill`, `Check`,
    `Cross`, `Glass`, `useTyped` and `Caret` are documented in API.md with a real still each.
  - `scaffold_scene` gains `mode: "template" | "starter" | "blank"`, and a beat's `scene` field
    points `stitch_composition` at any scene file.
  - `render_stills` takes `perBeat` (a number, or `"review"` for five frames per beat that
    straddle every cut), exact `frames`, and `round`; it writes a labelled contact grid and
    returns the numeric findings, so an agent without image input can review.
  - `validate_scenes` with `render: true` measures cropping, text size, reading time (3.5
    words/s plus 0.8 s, shared with `validate_beats`), dead frames, em dashes, contrast against
    the rendered pixels, the title-safe area, HUD overlap and whether the brand palette reaches a
    frame. A brief may mark a beat `deliberateHold`. Without `render`, a static check warns
    about numbers typed into a scene's copy instead of read from `facts.json`.
  - `write_description` writes YouTube chapters from the beats and a credits section read from
    disk, and `finalize_video` always writes it. `finalize_video` also normalises loudness to
    -14 LUFS / -1.5 dBTP and writes a poster and a size-capped share copy.
  - `CREATIVE.md` (principles), `TOOLS.md` (generated), and the `openvidstudio-director` skill,
    mirrored to the six agent skill directories.
- **A per-tool test suite.** `scripts/manual-test.mjs` is now a runner over one file per tool in
  `scripts/tests/`, each runnable alone. CI runs the ones that need only node.
- **The tool list and every tool-count claim are generated from the server's registry**
  (`scripts/generate-tool-docs.mjs`), and CI fails when they drift.

- **`render_video` accepts `async: true`, and a new `job_status` tool.** A real render can
  run 40+ minutes, well past an MCP client's own request timeout (Claude Code's
  `MCP_TOOL_TIMEOUT`, or the SDK client default), which killed it before it finished. Input
  is still validated synchronously (a bad call still fails immediately), then the render
  starts detached and the call returns `{ jobId, estimate }` right away. `job_status` polls
  for progress (frames rendered, current beat, a log tail) and the eventual result, the
  same shape a synchronous call would have returned. The synchronous path also now emits
  real MCP progress notifications for a client that attached a `progressToken`. Verified
  with a real render through a client enforcing a 3000ms timeout on the initial call: it
  returned in under 3s with a jobId, and polling reached `status: "done"` with a correct
  result.

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
  reach for this over the synthesized ambient bed.
- **Three CC0 sounds join the built-in pack.** `bong.wav`, `drop.wav` and `click_soft.wav`
  come from [Kenney](https://kenney.nl) under CC0 1.0, converted to the pack's 48kHz mono
  format, with `SoftClick`, `Bong` and `Drop` components in `@openvidstudio/core` and
  entries in `plan_sound_effects`. The pack stays free of any obligation, synthesized or
  public domain, and `public/sfx/CREDITS.md` now records which file is which and why.
- **`plan_music_cues`**: beats and strong cues, in seconds, for a music track. Reads
  the cue grid `compose_score` writes next to a track straight off disk. For any other
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
- **Cinematic camera.** A shot vocabulary for `DirectedShot` (`shot="pushIn" | "pullOut" | "pan" |
  "whip" | "orbit" | "dutch" | "hold" | "drift"`, explicit props still win), handheld sway that
  eases to exactly zero inside hold windows and an impact shake that decays (`handheldOffset`,
  `useHandheld`, `impactShake`, `useImpactShake`), `LayeredShot` for a capture split into depth
  layers, and `MotionBlur`, a `CameraMotionBlur` that is only mounted while the camera moves
  (frames outside the window are byte-identical to a render without it). `Layer` is now true Z
  parallax from the rig's perspective instead of a fixed offset, and takes its centre from the
  stage rather than 960 by 540. `CursorActor` segments arc slightly and overshoot on arrival.
  `E.sine` and `E.expo` join the easing set. Adds `@remotion/motion-blur` 4.0.534.
- **`beat.transition` now does something.** `cut`, `whip`, `fade`, `push`, `wipe` and `light-leak`
  are drawn by a `TransitionOverlay` over the cut, so every beat start, duration and audio join is
  unchanged and a file with only cuts is generated byte for byte as before. Measured on real
  renders: at the cut a `fade` frame has mean luma 13.8 against 72.9 for the plain cut, and frames
  20 before and after the cut are 0.000% different.
- **`capture_screenshot` `layers`.** Pass selectors and get a background with those elements
  hidden, one transparent PNG per element and a manifest (`<name>.layers.json`) in capture pixels,
  which `LayeredShot` reads. Compositing them back reproduces the screenshot (mean error 0.0010 of
  255, worst pixel 2).
- **`render_stills` `crop`.** A higher-scale look at a region next to each still, for checking small
  text.
- **`validate_beats` warns about a metronome.** Four or more beats whose longest is under 2.5 times
  the shortest read as uniform; the result now carries an always-present `warnings` array.
- **Native 9:16.** A project can be 1080x1920 from `init_project`'s `videoConfig`, and the core
  primitives follow the composition instead of assuming 1920x1080: `CinematicScene`'s stage,
  `DotGrid`, `Letterbox` (bars are 64/1080 of the frame height) and `RepoCta`'s camera.
  `defineDesignSystem` takes a `stage` option, so the grid margins scale to the frame (84/231/196 at
  1080x1920; 150/130/110 at 1920x1080 exactly as before). `validate_scenes` judges framing against the
  project's own frame size, so a 1500px block is an error in a 1080 wide frame and fine in a 1920 one.
  Landscape renders are byte-identical to before (checked on dots, bars and the end card).
- **`export_rendition` `reels` format.** 1080x1920, H.264 and AAC, 30 fps, faststart, from a native
  vertical render. A 1920x1080 or 4:5 source is refused with nothing written and a pointer to
  rendering natively vertical or to `reformat_vertical`. An unknown format is now an error instead of
  silently falling through to store frames.

### Changed

- **`preflight` asks for Node 20, not 18.** The packages declare `>=20` and CI runs 20, so a Node 18
  machine passed `preflight` and then failed later. The check is now `checkNodeVersion`, exported and
  tested.
- **Depth of field is off by default and never on text.** `DirectedShot`'s `depthOfField` defaulted
  to 6, which blurred product text outside a small ellipse. It now defaults to 0; when it is on,
  `protect` rectangles stay sharp (edge energy 1.000x against 0.006x unprotected), the cursor is
  never blurred, and `rackTo` slides the sharp region. This is what the eval reviewer called
  smeared text.
- **Captions settle, move and fit.** `Caption` has `position` (`bottom`, `top`, `left`, `right`,
  `auto`) and `avoid`, finishes its reveal within 8 frames of `at` whatever the word count (a
  14-word caption used to take 31), and sizes to the composition. The scene templates vary where
  it sits and cap the browser-capture push at 1.6.

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
- **`compose_score` has no percussion by default.** The score used to fire a tick on every
  beat in tension sections, an off-beat hat in every groove bar, a four-on-the-floor kick,
  a clap roll and a sixteenth-note arp on a fixed grid. Under a voiceover that reads as a
  ticking clock. `percussion` now defaults to `"none"` (no kick, clap, hat or tick; the
  bass and arp play uneven rhythms with small timing, level and decay changes), and
  `"full"` keeps the old arrangement as an opt-in. A new `checks.percussionTick` measures
  periodic transients above 5 kHz and `compose_score` warns when it finds them.
- **`finalize_video` warns when the final audio ticks (`audio-tick`).** The same
  measurement runs on the mixed audio, so a ticking track you brought yourself is flagged
  too.
- **`TitleSlam`'s per-word blip is off by default** (`sfx={false}`). A blip every four frames
  is a rapid tick under any title. Click and checklist sounds stay on, since they follow real
  events.
- **`stitch_composition` only auto-picks `music-bed.mp3`.** A leftover `pulse-bed.mp3` in a
  project is ignored unless you pass it as `musicBed.file`.

### Removed

- `key_a.wav`, `key_b.wav`, `key_c.wav` and `key_enter.wav`, with the `KeySound` and
  `EnterKey` components that played them. Use `TypingSfx` for typed text.
- **`pulse-bed.mp3`**, its cue file and `generate-pulse-bed.mjs`. It was a kick and hat
  click track and the default bed, so it put a ticking clock under most videos. Use
  `compose_score`, `find_music_bed`, or the ambient `music-bed.mp3`.

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

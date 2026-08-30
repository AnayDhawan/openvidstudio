# OVERVIEW.md: what openvidstudio is

openvidstudio is a free, open-source video-generation add-on for any
software project. It's built on Remotion (React-based programmatic video)
and Playwright (real-browser automation), and it's driven entirely through
MCP tools by whatever AI coding agent you're already using (Claude Code,
Cursor, ChatGPT, or anything else that speaks MCP). There's no separate app
to open, no timeline editor, no manual keyframing.

## The core idea

Launch and demo videos for software usually mean one of two compromises:
record a screen and cut it in a traditional editor (slow, and it looks like
a screen recording), or hand a brief to an AI video generator (fast, but
the UI, the product's actual text, and every detail a viewer would
recognize get hallucinated away).

openvidstudio does neither. It builds a cinematic camera, push-ins, drift,
shallow depth of field, an oversized cursor acting as an on-screen actor,
that moves over your product's real, DOM-rendered UI, composited from real
Playwright-captured screenshots and (v1 scope) full-viewport screen
recordings of the actual running app. Nothing on screen is invented: every
piece of product text a viewer can read came from the real product.

Where the real UI genuinely can't produce a shot (an atmosphere beat, a
desk/hands shot, some establishing texture that isn't product UI at all),
openvidstudio has an optional Higgsfield AI b-roll tier for exactly that
gap, and only that gap: an AI-generated clip never carries on-screen
product text or real UI, full stop. See `HIGGSFIELD.md` (not written yet;
this is its stable, reserved filename) for that tier's protocol once it
exists.

## Why not a hosted AI-storyboard tool?

There are hosted, MCP-callable pipelines that go storyboard to AI-generated
visuals plus VO plus music plus captions in one pass (Motion.so is one real
example). Those are genuinely fast for a rough pacing/storyboard draft to
react to, and openvidstudio doesn't try to replace that use case.

But that whole model, AI-generated visuals standing in for the product,
is the opposite of why openvidstudio exists: no traditional editor, no
AI-generated footage of the product itself, pixel-perfect real UI on
screen. openvidstudio deliberately doesn't work that way. A tool like that
isn't a component of this pipeline and isn't the model to reach for when
the goal is a video that shows what a real product actually looks like.

## The intended flow

1. **Intake.** The calling agent asks the guided question set in
   `PLANNING.md` (or, if the dev pastes a README, feature list, or other
   existing material instead, folds that into the same beat candidates;
   see `PLANNING.md`'s free-form-input section).
2. **Draft.** The agent turns intake answers into a `beats.json` draft:
   timing, VO, and, critically, a decided `captureMethod` for every beat,
   per `PLANNING.md`'s decision tree.
3. **Approval gate.** The agent shows the dev the full drafted
   `beats.json`, not a summary, and gets explicit approval before writing
   anything to disk. This is a protocol rule for the calling agent, not
   something enforced by the tooling itself; see `PLANNING.md`.
4. **Execute.** Once approved, the agent runs capture (screenshots and/or
   recordings, per `CAPTURE.md`'s protocol) and stitches the composition,
   following `PIPELINE.md`'s beat-to-scene-to-composition-to-QC loop and
   `STYLE.md`'s binding art-direction rules throughout.

## Doc map

| Doc | What it covers |
|---|---|
| `PIPELINE.md` | Step-by-step: beats.json, scenes, composition, QC loop, render |
| `STYLE.md` | Binding art-direction rules: camera, depth of field, lighting, cursor, motion, palette, type |
| `CAPTURE.md` | The real-capture protocol for screenshots and screen recordings: the Playwright zoom-desync bug and its fix |
| `PLANNING.md` | The guided intake to beats.json protocol, including the capture-method decision tree |
| `SCRIPT.md` | VO pacing, duration math, and the claim-obligates-visual writing rule |
| `HIGGSFIELD.md` | AI b-roll tier protocol (not written yet; reserved filename, a later task) |

## Two rules that changed on the way to being a public tool

This pipeline started as a private tool built for one person's own repos.
Two of its rules only made sense in that narrower context and don't hold up
once other people's projects are the ones going through it. Both are
documented changes here, not silent drops:

- **"No GitHub-star click action in a CTA."** The private version of this
  pipeline treated this as a hard QC-fail rule: it assumed every video was
  for a personal, no-self-promo repo. Here it's the default `RepoCta`
  behavior (no star action baked in, unless a project opts in), not
  something QC fails on. This pipeline now serves other people's projects,
  and a hardcoded no-self-promo stance doesn't make sense for every user
  the way it did for a single person's own repos.
- **Terminal windows with a fixed title and slash-command convention.** The
  private version hardcoded a specific title and command prefix. Here it's
  a documented default convention a project can override, not a QC-fail
  rule, for the same reason: other people's terminals show other people's
  commands.

## One refinement: the "DOM text" rule is now stated by provenance, not medium

The private version's rule was "all text is DOM text," reasoned from
medium: if it wasn't rendered as DOM inside Remotion, it wasn't trusted.
That was too strict. A genuine screen recording of the real, running
product isn't AI-hallucinated; it's ground truth, exactly like a screenshot
is. A medium-based rule would have wrongly forbidden a legitimate capture
method just because it wasn't literally re-rendered as DOM text inside the
composition.

The restated rule (full detail in `STYLE.md`): real product UI/text,
whether DOM-rendered, screenshotted, or screen-recorded, is always allowed
on screen, because it's ground truth by provenance. AI-generated clips
(Higgsfield or any future model) never carry on-screen product text or real
UI; they stay b-roll/atmosphere only. This is a refinement over the private
original, not a silent rewrite.

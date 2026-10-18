# Eval results: acme-launch (peak, 60 s)

One run of the director flow on the Acme Tasks sample app (`evals/acme-tasks`, a fictional app), following `evals/acme-launch/TASK.md` and scored with `evals/acme-launch/score.mjs` plus one independent reviewer.

## Automated score

40 of 41 checks pass. Run: `node evals/acme-launch/score.mjs <project> acme-launch --wall-minutes 56 --estimate-minutes 18.5`.

| Group | Result |
|---|---|
| Truth (T1-T8) | all pass: brief validates, sample app disclosed, no em dash, numbers sourced from facts.json, 6 beats backed by real captures, 0 template scenes |
| Gates (G1-G13) | all pass: validate_beats, validate_scenes render mode (8 of 8 beats measured, 0 skipped, 0 warnings), 60.0 s h264+aac, A/V drift 0 ms, -14 LUFS, -2 dBTP, poster + 9.27 MB share copy, chapters + credits, two review rounds, original score (96 bpm, 5 sections, 3 impacts), design.ts |
| W1 wall time within 60 min | pass, 56 min (77 min on the clock minus about 21 min waiting on the brief approval) |
| W2 wall time within 1.5x of plan_production's estimate | **fail**, 56 min against 18.5 min (3.03x) |

W2 is a real finding, not a scorer bug. The estimate leaves out the full render, which took 15 min on this machine by itself, plus bundling for each review round and the capture retries. plan_production's model needs a render term.

## Independent reviewer

One reviewer subagent, given only the rubric, the brief, both contact grids and the poster. Scores 1-5:

| Axis | Score |
|---|---|
| Story | 3 |
| Design coherence | 3 |
| Craft | 2 |

Verdict: not shippable as a real launch video yet. The pipeline produced a complete, truthful, correctly mixed video. The creative result is mediocre.

Reviewer's top fixes:
1. Cut the depth-of-field blur and heavy push; the product text being sold (card titles, insight labels) is smeared.
2. Caption cards: one frame shows a half-typed line ("One click, and it is") with a baseline jump on the last word; cards cover the lower-left of the product and never vary position.
3. Make the tension and payoff real: show a messy backlog that clears into done, draw the check on the real board, cut the empty-square frame at the start of the payoff, balance the CTA.

Round 1 to round 2 was a small gain (chrome visible, payoff and CTA better framed). The reviewer judged the craft defects unfixed; I did not run a third round because the 60 min budget was already used.

## What the run found in the tool

Fixed in this branch during the run:
- render_stills crashed when the first beat could not mount (now opens pages lazily per beat).
- write_description ignored `sampleContent` (now disclosed, grouped).
- write_brief accepted section maps that compose_score refuses (now checks contiguity).
- stitch_composition and validate_scenes warned "no narration" on every beat of a `narration: "none"` video (now silent unless `requireNarration` is set).
- finalize_video left audio about 100 ms longer than the picture (cut with `-t`).
- render_stills contact grid label bar covered the top 11% of each frame (label band now sits above the picture).

Open, not changed:
- Bar numbering: brief bars are 1-based, compose_score's impact `bar` is a zero-based index. An impact written as "bar 6" lands one bar later than a reader expects. Needs a product decision.
- The dead-frames check detects a beat that never moves, not a freeze mid-beat.
- plan_production's time estimate (see W2).
- `render_video` silently ignored an unknown `quality: "draft"` input (the option is `draft: true`), so a full render ran. The tool should reject unknown inputs.

Best contact grid kept: `evals/acme-launch/contact-grid-round-2.png`.

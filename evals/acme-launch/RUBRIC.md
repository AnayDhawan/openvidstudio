# acme-launch rubric

Four parts. The first two are measured by `score.mjs` and are pass or fail. The third is scored
by a reviewer who did not make the video. The fourth is a number.

## 1. Truth checks (automated)

| Id | Check |
|---|---|
| T1 | `brief.json` passes `write_brief`'s own validation, and `brief.md` has real prose |
| T2 | The sample app is disclosed: the description says Acme Tasks is a fictional sample |
| T3 | No em dash in the brief, beats, design, scenes or description |
| T4 | Every number a scene shows comes from `facts.json` or a capture (no `numbers-sourcing` warning) |
| T5 | `facts.json` merges real tool runs: at least 4 records, at least 2 beats backed by a capture |
| T6 | Zero template scenes: a peak run ships bespoke scenes only |
| T7 | Every beat has a scene wired |
| T8 | The product on screen is a real capture of the running app |

## 2. Gate results (automated)

| Id | Gate |
|---|---|
| G1 | `beats.json` passes `validate_beats` |
| G2 | `validate_scenes` in render mode reports no error, and G2b: it measured every beat |
| G3 to G5 | A final mp4 exists, within 15% of the target length, h264 video plus audio |
| G6 | A/V drift is at most one frame |
| G7, G8 | Loudness within 1 LU of -14 LUFS and true peak at or below -1 dBTP, measured independently |
| G9 | A poster frame and a size-capped share copy exist |
| G10 | The description has a Chapters list from 0:00 and a Credits section |
| G11 | Contact grids exist from at least two review rounds |
| G12 | An original score with a cue grid (bpm, sections, impacts, source generated) |
| G13 | `design.ts` exists and builds on `defineDesignSystem` |

## 3. Craft (a separate reviewer, 1 to 5)

The reviewer is a separate pass: not the agent that made the video, not given its reasoning, and
given only this rubric, the brief, the contact grid from each review round and the final poster.
They score three things from 1 to 5 and write one sentence of evidence for each. A 3 is
competent and unremarkable; a 5 would stand next to a video a human studio made.

**Story.** Is there a point of view, or a feature list?
- 1: a list of features with a voice over it
- 3: a clear arc, a hook and a payoff, but the device is generic
- 5: a device chosen for this product, tension that is shown rather than told, and a payoff that
  answers the hook in its own words

**Design coherence.** Do the frames belong to one video?
- 1: each beat looks like a different template
- 3: a consistent palette and type, the motif present but only decoratively
- 5: a motif lifted from the product, used in the transitions, the backgrounds and the type,
  with composition that changes from beat to beat

**Craft.** Is it well made at the level of the frame?
- 1: cropped or unreadable text, no focal point, frames that look unfinished
- 3: legible, framed correctly, one clear focal point most of the time
- 5: every frame has one thing to look at, the camera is directing, the cuts are motivated, and
  nothing is there that does not earn its place

The reviewer also lists, in the same pass, the three things they would fix first.

## 4. Wall time

Wall time against the 60-minute budget (W1), and against the estimate `plan_production` gave at
the start (W2, reported, passing within 1.5x). Time spent waiting for the approval gate is
subtracted.

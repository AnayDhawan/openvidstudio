# acme-launch

The task, given to the agent as one line:

> make a launch video of acme-tasks, peak, 60 min

That is the whole prompt. Nothing else is said about the story, the look, the music or the
scenes. Everything beyond it is the agent's own work, following `docs/CREATIVE.md` and the
`openvidstudio-director` skill, and anything it needs to know it has to find out from the repo.

## The product

`evals/acme-tasks/` is a small, fictional task board (Vite and React) built so the pipeline has a
real running product to film. It has a one-click new-task board, an Insights page (shipped per
week, cycle time, on-time rate) and, from v1.1, a shipping-streak card. `GIT_HISTORY.txt` and
`v1.0-to-v1.1.diff` describe the two releases. It is not a real product, and the finished video
has to say so (see the truth checks).

## Setup

1. Make a working copy outside this repo, so the run's output does not land in it:

   ```bash
   cp -r evals/acme-tasks ../ovs-eval-acme-tasks
   cd ../ovs-eval-acme-tasks && npm install && npm run build && npm run preview   # http://localhost:4173
   ```

2. Make the video project, also outside this repo, and point the tools at it:

   ```bash
   mkdir ../ovs-eval-project && cd ../ovs-eval-project
   export MCP_CWD=$PWD
   node ../openvidstudio/evals/acme-launch/mcp-call.mjs init_project '{"name":"acme-launch"}'
   ```

   `mcp-call.mjs` is a small MCP client that drives this checkout's built server. Any MCP client
   pointed at `packages/mcp-server/dist/stdio.js` works the same way.

3. Start a timer. Wall time is scored against the 60-minute budget and against the estimate
   `plan_production` gives.

## The run

The agent follows the director process: intake (peak, 60 minutes), `plan_production`, read the
repo, `extract_brand`, `write_brief`, an approval gate where a person sees the brief and the
beats before anything is written or rendered, captures of the running app, `collect_facts`,
`design.ts`, `compose_score`, scenes written from the primitives, review rounds with
`render_stills` (the contact grid from every round is kept), the gates, `render_video`,
`finalize_video`, and the description file.

The approval gate is real: the run pauses there and a person answers. Time spent waiting for the
answer is not counted against the budget.

## What comes out

Under the project: `src/videos/acme-launch/` (brief.md, brief.json, design.ts, beats.json,
facts.json, scenes), `public/audio/` (the score, its cues and spectrogram), `output/` (the final
mp4, poster, share copy, `acme-launch-DESCRIPTION.md`, and `stills/acme-launch/round-N/` with a
contact grid per review round).

## Scoring

`node evals/acme-launch/score.mjs <project> acme-launch --wall-minutes N --estimate-minutes M`
runs the automated checks. `RUBRIC.md` covers the rest: a separate reviewer scores story, design
coherence and craft from the contact grids, with the rubric in hand. Results go in
`evals/RESULTS.md`, and the best run's contact grid is kept as the bar to beat.

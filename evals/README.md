# evals

How we find out whether director mode works, other than by looking at one video and liking it.

- `acme-launch/`: the task "make a launch video of acme-tasks, peak, 60 min", its rubric, an
  automated scorer for the truth checks and the gate results, and a small MCP client to drive
  the server with.
- `acme-tasks/`: the fictional sample app the task films. It is a real, running Vite and React app,
  not a mock-up, and it is labelled as fictional in its own README.
- `RESULTS.md`: what each run scored, and the contact grid of the best one.

Run the automated half on any finished project:

```bash
pnpm --filter @openvidstudio/mcp-server build
node evals/acme-launch/score.mjs <projectRoot> <videoName> --wall-minutes 48 --estimate-minutes 40
```

`scripts/tests/eval-score.test.mjs` runs the scorer against a project built to pass and against
copies of it broken one check at a time, so a check that cannot fail is caught.

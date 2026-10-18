# Contributing to openvidstudio

Hi, and thanks for looking. openvidstudio is a small project, mostly built by a couple of
students, and every contribution matters here: a typo fix, a bug report with good steps, a
new scene template, or a whole capture backend.

You do not need to know Remotion, MCP or video to help. Plenty of the work is ordinary
TypeScript, docs and tests.

## Where to start

- **Never touched the code?** Pick an issue labelled
  [`good first issue`](https://github.com/AnayDhawan/openvidstudio/labels/good%20first%20issue).
  They are written to be doable without knowing the whole system.
- **Found something broken?** Open a
  [bug report](https://github.com/AnayDhawan/openvidstudio/issues/new?template=bug_report.yml).
  The most useful ones say what you ran, what you expected, what happened, and your OS and
  Node version.
- **Have an idea?** Open a
  [feature request](https://github.com/AnayDhawan/openvidstudio/issues/new?template=feature_request.yml)
  and describe the problem first. A paragraph on what you could not do is worth more than a
  design.
- **Want to take something bigger?** Say so on the issue before you start, so nobody builds
  the same thing twice. A quick "I'll take this" is enough.

If you are not sure whether something fits, ask in an issue. A question is always welcome.

## Set up

You need Node 20 or newer, [pnpm](https://pnpm.io) 9, and ffmpeg on your PATH. Some tests
also use Python (for `compose_score`) and a browser (for rendering); the ones that cannot
run on your machine say so and skip.

```bash
git clone https://github.com/AnayDhawan/openvidstudio.git
cd openvidstudio
pnpm install
pnpm build          # builds @openvidstudio/capture and @openvidstudio/mcp-server
```

This is a pnpm workspace, so commands for one package take a filter:

```bash
pnpm --filter @openvidstudio/mcp-server build
pnpm typecheck      # every package
```

To try your build with an agent, point your MCP config at the built server:

```json
{
  "mcpServers": {
    "openvidstudio": {
      "command": "node",
      "args": ["/path/to/openvidstudio/packages/mcp-server/dist/stdio.js"]
    }
  }
}
```

## Where things live

| Folder | What is in it |
| --- | --- |
| `packages/mcp-server` | the MCP tools an agent calls, and their tests |
| `packages/core` | the Remotion building blocks scenes are made from |
| `packages/stem` | Supernova mode: the Void + Spark design system and the STEM lesson primitives |
| `packages/capture` | browser, desktop, mobile and terminal capture, no Remotion needed |
| `packages/docs` | the guides copied into every scaffolded project |
| `templates/default` | the project `init_project` creates |
| `.claude/skills` | the agent skills (mirrored to the other tool folders by a script) |

## Tests

Each tool has its own test file in `packages/mcp-server/scripts/tests/`, and they run
against the built code in `dist/`, so build first.

```bash
cd packages/mcp-server
pnpm build
node scripts/tests/plan-beats.test.mjs          # one file, seconds
node scripts/manual-test.mjs                     # all of them, about 40 minutes
```

A few things help a lot:

- Write the test first and watch it fail for the right reason. Where you can, add a control
  that is meant to fail, so the test cannot pass by accident.
- Prefer a real check (render a frame and read the pixels, measure the audio) over checking
  that a string appears in the output.
- Two other checks run in CI and are quick to run yourself:
  `node scripts/sync-skills.mjs --check` and `node scripts/generate-tool-docs.mjs --check`.
  If you add or rename a tool or a skill, the second one tells you what to regenerate.

## Sending a pull request

1. Fork the repo and make a branch off `main`.
2. Keep the change small and about one thing.
3. Tell us why in the description, not only what. The pull request template walks you
   through it.
4. Add a line under `## [Unreleased]` in `CHANGELOG.md` if a user would notice the change,
   and update the docs or README if behaviour changed.
5. Open it against `main`.

AI-assisted code is welcome. Please read and run what it wrote before you send it, the same
as you would for your own.

Commit messages are short and say what changed, often with the area first, like
`compose_score: no percussion by default`. You do not need a special format.

Be kind in reviews, both ways. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## A note on licensing

openvidstudio is [Apache-2.0](LICENSE). By sending a contribution you agree it can be
distributed under that licence. There is no separate agreement to sign. If you copy code or
text from somewhere else, check that its licence allows it and say where it came from in
the pull request.

## Reporting a security problem

Please do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Getting an answer

Open an issue and ask. This is run by people with other things going on, so a reply can
take a few days, but every issue gets read.

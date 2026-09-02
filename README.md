<img src="brand/wordmark.png" alt="openvidstudio" width="560">

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
![Stack](https://img.shields.io/badge/stack-Remotion%20%2B%20Playwright%20%2B%20MCP-38bdf8)
[![GitHub stars](https://img.shields.io/github/stars/AnayDhawan/openvidstudio?style=social)](https://github.com/AnayDhawan/openvidstudio/stargazers)
![Last commit](https://img.shields.io/github/last-commit/AnayDhawan/openvidstudio)

openvidstudio is an open-source video-generation add-on, built on Remotion and
Playwright, that an AI coding agent drives through MCP tools to produce
launch and demo videos for a project directly from its repo and running app,
with an optional Higgsfield AI b-roll tier for shots that can't be captured
from a live screen. `packages/` and `templates/` each get their own README as
they're built out. The public site lives in a separate repo:
[vidstudio-site](https://github.com/AnayDhawan/vidstudio-site).

![A frame from a real video, captured from a real running app by this pipeline](docs/media/demo-poster.jpg)

*A frame from a real render, not a mockup. Every screen in it was captured from a
running app by this pipeline's own capture tools.*

## Quick Start

Not published to npm yet, so the server is built from a clone:

```bash
git clone https://github.com/AnayDhawan/openvidstudio.git
cd openvidstudio
pnpm install
pnpm --filter @openvidstudio/mcp-server build
```

Check it starts before wiring it into an agent. A server that fails here shows up
as a silently missing tool list rather than an error:

```bash
node packages/mcp-server/dist/stdio.js
# openvidstudio-mcp: connected over stdio
```

Then point your coding agent's MCP config at the built server, using the absolute
path to the file you just built, and restart the client so it picks the server up:

```json
{
  "mcpServers": {
    "openvidstudio": {
      "command": "node",
      "args": ["/absolute/path/to/openvidstudio/packages/mcp-server/dist/stdio.js"]
    }
  }
}
```

Nine tools should appear. Start your app, then ask your agent for a video in plain
English, for example "build a 60 second demo video of the app running on
localhost:3000". It runs a guided intake, drafts a `beats.json`, and shows you the
whole draft before writing anything to disk.

## Prerequisites

Node is assumed. Beyond that: pnpm, ffmpeg for sound effects and QC frame
extraction, and the Chromium build Playwright drives during capture.

```bash
# Windows
winget install --id Gyan.FFmpeg -e
npm install -g pnpm
npx playwright install chromium

# macOS
brew install ffmpeg && npm install -g pnpm && npx playwright install chromium

# Debian or Ubuntu
sudo apt update && sudo apt install -y ffmpeg
npm install -g pnpm && npx playwright install chromium
```

## Docs

Read `packages/docs/PLANNING.md` first for the guided intake flow, then
`packages/docs/OVERVIEW.md` for the full pipeline shape. `PIPELINE.md`,
`STYLE.md`, `CAPTURE.md` and `SCRIPT.md` cover the individual steps and the rules
that are enforced rather than suggested.

## Status

The mechanical pipeline works end to end: scaffold, validate, capture, stitch,
render, QC. Scene authoring is still the manual part. `scaffold_scene` currently
emits a stub for the calling agent to fill in, so building a video today means the
agent writes real Remotion scene code. Making that step generate working scenes is
the main thing tracked in the issues.

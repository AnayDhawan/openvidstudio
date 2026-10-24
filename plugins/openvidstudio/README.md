# openvidstudio for Claude

**Code-based video generation.** Every frame of your product is a real capture, never a generated mockup.

This plugin gives Claude the openvidstudio MCP tools and the skills that drive them, in one install:

| Skill | What it is for |
|---|---|
| `openvidstudio` | A demo, launch video or walkthrough of your real running app, end to end |
| `openvidstudio-director` | A directed film: a brief, a designed look, an original score, hand-built scenes, a review loop |
| `bgmusic` | Finding and fitting a real music bed |
| `supernova` | A short animated STEM lesson: one concept in up to two minutes, vertical, narrated |

In a session they appear as `/openvidstudio:openvidstudio`, `/openvidstudio:supernova` and so on, and Claude loads them on its own when you ask for a demo video.

## Install

In Claude Code, the Claude desktop app's Code tab, or Cowork:

```
/plugin marketplace add AnayDhawan/openvidstudio
/plugin install openvidstudio@openvidstudio
```

or from a shell:

```
claude plugin marketplace add AnayDhawan/openvidstudio
claude plugin install openvidstudio@openvidstudio
```

Then ask your agent to run `preflight`. It checks your machine (Node 20 or newer, ffmpeg, Chromium for Playwright, edge-tts for narration) and names the fix for anything missing.

**First start:** the plugin installs the pinned server version once (about 330 MB, about a minute). If the tools are not there at once, wait a minute and reconnect (`/mcp`, or restart the client). It finishes in the background even if the client gives up first, and every later start is instant and works offline.

## If you already added the server by hand

Remove the manual `openvidstudio` entry from your `.mcp.json` or client config, or you will get two servers. Tool names change from `mcp__openvidstudio__<tool>` to `mcp__plugin_openvidstudio_openvidstudio__<tool>`; update any permission rules that name them.

## Other places

The `install` command below ships with the next server release (1.4.0); until then use the config block in the last row.

| Where you use Claude | How |
|---|---|
| Claude Code, the desktop Code tab, Cowork | This plugin |
| Claude Desktop, Chat tab | `npx -y @openvidstudio/mcp-server install claude-desktop`, then restart Claude. (Chat loads a plugin's skills but not its local MCP server, so the tools come from the app's own config) |
| Cursor | `npx -y @openvidstudio/mcp-server install cursor` |
| VS Code | `npx -y @openvidstudio/mcp-server install vscode` (writes `.vscode/mcp.json`) |
| Anything else that speaks MCP | `{ "mcpServers": { "openvidstudio": { "command": "npx", "args": ["-y", "@openvidstudio/mcp-server"] } } }` (on native Windows use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "@openvidstudio/mcp-server"]`) |
| Claude Code cloud sessions | Plugins do not load there; clone the repo and build it, or use the npx config |

## What it needs

Node 20 or newer, ffmpeg, a Chromium for Playwright, and your app running. `edge-tts` (Python) for narration and `numpy scipy soundfile pyloudnorm matplotlib` for the original score are optional. See the repository README for the full table.

## Privacy and licence

[PRIVACY.md](./PRIVACY.md): what stays local and what leaves your machine. Apache-2.0 for openvidstudio's own code. Videos render through Remotion, which has its own licence: free for individuals, non-profits, evaluation use and for-profit companies with up to three employees; a larger company needs a Remotion Company License (https://www.remotion.pro/license).

Source, issues and the changelog: https://github.com/AnayDhawan/openvidstudio

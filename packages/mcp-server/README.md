# @openvidstudio/mcp-server

Code-based video generation. An MCP server that lets an AI coding agent make a video of your real
product: a real browser captures your app, and the agent plans, narrates, scores and renders the
video on your machine. Every frame of your product is a real capture, never a generated mockup.

## Three kinds of video

- **Demos of your product.** The agent opens your running app, films what it does, and cuts the clips
  to a plan you approve first. A browser, a desktop app, a phone or a terminal.
- **Director mode.** Ask for the peak or mid creative level and the agent writes a brief before it
  builds anything, then moves the camera on purpose, picks a transition for every cut and scores the
  film with original music that has no drums.
- **Lessons (Supernova).** One maths, physics or computer science concept in up to two minutes,
  vertical, always in the same seven beats, with formulas built line by line.

## Install

Add the server to your MCP client's config and restart the client. For Claude Code that is
`.mcp.json`:

```json
{
  "mcpServers": {
    "openvidstudio": {
      "command": "npx",
      "args": ["-y", "@openvidstudio/mcp-server"]
    }
  }
}
```

On native Windows some clients need the command wrapped: `"command": "cmd"` with
`"args": ["/c", "npx", "-y", "@openvidstudio/mcp-server"]`.

Then ask your agent to run `preflight`. It checks your machine and names the fix for anything that is
missing.

## What you need

| What | Minimum | Needed for |
| --- | --- | --- |
| Node.js | 20 | Runs the server |
| ffmpeg | 4.0 | Sound effects, audio checks, pulling frames back out of a render |
| Chromium (via Playwright) | current | The browser capture drives |
| Your app, running | reachable URL | Demos and director mode. A lesson needs no app |
| edge-tts | 7.3 or newer, Python 3.8+ | Narration. Required for lessons |
| numpy, scipy, soundfile, pyloudnorm, matplotlib | current, Python 3.8+ | `compose_score`, the original-score tool |

## Documentation

The pipeline docs ship in this package (`docs/`) and are online at
https://openvidstudio.vercel.app/docs. Start with `OVERVIEW.md`; `SUPERNOVA.md` and `SCRIPT.md` cover
lessons, and `TOOLS.md` lists every tool.

- Source, issues and the changelog: https://github.com/AnayDhawan/openvidstudio
- Site: https://openvidstudio.vercel.app

## License

Apache-2.0 for openvidstudio's own code. Videos render through Remotion, which has its own license:
free for individuals, non-profits, evaluation use and for-profit companies with up to three employees.
A larger company needs a Remotion Company License: https://www.remotion.pro/license

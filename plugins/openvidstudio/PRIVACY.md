# Privacy

openvidstudio runs on your machine. This page says what leaves it. It describes the code in this repository; read the code for the final word.

## What stays local

- Captures of your app (screenshots, recordings, terminal replays), the project files, the renders, and the finished videos. They are written to the folders you choose and are not uploaded anywhere by this plugin or the server.
- The project configuration and the facts file the tools write.

## What leaves your machine, and when

| What | Where it goes | When |
|---|---|---|
| The server package and its dependencies | npm (`registry.npmjs.org`) | The first time the plugin starts, and when a new plugin version pins a new server version |
| Browser downloads | Playwright and Remotion's download hosts | When Chromium is installed for capture or render, if you do not already have one |
| Narration text | Microsoft's speech service, through the `edge-tts` Python package | Only when you run `generate_narration` with the default engine. The text of the narration is sent so a voice can be made. The audio comes back and is saved locally |
| Music search queries and downloads | GitHub (`api.github.com`, `raw.githubusercontent.com`) | Only when you run `find_music_bed` or `import_music_bed` |
| Sound effect search queries | Freesound, only if you give the tool an API key | Only when you run `plan_sound_effects` with a key |
| Higgsfield requests | Higgsfield, through your own connection | Only if you enable the optional b-roll tier |

## What this project does not do

- No telemetry, analytics, crash reporting or usage tracking. The server code contains none (checked 2026-10-24).
- No accounts, no sign-in, no API keys required for the core pipeline.
- No reading of files outside the project folder you point it at, except what a tool is explicitly given a path to.

## The plugin itself

The plugin starts the server with a small launcher script (`scripts/launch-mcp.mjs`) that installs one exact, pinned version of `@openvidstudio/mcp-server` into the plugin's data folder and runs it. It runs as you, with your permissions, like any other Claude Code plugin: read it before you install it.

## Contact

Questions and reports: https://github.com/AnayDhawan/openvidstudio/issues

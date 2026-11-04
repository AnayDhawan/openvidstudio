# Adding openvidstudio to an MCP client

openvidstudio is a stdio MCP server, published as `@openvidstudio/mcp-server`. Every client needs the same
three things: the command that starts it, the config file that holds that command, and a restart. This page
lists the file for each client the installer supports, on Windows, macOS and Linux.

The paths and blocks below are the ones `npx -y @openvidstudio/mcp-server install <client>` writes, taken from
`packages/mcp-server/src/install.ts`. The installer only touches the `openvidstudio` key, keeps a backup of the
old file, and refuses to overwrite a file it cannot parse. Add `--print` to see the block without writing, or
`--dry-run` to see the whole file it would write.

## What has been checked

- **The server:** the built server was started over stdio and queried with an MCP SDK client. It reported
  `openvidstudio` 1.4.0 and listed **44 tools** (45 with the optional Higgsfield tier), `preflight` among them.
  [TOOLS.md](TOOLS.md) has the current count and the list.
- **The installer:** its file handling is covered by the `install-cli` test.
- **The clients:** not run end to end. Each section says so. Treat the client-side steps as documented, not tested.

## The command

macOS and Linux:

```json
{ "command": "npx", "args": ["-y", "@openvidstudio/mcp-server"] }
```

On native Windows the command needs the `cmd /c` wrapper so `npx` (a `.cmd` shim) resolves:

```json
{ "command": "cmd", "args": ["/c", "npx", "-y", "@openvidstudio/mcp-server"] }
```

The installer picks the right one for the machine it runs on. The blocks below use the macOS and Linux form.

## Claude Desktop (Chat tab)

Installer and config documented; not yet run end to end in this client.

| OS | Config file |
| --- | --- |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | No official build, so the installer prints the block for you to place by hand |

```
npx -y @openvidstudio/mcp-server install claude-desktop
```

By hand, add to the `mcpServers` object (keep your other servers):

```json
{
  "mcpServers": {
    "openvidstudio": { "command": "npx", "args": ["-y", "@openvidstudio/mcp-server"] }
  }
}
```

- **Restart:** quit Claude Desktop completely and start it again.
- **Verify:** the tools list shows 44 tools. Ask the agent to run `preflight`.

## Cursor

Installer and config documented; not yet run end to end in this client.

| OS | Config file (global) |
| --- | --- |
| Windows | `%USERPROFILE%\.cursor\mcp.json` |
| macOS | `~/.cursor/mcp.json` |
| Linux | `~/.cursor/mcp.json` |

```
npx -y @openvidstudio/mcp-server install cursor
```

By hand, add to the `mcpServers` object:

```json
{
  "mcpServers": {
    "openvidstudio": { "command": "npx", "args": ["-y", "@openvidstudio/mcp-server"] }
  }
}
```

- **Restart:** restart Cursor, or reload the window.
- **Verify:** the MCP settings page lists `openvidstudio` with 44 tools. Ask the agent to run `preflight`.

## VS Code

Installer and config documented; not yet run end to end in this client.

The file is per workspace, the same on every OS: `.vscode/mcp.json` in the folder where you run the installer.
VS Code keeps servers under `servers` (not `mcpServers`) and wants `"type": "stdio"`.

```
npx -y @openvidstudio/mcp-server install vscode
```

By hand, in `.vscode/mcp.json`:

```json
{
  "servers": {
    "openvidstudio": { "type": "stdio", "command": "npx", "args": ["-y", "@openvidstudio/mcp-server"] }
  }
}
```

- **Restart:** reload VS Code.
- **Verify:** the MCP server list shows `openvidstudio` running (Command Palette, `MCP: List Servers`) with 44
  tools. Ask the agent to run `preflight`.

## Claude Code, the desktop Code tab and Cowork

Installer and config documented; not yet run end to end in this client.

No config file to edit. The installer prints the commands:

```
npx -y @openvidstudio/mcp-server install claude-code
```

Install the plugin, which registers the server and the skills together:

```
/plugin marketplace add AnayDhawan/openvidstudio
/plugin install openvidstudio@openvidstudio
```

Tools only, without the plugin:

```
claude mcp add openvidstudio -- npx -y @openvidstudio/mcp-server
```

Do not keep both: the plugin already registers the server. The plugin's first start installs the server once in
the background; see [the plugin's README](https://github.com/AnayDhawan/openvidstudio/blob/main/plugins/openvidstudio/README.md).

- **Restart:** start a new session.
- **Verify:** `/mcp` in the session lists `openvidstudio` with 44 tools. Ask the agent to run `preflight`.

## Other clients

Any client that starts a stdio MCP server works with the block from "The command" above. The file location and the
top-level key differ per client: most use `mcpServers`, VS Code uses `servers`. Find the MCP config file in the
client's own docs, add the block, restart, and ask the agent to run `preflight`. Cline, Zed, Continue, Windsurf and
GitHub Copilot are not covered here.

To run from a clone instead of npm, build it (`pnpm install`, `pnpm build`) and point the client at the built entry:

```json
{ "command": "node", "args": ["/absolute/path/to/openvidstudio/packages/mcp-server/dist/stdio.js"] }
```

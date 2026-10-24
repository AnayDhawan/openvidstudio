import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * `npx -y @openvidstudio/mcp-server install <client>`: writes the openvidstudio entry into a client's
 * own MCP config file, so nobody has to hand-edit JSON (and get the Windows `cmd /c` wrapper wrong).
 *
 * It only ever touches the `openvidstudio` key: every other server in the file is left exactly as it
 * was, an unparsable file is never overwritten, and a backup is written before any change.
 *
 * Clients and where their config lives (checked against each vendor's own docs in October 2026):
 *   claude-desktop  macOS ~/Library/Application Support/Claude/claude_desktop_config.json,
 *                   Windows %APPDATA%\Claude\claude_desktop_config.json, key "mcpServers"
 *   cursor          ~/.cursor/mcp.json (global), key "mcpServers"
 *   vscode          .vscode/mcp.json in the current folder, key "servers", entry has "type": "stdio"
 *   claude-code     no file: prints the plugin commands (and the `claude mcp add` fallback)
 */

export const INSTALL_CLIENTS = ["claude-desktop", "cursor", "vscode", "claude-code"] as const;
export type InstallClient = (typeof INSTALL_CLIENTS)[number];

const SERVER_NAME = "openvidstudio";
const PACKAGE = "@openvidstudio/mcp-server";

export interface InstallEnv {
  platform: NodeJS.Platform;
  home: string;
  /** %APPDATA% on Windows; falls back to <home>/AppData/Roaming. */
  appData?: string;
  /** Where `vscode` writes `.vscode/mcp.json`. */
  cwd: string;
  /** Used in the backup file name; injectable so tests are stable. */
  now?: () => Date;
}

export interface ServerEntry {
  type?: "stdio";
  command: string;
  args: string[];
}

export interface InstallTarget {
  client: InstallClient;
  file: string;
  /** The top-level key the client keeps its servers under. */
  key: "mcpServers" | "servers";
  entry: ServerEntry;
}

export interface InstallResult {
  ok: boolean;
  client: InstallClient | null;
  action: "created" | "updated" | "unchanged" | "printed" | "refused" | "dry-run";
  file?: string;
  backup?: string;
  /** Lines to show the user, in order. */
  lines: string[];
}

/** The command a client runs to start the server. Windows needs `cmd /c` so `npx` (a .cmd shim) resolves. */
export function serverCommand(platform: NodeJS.Platform): { command: string; args: string[] } {
  const args = ["-y", PACKAGE];
  return platform === "win32" ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args };
}

export function installTarget(client: InstallClient, env: InstallEnv): InstallTarget | null {
  const { command, args } = serverCommand(env.platform);
  switch (client) {
    case "claude-desktop": {
      let file: string;
      if (env.platform === "darwin") file = path.join(env.home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      else if (env.platform === "win32") file = path.join(env.appData ?? path.join(env.home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      else return null; // no official Linux build; the caller prints the block instead
      return { client, file, key: "mcpServers", entry: { command, args } };
    }
    case "cursor":
      return { client, file: path.join(env.home, ".cursor", "mcp.json"), key: "mcpServers", entry: { command, args } };
    case "vscode":
      return { client, file: path.join(env.cwd, ".vscode", "mcp.json"), key: "servers", entry: { type: "stdio", command, args } };
    case "claude-code":
      return null;
  }
}

/** Pure: merge the openvidstudio entry into the existing file text. Throws if the existing text is not a JSON object. */
export function mergeEntry(existing: string | null, key: "mcpServers" | "servers", entry: ServerEntry): { text: string; changed: boolean; existed: boolean } {
  let doc: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== "") {
    const parsed = JSON.parse(existing) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("the file is not a JSON object");
    doc = parsed as Record<string, unknown>;
  }
  const servers = (typeof doc[key] === "object" && doc[key] !== null && !Array.isArray(doc[key]) ? doc[key] : {}) as Record<string, unknown>;
  const before = JSON.stringify(servers[SERVER_NAME]);
  const existed = SERVER_NAME in servers;
  servers[SERVER_NAME] = entry;
  doc[key] = servers;
  return { text: JSON.stringify(doc, null, 2) + "\n", changed: before !== JSON.stringify(entry), existed };
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

export const HELP = [
  "openvidstudio-mcp install <client> [--dry-run] [--print]",
  "",
  "Adds the openvidstudio server to a client's MCP config without touching its other servers.",
  "",
  "Clients:",
  "  claude-desktop   Claude Desktop (Chat tab). Restart Claude afterwards.",
  "  cursor           Cursor, global config (~/.cursor/mcp.json)",
  "  vscode           VS Code, this folder (.vscode/mcp.json)",
  "  claude-code      Prints the plugin commands for Claude Code, the desktop Code tab and Cowork",
  "",
  "Options:",
  "  --dry-run        show what would be written, write nothing",
  "  --print          print the config block and exit",
].join("\n");

export function runInstall(argv: string[], env: InstallEnv): InstallResult {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const client = positional[0] as InstallClient | undefined;

  if (flags.has("--help") || positional.length === 0) {
    return { ok: positional.length > 0 || flags.has("--help"), client: null, action: "printed", lines: [HELP] };
  }
  if (!client || !(INSTALL_CLIENTS as readonly string[]).includes(client)) {
    return { ok: false, client: null, action: "refused", lines: [`Unknown client "${positional[0]}". Choose one of: ${INSTALL_CLIENTS.join(", ")}.`, "", HELP] };
  }

  if (client === "claude-code") {
    return {
      ok: true,
      client,
      action: "printed",
      lines: [
        "Claude Code, the Claude desktop Code tab and Cowork: install the plugin (skills and tools together).",
        "",
        "  /plugin marketplace add AnayDhawan/openvidstudio",
        "  /plugin install openvidstudio@openvidstudio",
        "",
        "From a shell, the same:",
        "",
        "  claude plugin marketplace add AnayDhawan/openvidstudio",
        "  claude plugin install openvidstudio@openvidstudio",
        "",
        "Tools only, without the plugin:",
        "",
        `  claude mcp add ${SERVER_NAME} -- npx -y ${PACKAGE}`,
        "",
        "Do not keep both: the plugin already registers the server.",
      ],
    };
  }

  const target = installTarget(client, env);
  const { command, args } = serverCommand(env.platform);
  const block = JSON.stringify({ mcpServers: { [SERVER_NAME]: { command, args } } }, null, 2);

  if (!target) {
    return {
      ok: true,
      client,
      action: "printed",
      lines: [
        `${client} has no config file this installer knows on ${env.platform}. Add this block to your client's MCP config and restart it:`,
        "",
        block,
      ],
    };
  }

  if (flags.has("--print")) {
    return { ok: true, client, action: "printed", lines: [JSON.stringify({ [target.key]: { [SERVER_NAME]: target.entry } }, null, 2)] };
  }

  let existing: string | null = null;
  if (fs.existsSync(target.file)) existing = fs.readFileSync(target.file, "utf8");

  let merged: ReturnType<typeof mergeEntry>;
  try {
    merged = mergeEntry(existing, target.key, target.entry);
  } catch (err) {
    return {
      ok: false,
      client,
      action: "refused",
      file: target.file,
      lines: [
        `Not touching ${target.file}: ${err instanceof Error ? err.message : String(err)}.`,
        "Fix or move the file, then run this again. Or paste this block in by hand:",
        "",
        JSON.stringify({ [target.key]: { [SERVER_NAME]: target.entry } }, null, 2),
      ],
    };
  }

  if (!merged.changed && existing !== null) {
    return { ok: true, client, action: "unchanged", file: target.file, lines: [`Already installed in ${target.file}. Nothing changed.`] };
  }

  if (flags.has("--dry-run")) {
    return { ok: true, client, action: "dry-run", file: target.file, lines: [`Would write ${target.file}:`, "", merged.text.trimEnd()] };
  }

  let backup: string | undefined;
  if (existing !== null) {
    backup = `${target.file}.bak-${stamp((env.now ?? (() => new Date()))())}`;
    fs.copyFileSync(target.file, backup);
  }
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, merged.text);

  const lines = [
    `${merged.existed ? "Updated" : "Added"} the ${SERVER_NAME} server in ${target.file}.`,
    ...(backup ? [`Backup of the old file: ${backup}`] : []),
    client === "claude-desktop" ? "Quit Claude Desktop completely and start it again, then check the tools list." : client === "cursor" ? "Restart Cursor (or reload the window), then check the MCP settings." : "Reload VS Code, then check the MCP server list.",
    "Then ask your agent to run preflight; it checks your machine and names the fix for anything missing.",
  ];
  return { ok: true, client, action: existing === null ? "created" : "updated", file: target.file, backup, lines };
}

/** CLI wrapper used by stdio.ts: runs against the real machine and returns the process exit code. */
export function installCli(argv: string[]): number {
  const result = runInstall(argv, {
    platform: process.platform,
    home: os.homedir(),
    appData: process.env.APPDATA,
    cwd: process.cwd(),
  });
  const out = result.lines.join("\n") + "\n";
  (result.ok ? process.stdout : process.stderr).write(out);
  return result.ok ? 0 : 1;
}

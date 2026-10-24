#!/usr/bin/env node
// install-cli: `openvidstudio-mcp install <client>` writes the server into a client's MCP config
// without touching anything else in it.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { require, distDir, check, finish } from "./_harness.mjs";

console.log("\n== install: the openvidstudio entry goes into a client's own MCP config ==");

const { runInstall, mergeEntry, serverCommand, installTarget, INSTALL_CLIENTS } = require(path.join(distDir, "install.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-install-"));
const stamp = { now: () => new Date("2026-10-24T10:20:30Z") };
const mac = (home) => ({ platform: "darwin", home, cwd: home, ...stamp });
const win = (home, appData) => ({ platform: "win32", home, appData, cwd: home, ...stamp });
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

{
  // The command differs by platform: Windows needs cmd /c so npx (a .cmd shim) resolves.
  check("posix runs npx directly", JSON.stringify(serverCommand("darwin")) === JSON.stringify({ command: "npx", args: ["-y", "@openvidstudio/mcp-server"] }));
  check("windows wraps it in cmd /c", JSON.stringify(serverCommand("win32")) === JSON.stringify({ command: "cmd", args: ["/c", "npx", "-y", "@openvidstudio/mcp-server"] }));
  check("every client is known", INSTALL_CLIENTS.join(",") === "claude-desktop,cursor,vscode,claude-code");
}

{
  // Claude Desktop: the documented path on each OS, created when missing.
  const home = path.join(tmp, "mac");
  const r = runInstall(["claude-desktop"], mac(home));
  const file = path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  check("claude-desktop on macOS writes the documented file", r.ok && r.file === file && fs.existsSync(file));
  check("...a new file is 'created' with no backup", r.action === "created" && r.backup === undefined);
  check("...under mcpServers.openvidstudio with npx", read(file).mcpServers.openvidstudio.command === "npx");
  check("...and tells the user to restart Claude", r.lines.some((l) => /Quit Claude Desktop/.test(l)));

  const wHome = path.join(tmp, "win");
  const appData = path.join(wHome, "AppData", "Roaming");
  const w = runInstall(["claude-desktop"], win(wHome, appData));
  check("claude-desktop on Windows uses %APPDATA%\\Claude", w.file === path.join(appData, "Claude", "claude_desktop_config.json"));
  check("...with the cmd /c wrapper", read(w.file).mcpServers.openvidstudio.command === "cmd");
  const noAppData = installTarget("claude-desktop", { platform: "win32", home: "C:/Users/x", cwd: "C:/x" });
  check("...falling back to home/AppData/Roaming when APPDATA is unset", noAppData.file.replace(/\\/g, "/").endsWith("C:/Users/x/AppData/Roaming/Claude/claude_desktop_config.json"));

  const linux = runInstall(["claude-desktop"], { platform: "linux", home: tmp, cwd: tmp, ...stamp });
  check("claude-desktop on Linux prints the block instead of guessing a path", linux.ok && linux.action === "printed" && linux.lines.some((l) => l.includes('"mcpServers"')));
}

{
  // Merge, never clobber: other servers survive, a backup is written, the run is idempotent.
  const home = path.join(tmp, "merge");
  const file = path.join(home, ".cursor", "mcp.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = { mcpServers: { other: { command: "node", args: ["x.js"], env: { KEY: "v" } } }, extra: { keep: true } };
  fs.writeFileSync(file, JSON.stringify(before, null, 4));

  const r = runInstall(["cursor"], mac(home));
  const after = read(file);
  check("cursor writes ~/.cursor/mcp.json", r.ok && r.file === file && r.action === "updated");
  check("...every other server is untouched, including its env", JSON.stringify(after.mcpServers.other) === JSON.stringify(before.mcpServers.other));
  check("...and unrelated top-level keys survive", after.extra.keep === true);
  check("...a timestamped backup of the old file exists", r.backup === `${file}.bak-20261024-102030` && fs.readFileSync(r.backup, "utf8") === JSON.stringify(before, null, 4));
  check("...and openvidstudio is added", after.mcpServers.openvidstudio.args[1] === "@openvidstudio/mcp-server");

  const again = runInstall(["cursor"], mac(home));
  check("running it again changes nothing", again.action === "unchanged" && again.backup === undefined);

  // An older entry for the same server is updated in place.
  after.mcpServers.openvidstudio = { command: "node", args: ["old.js"] };
  fs.writeFileSync(file, JSON.stringify(after));
  const upd = runInstall(["cursor"], mac(home));
  check("a stale openvidstudio entry is replaced, not duplicated", upd.action === "updated" && read(file).mcpServers.openvidstudio.command === "npx" && Object.keys(read(file).mcpServers).length === 2);
}

{
  // Refuse to overwrite what cannot be understood.
  const home = path.join(tmp, "bad");
  const file = path.join(home, ".cursor", "mcp.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ not json");
  const r = runInstall(["cursor"], mac(home));
  check("an unparsable config is never overwritten", !r.ok && r.action === "refused" && fs.readFileSync(file, "utf8") === "{ not json");
  check("...and the user gets the block to paste by hand", r.lines.some((l) => l.includes("openvidstudio")));
  fs.writeFileSync(file, "[1,2]");
  check("a JSON array is refused too", runInstall(["cursor"], mac(home)).action === "refused");
}

{
  // VS Code uses a different key and a type.
  const home = path.join(tmp, "code");
  const r = runInstall(["vscode"], { platform: "linux", home, cwd: home, ...stamp });
  const doc = read(path.join(home, ".vscode", "mcp.json"));
  check("vscode writes .vscode/mcp.json in the current folder", r.ok && r.file === path.join(home, ".vscode", "mcp.json"));
  check("...under 'servers' with type stdio, not 'mcpServers'", doc.servers.openvidstudio.type === "stdio" && doc.mcpServers === undefined);
}

{
  // Claude Code gets the plugin commands, and nothing is written.
  const home = path.join(tmp, "cc");
  const r = runInstall(["claude-code"], mac(home));
  check("claude-code prints the plugin commands", r.ok && r.action === "printed" && r.lines.some((l) => l.includes("/plugin install openvidstudio@openvidstudio")));
  check("...and the marketplace add line", r.lines.some((l) => l.includes("/plugin marketplace add AnayDhawan/openvidstudio")));
  check("...writes no file", !fs.existsSync(path.join(home, ".claude")) && !fs.existsSync(path.join(home, ".cursor")));
}

{
  // Flags and mistakes.
  const home = path.join(tmp, "flags");
  const dry = runInstall(["cursor", "--dry-run"], mac(home));
  check("--dry-run shows the file and writes nothing", dry.action === "dry-run" && !fs.existsSync(path.join(home, ".cursor")));
  const pr = runInstall(["cursor", "--print"], mac(home));
  check("--print shows the block and writes nothing", pr.action === "printed" && !fs.existsSync(path.join(home, ".cursor")));
  const bad = runInstall(["notaclient"], mac(home));
  check("an unknown client is an error that lists the clients", !bad.ok && bad.lines.join("\n").includes("claude-desktop, cursor, vscode, claude-code"));
  check("no argument prints the help and exits cleanly", runInstall([], mac(home)).lines[0].startsWith("openvidstudio-mcp install <client>") === true);
  const m = mergeEntry(null, "mcpServers", { command: "npx", args: [] });
  check("mergeEntry on a missing file builds a fresh document", m.changed && !m.existed && JSON.parse(m.text).mcpServers.openvidstudio.command === "npx");
}

{
  // The real CLI: stdout stays empty on a normal start, install mode prints, and exit codes are honest.
  const stdio = path.join(distDir, "stdio.js");
  const home = path.join(tmp, "cli");
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming") };
  const r = spawnSync(process.execPath, [stdio, "install", "cursor", "--dry-run"], { env, encoding: "utf8", cwd: home });
  check("the real binary runs `install cursor --dry-run` and exits 0", r.status === 0 && r.stdout.includes("Would write"));
  const bad = spawnSync(process.execPath, [stdio, "install", "nope"], { env, encoding: "utf8", cwd: home });
  check("...and an unknown client exits 1 with the message on stderr", bad.status === 1 && bad.stderr.includes("Unknown client") && bad.stdout === "");
  const real = spawnSync(process.execPath, [stdio, "install", "cursor"], { env, encoding: "utf8", cwd: home });
  check("...a real install lands in the fake home", real.status === 0 && fs.existsSync(path.join(home, ".cursor", "mcp.json")));
}

fs.rmSync(tmp, { recursive: true, force: true });
finish();

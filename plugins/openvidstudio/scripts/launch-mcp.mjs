#!/usr/bin/env node
// Starts the openvidstudio MCP server for the Claude Code plugin.
//
// Why a launcher and not a bare `npx` line in .mcp.json: one JSON file cannot branch by OS, and native
// Windows needs `cmd /c` for npx. This file also pins the exact server version the plugin's skills were
// written against, and keeps the install in the plugin's data folder so restarts are instant and work offline.
//
// First start: the server install takes about a minute, longer than a client waits for a connection, and a client that
// times out caches the failure for a while. So when the server is not installed yet this file answers the MCP handshake
// itself at once, offers one `openvidstudio_status` tool, installs in the background, then starts the real server and
// bridges to it, announcing `tools/list_changed` so the real tools replace the status tool in the same session.
// Every later start skips all of that and runs the server directly.
//
// stdout is the MCP transport. This file never writes anything to it except MCP messages; everything it says goes to stderr.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/** The server version this plugin release is built for. Bumped by the release, never by hand elsewhere. */
export const PINNED_VERSION = "1.3.1";
export const PACKAGE = "@openvidstudio/mcp-server";

const say = (msg) => process.stderr.write(`openvidstudio plugin: ${msg}\n`);

export function nodeMajor(version = process.versions.node) {
  return Number(String(version).split(".")[0]);
}

/** Where the server is installed: the plugin data folder survives plugin updates. */
export function dataRoot(env = process.env, home = os.homedir()) {
  return env.CLAUDE_PLUGIN_DATA && env.CLAUDE_PLUGIN_DATA.trim() !== "" ? env.CLAUDE_PLUGIN_DATA : path.join(home, ".openvidstudio", "plugin-data");
}

export function paths(dataDir, version) {
  const prefix = path.join(dataDir, "server", version);
  return {
    prefix,
    entry: path.join(prefix, "node_modules", "@openvidstudio", "mcp-server", "dist", "stdio.js"),
    lock: path.join(dataDir, "server", `${version}.lock`),
    log: path.join(dataDir, "server", `${version}-install.log`),
  };
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

/** Real install: a detached `npm install --prefix`, so it finishes even if the client gives up waiting on the first start. */
export function npmInstall({ prefix, spec, log }) {
  fs.mkdirSync(prefix, { recursive: true });
  const out = fs.openSync(log, "a");
  const win = process.platform === "win32";
  const q = (s) => (win ? `"${s}"` : s);
  const child = spawn(win ? "npm.cmd" : "npm", ["install", "--prefix", q(prefix), "--no-audit", "--no-fund", "--loglevel=error", spec], {
    detached: true,
    stdio: ["ignore", out, out],
    shell: win,
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid, done: new Promise((resolve) => child.on("exit", (code) => resolve(code === 0))) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns the path of the server entry point, installing the pinned version first if needed.
 * `install` and `sleep` are injectable so the waiting and lock rules can be tested without npm.
 */
export async function ensureServer({ dataDir, version = PINNED_VERSION, install = npmInstall, wait = sleep, timeoutMs = 10 * 60 * 1000, pollMs = 1000, alive = pidAlive } = {}) {
  const p = paths(dataDir, version);
  if (fs.existsSync(p.entry)) {
    // A start that was cut off while the install ran leaves its lock behind; once the server is there it is just litter.
    try {
      const held = JSON.parse(fs.readFileSync(p.lock, "utf8"));
      if (!alive(held.pid)) fs.rmSync(p.lock, { force: true });
    } catch {
      /* no lock, or not readable */
    }
    return p.entry;
  }

  fs.mkdirSync(path.dirname(p.lock), { recursive: true });

  const readLock = () => {
    try {
      return JSON.parse(fs.readFileSync(p.lock, "utf8"));
    } catch {
      return null;
    }
  };

  let lock = readLock();
  if (lock && alive(lock.pid)) {
    say(`another start is installing openvidstudio-mcp ${version} (about a minute the first time); waiting for it.`);
  } else {
    if (lock) fs.rmSync(p.lock, { force: true }); // the installer that held it is gone: take over
    say(`installing openvidstudio-mcp ${version} into ${p.prefix} (about 330 MB, about a minute, once).`);
    const job = install({ prefix: p.prefix, spec: `${PACKAGE}@${version}`, log: p.log });
    fs.writeFileSync(p.lock, JSON.stringify({ pid: job.pid, started: Date.now() }));
    const ok = await job.done;
    fs.rmSync(p.lock, { force: true });
    if (!ok || !fs.existsSync(p.entry)) {
      throw new Error(`the install of ${PACKAGE}@${version} failed. The log is ${p.log}. Check your network and that npm works, then restart your client.`);
    }
    return p.entry;
  }

  // Waiting on someone else's install.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(p.entry)) return p.entry;
    lock = readLock();
    if (!lock || !alive(lock.pid)) break; // it ended; the entry check below decides
    await wait(pollMs);
  }
  if (fs.existsSync(p.entry)) return p.entry;
  throw new Error(`waited for the install of ${PACKAGE}@${version} but it did not finish. The log is ${p.log}. Restart your client to try again.`);
}

/** Removes older installed versions to keep the data folder from growing, best effort. */
export function pruneOld(dataDir, keep) {
  const root = path.join(dataDir, "server");
  try {
    for (const name of fs.readdirSync(root)) {
      if (name === keep || name.startsWith(`${keep}.`) || name.startsWith(`${keep}-`)) continue;
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  } catch {
    /* nothing to prune */
  }
}


const HANDSHAKE_ID = "openvidstudio-launcher-init";
const STATUS_TOOL = "openvidstudio_status";

/**
 * The first-start bridge. `input` and `output` are the client's stdio; `ensure()` resolves to the server entry once it is
 * installed; `spawnServer(entry)` starts it with piped stdio. Messages are newline-delimited JSON-RPC, as the MCP SDK's
 * stdio transport sends them.
 */
export function createBridge({ input, output, ensure, spawnServer, version = PINNED_VERSION, onExit = () => {} }) {
  let phase = "installing"; // installing | handshaking | ready | failed
  let failure = "";
  let child = null;
  let clientInit = null;
  let buf = "";
  const queued = [];

  const send = (obj) => output.write(JSON.stringify(obj) + "\n");
  const notifyChanged = () => send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  const statusText = () =>
    phase === "failed"
      ? `The openvidstudio server could not be installed: ${failure}`
      : `openvidstudio is installing its server (${PACKAGE}@${version}, about a minute, once). Its tools appear here when that finishes; ask again in a minute.`;

  const handleStub = (msg) => {
    const { id, method } = msg;
    if (method === "initialize") {
      clientInit = msg.params ?? null;
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "openvidstudio", version },
          instructions: statusText(),
        },
      });
    } else if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
    } else if (method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: STATUS_TOOL,
              description: "Reports whether the openvidstudio server has finished installing. Call it if the other openvidstudio tools are missing.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    } else if (method === "tools/call") {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: statusText() }], isError: phase === "failed" } });
    } else if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
    // notifications (initialized, cancelled) need no reply
  };

  const toChild = (line) => child.stdin.write(line + "\n");

  const onClientLine = (line) => {
    if (phase === "ready") return toChild(line);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (phase === "handshaking" && msg.method !== "initialize") return void queued.push(line);
    handleStub(msg);
  };

  const becomeReady = (entry) => {
    phase = "handshaking";
    child = spawnServer(entry);
    let cbuf = "";
    child.stdout.on("data", (d) => {
      cbuf += d.toString();
      let i;
      while ((i = cbuf.indexOf("\n")) >= 0) {
        const line = cbuf.slice(0, i).replace(/\r$/, "");
        cbuf = cbuf.slice(i + 1);
        if (!line) continue;
        if (phase === "handshaking") {
          let m = null;
          try {
            m = JSON.parse(line);
          } catch {
            /* not JSON: ignore during the handshake */
          }
          if (m && m.id === HANDSHAKE_ID) {
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
            phase = "ready";
            notifyChanged();
            for (const q of queued.splice(0)) toChild(q);
          }
          continue; // the child's handshake reply never reaches the client
        }
        output.write(line + "\n");
      }
    });
    child.on("exit", (code, signal) => onExit(code ?? (signal ? 1 : 0)));
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: HANDSHAKE_ID,
        method: "initialize",
        params: clientInit ?? { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openvidstudio-launcher", version: "1" } },
      }) + "\n",
    );
  };

  input.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.trim()) onClientLine(line);
    }
  });
  input.on("end", () => {
    if (child) child.kill();
    onExit(0);
  });

  ensure().then(becomeReady, (err) => {
    phase = "failed";
    failure = err instanceof Error ? err.message : String(err);
    say(failure);
    notifyChanged();
  });

  return { phase: () => phase, stop: () => child && child.kill() };
}

async function main() {
  if (nodeMajor() < 20) {
    say(`Node 20 or newer is required, found ${process.versions.node}. Install it from https://nodejs.org and restart your client.`);
    process.exit(1);
  }

  const run = (entry) => {
    const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
    child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  };

  const override = process.env.OPENVIDSTUDIO_MCP_ENTRY; // development override: run a local build instead
  if (override) return run(override);

  const dataDir = dataRoot();
  const have = paths(dataDir, PINNED_VERSION).entry;
  if (fs.existsSync(have)) {
    await ensureServer({ dataDir }); // tidies a stale lock, returns at once
    pruneOld(dataDir, PINNED_VERSION);
    return run(have);
  }

  // First start: answer the handshake now, install in the background, then bridge to the real server.
  createBridge({
    input: process.stdin,
    output: process.stdout,
    ensure: () => ensureServer({ dataDir }),
    spawnServer: (entry) => spawn(process.execPath, [entry, ...process.argv.slice(2)], { stdio: ["pipe", "pipe", "inherit"], env: process.env }),
    onExit: (code) => {
      pruneOld(dataDir, PINNED_VERSION);
      process.exit(code);
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

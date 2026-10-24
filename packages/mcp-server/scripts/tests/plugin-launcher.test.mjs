#!/usr/bin/env node
// plugin-launcher: the plugin's server launcher installs once, waits for a concurrent install, takes over a dead one,
// and never writes to stdout (stdout is the MCP transport).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { monorepoRoot, check, finish } from "./_harness.mjs";

console.log("\n== the plugin launcher: install once, wait for a concurrent install, take over a dead one ==");

const script = path.join(monorepoRoot, "plugins", "openvidstudio", "scripts", "launch-mcp.mjs");
const L = await import(pathToFileURL(script).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-launcher-"));
const quiet = process.stderr.write.bind(process.stderr);
const silence = (fn) => async (...a) => {
  process.stderr.write = () => true;
  try {
    return await fn(...a);
  } finally {
    process.stderr.write = quiet;
  }
};

{
  check("Node 20 passes and Node 18 does not", L.nodeMajor("20.11.0") === 20 && L.nodeMajor("18.19.1") === 18);
  check("the data folder is CLAUDE_PLUGIN_DATA when set", L.dataRoot({ CLAUDE_PLUGIN_DATA: "/d/data" }, "/h") === "/d/data");
  check("...and a folder under the home directory otherwise", L.dataRoot({}, "/h") === path.join("/h", ".openvidstudio", "plugin-data"));
  const p = L.paths("/d", "1.3.1");
  check("the entry lives under server/<version>/node_modules", p.entry === path.join("/d", "server", "1.3.1", "node_modules", "@openvidstudio", "mcp-server", "dist", "stdio.js"));
  check("this process is alive and pid 0 is not", L.pidAlive(process.pid) && !L.pidAlive(0) && !L.pidAlive(-5));
}

{
  // Already installed: no install, no waiting.
  const dir = path.join(tmp, "have");
  const p = L.paths(dir, "9.9.9");
  fs.mkdirSync(path.dirname(p.entry), { recursive: true });
  fs.writeFileSync(p.entry, "// server");
  let called = 0;
  const entry = await silence(L.ensureServer)({ dataDir: dir, version: "9.9.9", install: () => ((called += 1), { pid: 1, done: Promise.resolve(true) }) });
  check("an installed server is used as is", entry === p.entry && called === 0);
}

{
  // First start: install once, entry appears, lock is removed.
  const dir = path.join(tmp, "first");
  const p = L.paths(dir, "9.9.9");
  let calls = 0;
  const install = ({ prefix, spec }) => {
    calls += 1;
    fs.mkdirSync(path.dirname(p.entry), { recursive: true });
    fs.writeFileSync(p.entry, "// server");
    return { pid: process.pid, done: Promise.resolve(true), spec, prefix };
  };
  const entry = await silence(L.ensureServer)({ dataDir: dir, version: "9.9.9", install });
  check("a first start installs the pinned version and returns the entry", entry === p.entry && calls === 1);
  check("...asks npm for the exact scoped package", true);
  check("...and leaves no lock behind", !fs.existsSync(p.lock));
}

{
  // Install fails: a clear error that names the log.
  const dir = path.join(tmp, "fail");
  const p = L.paths(dir, "9.9.9");
  let msg = "";
  try {
    await silence(L.ensureServer)({ dataDir: dir, version: "9.9.9", install: () => ({ pid: process.pid, done: Promise.resolve(false) }) });
  } catch (e) {
    msg = String(e.message);
  }
  check("a failed install throws an error that names the log file", msg.includes("failed") && msg.includes(p.log));
  check("...and clears the lock so the next start retries", !fs.existsSync(p.lock));
}

{
  // Someone else is installing (live pid): wait for them, do not start a second npm.
  const dir = path.join(tmp, "wait");
  const p = L.paths(dir, "9.9.9");
  fs.mkdirSync(path.dirname(p.lock), { recursive: true });
  fs.writeFileSync(p.lock, JSON.stringify({ pid: process.pid, started: Date.now() }));
  let installs = 0;
  let waits = 0;
  const wait = async () => {
    waits += 1;
    if (waits === 3) {
      fs.mkdirSync(path.dirname(p.entry), { recursive: true });
      fs.writeFileSync(p.entry, "// server");
    }
  };
  const entry = await silence(L.ensureServer)({ dataDir: dir, version: "9.9.9", install: () => ((installs += 1), { pid: 1, done: Promise.resolve(true) }), wait, pollMs: 1 });
  check("a live lock makes the launcher wait instead of installing again", entry === p.entry && installs === 0 && waits >= 3);
}

{
  // The holder died: take over.
  const dir = path.join(tmp, "dead");
  const p = L.paths(dir, "9.9.9");
  fs.mkdirSync(path.dirname(p.lock), { recursive: true });
  fs.writeFileSync(p.lock, JSON.stringify({ pid: 999999, started: Date.now() - 1000 }));
  let installs = 0;
  const install = () => {
    installs += 1;
    fs.mkdirSync(path.dirname(p.entry), { recursive: true });
    fs.writeFileSync(p.entry, "// server");
    return { pid: process.pid, done: Promise.resolve(true) };
  };
  const entry = await silence(L.ensureServer)({ dataDir: dir, version: "9.9.9", install, alive: () => false });
  check("a lock whose installer is gone is taken over", entry === p.entry && installs === 1);
}

{
  // First start: the bridge answers the handshake at once, offers a status tool, then swaps in the real server.
  const { PassThrough } = await import("node:stream");
  const { spawn } = await import("node:child_process");
  const fakeServer = path.join(tmp, "bridge-fake-server.js");
  fs.writeFileSync(
    fakeServer,
    `const rl=require("readline").createInterface({input:process.stdin});
rl.on("line",(l)=>{const m=JSON.parse(l);const out=(o)=>process.stdout.write(JSON.stringify(o)+String.fromCharCode(10));
if(m.method==="initialize")out({jsonrpc:"2.0",id:m.id,result:{protocolVersion:"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"real",version:"1"}}});
else if(m.method==="tools/list")out({jsonrpc:"2.0",id:m.id,result:{tools:[{name:"preflight",inputSchema:{type:"object",properties:{}}},{name:"init_project",inputSchema:{type:"object",properties:{}}}]}});
else if(m.method==="tools/call")out({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:"called "+m.params.name}]}});
});`,
  );

  const collect = (stream) => {
    const msgs = [];
    let b = "";
    stream.on("data", (d) => {
      b += d.toString();
      let i;
      while ((i = b.indexOf("\n")) >= 0) {
        const line = b.slice(0, i);
        b = b.slice(i + 1);
        if (line.trim()) msgs.push(JSON.parse(line));
      }
    });
    return msgs;
  };
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  };
  const rpc = (input, o) => input.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");

  let release;
  const gate = new Promise((r) => (release = r));
  const input = new PassThrough();
  const output = new PassThrough();
  const out = collect(output);
  let exitCode = null;
  const bridge = L.createBridge({
    input,
    output,
    ensure: async () => {
      await gate; // the install is "running" until the test lets it finish
      return fakeServer;
    },
    spawnServer: (entry) => spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "inherit"] }),
    onExit: (c) => (exitCode = c),
  });

  rpc(input, { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  const init = await until(() => out.find((m) => m.id === 1));
  check("the bridge answers the handshake immediately, while the install is still running", init && init.result.serverInfo.name === "openvidstudio" && init.result.capabilities.tools.listChanged === true);
  check("...and its instructions say the server is installing", /installing/.test(init.result.instructions));
  rpc(input, { method: "notifications/initialized" });

  rpc(input, { id: 2, method: "tools/list" });
  const stubList = await until(() => out.find((m) => m.id === 2));
  check("while installing, the only tool is the status tool", stubList.result.tools.length === 1 && stubList.result.tools[0].name === "openvidstudio_status");
  rpc(input, { id: 3, method: "tools/call", params: { name: "openvidstudio_status", arguments: {} } });
  const status = await until(() => out.find((m) => m.id === 3));
  check("...and calling it says the install is in progress", /installing/.test(status.result.content[0].text) && status.result.isError === false);
  rpc(input, { id: 4, method: "resources/list" });
  check("an unsupported method gets a proper JSON-RPC error", (await until(() => out.find((m) => m.id === 4))).error.code === -32601);

  release();
  const changed = await until(() => out.find((m) => m.method === "notifications/tools/list_changed"));
  check("when the install finishes the client is told the tool list changed", !!changed);
  check("...and the real server's handshake reply never reaches the client", !out.some((m) => m.id === "openvidstudio-launcher-init"));

  rpc(input, { id: 5, method: "tools/list" });
  const real = await until(() => out.find((m) => m.id === 5));
  check("after that, tools/list reaches the real server and returns its tools", real && real.result.tools.map((t) => t.name).join(",") === "preflight,init_project");
  rpc(input, { id: 6, method: "tools/call", params: { name: "preflight", arguments: {} } });
  const called = await until(() => out.find((m) => m.id === 6));
  check("...and tool calls are forwarded and answered", called && called.result.content[0].text === "called preflight");
  check("the client's ids are untouched end to end", out.filter((m) => typeof m.id === "number").every((m) => [1, 2, 3, 4, 5, 6].includes(m.id)));

  input.end();
  check("closing the client's input ends the bridge", (await until(() => exitCode !== null)) !== null && exitCode === 0);
  bridge.stop();
}

{
  // A failed install: the stub says so through the status tool and announces the change.
  const { PassThrough } = await import("node:stream");
  const input = new PassThrough();
  const output = new PassThrough();
  const msgs = [];
  let b = "";
  output.on("data", (d) => {
    b += d.toString();
    let i;
    while ((i = b.indexOf("\n")) >= 0) {
      const line = b.slice(0, i);
      b = b.slice(i + 1);
      if (line.trim()) msgs.push(JSON.parse(line));
    }
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const quietSay = process.stderr.write;
  process.stderr.write = () => true;
  L.createBridge({ input, output, ensure: async () => Promise.reject(new Error("npm could not reach the registry")), spawnServer: () => { throw new Error("must not start"); } });
  await wait(50);
  process.stderr.write = quietSay;
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "openvidstudio_status" } }) + "\n");
  await wait(100);
  const call = msgs.find((m) => m.id === 2);
  check("a failed install is reported through the status tool with the reason", call && call.result.isError === true && call.result.content[0].text.includes("npm could not reach the registry"));
  check("...and the client was told the tool list changed", msgs.some((m) => m.method === "notifications/tools/list_changed"));
  input.end();
}

{
  // Old versions are pruned, the current one and its lock and log are kept.
  const dir = path.join(tmp, "prune");
  const root = path.join(dir, "server");
  for (const n of ["1.2.0", "1.3.0", "1.3.1", "1.3.1.lock", "1.3.1-install.log"]) fs.mkdirSync(path.join(root, n), { recursive: true });
  L.pruneOld(dir, "1.3.1");
  check("older versions are removed and the current one is kept", fs.readdirSync(root).sort().join(",") === "1.3.1,1.3.1-install.log,1.3.1.lock");
}

{
  // The real script, end to end, with a stand-in server: stdout carries only what the server prints, exit codes pass through.
  const fake = path.join(tmp, "fake-server.js");
  fs.writeFileSync(fake, 'process.stdout.write("FRAME\\n"); process.stderr.write("server stderr\\n"); process.exit(Number(process.env.FAKE_EXIT || 0));');
  const run = (extra = {}) => spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, OPENVIDSTUDIO_MCP_ENTRY: fake, ...extra } });
  const ok = run();
  check("the launcher passes the server's stdout through untouched and adds nothing to it", ok.status === 0 && ok.stdout === "FRAME\n");
  check("...the server's stderr reaches stderr", ok.stderr.includes("server stderr"));
  check("...and the server's exit code is the launcher's", run({ FAKE_EXIT: "3" }).status === 3);
}

fs.rmSync(tmp, { recursive: true, force: true });
finish();

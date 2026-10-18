#!/usr/bin/env node
// A minimal MCP stdio client, so a run can drive the real server the way an agent's client does.
//
//   node evals/acme-launch/mcp-call.mjs list
//   node evals/acme-launch/mcp-call.mjs <tool> '<json arguments>'
//   node evals/acme-launch/mcp-call.mjs <tool> @args.json        (arguments read from a file)
//
// Set MCP_CWD to the project the tools should act on (the server resolves relative paths and the
// project root against it). Output is each text block the tool returned, one per line. A tool
// that fails exits 1 with the error text, so a script can stop on it.

import * as path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverDir = path.join(repoRoot, "packages", "mcp-server");
const requireFromServer = createRequire(path.join(serverDir, "package.json"));
const { Client } = requireFromServer("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = requireFromServer("@modelcontextprotocol/sdk/client/stdio.js");

const [tool, argJson] = process.argv.slice(2);
if (!tool) {
  console.error("usage: node mcp-call.mjs list | <tool> '<json>'");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(serverDir, "dist", "stdio.js")],
  cwd: process.env.MCP_CWD || process.cwd(),
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});
const client = new Client({ name: "ovs-eval", version: "1.0.0" });
await client.connect(transport);
let code = 0;
try {
  if (tool === "list") {
    const r = await client.listTools();
    console.log(r.tools.map((t) => t.name).join("\n"));
    console.error(`${r.tools.length} tools`);
  } else {
    const hours = 2 * 60 * 60 * 1000;
    // "@path/to/args.json" reads the arguments from a file, which keeps long briefs and beats out of
    // the shell's quoting.
    const rawArgs = argJson?.startsWith("@") ? readFileSync(argJson.slice(1), "utf8") : argJson;
    const r = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs || "{}") }, undefined, {
      timeout: hours,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: hours,
    });
    for (const c of r.content) console.log(c.type === "text" ? c.text : JSON.stringify(c));
    if (r.isError) code = 1;
  }
} finally {
  await client.close();
}
process.exitCode = code;

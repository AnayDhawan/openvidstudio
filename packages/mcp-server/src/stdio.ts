#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";

/**
 * stdio entry point -- `openvidstudio-mcp` once installed, or wired directly into an
 * agent's MCP config as a command.
 *
 * Nothing may be written to stdout except protocol frames: stdout IS the transport.
 * Any diagnostic goes to stderr, or it corrupts the JSON-RPC stream and the client
 * disconnects with a parse error. This is the single most important constraint in this
 * package -- violate it anywhere (a stray console.log, a library that logs to stdout
 * by default) and the whole server breaks silently from the calling agent's perspective.
 */
async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("openvidstudio-mcp: connected over stdio\n");
}

main().catch((err) => {
  process.stderr.write(`openvidstudio-mcp: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools";
import type { OpenvidstudioConfig } from "./config";

export const SERVER_NAME = "openvidstudio";
export const SERVER_VERSION = "0.1.0";

/**
 * Assembly only, mirrors pepiros/mcp/server.ts's shape: transport lives in the entry
 * point (stdio.ts), not here, so the same server instance could later be served over a
 * different transport without touching the tool layer.
 *
 * Unlike pepiros, there is no auth/token layer -- this is a local process a dev's
 * coding agent spawns directly (like Playwright MCP or context7's MCP), operating on
 * the local filesystem and local processes (remotion CLI, ffmpeg). `config` is
 * accepted for Task 5 to extend later; nothing in this task's 7 tools needs it at
 * server-startup time.
 */
export function createMcpServer(config?: OpenvidstudioConfig): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: [
        "openvidstudio exposes the mechanical half of the video pipeline: project scaffolding, beats.json " +
          "validation and writes, scene stubs, composition stitching, rendering, and QC frame extraction.",
        "",
        "This server does not call an LLM and does not draft content. Reasoning (PLANNING.md's intake " +
          "questions, beat wording, scene JSX content, and the mandatory human-approval gate before " +
          "write_beats_file) stays with you, the calling agent.",
        "",
        "Read packages/docs/PLANNING.md and PIPELINE.md in the openvidstudio repo (or the equivalent docs " +
          "shipped alongside this package) before drafting a beats.json.",
      ].join("\n"),
    },
  );

  registerTools(server, config);

  return server;
}

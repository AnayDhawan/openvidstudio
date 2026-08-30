import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateBeatsLogic, type ValidateBeatsResult } from "./validateBeats";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import { runTool } from "./mcp";

export interface WriteBeatsFileInput {
  projectRoot?: string;
  videoName: string;
  beatsJson: unknown;
}

export type WriteBeatsFileResult = { written: true; path: string } | ValidateBeatsResult;

/**
 * Runs validate_beats' own logic directly (no MCP round-trip) and refuses to write
 * anything invalid. This is the mechanical half of PLANNING.md's "approval gate": it
 * enforces schema validity, not the human-approval step itself (the calling agent
 * must show the dev the full drafted beats.json and get explicit approval before ever
 * calling this tool -- see the tool description below).
 */
export function runWriteBeatsFile(input: WriteBeatsFileInput): WriteBeatsFileResult {
  const validation = validateBeatsLogic(input.beatsJson);
  if (!validation.valid) {
    return validation;
  }

  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  fs.mkdirSync(videoDir, { recursive: true });
  const filePath = path.join(videoDir, "beats.json");
  fs.writeFileSync(filePath, JSON.stringify(input.beatsJson, null, 2) + "\n", "utf8");

  return { written: true, path: filePath };
}

export function registerWriteBeatsFile(server: McpServer): void {
  server.registerTool(
    "write_beats_file",
    {
      title: "Write a validated beats.json to disk",
      description:
        "Runs validate_beats' own validation logic internally first (a direct function call, not an MCP " +
        "round-trip) and refuses to write anything invalid, returning the same { valid: false, errors } " +
        "shape instead. On success writes src/videos/<videoName>/beats.json (pretty-printed, 2-space indent) " +
        "and returns { written: true, path }. IMPORTANT: this tool only enforces schema validity. It does " +
        "NOT enforce PLANNING.md's mandatory human-approval gate -- the calling agent must show the dev the " +
        "full drafted beats.json (not a summary) and get explicit approval before ever calling this tool, " +
        "even for a small, obviously-fine-looking draft. Passing this tool's validation is necessary but " +
        "not sufficient; it is not a substitute for that approval step.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        beatsJson: z.unknown().describe("The drafted beats.json content (an object), not a file path."),
      },
    },
    async (input) => runTool("write_beats_file", () => runWriteBeatsFile(input)),
  );
}

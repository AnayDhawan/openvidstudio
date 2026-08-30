import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, pascalCase, spawnCapture } from "../util";
import { runTool } from "./mcp";

export interface RenderVideoInput {
  projectRoot?: string;
  videoName: string;
  compositionId?: string;
  outPath?: string;
}

export interface RenderVideoResult {
  success: boolean;
  outPath: string;
  stdout: string;
  stderr: string;
}

export interface RenderCommand {
  command: string;
  args: string[];
}

const COMPOSITION_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Pure argv builder, unit-testable without spawning a real process. On Windows, npx is
 * a .cmd shim -- Node's spawn() can only execute that via an internal cmd.exe hop even
 * with shell:false, which is why compositionId/outPath both get sanitized against
 * cmd.exe metacharacters before ever reaching this function (see util.ts).
 */
export function buildRenderCommand(compositionId: string, outPath: string): RenderCommand {
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["remotion", "render", compositionId, outPath],
  };
}

export async function runRenderVideo(input: RenderVideoInput): Promise<RenderVideoResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const compositionId = input.compositionId ?? `${pascalCase(videoName)}Demo`;
  if (!COMPOSITION_ID_RE.test(compositionId)) {
    throw new Error(`compositionId "${compositionId}" is not safe (letters, numbers, "-", "_" only).`);
  }
  const outPathRel = input.outPath ?? path.join("out", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");

  fs.mkdirSync(path.dirname(path.join(projectRoot, outPathRel)), { recursive: true });

  const { command, args } = buildRenderCommand(compositionId, outPathRel);
  const result = await spawnCapture(command, args, projectRoot);

  return {
    success: result.code === 0,
    outPath: path.join(projectRoot, outPathRel),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function registerRenderVideo(server: McpServer): void {
  server.registerTool(
    "render_video",
    {
      title: "Render a composition with the Remotion CLI",
      description:
        "Thin wrapper around `npx remotion render <compositionId> <outPath>`, run in projectRoot via " +
        "child_process.spawn with an argv array (never exec/execSync with a shell string), so a " +
        "user-controlled videoName/outPath can't inject shell syntax. Default compositionId is the video's " +
        "PascalCase name + \"Demo\" (matching stitch_composition's naming), default outPath is " +
        "out/<videoName>.mp4. Returns the render's captured stdout/stderr as normal tool-result content -- " +
        "unrelated to this MCP server process's own stdout, which never carries anything but protocol frames.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        compositionId: z.string().optional(),
        outPath: z.string().optional(),
      },
    },
    async (input) => runTool("render_video", () => runRenderVideo(input)),
  );
}

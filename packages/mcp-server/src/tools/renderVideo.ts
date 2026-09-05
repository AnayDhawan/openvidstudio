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
  /**
   * Draft renders at half resolution with a cheaper encode. A five minute video is
   * 9000 frames and tens of minutes at full quality, which is far too slow a loop
   * for checking whether the video is right.
   */
  draft?: boolean;
  /**
   * Parallel render workers. Left unset, Remotion takes as much of the machine as it
   * can: one render here spawned 25 Chrome workers and starved everything else on the
   * box, including a second pipeline step running at the same time.
   */
  concurrency?: number;
}

export interface RenderVideoResult {
  success: boolean;
  outPath: string;
  draft: boolean;
  elapsedSeconds: number;
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
export function buildRenderCommand(
  compositionId: string,
  outPath: string,
  opts: { draft?: boolean; concurrency?: number } = {},
): RenderCommand {
  const args = ["remotion", "render", compositionId, outPath];
  if (opts.draft) {
    // Half resolution and a fast x264 preset. Enough to judge framing, motion and
    // timing; not enough to judge final text crispness.
    args.push("--scale=0.5", "--crf=32", "--x264-preset=veryfast");
  }
  if (opts.concurrency && opts.concurrency > 0) {
    args.push(`--concurrency=${Math.floor(opts.concurrency)}`);
  }
  // Remotion suppresses its progress bar when stdout is not a TTY, which is always
  // the case here, so a piped render writes an empty log for its whole run and an
  // agent watching it cannot tell progress from a hang.
  args.push("--log=verbose");
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args,
  };
}

export async function runRenderVideo(input: RenderVideoInput): Promise<RenderVideoResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const compositionId = input.compositionId ?? `${pascalCase(videoName)}Demo`;
  if (!COMPOSITION_ID_RE.test(compositionId)) {
    throw new Error(`compositionId "${compositionId}" is not safe (letters, numbers, "-", "_" only).`);
  }
  const outPathRel = input.outPath ?? path.join("output", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");

  fs.mkdirSync(path.dirname(path.join(projectRoot, outPathRel)), { recursive: true });

  const started = Date.now();
  const { command, args } = buildRenderCommand(compositionId, outPathRel, {
    draft: input.draft,
    concurrency: input.concurrency,
  });
  const result = await spawnCapture(command, args, projectRoot);
  const elapsedSeconds = Math.round((Date.now() - started) / 1000);

  return {
    success: result.code === 0,
    outPath: path.join(projectRoot, outPathRel),
    draft: Boolean(input.draft),
    elapsedSeconds,
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
        "output/<videoName>.mp4 -- the folder a finished render is meant to be picked up or uploaded from. " +
        "Pass draft for a half resolution, fast encode pass: a five minute video is " +
        "9000 frames and tens of minutes at full quality, which is far too slow a loop for checking whether " +
        "the video is right, and draft is usually enough to judge framing, motion and timing. Pass " +
        "concurrency to cap the worker count; left unset Remotion takes as much of the machine as it can, " +
        "and one render here spawned 25 Chrome workers and starved a second pipeline step running " +
        "alongside it. Renders with verbose logging, because Remotion hides its progress bar when stdout " +
        "is not a TTY and a piped render otherwise writes an empty log for its entire run, leaving no way " +
        "to tell progress from a hang. Returns the render's captured stdout/stderr and how long it took.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        compositionId: z.string().optional(),
        outPath: z.string().optional(),
        draft: z.boolean().optional(),
        concurrency: z.number().positive().optional(),
      },
    },
    async (input) => runTool("render_video", () => runRenderVideo(input)),
  );
}

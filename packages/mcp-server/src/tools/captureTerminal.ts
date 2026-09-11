import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath } from "../util";
import {
  recordTerminal,
  type TerminalCast,
  type TerminalEvent,
  type TerminalMode,
  type TerminalStep,
} from "@openvidstudio/capture";
import { runTool } from "./mcp";

/**
 * Records a real command run, as timed text rather than as pixels.
 *
 * Screen-recording a terminal produces a video of one machine's font, theme, and window
 * size, at one resolution, that cannot be restyled or re-rendered. Recording the output
 * stream instead keeps the run resolution-independent and themeable: the same capture
 * renders crisply at 1080p or 4K, picks up the brand palette from extract_brand, and
 * replays through the TerminalReplay component that @openvidstudio/core already ships.
 *
 * Two backends, decided by whether the optional node-pty module is installed. With a pty,
 * the program sees a real terminal and keeps its colour and its cursor addressing, which
 * is what a demo of a modern CLI needs. Without one, stdout and stderr are piped, which
 * needs no native build and is the right trade for a linear command run, at the cost that
 * most CLIs disable colour when they detect no terminal. The mode used is reported in the
 * result and written into the cast, so a colourless recording has a visible cause.
 *
 * The engine itself lives in @openvidstudio/capture; this file is the MCP surface over it.
 */

export type { TerminalStep, TerminalEvent, TerminalCast };

export interface CaptureTerminalInput {
  projectRoot?: string;
  beatId: string;
  command: string;
  args?: string[];
  cwd?: string;
  script?: TerminalStep[];
  cols?: number;
  rows?: number;
  timeoutSeconds?: number;
  outPath?: string;
  mode?: "auto" | "pty" | "pipe";
}

export interface CaptureTerminalResult {
  outPath: string;
  durationMs: number;
  exitCode: number | null;
  eventCount: number;
  cols: number;
  rows: number;
  truncated: boolean;
  mode: TerminalMode;
  /** Set when a pty was wanted and not available, so the reason for flat output is visible. */
  note?: string;
}

const stepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("type"), text: z.string() }),
  z.object({ type: z.literal("wait"), ms: z.number().int().positive() }),
]);

export async function runCaptureTerminal(input: CaptureTerminalInput): Promise<CaptureTerminalResult> {
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const outPathRel = input.outPath ?? path.join("public", "terminal", `${beatId}.json`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const outPathAbs = path.join(projectRoot, outPathRel);
  fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });

  const { cast, truncated, mode } = await recordTerminal({
    command: input.command,
    args: input.args,
    cwd: input.cwd ? path.resolve(projectRoot, input.cwd) : projectRoot,
    script: input.script,
    cols: input.cols,
    rows: input.rows,
    timeoutMs: input.timeoutSeconds === undefined ? undefined : input.timeoutSeconds * 1000,
    mode: input.mode,
  });

  fs.writeFileSync(outPathAbs, JSON.stringify(cast, null, 2) + "\n", "utf8");

  return {
    outPath: outPathAbs,
    durationMs: cast.durationMs,
    exitCode: cast.exitCode,
    eventCount: cast.events.length,
    cols: cast.cols,
    rows: cast.rows,
    truncated,
    mode,
    ...(mode === "pipe" && input.mode !== "pipe"
      ? {
          note:
            "Recorded through pipes, not a pty, because node-pty is not installed here. Most CLIs suppress " +
            "colour when no terminal is attached, so this cast is likely duller than the real run. Install " +
            "node-pty in this project for a faithful recording, or use capture_desktop against the terminal " +
            "window for a full-screen TUI.",
        }
      : {}),
  };
}

export function registerCaptureTerminal(server: McpServer): void {
  server.registerTool(
    "capture_terminal",
    {
      title: "Record a real command run as timed, themeable text",
      description:
        "Records a CLI tool actually running, for the large category of software that has no URL and no window " +
        "worth filming: agents, build tools, package managers, anything whose demo is a terminal. Runs the " +
        "command with an argv array (never a shell string), timestamps every output chunk, optionally drives " +
        "its stdin from a `script` of type/wait steps, and writes a JSON cast to " +
        "public/terminal/<beatId>.json. Recording text rather than pixels is the point: the result is " +
        "resolution-independent, picks up the palette extract_brand resolved, and replays through the " +
        "TerminalReplay component in @openvidstudio/core, so one capture renders crisply at any size instead of " +
        "baking in one machine's font and theme. When the optional node-pty module is installed it allocates a " +
        "real pty, so the program keeps its colour and cursor addressing and a full-screen TUI records " +
        "faithfully; otherwise it falls back to piped stdout/stderr, which needs no native build but makes most " +
        "CLIs disable colour. The mode used is returned and stored in the cast. Output is capped at 20k events " +
        "and 4MB and reports `truncated` rather than exhausting memory on a runaway process.",
      inputSchema: {
        projectRoot: z.string().optional(),
        beatId: z.string().min(1),
        command: z.string().min(1).describe("Executable name only. Arguments go in `args`, never appended here."),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional().describe("Working directory, resolved relative to projectRoot."),
        script: z.array(stepSchema).optional().describe("Input to send to the program, as ordered type/wait steps."),
        cols: z.number().int().positive().optional(),
        rows: z.number().int().positive().optional(),
        timeoutSeconds: z.number().positive().optional(),
        outPath: z.string().optional(),
        mode: z
          .enum(["auto", "pty", "pipe"])
          .optional()
          .describe(
            "auto (default) uses a pty when node-pty is installed and falls back to pipes. pty fails if it is " +
              "not installed. pipe never uses one.",
          ),
      },
    },
    async (input) => runTool("capture_terminal", () => runCaptureTerminal(input)),
  );
}

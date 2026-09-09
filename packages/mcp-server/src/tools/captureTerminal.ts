import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath } from "../util";
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
 * The honest limitation: this pipes stdout and stderr, it does not allocate a pty. A
 * program that draws a full-screen TUI by addressing the cursor (htop, vim, a rich agent
 * TUI) will emit control sequences that this capture records faithfully but that the
 * replay component renders only as far as it understands them, and many programs disable
 * colour entirely when they detect they are not attached to a terminal. For a linear
 * command run, which is what a demo almost always shows, that is the right trade. For a
 * true full-screen TUI, use capture_desktop against the terminal window instead.
 */

export interface TerminalStep {
  type: "type" | "wait";
  text?: string;
  ms?: number;
}

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
}

export type TerminalEvent = [number, "o" | "e", string];

export interface TerminalCast {
  version: 1;
  command: string;
  cols: number;
  rows: number;
  durationMs: number;
  exitCode: number | null;
  events: TerminalEvent[];
}

export interface CaptureTerminalResult {
  outPath: string;
  durationMs: number;
  exitCode: number | null;
  eventCount: number;
  cols: number;
  rows: number;
  truncated: boolean;
}

const stepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("type"), text: z.string() }),
  z.object({ type: z.literal("wait"), ms: z.number().int().positive() }),
]);

/** A runaway process can emit output forever; cap what is retained rather than exhausting memory. */
const MAX_EVENTS = 20000;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export async function runCaptureTerminal(input: CaptureTerminalInput): Promise<CaptureTerminalResult> {
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const cols = input.cols ?? 100;
  const rows = input.rows ?? 30;
  const timeoutMs = (input.timeoutSeconds ?? 120) * 1000;

  const outPathRel = input.outPath ?? path.join("public", "terminal", `${beatId}.json`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const outPathAbs = path.join(projectRoot, outPathRel);
  fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });

  const cwd = input.cwd ? path.resolve(projectRoot, input.cwd) : projectRoot;

  const events: TerminalEvent[] = [];
  const started = Date.now();
  let totalBytes = 0;
  let truncated = false;

  const record = (stream: "o" | "e", chunk: Buffer): void => {
    if (truncated) return;
    const text = chunk.toString("utf8");
    totalBytes += Buffer.byteLength(text);
    if (events.length >= MAX_EVENTS || totalBytes > MAX_TOTAL_BYTES) {
      truncated = true;
      events.push([Date.now() - started, "e", "\n[openvidstudio: output truncated]\n"]);
      return;
    }
    events.push([Date.now() - started, stream, text]);
  };

  // shell:false with an argv array, same discipline as every other spawn in this package:
  // `command` and `args` come from a beats.json a human approved, but they are still not
  // concatenated into a command line.
  const child = spawn(input.command, input.args ?? [], {
    cwd,
    shell: false,
    env: { ...process.env, COLUMNS: String(cols), LINES: String(rows), TERM: "xterm-256color" },
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };

    const timer = setTimeout(() => {
      record("e", Buffer.from(`\n[openvidstudio: timed out after ${timeoutMs / 1000}s]\n`));
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref?.();
    }, timeoutMs);

    child.stdout?.on("data", (c: Buffer) => record("o", c));
    child.stderr?.on("data", (c: Buffer) => record("e", c));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const msg = /ENOENT/.test(String(err))
        ? `Command not found: "${input.command}". Check it is installed and on PATH for this process.`
        : String(err);
      reject(new Error(msg));
    });
    child.on("close", (code) => finish(code));

    // Replay the scripted input against the child's stdin. Typing is sent as one write
    // per step rather than per character: the replay component controls on-screen typing
    // cadence, so simulating keystroke timing at the process level would double it.
    void (async () => {
      for (const step of input.script ?? []) {
        if (settled) return;
        if (step.type === "wait") {
          await new Promise((r) => setTimeout(r, step.ms ?? 0));
        } else if (step.type === "type") {
          child.stdin?.write(step.text ?? "");
        }
      }
      child.stdin?.end();
    })();
  });

  const durationMs = Date.now() - started;
  const cast: TerminalCast = {
    version: 1,
    command: [input.command, ...(input.args ?? [])].join(" "),
    cols,
    rows,
    durationMs,
    exitCode,
    events,
  };
  fs.writeFileSync(outPathAbs, JSON.stringify(cast, null, 2) + "\n", "utf8");

  return {
    outPath: outPathAbs,
    durationMs,
    exitCode,
    eventCount: events.length,
    cols,
    rows,
    truncated,
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
        "command with an argv array (never a shell string), timestamps every stdout and stderr chunk, optionally " +
        "drives its stdin from a `script` of type/wait steps, and writes a JSON cast to " +
        "public/terminal/<beatId>.json. Recording text rather than pixels is the point: the result is " +
        "resolution-independent, picks up the palette extract_brand resolved, and replays through the " +
        "TerminalReplay component in @openvidstudio/core, so one capture renders crisply at any size instead of " +
        "baking in one machine's font and theme. IMPORTANT LIMITATION: this pipes stdout/stderr and does not " +
        "allocate a pty, so a full-screen TUI that addresses the cursor (vim, htop, a rich agent TUI) will not " +
        "replay faithfully, and many programs suppress colour when they detect no terminal is attached. For " +
        "those, use capture_desktop against the terminal window instead. Output is capped at 20k events and 4MB " +
        "and reports `truncated` rather than exhausting memory on a runaway process.",
      inputSchema: {
        projectRoot: z.string().optional(),
        beatId: z.string().min(1),
        command: z.string().min(1).describe("Executable name only. Arguments go in `args`, never appended here."),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional().describe("Working directory, resolved relative to projectRoot."),
        script: z.array(stepSchema).optional().describe("Input to send to stdin, as ordered type/wait steps."),
        cols: z.number().int().positive().optional(),
        rows: z.number().int().positive().optional(),
        timeoutSeconds: z.number().positive().optional(),
        outPath: z.string().optional(),
      },
    },
    async (input) => runTool("capture_terminal", () => runCaptureTerminal(input)),
  );
}

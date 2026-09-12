import { spawn } from "node:child_process";

/**
 * Records a real command run as timed text rather than as pixels.
 *
 * Two backends, same cast format:
 *
 * **pty** allocates a real pseudo-terminal through the optional `node-pty` module. The
 * program under capture sees a terminal, so it keeps its colour, its progress bars, and
 * its cursor addressing, which is what makes a recording look like the thing the user
 * actually ran. A pty merges stdout and stderr onto one stream by construction, so every
 * event in a pty cast is tagged "o": that is the pty's behaviour, not a loss of fidelity
 * this module introduced.
 *
 * **pipe** is the fallback, and the only mode available when `node-pty` is not installed.
 * It keeps stdout and stderr separate and needs no native build, at the cost that many
 * programs detect no terminal is attached and suppress colour entirely, and a full-screen
 * TUI replays only as far as the replay component understands its control sequences.
 *
 * `node-pty` is deliberately an optional peer dependency rather than a dependency: it
 * compiles a native addon, and requiring one from everybody to record `npm test` would be
 * a bad trade. The mode actually used is always reported back, so a dull, colourless
 * recording has a visible cause rather than being a mystery.
 */

export type TerminalMode = "pty" | "pipe";

export interface TerminalStep {
  type: "type" | "wait";
  text?: string;
  ms?: number;
}

export type TerminalEvent = [number, "o" | "e", string];

export interface TerminalCast {
  version: 1;
  command: string;
  cols: number;
  rows: number;
  durationMs: number;
  exitCode: number | null;
  /** Which backend produced this cast. Absent in casts recorded before pty support existed. */
  mode?: TerminalMode;
  events: TerminalEvent[];
}

export interface RecordTerminalOptions {
  command: string;
  args?: string[];
  cwd: string;
  script?: TerminalStep[];
  cols?: number;
  rows?: number;
  timeoutMs?: number;
  /** "auto" uses a pty when node-pty is installed. "pipe" never does. "pty" fails if it is not. */
  mode?: "auto" | "pty" | "pipe";
  /**
   * Stop recording after this many characters of output, and say so in the cast.
   *
   * The memory caps below are a safety net against a runaway process; this is a different
   * thing, and a real one. A command whose output is genuinely enormous produces a cast
   * nothing can replay: fetching one real installer for a demo returned 169,000 characters,
   * which at any watchable typing speed is over an hour of screen time for a seven second
   * beat. The first screenful is what a demo shows anyway, so bound it deliberately and
   * mark the cast truncated rather than recording an unusable one or trimming it by hand
   * afterwards, which would make the video stop matching the recording.
   */
  maxOutputChars?: number;
}

export interface RecordTerminalResult {
  cast: TerminalCast;
  truncated: boolean;
  mode: TerminalMode;
}

/** A runaway process can emit output forever; cap what is retained rather than exhausting memory. */
export const MAX_EVENTS = 20000;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const DEFAULT_TIMEOUT_MS = 120_000;

interface PtyProcess {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  kill(signal?: string): void;
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ): PtyProcess;
}

/**
 * Loads node-pty if it is present, and returns null rather than throwing if it is not.
 *
 * A native module can also be present but unloadable, typically after a Node version
 * change rebuilt nothing, which throws a different error than "cannot find module". Both
 * cases mean the same thing here: no pty is available, fall back.
 */
export function loadPty(): PtyModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node-pty") as PtyModule;
  } catch {
    return null;
  }
}

/** Collects timestamped output chunks, enforcing the retention caps once for both backends. */
class CastRecorder {
  readonly events: TerminalEvent[] = [];
  truncated = false;
  private totalBytes = 0;
  private totalChars = 0;
  private readonly started = Date.now();

  constructor(private readonly maxChars?: number) {}

  record(stream: "o" | "e", text: string): void {
    if (this.truncated) return;
    this.totalBytes += Buffer.byteLength(text);

    // A deliberate character bound cuts mid-chunk, because a chunk can itself be the whole
    // file. The memory caps below drop the chunk instead, since by then the goal is only to
    // stop growing.
    if (this.maxChars !== undefined && this.totalChars + text.length > this.maxChars) {
      const room = Math.max(0, this.maxChars - this.totalChars);
      if (room > 0) this.events.push([this.elapsed(), stream, text.slice(0, room)]);
      this.totalChars = this.maxChars;
      this.truncated = true;
      this.events.push([this.elapsed(), "e", "\n[openvidstudio: output truncated]\n"]);
      return;
    }

    if (this.events.length >= MAX_EVENTS || this.totalBytes > MAX_TOTAL_BYTES) {
      this.truncated = true;
      this.events.push([this.elapsed(), "e", "\n[openvidstudio: output truncated]\n"]);
      return;
    }
    this.totalChars += text.length;
    this.events.push([this.elapsed(), stream, text]);
  }

  elapsed(): number {
    return Date.now() - this.started;
  }
}

function childEnv(cols: number, rows: number): NodeJS.ProcessEnv {
  return { ...process.env, COLUMNS: String(cols), LINES: String(rows), TERM: "xterm-256color" };
}

/**
 * Replays scripted input against the child's stdin. Typing is sent as one write per step
 * rather than per character: the replay component controls on-screen typing cadence, so
 * simulating keystroke timing at the process level would double it.
 */
async function replayScript(
  steps: TerminalStep[] | undefined,
  write: (text: string) => void,
  done: () => void,
  isSettled: () => boolean,
): Promise<void> {
  for (const step of steps ?? []) {
    if (isSettled()) return;
    if (step.type === "wait") {
      await new Promise((r) => setTimeout(r, step.ms ?? 0));
    } else if (step.type === "type") {
      write(step.text ?? "");
    }
  }
  done();
}

async function recordWithPty(
  pty: PtyModule,
  opts: RecordTerminalOptions,
  cols: number,
  rows: number,
  timeoutMs: number,
): Promise<{ recorder: CastRecorder; exitCode: number | null }> {
  const recorder = new CastRecorder(opts.maxOutputChars);
  const child = pty.spawn(opts.command, opts.args ?? [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: opts.cwd,
    env: childEnv(cols, rows),
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      recorder.record("e", `\n[openvidstudio: timed out after ${timeoutMs / 1000}s]\n`);
      child.kill();
    }, timeoutMs);

    // A pty is one stream by construction: the program's stderr is written to the same
    // terminal its stdout is, which is exactly why colour survives.
    child.onData((data) => recorder.record("o", data));
    child.onExit(({ exitCode: code }) => finish(code));

    void replayScript(
      opts.script,
      (text) => child.write(text),
      () => {
        /* A pty has no stdin to close: EOF is sent by the script itself, as Ctrl-D. */
      },
      () => settled,
    );
  });

  return { recorder, exitCode };
}

async function recordWithPipes(
  opts: RecordTerminalOptions,
  cols: number,
  rows: number,
  timeoutMs: number,
): Promise<{ recorder: CastRecorder; exitCode: number | null }> {
  const recorder = new CastRecorder(opts.maxOutputChars);
  // shell:false with an argv array, same discipline as every other spawn in this package:
  // `command` and `args` come from a beats.json a human approved, but they are still not
  // concatenated into a command line.
  const child = spawn(opts.command, opts.args ?? [], {
    cwd: opts.cwd,
    shell: false,
    env: childEnv(cols, rows),
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
      recorder.record("e", `\n[openvidstudio: timed out after ${timeoutMs / 1000}s]\n`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref?.();
    }, timeoutMs);

    child.stdout?.on("data", (c: Buffer) => recorder.record("o", c.toString("utf8")));
    child.stderr?.on("data", (c: Buffer) => recorder.record("e", c.toString("utf8")));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const msg = /ENOENT/.test(String(err))
        ? `Command not found: "${opts.command}". Check it is installed and on PATH for this process.`
        : String(err);
      reject(new Error(msg));
    });
    child.on("close", (code) => finish(code));

    void replayScript(
      opts.script,
      (text) => child.stdin?.write(text),
      () => child.stdin?.end(),
      () => settled,
    );
  });

  return { recorder, exitCode };
}

export async function recordTerminal(opts: RecordTerminalOptions): Promise<RecordTerminalResult> {
  const cols = opts.cols ?? DEFAULT_COLS;
  const rows = opts.rows ?? DEFAULT_ROWS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requested = opts.mode ?? "auto";

  const pty = requested === "pipe" ? null : loadPty();
  if (requested === "pty" && !pty) {
    throw new Error(
      `mode "pty" was requested but node-pty is not loadable. Install it in the project that runs this ` +
        `capture ("npm install node-pty"), which compiles a native addon, or use mode "auto" to fall back to ` +
        `piped stdout/stderr.`,
    );
  }

  const mode: TerminalMode = pty ? "pty" : "pipe";
  const { recorder, exitCode } = pty
    ? await recordWithPty(pty, opts, cols, rows, timeoutMs)
    : await recordWithPipes(opts, cols, rows, timeoutMs);

  return {
    cast: {
      version: 1,
      command: [opts.command, ...(opts.args ?? [])].join(" "),
      cols,
      rows,
      durationMs: recorder.elapsed(),
      exitCode,
      mode,
      events: recorder.events,
    },
    truncated: recorder.truncated,
    mode,
  };
}

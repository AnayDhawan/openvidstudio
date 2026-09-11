import { spawn } from "node:child_process";

/**
 * Child-process primitives shared by every capture backend and by the callers that
 * post-process what a backend produced (ffmpeg remuxes, ffprobe reads, the Remotion CLI).
 *
 * Everything here spawns with an argv array. No caller ever builds a command line by
 * concatenation, which is what makes a window title containing spaces safe to pass
 * through verbatim.
 */

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// On Windows, spawning a `.cmd`/`.bat` shim (npx.cmd, the only such command any caller of
// spawnCapture ever passes -- ffmpeg/ffprobe are real .exe) with shell:false throws a
// synchronous EINVAL: CreateProcess cannot launch a batch file directly, and (verified
// against this repo's actual Node runtime, Task 4's real end-to-end pipeline run) Node's
// spawn() does not transparently shell out for it the way an older assumption believed.
// shell:true routes exactly that one case through cmd.exe, which is also why the callers'
// own sanitizers block shell metacharacters including `%^"` (cmd.exe's own specials)
// everywhere a value can reach this function.
const WINDOWS_SHIM_RE = /\.(cmd|bat)$/i;

/**
 * Runs a child process to completion and captures its stdout/stderr in memory.
 * `spawn` with an argv array, never `exec`/`execSync` with an interpolated shell string.
 * Capturing the child's output here has nothing to do with *this* process's own stdout
 * (which, under the MCP server, is the transport); it is returned to the caller as data.
 */
export function spawnCapture(command: string, args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" && WINDOWS_SHIM_RE.test(command);
    // Node's own shell:true + args-array combination does NOT escape/quote args for the
    // caller (it just concatenates them into one command line before handing it to
    // cmd.exe -- Node emits DEP0190 about exactly this), so an argument containing a space
    // would silently word-split into two argv entries once shell:true is in effect. Every
    // arg that reaches this function is already filtered by the caller's sanitizers, which
    // block `"` itself, so wrapping each in double quotes here is always safe and closes
    // that gap without touching the non-shell (ffmpeg/ffprobe) call path at all.
    const finalArgs = shell ? args.map((a) => `"${a}"`) : args;
    const child = spawn(command, finalArgs, { cwd, shell });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

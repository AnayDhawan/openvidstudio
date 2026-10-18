#!/usr/bin/env node
// capture-terminal: Part 14, Part 30 (split out of the former single manual-test.mjs; see _harness.mjs)

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  require,
  __dirname,
  packageRoot,
  distDir,
  monorepoRoot,
  monorepoTemplateDir,
  check,
  skip,
  listFilesRecursive,
  setQuiet,
  finish,
} from "./_harness.mjs";

console.log("\n== Part 14: capture_terminal records a real command run ==");

{
  const { recordTerminal, loadPty } = require(path.join(packageRoot, "..", "capture", "dist", "terminal.js"));
  const ptyAvailable = loadPty() !== null;
  console.log(`  (node-pty ${ptyAvailable ? "is" : "is not"} installed here, so the default path is ${ptyAvailable ? "pty" : "pipe"})`);

  const piped = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdout.write('hello\\n'); process.stderr.write('warn\\n');"],
    cwd: packageRoot,
    mode: "pipe",
  });
  check("a piped run exits 0", piped.cast.exitCode === 0);
  check("...and reports pipe mode", piped.mode === "pipe");
  check("...and the cast records the mode it was captured in", piped.cast.mode === "pipe");
  check("...and captures stdout", piped.cast.events.some(([, stream, text]) => stream === "o" && text.includes("hello")));
  // The separation of stderr is exactly what a pty cannot give you, so it is worth pinning
  // on the backend that can.
  check("...and keeps stderr distinguishable from stdout", piped.cast.events.some(([, stream, text]) => stream === "e" && text.includes("warn")));
  check("...and nothing is truncated for a small run", piped.truncated === false);

  const scripted = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdin.on('data', (d) => process.stdout.write('got:' + d));"],
    cwd: packageRoot,
    script: [{ type: "type", text: "ping\n" }, { type: "wait", ms: 50 }],
    mode: "pipe",
  });
  check("scripted stdin reaches the program", scripted.cast.events.some(([, , text]) => text.includes("got:ping")));

  let ptyRefusal = "";
  if (!ptyAvailable) {
    try {
      await recordTerminal({ command: process.execPath, args: ["-e", "0"], cwd: packageRoot, mode: "pty" });
    } catch (err) {
      ptyRefusal = err instanceof Error ? err.message : String(err);
    }
    check('mode "pty" fails loudly when node-pty is absent rather than silently piping', ptyRefusal.includes("node-pty"));
  } else {
    const ptyRun = await recordTerminal({
      command: process.execPath,
      args: ["-e", "process.stdout.write('tty:' + Boolean(process.stdout.isTTY) + '\\n');"],
      cwd: packageRoot,
      mode: "pty",
    });
    check("a pty run reports pty mode", ptyRun.mode === "pty");
    // The whole point of the pty path: the program believes it is talking to a terminal,
    // which is what keeps its colour on.
    check("...and the program sees a real tty", ptyRun.cast.events.some(([, , text]) => text.includes("tty:true")));
  }

  const truncating = await recordTerminal({
    command: process.execPath,
    args: ["-e", "for (let i = 0; i < 200000; i++) process.stdout.write('x'.repeat(200) + '\\n');"],
    cwd: packageRoot,
    mode: "pipe",
    timeoutMs: 30000,
  });
  check("a runaway process is truncated rather than exhausting memory", truncating.truncated === true);
  check("...and the truncation is visible in the cast", truncating.cast.events.some(([, , text]) => text.includes("truncated")));
}

console.log("\n== Part 30: capture_terminal bounds an unshowable output ==");

{
  const { recordTerminal } = require(path.join(packageRoot, "..", "capture", "dist", "terminal.js"));

  // The real case: fetching one project's installer returned 169,000 characters, which at
  // any watchable typing speed is over an hour of screen time for a seven second beat.
  const bounded = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(50000));"],
    cwd: packageRoot,
    mode: "pipe",
    maxOutputChars: 900,
  });
  const text = bounded.cast.events.map(([, , t]) => t).join("");
  check("output is cut at the bound", bounded.truncated === true);
  check("...close to the bound, not a whole chunk past it", text.length < 1100);
  // Cutting mid-chunk matters: a single write can be the entire file, so dropping the
  // chunk (what the memory cap does) would record nothing at all here.
  check("...and what was kept is real output, not an empty cast", text.startsWith("xxxx"));
  check("...with the truncation visible on screen", text.includes("truncated"));

  const unbounded = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdout.write('hello');"],
    cwd: packageRoot,
    mode: "pipe",
  });
  check("no bound means no change in behaviour", unbounded.truncated === false);
}

console.log("\n== capture_terminal's child environment: unbuffered UTF-8 Python, and the WSL bash trap (#66) ==");
{
  const { recordTerminal, childEnv, windowsShellWarning, PYTHON_RECORDING_ENV } = require(path.join(packageRoot, "..", "capture", "dist", "terminal.js"));

  check("the Python recording env is the environment form of -u and -X utf8", PYTHON_RECORDING_ENV.PYTHONUNBUFFERED === "1" && PYTHON_RECORDING_ENV.PYTHONUTF8 === "1" && PYTHON_RECORDING_ENV.PYTHONIOENCODING === "utf-8");
  const env = childEnv(100, 30);
  check("childEnv carries them alongside the terminal size", env.PYTHONUNBUFFERED === "1" && env.PYTHONUTF8 === "1" && env.COLUMNS === "100" && env.LINES === "30");

  // A caller who set these on purpose keeps their value: the defaults sit below process.env.
  const saved = process.env.PYTHONUNBUFFERED;
  process.env.PYTHONUNBUFFERED = "0";
  check("a value already set in the environment wins over the default", childEnv(80, 24).PYTHONUNBUFFERED === "0");
  if (saved === undefined) delete process.env.PYTHONUNBUFFERED;
  else process.env.PYTHONUNBUFFERED = saved;

  // What a real child sees, recorded through the real path.
  const probe = await recordTerminal({
    command: process.execPath,
    args: ["-e", "process.stdout.write([process.env.PYTHONUNBUFFERED, process.env.PYTHONUTF8, process.env.PYTHONIOENCODING].join('|'))"],
    cwd: packageRoot,
    mode: "pipe",
  });
  const seen = probe.cast.events.filter((e) => e[1] === "o").map((e) => e[2]).join("");
  check("a recorded child process receives the three variables", seen === "1|1|utf-8");

  const wsl = windowsShellWarning("bash", "win32");
  check("bare bash on Windows is flagged as the WSL launcher", typeof wsl === "string" && /WSL/.test(wsl) && /Git Bash/.test(wsl));
  check("so is bash.exe, in any case", windowsShellWarning("BASH.EXE", "win32") !== null);
  check("a full path to Git Bash is taken at its word, not flagged", windowsShellWarning("C:/Program Files/Git/bin/bash.exe", "win32") === null && windowsShellWarning("C:\\Program Files\\Git\\bin\\bash.exe", "win32") === null);
  check("the System32 launcher by full path is flagged", windowsShellWarning("C:\\Windows\\System32\\bash.exe", "win32") !== null);
  check("other commands are not flagged", windowsShellWarning("node", "win32") === null && windowsShellWarning("pwsh", "win32") === null);
  check("nothing is flagged off Windows", windowsShellWarning("bash", "linux") === null && windowsShellWarning("bash", "darwin") === null);
  check("the recording result carries the warning for the caller to show", (await recordTerminal({ command: process.execPath, args: ["-e", "0"], cwd: packageRoot, mode: "pipe" })).warnings.length === 0);

  // A real Python, if there is one: the actual symptom was output arriving as one lump at exit.
  const py = spawnSync("python", ["-c", "print(1)"], { encoding: "utf8" });
  if (py.status === 0 && py.stdout.trim() === "1") {
    const code = "import time\nprint('first', flush=False)\ntime.sleep(0.5)\nprint('second \\u2713 h\\u00e9llo')\n";
    const real = await recordTerminal({ command: "python", args: ["-c", code], cwd: packageRoot, mode: "pipe" });
    const outs = real.cast.events.filter((e) => e[1] === "o");
    check("Python output is not collapsed into one event: 'first' arrives well before 'second'", outs.length >= 2 && outs[0][2].includes("first") && outs[outs.length - 1][0] - outs[0][0] >= 300);
    check("non-ASCII output survives (UTF-8, no UnicodeEncodeError)", outs.some((e) => e[2].includes("\u2713") && e[2].includes("h\u00e9llo")) && real.cast.exitCode === 0);

    // Negative control, so the check above is known to be able to fail: with buffering forced
    // back on (an empty PYTHONUNBUFFERED counts as unset), the same program's output collapses
    // into the one lump at exit that #66 described.
    const savedUnbuffered = process.env.PYTHONUNBUFFERED;
    process.env.PYTHONUNBUFFERED = "";
    const lumped = await recordTerminal({ command: "python", args: ["-c", code], cwd: packageRoot, mode: "pipe" });
    if (savedUnbuffered === undefined) delete process.env.PYTHONUNBUFFERED;
    else process.env.PYTHONUNBUFFERED = savedUnbuffered;
    const lumpedOuts = lumped.cast.events.filter((e) => e[1] === "o");
    check("control: with buffering forced on, the output arrives as one event, as in #66", lumpedOuts.length === 1 && lumpedOuts[0][2].includes("first") && lumpedOuts[0][2].includes("second"));
  } else {
    skip("real Python recording", "no working python on PATH");
  }
}

finish();

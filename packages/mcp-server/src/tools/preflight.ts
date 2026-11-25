import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { chromium, resolvedPlaywrightVersion } from "@openvidstudio/capture";
import { resolveProjectRoot, spawnCapture } from "../util";
import { loadConfig } from "../config";
import { omnivoiceCommands, probeEdgeTts, type NarrationEngine } from "./generateNarration";
import { PREFLIGHT_BENCHMARK_COMPOSITION_ID } from "./stitchComposition";
import { runTool } from "./mcp";

/**
 * The pipeline assumes its environment. Without this, a missing ffmpeg or an
 * undownloaded Chromium surfaces several steps in, as a symptom rather than a fix,
 * often after a long render has already started.
 *
 * Every failing check states the fix, with the command for the caller's platform.
 */

export interface PreflightInput {
  projectRoot?: string;
  /** Overrides the app url in openvidstudio.config.json. */
  appUrl?: string;
  /**
   * Also render ~60 frames of a fixed benchmark composition (seeded by init_project,
   * see stitchComposition.ts's PREFLIGHT_BENCHMARK_VIDEO_NAME) and report real frames/sec
   * plus CPU count. Off by default: a routine "are my deps installed" preflight call
   * should stay fast, this costs a real ~10-20s render. plan_production turns it on when
   * it actually needs a measured fps to base a time estimate on.
   */
  benchmark?: boolean;
  /**
   * The narration engine to check for, overriding narration.engine in openvidstudio.config.json. It is the
   * same switch generate_narration takes, so a caller can ask "could I narrate with omnivoice here?" without
   * editing the config first.
   */
  engine?: NarrationEngine;
}

export interface BenchmarkResult {
  ok: boolean;
  /** Frames actually timed (the composition's own first N frames, N = framesRequested unless the composition is shorter). */
  framesTimed: number;
  secondsElapsed: number;
  fps: number;
  cpuCount: number;
  /**
   * Wall seconds the benchmark command took beyond the render itself: bundling the project's
   * entry point and starting the browser. plan_production counts one of these per review round.
   */
  bundleSeconds?: number;
  /** Present only when ok is false: why no measurement came back. */
  error?: string;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Present when the check failed: what to actually run. */
  fix?: string;
  /** A failure that stops the pipeline, versus one that only limits it. */
  blocking: boolean;
}

export interface PreflightResult {
  ok: boolean;
  platform: string;
  checks: Check[];
  blockers: string[];
  /** Present only when input.benchmark was true. */
  benchmarkResult?: BenchmarkResult;
}

function which(cmd: string): string | null {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").split(/\r?\n/)[0]?.trim() || null;
}

function platformFix(win: string, mac: string, linux: string): string {
  if (process.platform === "win32") return win;
  if (process.platform === "darwin") return mac;
  return linux;
}

const BENCHMARK_FRAMES = 60;

/** Pure argv builder, unit-testable without spawning a real process. */
export function buildBenchmarkArgs(
  projectRoot: string,
  opts: { frames?: number; browserExecutable?: string } = {},
): string[] {
  const frames = opts.frames ?? BENCHMARK_FRAMES;
  const args = [
    "remotion",
    "benchmark",
    path.join(projectRoot, "src", "index.ts"),
    PREFLIGHT_BENCHMARK_COMPOSITION_ID,
    `--frames=0-${frames - 1}`,
    "--width=1920",
    "--height=1080",
    "--runs=1",
  ];
  if (opts.browserExecutable) args.push(`--browser-executable=${opts.browserExecutable}`);
  return args;
}

/**
 * Strips ANSI colour codes (the CLI has no machine-readable output mode) and reads the
 * "Time (mean ± σ): X.XXXXXs" summary line `remotion benchmark` always prints at the end
 * of a run.
 */
export function parseBenchmarkSeconds(stdout: string): number | null {
  // eslint-disable-next-line no-control-regex
  const plain = stdout.replace(/\x1b\[[0-9;]*m/g, "");
  const m = /Time \(mean[^)]*\):\s+([\d.]+)s/.exec(plain);
  return m ? Number.parseFloat(m[1]) : null;
}

async function runBenchmark(projectRoot: string, browserExecutable?: string): Promise<BenchmarkResult> {
  const cpuCount = os.cpus().length;
  if (!fs.existsSync(path.join(projectRoot, "src", "index.ts"))) {
    return { ok: false, framesTimed: 0, secondsElapsed: 0, fps: 0, cpuCount, error: "src/index.ts not found -- run init_project first" };
  }
  const startedAt = Date.now();
  const result = await spawnCapture(
    process.platform === "win32" ? "npx.cmd" : "npx",
    buildBenchmarkArgs(projectRoot, { browserExecutable }),
    projectRoot,
  );
  const wallSeconds = (Date.now() - startedAt) / 1000;
  const seconds = parseBenchmarkSeconds(result.stdout) ?? parseBenchmarkSeconds(result.stderr);
  if (seconds === null || seconds <= 0) {
    return {
      ok: false,
      framesTimed: 0,
      secondsElapsed: 0,
      fps: 0,
      cpuCount,
      error: `could not parse a benchmark time from remotion's output: ${(result.stderr || result.stdout).slice(-1000)}`,
    };
  }
  return {
    ok: true,
    framesTimed: BENCHMARK_FRAMES,
    secondsElapsed: seconds,
    fps: Number((BENCHMARK_FRAMES / seconds).toFixed(2)),
    cpuCount,
    bundleSeconds: Number(Math.max(0, wallSeconds - seconds).toFixed(1)),
  };
}

/**
 * What to run when OmniVoice is missing. The Python floor is pyproject.toml's requires-python (omnivoice also
 * needs torch 2.4 or newer). The upstream README has no CPU section: its pinned torch==2.8.0 line is the Apple
 * Silicon option and its +cu128 line with the extra index is the NVIDIA one. The CPU run measured for NARRATION.md
 * used unpinned torch (2.13.0+cpu) on Python 3.14.2, so the plain install leads and the pinned lines are labelled.
 * The model is fetched from Hugging Face on first use.
 */
export const OMNIVOICE_INSTALL_FIX =
  "Needs Python 3.10 or newer. In a fresh virtual environment run: pip install torch torchaudio " +
  "(add --index-url https://download.pytorch.org/whl/cpu for the CPU-only build; the CPU run measured for these docs " +
  "used torch 2.13.0+cpu on Python 3.14.2), then pip install omnivoice. " +
  "Upstream's pinned options: on Apple Silicon, pip install torch==2.8.0 torchaudio==2.8.0; with an NVIDIA GPU, " +
  "pip install torch==2.8.0+cu128 torchaudio==2.8.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128. " +
  "Put the environment's Scripts directory (Windows) or bin directory (macOS, Linux) on PATH so omnivoice-infer resolves. " +
  "The first run downloads the k2-fsa/OmniVoice model (about 3 GB); later runs may still check Hugging Face for a " +
  "newer version unless HF_HUB_OFFLINE=1 is set.";

/**
 * generate_narration takes its engine from its own input and never reads narration.engine, so a check that
 * passed because of the config alone would let the text go to the default engine's service while the user
 * believes it stays on the machine.
 */
const OMNIVOICE_CONFIG_ONLY_WARNING =
  ' Note: narration.engine is "omnivoice" in openvidstudio.config.json, but generate_narration does not read the ' +
  'config. Call it with engine: "omnivoice", or it uses edge-tts and sends the text to Microsoft.';

export interface OmnivoiceProbe {
  ok: boolean;
  detail: string;
}

/**
 * Looks for OmniVoice the way synthesis will run it (omnivoice-infer first, then python and python3 with the
 * module entrypoint, see omnivoiceCommands). It does not run the model: importing torch takes seconds, and the
 * launcher existing is what separates "installed" from "not installed". The python import only happens when the
 * launcher is not on PATH.
 */
export function probeOmnivoice(): OmnivoiceProbe {
  const [launcher, ...fallbacks] = omnivoiceCommands([]);
  const found = which(launcher.command);
  if (found) return { ok: true, detail: `${launcher.command} found at ${found}` };
  const reachable: string[] = [];
  for (const fallback of fallbacks) {
    const r = spawnSync(fallback.command, ["-c", "import omnivoice"], { encoding: "utf8", timeout: 120000 });
    if (r.error) continue;
    reachable.push(fallback.command);
    if (r.status === 0) {
      return {
        ok: true,
        detail: `${launcher.command} is not on PATH, but ${fallback.command} can import omnivoice (narration runs ${fallback.command} -m omnivoice.cli.infer)`,
      };
    }
  }
  return {
    ok: false,
    detail:
      reachable.length > 0
        ? `${launcher.command} is not on PATH and ${reachable.join(" and ")} cannot import omnivoice`
        : `${launcher.command} is not on PATH and there is no python or python3 to import omnivoice from`,
  };
}

async function urlResponds(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow" });
    clearTimeout(t);
    return res.ok || (res.status >= 200 && res.status < 500);
  } catch {
    return false;
  }
}

/** The oldest Node major openvidstudio supports. It matches the packages' `engines` field and what CI runs. */
export const MIN_NODE_MAJOR = 20;

/** Whether a `process.versions.node` string is new enough, and what to tell the user if not. */
export function checkNodeVersion(version: string): { ok: boolean; fix?: string } {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (major >= MIN_NODE_MAJOR) return { ok: true };
  return { ok: false, fix: `Install Node ${MIN_NODE_MAJOR} or newer from nodejs.org.` };
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const config = loadConfig(projectRoot);
  const appUrl = input.appUrl ?? config.capture.appUrl;
  const checks: Check[] = [];

  const nodeVersion = checkNodeVersion(process.versions.node);
  checks.push({
    name: "node",
    ok: nodeVersion.ok,
    detail: `node ${process.versions.node}`,
    fix: nodeVersion.fix,
    blocking: true,
  });

  const ffmpeg = which("ffmpeg");
  checks.push({
    name: "ffmpeg",
    ok: Boolean(ffmpeg),
    detail: ffmpeg ? `found at ${ffmpeg}` : "not on PATH",
    fix: ffmpeg
      ? undefined
      : platformFix(
          "winget install --id Gyan.FFmpeg -e",
          "brew install ffmpeg",
          "sudo apt update && sudo apt install -y ffmpeg",
        ),
    blocking: true,
  });

  // Playwright keeps its browsers in a per-user cache; the surest check is asking it.
  // On Windows, npx is a .cmd shim, and Node refuses to spawn a batch file with shell:false
  // (EINVAL), which reported Playwright as missing even when it was installed. The command is a
  // fixed string with no user input, so routing it through cmd.exe is safe.
  const pw =
    process.platform === "win32"
      ? spawnSync("npx playwright --version", { cwd: projectRoot, encoding: "utf8", shell: true })
      : spawnSync("npx", ["playwright", "--version"], { cwd: projectRoot, encoding: "utf8" });
  const pwOk = pw.status === 0;
  checks.push({
    name: "playwright",
    ok: pwOk,
    detail: pwOk ? (pw.stdout ?? "").trim() : "playwright not resolvable in this project",
    fix: pwOk ? undefined : "npm install playwright && npx playwright install chromium",
    blocking: true,
  });

  // Resolved the same way real capture actually launches it (@openvidstudio/capture's
  // browser.ts, the module captureScreenshot.ts/captureScreenRecording.ts both call into),
  // not a second, separately guessed lookup. Guessing fixed OS cache dirs (the old approach)
  // reported "no chromium" whenever browsers lived under PLAYWRIGHT_BROWSERS_PATH instead, and
  // could report OK on a *different* chromium build than the one this exact resolution wants
  // (a version mismatch: the server's playwright expects one build, the machine has an older
  // one already downloaded from a previous playwright version). executablePath() embeds the
  // exact expected build revision in the path it returns (e.g. ".../chromium-1243/..."), so
  // fs.existsSync() on it catches both cases the old check missed.
  let chromiumPath: string | null = null;
  let chromiumResolveError: string | null = null;
  try {
    chromiumPath = chromium.executablePath();
  } catch (err) {
    chromiumResolveError = err instanceof Error ? err.message : String(err);
  }
  const playwrightVersion = (() => {
    try {
      return resolvedPlaywrightVersion();
    } catch {
      return "unknown";
    }
  })();
  const chromiumOk = chromiumPath !== null && fs.existsSync(chromiumPath);
  checks.push({
    name: "chromium",
    ok: chromiumOk,
    detail: chromiumOk
      ? `resolved build present at ${chromiumPath} (playwright ${playwrightVersion})`
      : chromiumPath
        ? `playwright ${playwrightVersion} expects a build at ${chromiumPath}, which does not exist` +
          (process.env.PLAYWRIGHT_BROWSERS_PATH
            ? ` (PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH})`
            : "")
        : `could not resolve Chromium's executable path (playwright ${playwrightVersion}): ${chromiumResolveError}`,
    fix: chromiumOk ? undefined : "npx playwright install chromium",
    blocking: true,
  });

  // render.browserExecutable (openvidstudio.config.json) is what render_video actually
  // passes to Remotion's --browser-executable when set, instead of letting Remotion manage
  // its own chrome-headless-shell download -- check that exact path too, separately from
  // the chromium check above, since a project can have real Playwright Chromium (the
  // "chromium" check passes) while still pointing render.browserExecutable at something
  // stale or never configured for this machine.
  if (config.render.browserExecutable) {
    const configuredOk = fs.existsSync(config.render.browserExecutable);
    checks.push({
      name: "render.browserExecutable",
      ok: configuredOk,
      detail: configuredOk
        ? `${config.render.browserExecutable} exists; render_video will pass --browser-executable to reuse it`
        : `openvidstudio.config.json sets render.browserExecutable to ${config.render.browserExecutable}, which does not exist`,
      fix: configuredOk
        ? undefined
        : chromiumOk
          ? `Point render.browserExecutable at the resolved build instead: ${chromiumPath}`
          : "Fix the \"chromium\" check above first, then point render.browserExecutable at its resolved path.",
      blocking: true,
    });
  }

  let benchmarkResult: BenchmarkResult | undefined;
  if (input.benchmark) {
    benchmarkResult = await runBenchmark(projectRoot, config.render.browserExecutable);
  }

  const responds = await urlResponds(appUrl);
  checks.push({
    name: "app",
    ok: responds,
    detail: responds ? `${appUrl} responds` : `${appUrl} did not respond`,
    fix: responds
      ? undefined
      : `Start the app you want to film, then set capture.appUrl in openvidstudio.config.json if the port differs.`,
    blocking: true,
  });

  let writable = false;
  try {
    const probe = path.join(projectRoot, ".openvidstudio-write-probe");
    fs.writeFileSync(probe, "");
    fs.rmSync(probe);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({
    name: "writable",
    ok: writable,
    detail: writable ? `${projectRoot} is writable` : `cannot write to ${projectRoot}`,
    fix: writable ? undefined : "Check permissions on the project directory.",
    blocking: true,
  });

  // The engine input wins over the config file, the same way generate_narration's own engine input does.
  const engine = input.engine ?? config.narration.engine;

  // OmniVoice's launcher is omnivoice-infer, not a binary named after the engine, and a bare python on PATH
  // proves nothing about it, so it is probed on its own terms (see probeOmnivoice).
  const omnivoice = engine === "omnivoice" ? probeOmnivoice() : null;
  const narration = omnivoice ? omnivoice.ok : Boolean(which(engine)) || Boolean(which("python"));
  checks.push({
    name: "narration",
    ok: narration,
    detail: narration ? `${engine} available` : `${engine} not found`,
    fix: narration ? undefined : omnivoice ? "See the omnivoice check." : "pip install edge-tts",
    blocking: false,
  });

  if (omnivoice) {
    checks.push({
      name: "omnivoice",
      ok: omnivoice.ok,
      detail: input.engine === undefined ? `${omnivoice.detail}.${OMNIVOICE_CONFIG_ONLY_WARNING}` : omnivoice.detail,
      fix: omnivoice.ok ? undefined : OMNIVOICE_INSTALL_FIX,
      blocking: false,
    });
  }

  // Having edge-tts installed does not mean it can synthesize: Microsoft's service refuses some client
  // versions with a 403, and the first symptom is a narration run that fails on every beat. So speak one
  // word. Skipped for any other engine, and when the command is missing (the narration check above says so).
  if (engine === "edge-tts" && narration) {
    const probe = probeEdgeTts();
    checks.push({
      name: "edge-tts",
      ok: probe.ok,
      detail: probe.ok
        ? `edge-tts ${probe.version ?? "(version unknown)"} synthesized a test word`
        : `edge-tts ${probe.version ?? "(version unknown)"} could not synthesize: ${probe.error}`,
      fix: probe.ok ? undefined : "pip install -U edge-tts (Microsoft refuses some older versions with a 403; 7.3 or newer works)",
      blocking: false,
    });
  }

  // compose_score needs a real python with its DSP stack importable, not just a python on
  // PATH, so this checks the same import line the tool itself depends on rather than
  // guessing from the interpreter's presence alone. Same python-then-python3 fallback order
  // composeScore.ts uses internally. Non-blocking: a video with no original score still
  // renders, same reasoning as the narration check above.
  const composeScorePython = which("python") ? "python" : which("python3") ? "python3" : null;
  const composeScoreDeps = composeScorePython
    ? spawnSync(composeScorePython, ["-c", "import numpy, scipy, soundfile, pyloudnorm, matplotlib"], { encoding: "utf8" })
    : null;
  const composeScoreOk = composeScorePython !== null && composeScoreDeps?.status === 0;
  checks.push({
    name: "compose-score-deps",
    ok: composeScoreOk,
    detail: composeScoreOk
      ? `${composeScorePython} has numpy, scipy, soundfile, pyloudnorm and matplotlib importable`
      : composeScorePython
        ? `${composeScorePython} is missing one or more of numpy/scipy/soundfile/pyloudnorm/matplotlib`
        : "no python or python3 on PATH",
    fix: composeScoreOk
      ? undefined
      : `${composeScorePython ?? "python"} -m pip install numpy scipy soundfile pyloudnorm matplotlib`,
    blocking: false,
  });

  const blockers = checks.filter((c) => !c.ok && c.blocking).map((c) => `${c.name}: ${c.fix ?? c.detail}`);
  return {
    ok: blockers.length === 0,
    platform: process.platform,
    checks,
    blockers,
    ...(benchmarkResult ? { benchmarkResult } : {}),
  };
}

export function registerPreflight(server: McpServer): void {
  server.registerTool(
    "preflight",
    {
      title: "Check the machine can actually run the pipeline",
      description:
        "Verifies node, ffmpeg, Playwright and its Chromium build, that the app you want to film is " +
        "responding, that the project directory is writable, and that a narration engine is available. " +
        "If openvidstudio.config.json sets render.browserExecutable, also checks that exact path exists, " +
        "separately from the chromium check (render_video passes it to Remotion as --browser-executable " +
        "so a render reuses that browser instead of downloading its own, which fails with no network). " +
        "Every failure names the fix with the command for this platform, rather than describing a symptom. " +
        "Run it before init_project on a new machine: without it a missing dependency surfaces several " +
        "steps later, often after a long render has already started. When the narration engine is edge-tts, it " +
        "also speaks one short word to a temp file (the edge-tts check), because Microsoft refuses some client " +
        "versions with a 403 and the command existing proves nothing; a failure shows the installed version, " +
        "the error line and pip install -U edge-tts. Pass engine: \"omnivoice\" to check for the local OmniVoice " +
        "engine instead: it looks for omnivoice-infer on PATH, then for a python that can import omnivoice, and " +
        "adds an omnivoice check whose fix is the install command and the Python requirement (the first run " +
        "downloads the model). Without the input, narration.engine in the config picks the engine for these " +
        "checks, but generate_narration does not read that setting: it must be called with engine: \"omnivoice\" " +
        "too, or it uses edge-tts and sends the text to Microsoft. Narration is reported as non blocking, " +
        "since a silent video still renders. Pass benchmark: true to also render ~60 frames of a fixed " +
        "benchmark composition (init_project seeds it, so this works even before any real video is planned) " +
        "and report real frames/sec plus CPU count in benchmarkResult -- off by default since it costs a " +
        "real 10-20s render; plan_production turns it on when it needs a measured fps to base a time " +
        "estimate on rather than guessing one.",
      inputSchema: {
        projectRoot: z.string().optional(),
        appUrl: z.string().optional(),
        benchmark: z.boolean().optional(),
        engine: z.enum(["edge-tts", "say", "espeak", "omnivoice"]).optional(),
      },
    },
    async (input) => runTool("preflight", () => runPreflight(input)),
  );
}

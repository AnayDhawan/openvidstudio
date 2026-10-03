import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { chromium, resolvedPlaywrightVersion } from "@openvidstudio/capture";
import { resolveProjectRoot } from "../util";
import { loadConfig } from "../config";
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

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const config = loadConfig(projectRoot);
  const appUrl = input.appUrl ?? config.capture.appUrl;
  const checks: Check[] = [];

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    name: "node",
    ok: nodeMajor >= 18,
    detail: `node ${process.versions.node}`,
    fix: nodeMajor >= 18 ? undefined : "Install Node 18 or newer from nodejs.org.",
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

  const narrationCmd = config.narration.engine === "edge-tts" ? "edge-tts" : config.narration.engine;
  const narration = Boolean(which(narrationCmd)) || Boolean(which("python"));
  checks.push({
    name: "narration",
    ok: narration,
    detail: narration ? `${config.narration.engine} available` : `${config.narration.engine} not found`,
    fix: narration ? undefined : "pip install edge-tts",
    blocking: false,
  });

  const blockers = checks.filter((c) => !c.ok && c.blocking).map((c) => `${c.name}: ${c.fix ?? c.detail}`);
  return { ok: blockers.length === 0, platform: process.platform, checks, blockers };
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
        "steps later, often after a long render has already started. Narration is reported as non blocking, " +
        "since a silent video still renders.",
      inputSchema: {
        projectRoot: z.string().optional(),
        appUrl: z.string().optional(),
      },
    },
    async (input) => runTool("preflight", () => runPreflight(input)),
  );
}

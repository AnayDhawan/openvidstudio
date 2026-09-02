import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  const pw = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["playwright", "--version"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const pwOk = pw.status === 0;
  checks.push({
    name: "playwright",
    ok: pwOk,
    detail: pwOk ? (pw.stdout ?? "").trim() : "playwright not resolvable in this project",
    fix: pwOk ? undefined : "npm install playwright && npx playwright install chromium",
    blocking: true,
  });

  const cacheDirs = [
    path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright"),
    path.join(process.env.HOME ?? "", ".cache", "ms-playwright"),
    path.join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  const chromium = cacheDirs.some(
    (d) => fs.existsSync(d) && fs.readdirSync(d).some((e) => e.startsWith("chromium")),
  );
  checks.push({
    name: "chromium",
    ok: chromium,
    detail: chromium ? "browser binaries present" : "no chromium build in the Playwright cache",
    fix: chromium ? undefined : "npx playwright install chromium",
    blocking: true,
  });

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

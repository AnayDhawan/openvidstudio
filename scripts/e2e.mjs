#!/usr/bin/env node
/**
 * End-to-end pipeline check against a real app: reference/acme-tasks, v1.1 served on
 * :4173 and v1.0 on :4174 (reference/acme-tasks/v1.0-to-v1.1.diff is the change between
 * them; v1.0 is a copy with that diff reverse-applied). Drives the actual compiled MCP
 * server over stdio, the transport a real agent uses, rather than calling package
 * internals directly, so a regression in tool registration, schema or the transport
 * itself shows up here too.
 *
 * This is a growing harness, not a finished one: Phase A's bug fixes and Phase B-E's
 * production-mode/director-mode work each add their own step here rather than a
 * one-off script, so "does the pipeline still actually work end to end" stays answerable
 * with one command as the tool surface grows. `covered` in the final table is honest
 * about what this file does not yet drive -- see the TODO list at the bottom.
 *
 * Prereqs (not started by this script):
 *   - packages/mcp-server built: pnpm --filter @openvidstudio/mcp-server build
 *   - reference/ unzipped from ovs-launch-reference.zip into the repo root (gitignored)
 *   - acme-tasks v1.1 served on :4173 and v1.0 on :4174:
 *       cd reference/acme-tasks && npm i && npx vite build && npx vite preview --port 4173 --strictPort
 *       (copy the tree, `patch -p1 -R < v1.0-to-v1.1.diff`, build, serve --port 4174 --strictPort)
 *
 * Usage: node scripts/e2e.mjs [--project <dir>] [--keep]
 *   --project   reuse an existing scaffolded project instead of a fresh temp one
 *   --keep      don't delete the temp project directory on exit
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distStdio = path.join(root, "packages", "mcp-server", "dist", "stdio.js");
const sdkClientDir = path.join(
  root, "packages", "mcp-server", "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client",
);

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const projectFlagIdx = args.indexOf("--project");
const explicitProject = projectFlagIdx >= 0 ? args[projectFlagIdx + 1] : null;

const V11_URL = "http://localhost:4173";
const V10_URL = "http://localhost:4174";

function fail(msg) {
  console.error(`e2e.mjs: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(distStdio)) {
  fail(`${distStdio} not found. Run: pnpm --filter @openvidstudio/mcp-server build`);
}
if (!fs.existsSync(sdkClientDir)) {
  fail(`MCP SDK not found under packages/mcp-server/node_modules. Run: pnpm install`);
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

if (!(await checkUrl(V11_URL))) {
  fail(`${V11_URL} (acme-tasks v1.1) is not responding. See this file's header for how to serve it.`);
}
if (!(await checkUrl(V10_URL))) {
  fail(`${V10_URL} (acme-tasks v1.0) is not responding. See this file's header for how to serve it.`);
}

const { Client } = await import(pathToFileURL(path.join(sdkClientDir, "index.js")).href);
const { StdioClientTransport } = await import(pathToFileURL(path.join(sdkClientDir, "stdio.js")).href);

const transport = new StdioClientTransport({ command: "node", args: [distStdio], env: { ...process.env } });
const client = new Client({ name: "ovs-e2e", version: "1.0.0" });
await client.connect(transport);

// A tool call that returns 200-shaped JSON with success/valid/ok: false is a failure just
// as much as a thrown MCP error is -- checking this generically here is what stops "the
// call didn't throw" from being mistaken for "the step passed" (exactly the gap that let
// render_video's real npm failure read as a PASS on the first run of this file).
const FAILURE_FLAGS = ["success", "valid", "ok"];
async function call(tool, args) {
  const r = await client.callTool(
    { name: tool, arguments: args },
    undefined,
    { timeout: 1800000, resetTimeoutOnProgress: true, maxTotalTimeout: 1800000 },
  );
  const text = r.content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
  if (r.isError) throw new Error(text);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed && typeof parsed === "object") {
    for (const flag of FAILURE_FLAGS) {
      if (parsed[flag] === false) {
        const detail = parsed.errors ?? parsed.stderr ?? parsed.findings ?? parsed;
        throw new Error(`${tool} reported ${flag}: false -- ${JSON.stringify(detail).slice(0, 500)}`);
      }
    }
  }
  return parsed;
}

const projectRoot = explicitProject ?? fs.mkdtempSync(path.join(os.tmpdir(), "ovs-e2e-"));
if (!explicitProject) fs.mkdirSync(projectRoot, { recursive: true });

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  PASS ${name} (${Date.now() - started}ms)`);
    return value;
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(err?.message ?? err) });
    console.log(`  FAIL ${name}: ${String(err?.message ?? err).slice(0, 300)}`);
    throw err;
  }
}

const videoName = "e2e";
let ok = true;
try {
  await step("init_project", () => call("init_project", { name: videoName, projectRoot, appUrl: V11_URL }));
  await step("npm install (scaffolded project)", () => {
    // Windows can't CreateProcess a .cmd shim directly (EINVAL); shell:true routes it
    // through cmd.exe, same as @openvidstudio/capture's spawnCapture does for npx.cmd.
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], {
      cwd: projectRoot,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  });
  await step("preflight", () => call("preflight", { projectRoot }));
  await step("extract_brand", () =>
    call("extract_brand", { projectRoot, sourceRepo: path.join(root, "reference", "acme-tasks") }),
  );

  const beatsJson = {
    fps: 30,
    title: "Acme Tasks",
    beats: [
      {
        // 10 words / 4.0s = 2.5 words/s, inside SCRIPT.md's 2.3-2.9 budget.
        id: "hook",
        start: 0,
        duration: 120,
        vo: "Acme Tasks is a one-click board for a small team.",
        visual: { captureMethod: "dom-demo" },
      },
      {
        // 9 words / 3.5s ~= 2.57 words/s.
        id: "board",
        start: 120,
        duration: 105,
        vo: "New tasks land on the board in one click.",
        visual: { captureMethod: "screenshot", url: V11_URL, interactions: [] },
      },
      {
        // 6 words / 2.5s = 2.4 words/s.
        id: "insights",
        start: 225,
        duration: 75,
        vo: "Insights tracks the team's shipping streak.",
        visual: { captureMethod: "screenshot", url: `${V11_URL}/insights`, interactions: [] },
      },
    ],
  };
  await step("write_beats_file", () => call("write_beats_file", { projectRoot, videoName, beatsJson }));
  await step("validate_beats", () => call("validate_beats", { projectRoot, videoName, beatsJson }));

  await step("capture_screenshot (board)", () =>
    call("capture_screenshot", { projectRoot, beatId: "board", url: V11_URL }),
  );
  await step("capture_screenshot (insights)", () =>
    call("capture_screenshot", { projectRoot, beatId: "insights", url: `${V11_URL}/insights` }),
  );

  await step("scaffold_scene (hook, dom-demo)", () =>
    call("scaffold_scene", { projectRoot, videoName, beatId: "hook", kind: "dom-demo" }),
  );
  await step("scaffold_scene (board, real-screenshot)", () =>
    call("scaffold_scene", { projectRoot, videoName, beatId: "board", kind: "real-screenshot" }),
  );
  await step("scaffold_scene (insights, real-screenshot)", () =>
    call("scaffold_scene", { projectRoot, videoName, beatId: "insights", kind: "real-screenshot" }),
  );
  await step("validate_scenes", () => call("validate_scenes", { projectRoot, videoName }));

  await step("stitch_composition", () => call("stitch_composition", { projectRoot, videoName }));
  await step("render_video (incremental, draft)", () =>
    call("render_video", { projectRoot, videoName, draft: true, incremental: true, skipBrandLock: true }),
  );
  await step("qc_extract_frames", () => call("qc_extract_frames", { projectRoot, videoName }));
  await step("contact_sheet", () => call("contact_sheet", { projectRoot, videoName }));
  await step("export_rendition (gif)", () => call("export_rendition", { projectRoot, videoName, format: "gif" }));
  await step("visual_regression", () => call("visual_regression", { projectRoot, videoName }));
  await step("docs_drift", () => call("docs_drift", { projectRoot, videoName }));
  await step("diff_beats", () => call("diff_beats", { projectRoot, videoName, beatsJson }));
} catch {
  ok = false;
} finally {
  await client.close();
  if (!explicitProject && !keep) fs.rmSync(projectRoot, { recursive: true, force: true });
}

console.log("\n== e2e.mjs summary ==");
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.ms}ms)`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} steps passed.`);

// Registered tools this file does not yet drive -- extend here as each gets covered,
// rather than treating silence as coverage.
const notYetCovered = [
  "plan_beats", "plan_shots", "plan_sound_effects", "plan_music_cues",
  "find_music_bed", "import_music_bed", "generate_narration",
  "capture_screen_recording", "capture_desktop", "capture_mobile", "capture_terminal",
  "qc_capture", "reformat_vertical", "release_diff",
  "catalog_motion_primitives", "add_motion_primitive",
];
console.log(`\n${notYetCovered.length} registered tools not yet covered by this file:`);
for (const t of notYetCovered) console.log(`  - ${t}`);
if (!explicitProject) console.log(keep ? `\nproject kept at: ${projectRoot}` : "");

process.exitCode = ok ? 0 : 1;

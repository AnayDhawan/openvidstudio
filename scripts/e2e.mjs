#!/usr/bin/env node
/**
 * End-to-end pipeline check against a real app: evals/acme-tasks, v1.1 served on
 * :4173 and v1.0 on :4174 (evals/acme-tasks/v1.0-to-v1.1.diff is the change between
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
 *   - acme-tasks v1.1 served on :4173 and v1.0 on :4174 (a copy outside this repo is fine and
 *     keeps node_modules out of it):
 *       cd evals/acme-tasks && npm i && npx vite build && npx vite preview --port 4173 --strictPort
 *   - for the compose_score step, Python with numpy, scipy, soundfile, pyloudnorm and matplotlib;
 *     without them that one step is reported as skipped, never as passed
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
async function skipStep(name, reason) {
  results.push({ name, ok: true, skipped: true, ms: 0 });
  console.log(`  SKIP ${name}: ${reason}`);
}
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
  await step("plan_production (mid, 30 min, 12 s)", async () => {
    const plan = await call("plan_production", { projectRoot, creativeLevel: "mid", timeBudgetMinutes: 30, targetDurationSeconds: 12 });
    if (typeof plan !== "object" || plan === null || !("fitsBudget" in plan)) throw new Error("plan_production returned no fitsBudget");
    return plan;
  });
  await step("extract_brand", () =>
    call("extract_brand", { projectRoot, sourceRepo: path.join(root, "evals", "acme-tasks") }),
  );
  await step("plan_beats (snapToBars at 96 bpm)", async () => {
    const plan = await call("plan_beats", { projectRoot, targetDurationSeconds: 12, features: ["board", "insights"], snapToBars: { bpm: 96 } });
    const barFrames = (60 / 96) * 4 * 30;
    if (!plan.snappedToBars || !plan.beats.every((b) => b.start === Math.round(b.startBar * barFrames))) {
      throw new Error("plan_beats did not land every beat on a downbeat");
    }
    return plan;
  });

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
  await step("write_brief", () =>
    call("write_brief", {
      projectRoot,
      videoName,
      briefMarkdown: "# Brief\n\nA short launch of a calm task board. The product is the story: one click to capture, one page to see what shipped.",
      briefJson: {
        creativeLevel: "mid",
        logline: "A task board that makes the end of the week feel calm.",
        audience: "Small teams that ship weekly.",
        feeling: "Relief at the end of a long week.",
        storyDevice: { device: "a ticking clock", reason: "the product is about the weekly rhythm." },
        arc: { hook: "A busy board.", tension: "Work piles up.", turn: "One click captures a task.", proof: "The real board and the real Insights page.", payoff: "The streak says it landed.", cta: "Try the board." },
        designSystem: { path: `src/videos/${videoName}/design.ts`, paletteRationale: "extract_brand found the orange and teal pair.", motif: "rounded-soft", motifRationale: "the product's cards are rounded.", motionRationale: "slow drift" },
        music: { bpm: 96, key: "D major", sectionMap: [{ label: "intro", startBar: 1, endBar: 3 }, { label: "peak", startBar: 3, endBar: 6 }], impactPoints: [{ name: "turn", bar: 3, note: "the click" }] },
        shotList: [
          { beatId: "hook", real: false, provenance: "a constructed title card", whyConstructed: "a title card is not product UI", focalPoint: "the product name" },
          { beatId: "board", real: true, provenance: "capture_screenshot of the board", focalPoint: "the new task button" },
          { beatId: "insights", real: true, provenance: "capture_screenshot of Insights", focalPoint: "the streak card" },
        ],
      },
    }),
  );
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

  const pyOk = (() => {
    try {
      execFileSync("python", ["-c", "import numpy, scipy, soundfile, pyloudnorm, matplotlib"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();
  if (pyOk) {
    await step("compose_score (mode music)", async () => {
      const score = await call("compose_score", { projectRoot, videoName, mode: "music" });
      if (!score.cues || score.cues.source !== "generated") throw new Error("compose_score wrote no generated cues");
      return score;
    });
  } else {
    await skipStep("compose_score (mode music)", "Python with numpy, scipy, soundfile, pyloudnorm and matplotlib is not available");
  }
  await step("stitch_composition", () => call("stitch_composition", { projectRoot, videoName }));
  await step("render_stills (review round, contact grid, findings)", async () => {
    const r = await call("render_stills", { projectRoot, videoName, perBeat: "review", round: 1 });
    if (!r.contactGrid || !fs.existsSync(r.contactGrid.path)) throw new Error("render_stills wrote no contact grid");
    if (!Array.isArray(r.findings)) throw new Error("render_stills returned no numeric findings");
    return r;
  });
  await step("render_video (incremental, draft)", () =>
    call("render_video", { projectRoot, videoName, draft: true, incremental: true, skipBrandLock: true }),
  );
  await step("collect_facts", async () => {
    const r = await call("collect_facts", { projectRoot, videoName });
    if (!fs.existsSync(r.factsPath)) throw new Error("collect_facts wrote no facts.json");
    return r;
  });
  await step("finalize_video (loudness, poster, share, description)", async () => {
    const r = await call("finalize_video", { projectRoot, videoName, inPath: path.join("output", `${videoName}.mp4`) });
    if (!r.description?.written || !fs.existsSync(r.description.path)) throw new Error("finalize_video wrote no description");
    return r;
  });
  await step("qc_extract_frames", () => call("qc_extract_frames", { projectRoot, videoName }));
  await step("contact_sheet", () => call("contact_sheet", { projectRoot, videoName }));
  await step("export_rendition (gif)", () => call("export_rendition", { projectRoot, videoName, format: "gif" }));
  await step("visual_regression", () => call("visual_regression", { projectRoot, videoName }));
  await step("docs_drift", () => call("docs_drift", { projectRoot, videoName }));
  await step("diff_beats", () => call("diff_beats", { projectRoot, videoName, newBeatsJson: beatsJson }));
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
  "plan_shots", "plan_sound_effects", "plan_music_cues",
  "find_music_bed", "import_music_bed", "generate_narration",
  "capture_screen_recording", "capture_desktop", "capture_mobile", "capture_terminal",
  "qc_capture", "reformat_vertical", "release_diff",
  "catalog_motion_primitives", "add_motion_primitive",
];
console.log(`\n${notYetCovered.length} registered tools not yet covered by this file:`);
for (const t of notYetCovered) console.log(`  - ${t}`);
if (!explicitProject) console.log(keep ? `\nproject kept at: ${projectRoot}` : "");

process.exitCode = ok ? 0 : 1;

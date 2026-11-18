#!/usr/bin/env node
/**
 * CI check for A2: a freshly scaffolded project renders real content with no network
 * access, exercising every core component that used to call @remotion/google-fonts at
 * module scope (TerminalReplay, RepoCta, ChecklistPanel -- every scene imports the core
 * index, so any one of them reaching fonts.gstatic.com crashed every render offline).
 *
 * Network is "blocked" by pointing HTTP(S)_PROXY at an address nothing listens on, with
 * NODE_USE_ENV_PROXY=1 so Node's own fetch honors it, and NO_PROXY carving out localhost
 * (the scaffolded project's own dev/static-asset traffic, unrelated to the font fix this
 * checks). This is also how packages/mcp-server's render_video spawns its child process:
 * env is inherited, so the proxy applies to the real `remotion render` subprocess too.
 *
 * Remotion's own browser download (chrome-headless-shell, separate from the Playwright
 * chromium CI already installs) needs one real-network render first to cache; openvidstudio
 * doesn't yet have a way to point Remotion at an already-installed browser instead (that's
 * tracked separately), so this script warms that cache before the network-blocked render
 * that's the actual point of the check.
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

function fail(msg) {
  console.error(`offline-render-check: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(distStdio)) fail(`${distStdio} not found. Run: pnpm --filter @openvidstudio/mcp-server build`);

const { Client } = await import(pathToFileURL(path.join(sdkClientDir, "index.js")).href);
const { StdioClientTransport } = await import(pathToFileURL(path.join(sdkClientDir, "stdio.js")).href);

async function callOnce(tool, args, env) {
  const transport = new StdioClientTransport({ command: "node", args: [distStdio], env: { ...process.env, ...env } });
  const client = new Client({ name: "ovs-offline-check", version: "1.0.0" });
  await client.connect(transport);
  try {
    const r = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 1800000, maxTotalTimeout: 1800000 });
    const text = r.content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
    if (r.isError) throw new Error(text);
    return JSON.parse(text);
  } finally {
    await client.close();
  }
}

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-offline-check-"));
const videoName = "fontcheck";

const init = await callOnce("init_project", { name: videoName, projectRoot }, {});
if (!init?.projectRoot) fail("init_project did not return a projectRoot");

execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const beatsJson = {
  fps: 30,
  title: "Font Check",
  beats: [
    { id: "term", start: 0, duration: 90, vo: "A terminal session runs right here on screen.", visual: { captureMethod: "dom-demo" } },
    { id: "cta", start: 90, duration: 105, vo: "Open source, free to use, star the repo today.", visual: { captureMethod: "dom-demo" } },
    { id: "check", start: 195, duration: 90, vo: "Every step in the checklist completes in order.", visual: { captureMethod: "dom-demo" } },
  ],
};
const written = await callOnce("write_beats_file", { projectRoot, videoName, beatsJson }, {});
if (written?.written !== true) fail(`write_beats_file did not write: ${JSON.stringify(written)}`);

for (const [beatId, template] of [["term", "terminal"], ["cta", "cta"], ["check", "checklist"]]) {
  const r = await callOnce("scaffold_scene", { projectRoot, videoName, beatId, kind: "dom-demo", template }, {});
  if (r?.written !== true) fail(`scaffold_scene(${beatId}) did not write: ${JSON.stringify(r)}`);
}

const stitched = await callOnce("stitch_composition", { projectRoot, videoName }, {});
if (stitched?.written !== true) fail(`stitch_composition did not write: ${JSON.stringify(stitched)}`);

// Warm-up render (real network): caches Remotion's own browser download so the
// network-blocked render below fails only on what this check actually cares about.
console.log("warm-up render (network allowed, caches Remotion's browser download)...");
const warm = await callOnce("render_video", { projectRoot, videoName, draft: true, skipBrandLock: true }, {});
if (warm?.success !== true) fail(`warm-up render failed: ${warm?.stderr?.slice(-2000)}`);

const blockedEnv = {
  NODE_USE_ENV_PROXY: "1",
  HTTPS_PROXY: "http://127.0.0.1:9",
  HTTP_PROXY: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  NO_PROXY: "localhost,127.0.0.1",
  no_proxy: "localhost,127.0.0.1",
};
console.log("network-blocked render (the actual check)...");
fs.rmSync(path.join(projectRoot, "output", `${videoName}.mp4`), { force: true });
const blocked = await callOnce("render_video", { projectRoot, videoName, draft: true, skipBrandLock: true }, blockedEnv);
if (blocked?.success !== true) {
  fail(`network-blocked render failed (A2 regression?):\n${blocked?.stderr?.slice(-4000)}`);
}

const outPath = path.join(projectRoot, "output", `${videoName}.mp4`);
if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
  fail(`render reported success but ${outPath} is missing or empty`);
}

console.log(`PASS: offline render of TerminalReplay/RepoCta/ChecklistPanel succeeded (${fs.statSync(outPath).size} bytes).`);

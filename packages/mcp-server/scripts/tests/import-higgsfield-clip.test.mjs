#!/usr/bin/env node
// import-higgsfield-clip: Part 7 (split out of the former single manual-test.mjs; see _harness.mjs)

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

// ---- fixtures (quiet): state this file's checks expect from earlier in the old single script ----
setQuiet(true);
// fixture: PATHS
const { TEMPLATE_DIR } = require(path.join(distDir, "paths.js"));
setQuiet(false);
// ---- checks ----

console.log("\n== Part 7: import_higgsfield_clip -- gating + ingest logic (no Higgsfield call, no network) ==");

const { createMcpServer } = require(path.join(distDir, "server.js"));

// Gating: registerTools must add import_higgsfield_clip in exactly one of these two cases.
// Reaching into McpServer's own _registeredTools map is the compiled SDK's actual runtime
// state (no public "list currently registered tool names" accessor exists on McpServer
// itself), which is fine for this verification script the same way this file already
// reaches into other packages' compiled internals (e.g. TEMPLATE_DIR) elsewhere above.
function registeredToolNames(server) {
  return Object.keys(server._registeredTools ?? {});
}

const serverWithoutHiggsfield = createMcpServer({
  hasHiggsfield: false,
  targetDurationSeconds: 60,
  videoConfig: { fps: 30, width: 1920, height: 1080 },
});
check(
  "import_higgsfield_clip absent when hasHiggsfield: false",
  !registeredToolNames(serverWithoutHiggsfield).includes("import_higgsfield_clip"),
);

const serverWithoutConfigAtAll = createMcpServer();
check(
  "import_higgsfield_clip absent when no config is passed at all (matches stdio.ts's un-initialized-project default)",
  !registeredToolNames(serverWithoutConfigAtAll).includes("import_higgsfield_clip"),
);

const serverWithHiggsfield = createMcpServer({
  hasHiggsfield: true,
  targetDurationSeconds: 60,
  videoConfig: { fps: 30, width: 1920, height: 1080 },
});
check(
  "import_higgsfield_clip present when hasHiggsfield: true",
  registeredToolNames(serverWithHiggsfield).includes("import_higgsfield_clip"),
);
check(
  "every other tool is still registered regardless of the gate (spot-check init_project + capture_screen_recording)",
  ["init_project", "capture_screen_recording"].every((name) =>
    registeredToolNames(serverWithHiggsfield).includes(name) && registeredToolNames(serverWithoutHiggsfield).includes(name),
  ),
);

// Ingest logic: no Higgsfield MCP call exists in this design at all (see HIGGSFIELD.md /
// task-5-report.md), so there is no credit-spend concern to guard against here the way
// there was for capture_screen_recording's real-browser E2E section above. Both branches
// (local path, URL) are exercised against fakes only.
const { runImportHiggsfieldClip } = require(path.join(distDir, "tools", "importHiggsfieldClip.js"));
const higgsfieldTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-higgsfield-test-"));

{
  // "path" branch: a fake local file standing in for whatever the calling agent's own
  // Higgsfield generate_video/jobs_wait call produced on disk.
  const fakeSourcePath = path.join(higgsfieldTmpRoot, "fake-source.bin");
  const fakeBytes = Buffer.from("fake mp4 bytes from a fake local higgsfield result");
  fs.writeFileSync(fakeSourcePath, fakeBytes);

  const result = await runImportHiggsfieldClip({
    projectRoot: higgsfieldTmpRoot,
    beatId: "outro",
    source: { type: "path", path: fakeSourcePath },
  });
  check(
    "path branch: outPath matches the public/video/<beatId>.mp4 convention",
    result.outPath === path.join(higgsfieldTmpRoot, "public", "video", "outro.mp4") && result.beatId === "outro",
  );
  check(
    "path branch: bytes at outPath match the fake source exactly",
    fs.existsSync(result.outPath) && Buffer.compare(fs.readFileSync(result.outPath), fakeBytes) === 0,
  );

  let missingPathThrew = null;
  try {
    await runImportHiggsfieldClip({
      projectRoot: higgsfieldTmpRoot,
      beatId: "missing",
      source: { type: "path", path: path.join(higgsfieldTmpRoot, "does-not-exist.bin") },
    });
  } catch (err) {
    missingPathThrew = err;
  }
  check(
    "path branch: a missing local file is a structured failure (does not exist), not a silent no-op",
    missingPathThrew !== null && /does not exist/.test(missingPathThrew.message),
  );
}

{
  // "url" branch: a fake fetch (matching this project's existing fake-Playwright-page
  // pattern, a controlled fake rather than a real network call) standing in for whatever
  // URL the calling agent's Higgsfield result pointed at.
  const fakeUrlBytes = Buffer.from("fake mp4 bytes from a fake url higgsfield result");
  const fakeFetchOk = async (url) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async arrayBuffer() {
      return fakeUrlBytes.buffer.slice(fakeUrlBytes.byteOffset, fakeUrlBytes.byteOffset + fakeUrlBytes.byteLength);
    },
  });

  const result = await runImportHiggsfieldClip(
    { projectRoot: higgsfieldTmpRoot, beatId: "hook", source: { type: "url", url: "https://example.invalid/clip.mp4" } },
    { fetchImpl: fakeFetchOk },
  );
  check(
    "url branch: outPath matches the public/video/<beatId>.mp4 convention",
    result.outPath === path.join(higgsfieldTmpRoot, "public", "video", "hook.mp4"),
  );
  check(
    "url branch: bytes at outPath match the fake fetch response exactly",
    fs.existsSync(result.outPath) && Buffer.compare(fs.readFileSync(result.outPath), fakeUrlBytes) === 0,
  );

  const fakeFetch404 = async () => ({ ok: false, status: 404, statusText: "Not Found" });
  let badUrlThrew = null;
  try {
    await runImportHiggsfieldClip(
      { projectRoot: higgsfieldTmpRoot, beatId: "bad", source: { type: "url", url: "https://example.invalid/missing.mp4" } },
      { fetchImpl: fakeFetch404 },
    );
  } catch (err) {
    badUrlThrew = err;
  }
  check(
    "url branch: a non-ok response is a structured failure carrying the status code, not a silent no-op",
    badUrlThrew !== null && /404/.test(badUrlThrew.message),
  );

  const fakeFetchNetworkError = async () => {
    throw new Error("simulated DNS failure");
  };
  let networkErrorThrew = null;
  try {
    await runImportHiggsfieldClip(
      { projectRoot: higgsfieldTmpRoot, beatId: "bad2", source: { type: "url", url: "https://example.invalid/unreachable.mp4" } },
      { fetchImpl: fakeFetchNetworkError },
    );
  } catch (err) {
    networkErrorThrew = err;
  }
  check(
    "url branch: a fetch-level network error is a structured failure, not an uncaught throw escaping this test",
    networkErrorThrew !== null && /simulated DNS failure/.test(networkErrorThrew.message),
  );
}

const importHiggsfieldClipSrc = fs.readFileSync(path.join(packageRoot, "src", "tools", "importHiggsfieldClip.ts"), "utf8");
check(
  "importHiggsfieldClip.ts never imports/requires a Higgsfield SDK or client package (only fetch + node:fs)",
  !/(from\s*["'][^"']*higgsfield[^"']*["']|require\(\s*["'][^"']*higgsfield[^"']*["']\s*\))/i.test(importHiggsfieldClipSrc),
);

finish();

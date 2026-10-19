#!/usr/bin/env node
// edge-tts-preflight: preflight checks that edge-tts can synthesize, and a refusal is reported with its cause (#140).
//
// Microsoft refuses some edge-tts client versions with a 403 from speech.platform.bing.com. The tool used to
// say only "no usable audio after 3 attempts", and preflight found a working install because the command existed.
// These tests put a fake edge-tts (and a fake python, so the real module is never reached) first on PATH that
// fails the way the service does, and run the real tools against it in a child process.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { distDir, check, skip, finish } from "./_harness.mjs";

if (process.platform === "win32") {
  skip("edge-tts 403 handling", "the fake edge-tts is a shell script");
  finish();
  process.exit(process.exitCode ?? 0);
}

const ERROR_LINE = "aiohttp.client_exceptions.WSServerHandshakeError: 403, message='Invalid response status'";
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-fake-edge-"));
function fake(name, body) {
  const file = path.join(fakeBin, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}
// edge-tts: reports a version, refuses every synthesis the way the service did.
fake("edge-tts", `if [ "$1" = "--version" ]; then echo "edge-tts 7.2.8"; exit 0; fi\necho "Traceback (most recent call last):" >&2\necho "${ERROR_LINE}" >&2\nexit 1`);
// python and python3: nothing importable, and the module entrypoint fails the same way.
for (const py of ["python", "python3"]) fake(py, `if [ "$1" = "-c" ]; then exit 1; fi\necho "${ERROR_LINE}" >&2\nexit 1`);

const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
function inChild(code) {
  const r = spawnSync(process.execPath, ["-e", code], { env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
const projectCode = (name) => `
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { runInitProject } = require(${JSON.stringify(path.join(distDir, "tools", "initProject.js"))});
const root = fs.mkdtempSync(path.join(os.tmpdir(), ${JSON.stringify(name)}));
runInitProject({ name: "lesson", projectRoot: root });
`;

console.log("\n== preflight: edge-tts has to synthesize, not just exist ==");
{
  const r = inChild(`${projectCode("ovs-edge-pf-")}
const { runPreflight } = require(${JSON.stringify(path.join(distDir, "tools", "preflight.js"))});
runPreflight({ projectRoot: root }).then((res) => console.log(JSON.stringify(res.checks.filter((c) => c.name === "edge-tts"))));
`);
  check("preflight reports one edge-tts check", r.length === 1);
  check("the check fails when the service refuses the connection", r[0]?.ok === false);
  check("it shows the installed version", /7\.2\.8/.test(r[0]?.detail ?? ""));
  check("it shows the error line", (r[0]?.detail ?? "").includes("403, message='Invalid response status'"));
  check("it suggests pip install -U edge-tts", /pip install -U edge-tts/.test(r[0]?.fix ?? ""));
  check("a failing edge-tts is not a blocking check", r[0]?.blocking === false);
}

console.log("\n== preflight: skipped when the narration engine is not edge-tts ==");
{
  const r = inChild(`${projectCode("ovs-edge-pf-say-")}
const cfg = path.join(root, "openvidstudio.config.json");
const json = JSON.parse(fs.readFileSync(cfg, "utf8"));
json.narration = { ...json.narration, engine: "say" };
fs.writeFileSync(cfg, JSON.stringify(json));
const { runPreflight } = require(${JSON.stringify(path.join(distDir, "tools", "preflight.js"))});
runPreflight({ projectRoot: root }).then((res) => console.log(JSON.stringify(res.checks.filter((c) => c.name === "edge-tts"))));
`);
  check("no edge-tts check runs for another engine", r.length === 0);
}

console.log("\n== generate_narration: the warning carries edge-tts's own error ==");
{
  const r = inChild(`${projectCode("ovs-edge-gn-")}
fs.writeFileSync(path.join(root, "src", "videos", "lesson", "beats.json"), JSON.stringify({ fps: 30, beats: [
  { id: "one", start: 0, duration: 150, vo: "A slope is how steep a line is.", visual: { captureMethod: "dom-demo" } },
] }));
const { runGenerateNarration } = require(${JSON.stringify(path.join(distDir, "tools", "generateNarration.js"))});
const res = runGenerateNarration({ projectRoot: root, videoName: "lesson", engine: "edge-tts" });
console.log(JSON.stringify({ written: res.written.length, warnings: res.warnings }));
`);
  check("nothing was written", r.written === 0);
  const warning = r.warnings.find((w) => w.startsWith("one:")) ?? "";
  check("the warning still says no usable audio", /no usable audio after 3 attempts/.test(warning));
  check("the warning includes the last stderr line", warning.includes("403, message='Invalid response status'"));
  check("the warning points at preflight and the upgrade", /preflight/.test(warning) && /pip install -U edge-tts/.test(warning));
}

fs.rmSync(fakeBin, { recursive: true, force: true });
finish();

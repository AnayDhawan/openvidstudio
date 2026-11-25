#!/usr/bin/env node
// omnivoice-preflight: preflight knows about the local OmniVoice narration engine (#180).
//
// generate_narration has taken engine "omnivoice" for a while, but preflight only knew edge-tts: it looked for a
// binary called "omnivoice" (the real one is omnivoice-infer), so a machine with OmniVoice installed was
// reported as missing it and a machine without it was reported fine. These tests put a fake omnivoice-infer
// first on PATH (a .cmd on Windows, a shell script elsewhere) and run the real preflight against it in a child
// process, so nothing here needs Python, a model, ffmpeg or the network.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { require, distDir, check, skip, finish } from "./_harness.mjs";

const { loadConfig, writeConfig } = require(path.join(distDir, "config.js"));
const { omnivoiceCommands, omnivoiceArgs, omnivoiceWavPath, claimOmnivoiceWav } = require(path.join(distDir, "tools", "generateNarration.js"));

const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-fake-omni-"));
if (process.platform === "win32") {
  fs.writeFileSync(path.join(fakeBin, "omnivoice-infer.cmd"), "@echo off\r\nexit /b 0\r\n");
} else {
  fs.writeFileSync(path.join(fakeBin, "omnivoice-infer"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

function onPath(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [cmd], { encoding: "utf8" }).status === 0;
}
function pythonImportsOmnivoice() {
  for (const py of ["python", "python3"]) {
    const r = spawnSync(py, ["-c", "import omnivoice"], { encoding: "utf8", timeout: 120000 });
    if (r.status === 0) return true;
  }
  return false;
}

// One child process per PATH. Each scenario scaffolds its own project, optionally sets narration.engine in the
// config file, and passes an optional engine input to runPreflight. Prints [{ name, checks, blockers }] per scenario.
function preflightChild(env, scenarios) {
  const code = `
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { runInitProject } = require(${JSON.stringify(path.join(distDir, "tools", "initProject.js"))});
const { runPreflight } = require(${JSON.stringify(path.join(distDir, "tools", "preflight.js"))});
(async () => {
  const out = [];
  for (const s of ${JSON.stringify(scenarios)}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-omni-pf-"));
    runInitProject({ name: "lesson", projectRoot: root });
    if (s.configEngine) {
      const cfg = path.join(root, "openvidstudio.config.json");
      const json = JSON.parse(fs.readFileSync(cfg, "utf8"));
      json.narration = { ...json.narration, engine: s.configEngine };
      fs.writeFileSync(cfg, JSON.stringify(json));
    }
    const input = { projectRoot: root };
    if (s.engine) input.engine = s.engine;
    const res = await runPreflight(input);
    out.push({ name: s.name, checks: res.checks, blockers: res.blockers });
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(JSON.stringify(out));
})();
`;
  const r = spawnSync(process.execPath, ["-e", code], { env, encoding: "utf8", timeout: 240000 });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr || r.stdout}`);
  return Object.fromEntries(JSON.parse(r.stdout.trim().split("\n").pop()).map((s) => [s.name, s]));
}
const byName = (scenario, name) => scenario.checks.find((c) => c.name === name);

console.log("\n== preflight: engine omnivoice finds omnivoice-infer on PATH ==");
{
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const s = preflightChild(env, [
    { name: "input", engine: "omnivoice" },
    { name: "config", configEngine: "omnivoice" },
    { name: "input-over-config", configEngine: "omnivoice", engine: "edge-tts" },
    { name: "default" },
  ]);
  const omni = byName(s.input, "omnivoice");
  check("an omnivoice check is added when the engine input is omnivoice", omni !== undefined);
  check("it passes when omnivoice-infer is on PATH", omni?.ok === true);
  check("a missing OmniVoice is never blocking", omni?.blocking === false);
  check("the detail says omnivoice-infer was found", /omnivoice-infer/.test(omni?.detail ?? ""));
  const narration = byName(s.input, "narration");
  check("the narration check looks for omnivoice-infer, not a binary called omnivoice, and passes", narration?.ok === true && /omnivoice/.test(narration?.detail ?? ""));
  check("the narration check passes with no edge-tts fix text", narration?.fix === undefined);
  check("config narration.engine omnivoice adds the check with no engine input", byName(s.config, "omnivoice")?.ok === true);
  // generate_narration never reads narration.engine, so a green check from the config alone would let the text
  // go to Microsoft's service while the user believes it stays local.
  const fromConfig = byName(s.config, "omnivoice")?.detail ?? "";
  check("an engine that came from the config says generate_narration does not read it", /generate_narration does not read/.test(fromConfig) && fromConfig.includes('engine: "omnivoice"'));
  check("and says what happens otherwise", /edge-tts/.test(fromConfig) && /Microsoft/.test(fromConfig));
  check("no such warning when the engine was passed as input", !/does not read/.test(omni?.detail ?? ""));
  check("the engine input overrides the config engine (edge-tts input, omnivoice config: no omnivoice check)", byName(s["input-over-config"], "omnivoice") === undefined);
  check("and the narration check then follows the input engine", /edge-tts/.test(byName(s["input-over-config"], "narration")?.detail ?? ""));
  check("no omnivoice check for the default engine, even with omnivoice-infer installed", byName(s.default, "omnivoice") === undefined);
  check("the default narration check still talks about edge-tts", /edge-tts/.test(byName(s.default, "narration")?.detail ?? ""));
}

console.log("\n== preflight: engine omnivoice with nothing installed ==");
if (onPath("omnivoice-infer") || pythonImportsOmnivoice()) {
  skip("missing OmniVoice reports ok: false", "this machine has OmniVoice on PATH or importable from python");
} else {
  const s = preflightChild({ ...process.env }, [{ name: "missing", engine: "omnivoice" }]).missing;
  const omni = byName(s, "omnivoice");
  check("the omnivoice check fails", omni?.ok === false);
  check("it does not block the pipeline", omni?.blocking === false);
  check("it is not listed as a blocker", !s.blockers.some((b) => b.startsWith("omnivoice")));
  check("the detail says what was looked for", /omnivoice-infer/.test(omni?.detail ?? "") && /python/.test(omni?.detail ?? ""));
  check("the fix has the install command", /pip install omnivoice/.test(omni?.fix ?? ""));
  check("the fix names the Python requirement", /3\.10/.test(omni?.fix ?? ""));
  check("the fix says the first run downloads the model", /first run/i.test(omni?.fix ?? "") && /download/i.test(omni?.fix ?? ""));
  // Upstream's pinned torch lines are its Apple Silicon (torch==2.8.0) and NVIDIA (+cu128) options, not a CPU route,
  // and the measured CPU machine runs torch 2.13.0 on Python 3.14, so the fix leads with the unpinned install.
  const fix = omni?.fix ?? "";
  check("the fix leads with an unpinned torch install", fix.includes("pip install torch torchaudio") && fix.indexOf("pip install torch torchaudio") < fix.indexOf("torch==2.8.0"));
  check("the fix gives the CPU-only index", fix.includes("https://download.pytorch.org/whl/cpu"));
  check("the pinned lines are labelled as upstream's Apple Silicon and NVIDIA options", /Apple Silicon/.test(fix) && /NVIDIA/.test(fix) && fix.includes("torch==2.8.0+cu128"));
  const narration = byName(s, "narration");
  check("the narration check fails too, and does not suggest edge-tts", narration?.ok === false && !/edge-tts/.test(`${narration?.detail} ${narration?.fix}`));
  check("the narration check is not blocking either", narration?.blocking === false);
}

console.log("\n== config accepts omnivoice ==");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-omni-cfg-"));
  fs.writeFileSync(path.join(root, "openvidstudio.config.json"), JSON.stringify({ narration: { engine: "omnivoice" } }));
  check("loadConfig keeps narration.engine omnivoice", loadConfig(root).narration.engine === "omnivoice");
  writeConfig(root, { narration: { engine: "omnivoice", voice: "k2-fsa/OmniVoice" } });
  check("writeConfig round-trips it", loadConfig(root).narration.engine === "omnivoice");
  check("the default engine is still edge-tts", loadConfig(fs.mkdtempSync(path.join(os.tmpdir(), "ovs-omni-cfg-empty-"))).narration.engine === "edge-tts");
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("\n== preflight and synthesis run OmniVoice the same way ==");
{
  const cmds = omnivoiceCommands(["--text", "hi"]);
  check("omnivoice-infer is tried first, then python, then python3", cmds.map((c) => c.command).join(" ") === "omnivoice-infer python python3");
  check("the python fallbacks run the module entrypoint", cmds.slice(1).every((c) => c.args.slice(0, 2).join(" ") === "-m omnivoice.cli.infer"));
  check("every candidate carries the caller's arguments last", cmds.every((c) => c.args.slice(-2).join(" ") === "--text hi"));
  const clip = path.join("work", "one.raw");
  const args = omnivoiceArgs({ voice: "k2-fsa/OmniVoice", text: "A slope.", out: clip });
  check("the CLI is given --model, --text and --output", args.slice(0, 5).join("|") === ["--model", "k2-fsa/OmniVoice", "--text", "A slope.", "--output"].join("|") && args.length === 6);
  // omnivoice-infer writes with soundfile, which picks the format from the extension and has no default for .raw,
  // while the narration pipeline keeps its working clips as <beatId>.raw (fit_beats reads them).
  check("the output path handed to the CLI is a .wav, not the .raw clip", args[5] === omnivoiceWavPath(clip) && args[5].endsWith(".wav") && args[5] !== clip);
  check("the .wav sits next to the clip it becomes", path.dirname(omnivoiceWavPath(clip)) === path.dirname(clip));
  const cloned = omnivoiceArgs({ voice: "m", text: "t", out: "o.raw", refAudio: "ref.wav", refText: "ref line", instruct: "male" });
  check("a reference clip, its text and an instruction are passed through", cloned.join("|").includes("--ref_audio|ref.wav|--ref_text|ref line|--instruct|male"));
}

console.log("\n== the .wav omnivoice-infer writes becomes the clip the pipeline reads ==");
{
  // Without this move every omnivoice beat is missing: the CLI writes <clip>.wav, and fit_beats and the ffmpeg fit
  // step read <clip> itself. No ffmpeg or Python needed, only files.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-omni-claim-"));
  const clip = path.join(dir, "one.raw");
  fs.writeFileSync(omnivoiceWavPath(clip), "RIFF-pretend-wav");
  check("it reports that it moved a .wav", claimOmnivoiceWav(clip) === true);
  check("the clip now has the wav's bytes", fs.existsSync(clip) && fs.readFileSync(clip, "utf8") === "RIFF-pretend-wav");
  check("no .wav is left beside it", !fs.existsSync(omnivoiceWavPath(clip)));
  const none = path.join(dir, "two.raw");
  check("with no .wav (the CLI failed) it moves nothing and says so", claimOmnivoiceWav(none) === false && !fs.existsSync(none));
  fs.rmSync(dir, { recursive: true, force: true });
}

fs.rmSync(fakeBin, { recursive: true, force: true });
finish();

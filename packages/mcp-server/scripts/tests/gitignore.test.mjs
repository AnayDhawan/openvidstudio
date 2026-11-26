#!/usr/bin/env node
// gitignore: build output and stray artefacts that must never be committed stay ignored.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { monorepoRoot, check, skip, finish } from "./_harness.mjs";

console.log("\n== .gitignore: Python wheels (#186) ==");

const git = spawnSync("git", ["--version"], { encoding: "utf8" });
if (git.status !== 0) {
  skip("git check-ignore on *.whl", "git is not available");
} else {
  const ignored = (rel) => spawnSync("git", ["check-ignore", "-q", rel], { cwd: monorepoRoot }).status === 0;

  check("a wheel at the repo root is ignored", ignored("openvidstudio-1.0.0-py3-none-any.whl"));
  check("a wheel in a nested directory is ignored", ignored("packages/mcp-server/py/vendor/numpy-2.0.0-cp312-cp312-win_amd64.whl"));
  // The check has to be able to fail: these are tracked on purpose.
  check("control: a Python source file is not ignored", !ignored("packages/mcp-server/py/compose-score.py"));
  check("control: the .gitignore itself is not ignored", !ignored(".gitignore"));

  const tracked = spawnSync("git", ["ls-files", "*.whl"], { cwd: monorepoRoot, encoding: "utf8" }).stdout.trim();
  check("no wheel file is tracked in the repository", tracked === "");

  // The entry has to take effect on a real working tree, not just match in the abstract.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-gitignore-"));
  spawnSync("git", ["init", "-q"], { cwd: tmp });
  fs.copyFileSync(path.join(monorepoRoot, ".gitignore"), path.join(tmp, ".gitignore"));
  fs.writeFileSync(path.join(tmp, "stray-1.0-py3-none-any.whl"), "x");
  fs.writeFileSync(path.join(tmp, "keep.py"), "x");
  const status = spawnSync("git", ["status", "--porcelain", "-uall"], { cwd: tmp, encoding: "utf8" }).stdout;
  check("git status in a tree with a stray wheel does not list it", !status.includes(".whl") && status.includes("keep.py"));
  fs.rmSync(tmp, { recursive: true, force: true });
}

finish();

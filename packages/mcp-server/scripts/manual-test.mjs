#!/usr/bin/env node
// Runs the per-tool test files in scripts/tests/ and prints one combined summary.
//
//   node scripts/manual-test.mjs                      every file, one process each
//   node scripts/manual-test.mjs stitch-composition   only the named files (suffix optional)
//   node scripts/tests/stitch-composition.test.mjs    one file directly
//
// Each file is a separate process, so one crash or failure no longer hides the rest, and each
// file builds its own throwaway fixtures, so any of them runs alone.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.join(here, "tests");
const all = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

const wanted = process.argv.slice(2).map((a) => a.replace(/\.test\.mjs$/, ""));
const unknown = wanted.filter((w) => !all.includes(`${w}.test.mjs`));
if (unknown.length > 0) {
  console.error(`No such test file: ${unknown.join(", ")}\nAvailable: ${all.map((f) => f.replace(/\.test\.mjs$/, "")).join(", ")}`);
  process.exit(2);
}
const files = wanted.length > 0 ? all.filter((f) => wanted.includes(f.replace(/\.test\.mjs$/, ""))) : all;

function runFile(file) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(process.execPath, [path.join(testsDir, file)], { cwd: path.join(here, ".."), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (c) => {
      out += c;
      process.stdout.write(c);
    });
    child.stderr.on("data", (c) => process.stderr.write(c));
    child.on("close", (code) => {
      const m = out.match(/^RESULT (PASSED|FAILED) passed=(\d+) failed=(\d+) skipped=(\d+)/m);
      resolve({
        file,
        code,
        crashed: !m,
        passed: m ? Number(m[2]) : 0,
        failed: m ? Number(m[3]) : 0,
        skipped: m ? Number(m[4]) : 0,
      });
    });
  });
}

const results = [];
for (const file of files) {
  console.log(`\n######## ${file.replace(/\.test\.mjs$/, "")} ########`);
  results.push(await runFile(file));
}

const total = results.reduce(
  (t, r) => ({ passed: t.passed + r.passed, failed: t.failed + r.failed, skipped: t.skipped + r.skipped }),
  { passed: 0, failed: 0, skipped: 0 },
);
const bad = results.filter((r) => r.failed > 0 || r.crashed || r.code !== 0);

console.log("\n==== summary ====");
for (const r of results) {
  const tag = r.crashed ? "CRASHED" : r.failed > 0 || r.code !== 0 ? "FAILED " : "ok     ";
  console.log(`  ${tag} ${r.file.replace(/\.test\.mjs$/, "").padEnd(24)} passed=${r.passed} failed=${r.failed} skipped=${r.skipped}`);
}
console.log(
  `\n${bad.length === 0 ? `ALL CHECKS PASSED (${total.passed} checks, ${total.skipped} skipped)` : `${total.failed} CHECK(S) FAILED in ${bad.length} file(s): ${bad.map((r) => r.file).join(", ")} (${total.skipped} skipped)`}`,
);
process.exitCode = bad.length === 0 ? 0 : 1;

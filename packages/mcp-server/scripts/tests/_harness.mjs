// Shared harness for the per-tool test files in this directory. Each *.test.mjs imports this,
// runs against the package's compiled dist/ (never src/), and ends by calling finish().
//
// Run one file:   node scripts/tests/stitch-composition.test.mjs
// Run everything: node scripts/manual-test.mjs   (or: pnpm test)

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
// Kept as scripts/ (not scripts/tests/) so path arithmetic written against the old single
// script, such as path.join(__dirname, ".."), still resolves to the package root.
export const __dirname = path.join(here, "..");
export const packageRoot = path.join(__dirname, "..");
export const distDir = path.join(packageRoot, "dist");
export const monorepoRoot = path.resolve(packageRoot, "..", "..");
export const monorepoTemplateDir = path.join(monorepoRoot, "templates", "default");

let failures = 0;
let skipped = 0;
let passed = 0;
let quiet = false;
const realLog = console.log;

export function check(label, cond) {
  if (quiet) return;
  if (cond) {
    console.log(`  ok   ${label}`);
    passed++;
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

// A skip is a distinct, explicitly-counted outcome, never silent: a block that doesn't run
// because a local dependency (Chromium, ffmpeg, ffprobe, a symlinked node_modules) is
// unavailable must still show up in the summary, so "PASSED" can't quietly mean "some of
// this didn't execute at all".
export function skip(label, reason) {
  if (quiet) return;
  console.log(`  SKIP ${label}${reason ? ` (${reason})` : ""}`);
  skipped++;
}

// Fixture code that builds state a test depends on (a scaffolded project, a browser probe)
// runs quietly: its own checks belong to the file that owns that tool, and counting them in
// every dependent file would inflate the totals.
export function setQuiet(value) {
  quiet = value;
  console.log = value ? () => {} : realLog;
}

export function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else {
      out.push(path.relative(base, full));
    }
  }
  return out.sort();
}

if (!fs.existsSync(distDir)) {
  console.error(`dist/ not found at ${distDir}. Run "pnpm run build" first.`);
  process.exit(1);
}

// The runner parses this exact line, so keep its shape stable.
export function finish() {
  if (quiet) setQuiet(false);
  console.log(`\nRESULT ${failures === 0 ? "PASSED" : "FAILED"} passed=${passed} failed=${failures} skipped=${skipped}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

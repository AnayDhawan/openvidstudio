#!/usr/bin/env node
// ci-timeouts: every workflow job sets timeout-minutes, with headroom over how long it really takes.
// Without one a hung job runs for GitHub's 6 hour default, and the slowest job here (the Windows
// offline render) is the likeliest to hang.

import * as fs from "node:fs";
import * as path from "node:path";
import { monorepoRoot, check, finish } from "./_harness.mjs";

console.log("\n== CI: every job has a timeout (#184) ==");

const dir = path.join(monorepoRoot, ".github", "workflows");

/** Jobs of one workflow file as { name: timeoutMinutes | null }. Reads the two indent levels the files use. */
export function readJobs(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job) {
      current = job[1];
      jobs[current] = null;
      continue;
    }
    const t = /^ {4}timeout-minutes:\s*(\S+)\s*$/.exec(line);
    if (t && current) jobs[current] = t[1];
  }
  return jobs;
}

// The slowest measured run of each job, in minutes (CI history, Windows for offline-render).
const MEASURED_MAX = { "offline-render": 15.7, test: 1.6, "plugin-validate": 0.2 };

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
check("there are workflow files to check", files.length > 0);

for (const file of files) {
  const jobs = readJobs(fs.readFileSync(path.join(dir, file), "utf8"));
  check(`${file} defines at least one job`, Object.keys(jobs).length > 0);
  for (const [name, raw] of Object.entries(jobs)) {
    const minutes = Number(raw);
    check(`${file}: job "${name}" sets timeout-minutes (${raw})`, raw !== null && Number.isFinite(minutes));
    check(`${file}: job "${name}" stays well under the 6 hour default (${raw})`, Number.isFinite(minutes) && minutes > 0 && minutes <= 60);
    if (file === "ci.yml" && MEASURED_MAX[name] !== undefined) {
      check(
        `ci.yml: "${name}" has headroom over its slowest measured run (${MEASURED_MAX[name]} min, limit ${raw})`,
        minutes >= MEASURED_MAX[name] * 1.5,
      );
    }
  }
}

// The reader has to be able to see a missing timeout, or the checks above prove nothing.
const without = readJobs("name: x\njobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    timeout-minutes: 5\n    runs-on: ubuntu-latest\n");
check("control: a job with no timeout reads as null", without.a === null && without.b === "5");

finish();

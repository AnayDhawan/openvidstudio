#!/usr/bin/env node
/**
 * Fails when the Remotion packages disagree with each other, or react with react-dom.
 *
 * Both families have a hard same-version requirement. Remotion says so in its own
 * startup warning; React enforces it at runtime, and the failure it produces is a
 * minified error code with no mention of versions, which cost a long debugging session
 * to trace back to a dependabot PR that bumped one half of a pair.
 *
 * Dependabot grouping (see .github/dependabot.yml) is the prevention. This is the net
 * underneath it, because a grouped config still cannot stop a hand-edited package.json.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MANIFESTS = [
  "package.json",
  "packages/core/package.json",
  "packages/mcp-server/package.json",
  "templates/default/package.json",
];

const FAMILIES = [
  { name: "remotion", match: (n) => n === "remotion" || n.startsWith("@remotion/") },
  { name: "react", match: (n) => n === "react" || n === "react-dom" },
];

const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies"];

/** A range rather than an exact pin cannot be compared, and is itself the bug for these families. */
const isExact = (v) => /^\d+\.\d+\.\d+$/.test(v);

let failed = false;

for (const family of FAMILIES) {
  /** @type {Map<string, string[]>} */
  const seen = new Map();

  for (const rel of MANIFESTS) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const block of DEP_BLOCKS) {
      for (const [name, version] of Object.entries(pkg[block] ?? {})) {
        if (!family.match(name)) continue;
        if (!isExact(version)) {
          console.error(`  ${rel} -> ${block}.${name} is "${version}"; pin these exactly, a range re-opens the drift.`);
          failed = true;
          continue;
        }
        if (!seen.has(version)) seen.set(version, []);
        seen.get(version).push(`${rel} ${name}`);
      }
    }
  }

  if (seen.size > 1) {
    failed = true;
    console.error(`\n  ${family.name} packages disagree across the workspace:`);
    for (const [version, where] of [...seen.entries()].sort()) {
      console.error(`    ${version}`);
      for (const w of where) console.error(`      ${w}`);
    }
  } else if (seen.size === 1) {
    console.log(`  ok   every ${family.name} package is on ${[...seen.keys()][0]}`);
  }
}

if (failed) {
  console.error(
    `\nAll Remotion packages must share one version, and react must match react-dom. ` +
      `A split tree fails at render with a minified React error that never mentions versions.`,
  );
  process.exit(1);
}
console.log("version alignment ok");

#!/usr/bin/env node
// Copies the monorepo's templates/default/ into this package's own templates/default/
// so a standalone npm install of @openvidstudio/mcp-server ships the project shell
// init_project needs, without depending on a monorepo-relative path that will not exist
// once this package is installed standalone in someone else's project. Run as part of
// `npm run build`. packages/mcp-server/templates/ is gitignored and always regenerated
// here rather than checked into git (see task-3-report.md for the reasoning), and it is
// listed in package.json's "files" array so it ships inside the published npm tarball.

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const monorepoRoot = join(packageRoot, "..", "..");
const src = join(monorepoRoot, "templates", "default");
const dest = join(packageRoot, "templates", "default");

if (!existsSync(src)) {
  process.stderr.write(`copy-template: source template not found at ${src}\n`);
  process.exit(1);
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue; // never ship the dev monorepo's installed deps
    const s = join(from, entry.name);
    const d = join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);
process.stderr.write(`copy-template: copied ${src} -> ${dest}\n`);

#!/usr/bin/env node
// Copies packages/docs/*.md into this package's own docs/ directory so a standalone
// install of @openvidstudio/mcp-server ships the pipeline docs a scaffolded project
// needs (see C2 in final-review-fix-report.md): packages/docs has no package.json and
// was never meant to be an installable npm package, so templates/default/CLAUDE.md no
// longer points at node_modules/@openvidstudio/docs/. Instead, init_project copies these
// bundled docs directly into each scaffolded project's own docs/ folder (see
// src/paths.ts's DOCS_DIR and src/tools/initProject.ts). Run as part of `npm run build`,
// alongside scripts/copy-template.mjs. packages/mcp-server/docs/ is gitignored and
// always regenerated here rather than checked into git, and is listed in package.json's
// "files" array so it ships inside the published npm tarball.

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const monorepoRoot = join(packageRoot, "..", "..");
const src = join(monorepoRoot, "packages", "docs");
const dest = join(packageRoot, "docs");

if (!existsSync(src)) {
  process.stderr.write(`copy-docs: source docs not found at ${src}\n`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

let copied = 0;
for (const entry of readdirSync(src, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".md")) {
    copyFileSync(join(src, entry.name), join(dest, entry.name));
    copied += 1;
  }
}

process.stderr.write(`copy-docs: copied ${copied} doc(s) from ${src} -> ${dest}\n`);

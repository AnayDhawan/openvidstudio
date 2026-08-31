#!/usr/bin/env node
// Copies the monorepo's templates/default/ into this package's own templates/default/
// so a standalone npm install of @openvidstudio/mcp-server ships the project shell
// init_project needs, without depending on a monorepo-relative path that will not exist
// once this package is installed standalone in someone else's project. Also vendors
// packages/core's source into the bundled template (see C1 below) so a scaffolded
// project's own npm/pnpm install actually resolves @openvidstudio/core. Run as part of
// `npm run build`, alongside scripts/copy-docs.mjs. packages/mcp-server/templates/ is
// gitignored and always regenerated here rather than checked into git (see
// task-3-report.md for the reasoning), and it is listed in package.json's "files" array
// so it ships inside the published npm tarball.

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from "node:fs";
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

// Bridge for C1 (final-review-fix-report.md): templates/default/package.json depends on
// "@openvidstudio/core": "workspace:*", which only resolves inside this monorepo's pnpm
// workspace. A project scaffolded by init_project needs something a plain
// `npm install`/`pnpm install` can actually resolve standalone -- publishing
// @openvidstudio/core to npm is a separate, not-yet-made decision. Bridge: vendor core's
// real source + package.json into the bundled template as ./openvidstudio-core, and
// rewrite the bundled package.json's dependency to a relative file: reference. Flip this
// back to a real semver dependency once @openvidstudio/core has an npm-publish decision;
// nothing else about this fix needs to change to do that.
const coreSrc = join(monorepoRoot, "packages", "core");
const vendoredCoreDest = join(dest, "openvidstudio-core");
if (existsSync(coreSrc)) {
  copyDir(join(coreSrc, "src"), join(vendoredCoreDest, "src"));
  const coreScriptsSrc = join(coreSrc, "scripts");
  if (existsSync(coreScriptsSrc)) {
    copyDir(coreScriptsSrc, join(vendoredCoreDest, "scripts"));
  }
  const corePkg = JSON.parse(readFileSync(join(coreSrc, "package.json"), "utf8"));
  writeFileSync(join(vendoredCoreDest, "package.json"), JSON.stringify(corePkg, null, 2) + "\n");
  process.stderr.write(`copy-template: vendored @openvidstudio/core -> ${vendoredCoreDest}\n`);
} else {
  process.stderr.write(`copy-template: packages/core not found at ${coreSrc}, skipping core vendoring\n`);
}

const templatePkgPath = join(dest, "package.json");
const templatePkg = JSON.parse(readFileSync(templatePkgPath, "utf8"));
if (templatePkg.dependencies && templatePkg.dependencies["@openvidstudio/core"]) {
  templatePkg.dependencies["@openvidstudio/core"] = "file:./openvidstudio-core";
  writeFileSync(templatePkgPath, JSON.stringify(templatePkg, null, 2) + "\n");
  process.stderr.write(
    `copy-template: rewrote bundled package.json's @openvidstudio/core dependency to file:./openvidstudio-core\n`,
  );
}

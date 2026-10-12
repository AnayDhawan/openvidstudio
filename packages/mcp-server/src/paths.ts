import * as path from "node:path";

/**
 * Bundled copy of templates/default, produced by scripts/copy-template.mjs at build
 * time and shipped inside the published npm package (see package.json's "files").
 *
 * This module compiles to dist/paths.js, so `__dirname` here is the package's own
 * dist/ directory at runtime -- "../templates/default" resolves to
 * <package root>/templates/default, never to the monorepo's own templates/default/
 * (that path does not exist once this package is installed standalone in someone
 * else's project). Deliberately kept in a top-level src/ module (not nested under
 * src/tools/) so this one-line relative-path computation stays easy to audit.
 */
export const TEMPLATE_DIR = path.join(__dirname, "..", "templates", "default");

/**
 * Bundled copy of packages/docs/*.md, produced by scripts/copy-docs.mjs at build time
 * and shipped inside the published npm package (see package.json's "files"). Same
 * __dirname-relative reasoning as TEMPLATE_DIR above: resolves to
 * <package root>/docs, never the monorepo's own packages/docs/. init_project copies
 * these into a scaffolded project's own docs/ folder (see tools/initProject.ts).
 */
export const DOCS_DIR = path.join(__dirname, "..", "docs");

/**
 * Bundled copy of packages/mcp-server/py/*.py, produced by this package's own build
 * step (the directory is listed in package.json's "files", no separate copy script
 * needed since it is already inside the package root) and shipped inside the
 * published npm package. Same __dirname-relative reasoning as TEMPLATE_DIR and
 * DOCS_DIR above: resolves to <package root>/py at runtime, whether this package is
 * installed standalone or run from inside this monorepo. compose_score
 * (tools/composeScore.ts) spawns packages/mcp-server/py/compose-score.py from here.
 */
export const PY_DIR = path.join(__dirname, "..", "py");

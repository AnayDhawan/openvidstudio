#!/usr/bin/env node
// Removes dist/ before a build. tsc only writes files, it never deletes the compiled output of a
// source file that no longer exists, so without this a removed tool keeps shipping in the npm tarball
// as dead code (the 2.0.0 package carried compiled check_script and canvas explainer files that way).

import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
rmSync(dist, { recursive: true, force: true });
process.stderr.write(`clean-dist: removed ${dist}\n`);

#!/usr/bin/env node
// find-music-bed: Part 43 (split out of the former single manual-test.mjs; see _harness.mjs)

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  require,
  __dirname,
  packageRoot,
  distDir,
  monorepoRoot,
  monorepoTemplateDir,
  check,
  skip,
  listFilesRecursive,
  setQuiet,
  finish,
} from "./_harness.mjs";

console.log("\n== Part 43: find_music_bed fetches only the requested catalog, degrades gracefully on \"any\" (A12) ==");
{
  const githubReachable = await fetch("https://api.github.com/", { signal: AbortSignal.timeout(5000) })
    .then((r) => r.status < 500)
    .catch(() => false);

  if (githubReachable) {
    const { runFindMusicBed } = require(path.join(distDir, "tools", "musicLibrary.js"));
    const musicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-a12-music-"));

    const lofiOnly = await runFindMusicBed({ projectRoot: musicRoot, source: "lofi", limit: 3 });
    check("source: \"lofi\" returns only lofi candidates", lofiOnly.candidates.every((c) => c.source === "lofi"));
    check("...and nothing from cc0 got fetched", lofiOnly.categories.cc0.length === 0);
    const indexAfterLofi = JSON.parse(fs.readFileSync(path.join(musicRoot, "output", "music-index.json"), "utf8"));
    check("the cache records only lofi as fetched", JSON.stringify(indexAfterLofi.sourcesFetched) === JSON.stringify(["lofi"]));

    // lofi is now cached; block all network and ask for "any" -- cc0 has to be fetched
    // fresh (not cached yet) and can't be, so this must degrade, not fail outright.
    const blockedEnv = { HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" };
    const savedProxy = { HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY };
    process.env.NODE_USE_ENV_PROXY = "1";
    Object.assign(process.env, blockedEnv);
    // Undici (Node's fetch) also caches its dispatcher/proxy agent at first use within a
    // process, same class of issue as playwright's path resolution in Part 41 -- so this
    // specific case runs in its own child process rather than relying on the env mutation
    // taking effect on an already-initialized fetch in this long-lived process.
    const probeScript = path.join(packageRoot, ".a12-probe-music.cjs");
    fs.writeFileSync(
      probeScript,
      `const { runFindMusicBed } = require(${JSON.stringify(path.join(distDir, "tools", "musicLibrary.js"))});
       runFindMusicBed({ projectRoot: ${JSON.stringify(musicRoot)}, source: "any", limit: 2 })
         .then((r) => console.log(JSON.stringify(r)))
         .catch((e) => { console.log(JSON.stringify({ threw: String(e.message || e) })); });`,
      "utf8",
    );
    try {
      const out = execFileSync("node", [probeScript], { env: { ...process.env }, encoding: "utf8" });
      const degraded = JSON.parse(out.trim().split("\n").pop());
      check(
        "source: \"any\" with cc0 unreachable still succeeds, using lofi's cache",
        !degraded.threw && Array.isArray(degraded.candidates) && degraded.candidates.length > 0,
      );
      check(
        "...and reports a warning naming cc0 specifically, not a generic failure",
        Array.isArray(degraded.warnings) && degraded.warnings.some((w) => w.includes("cc0") || w.includes("CC0-1.0-Music")),
      );
    } finally {
      fs.rmSync(probeScript, { force: true });
      for (const [k, v] of Object.entries(savedProxy)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  } else {
    skip("Part 43: find_music_bed source-gating and degradation (entire section)", "api.github.com is not reachable from this environment");
  }
}

finish();

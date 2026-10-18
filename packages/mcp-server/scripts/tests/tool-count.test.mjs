#!/usr/bin/env node
// Every tool-count claim in the docs matches what the server registers (#69, #70, #81, A12).
// The prose counts live between <!-- tools:... --> markers that scripts/generate-tool-docs.mjs
// rewrites; this test is the same check CI runs through that script, plus a pin on the markers
// themselves so deleting one cannot quietly turn the check off.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { require, distDir, monorepoRoot, check, finish } from "./_harness.mjs";

console.log("\n== README's and TOOLS.md's tool counts match what actually gets registered ==");
{
  const { createMcpServer } = require(path.join(distDir, "server.js"));
  const registry = (config) => createMcpServer(config)._registeredTools;
  const higgsfieldConfig = {
    hasHiggsfield: true,
    targetDurationSeconds: 60,
    videoConfig: { fps: 30, width: 1920, height: 1080 },
    capture: { appUrl: "http://localhost:3000", width: 1440, height: 900, settleMs: 1200 },
    narration: { engine: "edge-tts", voice: "en-US-AndrewNeural" },
  };
  const baseNames = Object.keys(registry(undefined));
  const allNames = Object.keys(registry(higgsfieldConfig));
  check("passing hasHiggsfield registers exactly one more tool", allNames.length === baseNames.length + 1);
  check("every registered tool has a title, which is what the tool table shows", Object.values(registry(higgsfieldConfig)).every((t) => typeof t.title === "string" && t.title.length > 0));

  const readme = fs.readFileSync(path.join(monorepoRoot, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const spans = [...readme.matchAll(/<!-- tools:([A-Za-z:]+) -->([\s\S]*?)<!-- \/tools -->/g)].map((m) => ({ kind: m[1], text: m[2] }));
  check("README keeps its tool-count markers (3 spots, 5 spans: the pitch, the quick start, the layout tree)", spans.length === 5 &&["base", "higgsfield", "Base", "base:digits", "higgsfield:digits"].every((k) => spans.some((s) => s.kind === k)));
  const digits = (k) => String((k.toLowerCase().startsWith("higgsfield") ? allNames : baseNames).length);
  const digitSpans = spans.filter((s) => s.kind.endsWith(":digits"));
  check(
    `README's digit counts are ${baseNames.length} and ${allNames.length}`,
    digitSpans.length === 2 && digitSpans.every((s) => s.text === digits(s.kind)),
  );
  // The words form is checked by the generator rather than re-implemented here: --check recomputes
  // every span and exits 1 if any differs.
  const gen = spawnSync(process.execPath, [path.join(monorepoRoot, "scripts", "generate-tool-docs.mjs"), "--check"], { encoding: "utf8" });
  check("generate-tool-docs --check agrees (this is the command CI runs)", gen.status === 0);

  const toolsMd = fs.readFileSync(path.join(monorepoRoot, "packages", "docs", "TOOLS.md"), "utf8");
  const listed = [...toolsMd.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort();
  check("TOOLS.md lists exactly the registered tools, none missing, none stale", JSON.stringify(listed) === JSON.stringify([...allNames].sort()));
  check("TOOLS.md states both counts", toolsMd.includes(`${baseNames.length} tools, ${allNames.length} with the Higgsfield tier enabled.`));

  // The check has to be able to fail: a README claiming the wrong number must be reported.
  const stale = spawnSync(process.execPath, ["-e", `
    const fs = require("fs"); const p = ${JSON.stringify(path.join(monorepoRoot, "README.md"))};
    const orig = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, orig.replace("<!-- tools:base:digits -->${baseNames.length}<!-- /tools -->", "<!-- tools:base:digits -->99<!-- /tools -->"));
    const r = require("child_process").spawnSync(process.execPath, [${JSON.stringify(path.join(monorepoRoot, "scripts", "generate-tool-docs.mjs"))}, "--check"], { encoding: "utf8" });
    fs.writeFileSync(p, orig);
    process.stdout.write(JSON.stringify({ status: r.status, err: r.stderr }));
  `], { encoding: "utf8" });
  const result = JSON.parse(stale.stdout);
  check("control: a README that claims 99 tools makes --check fail and name README.md", result.status === 1 && /STALE README\.md/.test(result.err));
  check("...and the README on disk was put back exactly", spawnSync(process.execPath, [path.join(monorepoRoot, "scripts", "generate-tool-docs.mjs"), "--check"], { encoding: "utf8" }).status === 0);
}

finish();

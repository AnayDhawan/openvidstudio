#!/usr/bin/env node
// release-diff: Part 27, Part 28 (split out of the former single manual-test.mjs; see _harness.mjs)

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

// ---- fixtures (quiet): state this file's checks expect from earlier in the old single script ----
setQuiet(true);
// fixture: CAP
const captureCore = require(path.join(packageRoot, "..", "capture", "dist", "browser.js"));
const { cropAndUpscale } = require(path.join(distDir, "tools", "captureScreenshot.js"));
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));
const { buildFfmpegTranscodeArgs, buildFfprobeDurationArgs } = require(path.join(distDir, "tools", "captureScreenRecording.js"));
// fixture: BROWSER
let browserAvailable = false;
try {
  const probeBrowser = await captureCore.launchChromium();
  await probeBrowser.close();
  browserAvailable = true;
} catch {}
setQuiet(false);
// ---- checks ----

console.log("\n== Part 27: release diff ==");

{
  const rel = require(path.join(distDir, "tools", "releaseDiff.js"));
  const { routeSlug, routesFromDiff, buildDraftManifest } = rel;

  check("a route becomes a usable beat id", routeSlug("/docs/getting-started") === "docs-getting-started");
  check("...and the root route is named rather than empty", routeSlug("/") === "home");

  const allRoutes = ["/", "/pricing", "/docs"];
  check(
    "a changed page names its own route",
    routesFromDiff(["src/app/pricing/page.tsx"], allRoutes).join(",") === "/pricing",
  );
  // A shared component has no route of its own and can repaint every page, so guessing at
  // an import graph would be less reliable than checking all of them and letting the visual
  // comparison narrow it down.
  check(
    "a shared component makes every route a candidate",
    routesFromDiff(["src/components/Button.tsx"], allRoutes).length === 3,
  );
  check(
    "a release that touches no source touches no routes",
    routesFromDiff(["README.md", "package-lock.json"], allRoutes).length === 0,
  );

  const draft = buildDraftManifest({
    videoName: "rel",
    beforeRef: "v1.0.0",
    afterRef: "v1.1.0",
    changes: [{ route: "/pricing", beforePath: "a.png", afterPath: "b.png" }],
    fps: 30,
    beatFrames: 90,
  });
  check("the draft pairs a before and an after per route", draft.beats.length === 2);
  check("...contiguously, the way validate_beats requires", draft.beats[0].start === 0 && draft.beats[1].start === 90);
  // The before frame cannot be re-captured from a live URL once the release is out, and
  // existing-asset is what that honestly is.
  check("...as existing-asset beats", draft.beats.every((b) => b.visual.captureMethod === "existing-asset"));
  check("...attributed to the ref each came from", draft.beats[0].visual.attribution.includes("v1.0.0") && draft.beats[1].visual.attribution.includes("v1.1.0"));
  // Writing narration is drafting content, which this server does not do: the approval gate
  // exists so a human sees the words before they are spoken over their product.
  check("...with the narration left for a human", draft.beats.every((b) => b.vo === ""));
  check("...and the draft says how many words fit", draft.suggestedWordsPerBeat === 8);
  check("...and marks itself unfinished", draft.draft === true);
}

console.log("\n== Part 28: release diff against two real running versions ==");

if (browserAvailable) {
  const http = await import("node:http");
  const { runReleaseDiff } = require(path.join(distDir, "tools", "releaseDiff.js"));

  const page = (body) => `<!doctype html><html><body style="margin:0;background:#fff;font:24px sans-serif">${body}</body></html>`;
  const serve = (html) =>
    new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        // Both versions serve every path, so /pricing and /about differ only by content.
        res.end(html(req.url));
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });

  const before = await serve((url) => page(url === "/pricing" ? "<h1>Pricing</h1><p>Free and Pro.</p>" : "<h1>About</h1><p>Unchanged page.</p>"));
  const after = await serve((url) =>
    url === "/pricing"
      ? page('<h1>Pricing</h1><p>Free, Pro and Team.</p><div style="width:700px;height:400px;background:#2d7"></div>')
      : page("<h1>About</h1><p>Unchanged page.</p>"),
  );
  const relRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-release-test-"));

  try {
    const result = await runReleaseDiff({
      projectRoot: relRoot,
      videoName: "rel",
      repoRoot: relRoot,
      beforeRef: "v1.0.0",
      afterRef: "v1.1.0",
      beforeUrl: `http://127.0.0.1:${before.address().port}`,
      afterUrl: `http://127.0.0.1:${after.address().port}`,
      routes: ["/pricing", "/about"],
      viewport: { width: 800, height: 600 },
    });

    check("both routes were captured on both sides", result.routes.length === 2);
    check("the changed route is caught", result.changedRoutes.join(",") === "/pricing");
    // The filtering is the important half: a what's-new clip showing identical pages is
    // worse than no clip at all.
    check("...and the unchanged one is dropped, not filmed", !result.changedRoutes.includes("/about"));
    check("...with the numbers reported either way", result.routes.every((r) => typeof r.changedRatio === "number"));
    check("a diff image exists for each route", result.routes.every((r) => fs.existsSync(path.join(relRoot, r.diffPath))));

    const draft = JSON.parse(fs.readFileSync(path.join(relRoot, result.draftPath), "utf8"));
    check("the draft manifest only covers what changed", draft.beats.length === 2);
    check("...and its assets are the real captures on disk", draft.beats.every((b) => fs.existsSync(path.join(relRoot, b.visual.assetPath))));
    // The draft is a draft: this tool does not install a manifest and does not write the
    // script.
    check("the draft is not installed as the video's beats.json", !fs.existsSync(path.join(relRoot, "src", "videos", "rel", "beats.json")));
    check("the next steps send it through the approval gate", result.nextSteps.join(" ").includes("write_beats_file"));
  } finally {
    before.close();
    after.close();
  }
} else {
  skip("Part 28: release diff (entire section)", "real Chromium is not available in this environment");
}

finish();

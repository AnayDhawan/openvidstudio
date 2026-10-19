#!/usr/bin/env node
// plan-shots: Part 26 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 26: plan_shots ranks from real repo signal ==");

{
  const shots = require(path.join(distDir, "tools", "planShots.js"));
  const { parseReadmeFeatures, parseChangelogFeatures, discoverRoutes, countRouteMentions, summarizeChurn, shortTitle, overlaps, runPlanShots } = shots;

  const readme = [
    "# Thing",
    "Some intro prose that is not a feature.",
    "## Features",
    "- **Instant search.** Finds anything in the repo.",
    "- **Offline first.** No account needed.",
    "- Plain bullet with no bold lead",
    "## Install",
    "- npm install thing",
  ].join("\n");
  const features = parseReadmeFeatures(readme);
  // Order is the signal: the first feature is what the author thinks sells the project.
  check("features are read in the author's order", features.map((f) => f.rank).join(",") === "1,2,3");
  check("...a bold lead-in becomes the title", features[0].title === "Instant search");
  check("...a plain bullet still counts", features[2].title === "Plain bullet with no bold lead");
  // The install section is a list too, and it is not a feature list.
  check("...and bullets outside a feature heading are ignored", features.length === 3);

  const changelog = [
    "# Changelog",
    "## [1.4.0]",
    "### Added",
    "- Real-time collaboration",
    "- fix: a crash on startup",
    "### Fixed",
    "- Something else entirely",
    "## [1.3.0]",
    "### Added",
    "- An older feature that has had its moment",
  ].join("\n");
  const entries = parseChangelogFeatures(changelog);
  check("only the newest release is ranked", entries.length === 1 && entries[0].version === "1.4.0");
  // "We fixed a crash" is not a demo beat.
  check("...and fixes are not candidate shots", entries[0].title === "Real-time collaboration");

  // Cutting a release leaves an empty [Unreleased] heading on top. It must not hide the release below it.
  const afterCut = parseChangelogFeatures(
    ["# Changelog", "", "## [Unreleased]", "", "## [2.0.0] - 2026-01-01", "", "### Added", "", "- **Dark mode.** A dark theme.", "- Offline sync", "", "## [1.9.0] - 2025-12-01", "", "### Added", "", "- Old thing", ""].join("\n"),
  );
  check("an empty [Unreleased] above a release does not hide that release's features", afterCut.length === 2 && afterCut.every((e) => e.version === "2.0.0"));
  check("...and the older release below it is still not ranked", !afterCut.some((e) => e.title === "Old thing"));
  const fullUnreleased = parseChangelogFeatures(
    ["## [Unreleased]", "", "### Added", "", "- Brand new", "", "## [2.0.0] - 2026-01-01", "", "### Added", "", "- Older", ""].join("\n"),
  );
  check("control: a non-empty [Unreleased] is still the newest section", fullUnreleased.length === 1 && fullUnreleased[0].version === "Unreleased");
  const onlyFixes = parseChangelogFeatures(
    ["## [Unreleased]", "", "### Fixed", "", "- fix a crash", "", "## [2.0.0] - 2026-01-01", "", "### Added", "", "- Real feature", ""].join("\n"),
  );
  check("an [Unreleased] with nothing to film is skipped in favour of the release below", onlyFixes.length === 1 && onlyFixes[0].title === "Real feature");

  const routes = discoverRoutes([
    "src/app/page.tsx",
    "src/app/(marketing)/pricing/page.tsx",
    "src/app/docs/[slug]/page.tsx",
    "src/app/api/health/route.ts",
    "pages/about.tsx",
    "pages/api/hook.ts",
  ]);
  check("routes are read out of the file tree", routes.includes("/pricing") && routes.includes("/about"));
  // A route group in parentheses is organisational and is not part of the URL.
  check("...with route groups stripped", !routes.some((r) => r.includes("(")));
  check("...and api handlers are not pages to film", !routes.some((r) => r.includes("api")));

  const mentions = countRouteMentions(["/pricing", "/about"], "see /pricing and /pricing again");
  check("docs links are counted per route", mentions["/pricing"] === 2 && mentions["/about"] === 0);

  const churn = summarizeChurn("commit abc\nsrc/search/index.ts\nsrc/search/rank.ts\ndocs/readme.md\n");
  check("recent work is summarized by directory", churn["src/search"] === 2);

  const longTitle = shortTitle("capture_desktop records a window, a region, or a whole display through ffmpeg on every platform");
  check("a long title is cut at a word, not mid-word", longTitle === "capture_desktop records a window, a region, or a whole display through");
  // Underscores survive: a changelog names capture_desktop far more often than it uses
  // underscore emphasis, and stripping them ran tool names together.
  check("...and a tool name keeps its underscore", longTitle.startsWith("capture_desktop"));
  // A single unbroken 90-character word has no word boundary to cut at, so the hard cut
  // is the only honest option rather than returning nothing.
  check("...and a title with no word boundary is still cut", shortTitle("b".repeat(90)).length === 72);
  check("overlapping titles merge rather than compete", overlaps("Instant search", "the search page") === true);
  check("...and unrelated ones do not", overlaps("Instant search", "billing portal") === false);

  // A real run against this repository, which has a README feature list, a changelog, no
  // routes, and a package that ships a bin.
  const real = await runPlanShots({ repoRoot: path.join(packageRoot, "..", ".."), maxShots: 5 });
  check("a real repo produces a ranked list", real.candidates.length === 5);
  check("...in descending order", real.candidates.every((c, i) => i === 0 || real.candidates[i - 1].score >= c.score));
  check("...every candidate carries its evidence", real.candidates.every((c) => c.evidence.length > 0));
  // Compare the two features' own scores rather than asserting who is on top: what leads depends on
  // the changelog's current entries, which change with every release, and this repo's does. Ask for
  // every candidate: with only five, a long [Unreleased] pushes the README's fourth feature off the list.
  const all = await runPlanShots({ repoRoot: path.join(packageRoot, "..", ".."), maxShots: 200 });
  const scoreOf = (position) => all.candidates.find((c) => c.evidence.join(" ").includes(`lists this ${position} under`))?.score;
  check("...the README's first feature outranks its fourth", scoreOf("first") !== undefined && scoreOf("fourth") !== undefined && scoreOf("first") > scoreOf("fourth"));
  // A thin result should be explained rather than mysterious.
  check("...and missing signals are named", real.signalsMissing.some((m) => m.includes("routes")));
  // This repo has no routes and does ship a command, so recommending a reconstructed panel
  // would be recommending a fake of something that can be filmed for real.
  check("...a browserless repo is not told to reconstruct panels", real.candidates.every((c) => c.suggestedCapture !== "dom-demo"));
  check("...and the notes say plan_shots feeds the intake rather than replacing it", real.notes.join(" ").includes("PLANNING.md"));
}

finish();

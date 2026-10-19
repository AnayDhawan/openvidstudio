#!/usr/bin/env node
// release-version: the version the MCP server reports is the version it ships as, and the four
// published-shaped packages move together.

import * as fs from "node:fs";
import * as path from "node:path";
import { require, distDir, monorepoRoot, check, finish } from "./_harness.mjs";

console.log("\n== the server reports the version it ships as ==");
{
  const version = (dir) => JSON.parse(fs.readFileSync(path.join(monorepoRoot, dir, "package.json"), "utf8")).version;
  const { SERVER_VERSION } = require(path.join(distDir, "server.js"));
  const versions = {
    root: version("."),
    capture: version("packages/capture"),
    core: version("packages/core"),
    stem: version("packages/stem"),
    server: version("packages/mcp-server"),
  };
  const semver = /^\d+\.\d+\.\d+$/;

  check(`every package version is plain semver (${JSON.stringify(versions)})`, Object.values(versions).every((v) => semver.test(v)));
  check("the five packages share one version", new Set(Object.values(versions)).size === 1);
  check(
    `SERVER_VERSION (${SERVER_VERSION}) equals packages/mcp-server's own version (${versions.server})`,
    SERVER_VERSION === versions.server,
  );

  // The check has to be able to fail.
  check("control: a different version string is not equal", SERVER_VERSION !== "0.0.0-not-a-release");
}

console.log("\n== the changelog's newest release matches ==");
{
  const changelog = fs.readFileSync(path.join(monorepoRoot, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
  const server = JSON.parse(fs.readFileSync(path.join(monorepoRoot, "packages", "mcp-server", "package.json"), "utf8")).version;
  const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  check(`CHANGELOG's newest numbered release (${headings[0]}) is the packages' version (${server})`, headings[0] === server);
  check("CHANGELOG keeps an [Unreleased] heading above it", changelog.indexOf("## [Unreleased]") !== -1 && changelog.indexOf("## [Unreleased]") < changelog.indexOf(`## [${server}]`));
}

finish();

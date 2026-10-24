#!/usr/bin/env node
// claude-plugin: the plugin folder, the marketplace file and the launcher agree with each other and with the
// packages, so a release cannot ship a plugin that points at a server version that does not exist yet.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { distDir, monorepoRoot, check, finish, listFilesRecursive } from "./_harness.mjs";

console.log("\n== the Claude plugin is consistent with the marketplace, the skills and the server ==");

const pluginDir = path.join(monorepoRoot, "plugins", "openvidstudio");
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const text = (p) => fs.readFileSync(p, "utf8");

{
  const market = json(path.join(monorepoRoot, ".claude-plugin", "marketplace.json"));
  const manifest = json(path.join(pluginDir, ".claude-plugin", "plugin.json"));
  const entry = market.plugins.find((p) => p.name === manifest.name);

  check("the marketplace has a name, an owner and one plugin", typeof market.name === "string" && market.owner?.name && market.plugins.length === 1);
  check("the entry name equals the manifest name (installs by name depend on it)", entry && entry.name === manifest.name);
  check("the entry's source is a relative path that exists", entry && entry.source === "./plugins/openvidstudio" && fs.existsSync(path.join(monorepoRoot, entry.source, ".claude-plugin", "plugin.json")));
  check("the plugin name is kebab-case and not a reserved Anthropic name", /^[a-z][a-z0-9-]*$/.test(manifest.name) && !/^(claude|anthropic|anthropics|cc-plugin)-/.test(manifest.name));
  check("the plugin version is plain semver", /^\d+\.\d+\.\d+$/.test(manifest.version));
  check("the plugin is Apache-2.0 with the licence file next to it", manifest.license === "Apache-2.0" && fs.existsSync(path.join(pluginDir, "LICENSE")));
  check("the plugin ships a privacy page and a README", fs.existsSync(path.join(pluginDir, "PRIVACY.md")) && fs.existsSync(path.join(pluginDir, "README.md")));
  check("no bin/ folder (a plugin with one cannot be installed on claude.ai or Cowork)", !fs.existsSync(path.join(pluginDir, "bin")));
  check("the manifest has no stray top-level fields the validator warns about (directory fields are added at submission)", ["icon", "documentationUrl", "supportUrl", "privacyPolicyUrl"].every((k) => !(k in manifest)));
}

{
  const mcp = json(path.join(pluginDir, ".mcp.json"));
  const server = mcp.mcpServers?.openvidstudio;
  check(".mcp.json registers exactly one server, named openvidstudio", Object.keys(mcp.mcpServers ?? {}).join(",") === "openvidstudio");
  check("...started through the launcher with ${CLAUDE_PLUGIN_ROOT}, not a bare npx line", server?.command === "node" && server.args?.[0] === "${CLAUDE_PLUGIN_ROOT}/scripts/launch-mcp.mjs");
  // Without an explicit type, a headless Claude Code session reports the plugin's server as failed and never starts it
  // (found 2026-10-24 by running claude -p against the installed plugin); with it the server connects.
  check('...with "type": "stdio" spelled out (headless sessions fail the server without it)', server?.type === "stdio");
  check("the launcher file exists", fs.existsSync(path.join(pluginDir, "scripts", "launch-mcp.mjs")));
}

{
  const launcher = await import(pathToFileURL(path.join(pluginDir, "scripts", "launch-mcp.mjs")).href);
  const serverVersion = json(path.join(monorepoRoot, "packages", "mcp-server", "package.json")).version;
  const num = (v) => v.split(".").map(Number);
  const lte = (a, b) => {
    const x = num(a);
    const y = num(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return true;
  };
  check(`the launcher pins an exact version (${launcher.PINNED_VERSION})`, /^\d+\.\d+\.\d+$/.test(launcher.PINNED_VERSION));
  check(`...no newer than the server in this repo (${serverVersion}); a pin ahead of the code would never exist on npm`, lte(launcher.PINNED_VERSION, serverVersion));
  check("...and it names the published package", launcher.PACKAGE === json(path.join(monorepoRoot, "packages", "mcp-server", "package.json")).name);
}

{
  // The skills in the plugin are a generated copy of .claude/skills; the sync script is the judge.
  const sync = spawnSync(process.execPath, [path.join(monorepoRoot, "scripts", "sync-skills.mjs"), "--check"], { encoding: "utf8" });
  check("sync-skills --check passes (the plugin's skills are not stale)", sync.status === 0);

  const skillsDir = path.join(pluginDir, "skills");
  const skills = fs.readdirSync(skillsDir);
  check("the plugin ships the four owned skills", ["bgmusic", "openvidstudio", "openvidstudio-director", "supernova"].every((s) => skills.includes(s)));
  check("each skill has a SKILL.md with a name and a description", skills.every((s) => {
    const t = text(path.join(skillsDir, s, "SKILL.md"));
    return new RegExp(`^---\\nname: ${s}\\n`).test(t.replace(/\r\n/g, "\n")) && /\ndescription: .{40,}/.test(t);
  }));
  // An unquoted ": " inside a description is invalid YAML: Claude Code then drops the skill's frontmatter and the
  // skill silently does not load (supernova had exactly this until 2026-10-24).
  check("no skill's description holds an unquoted colon-space (invalid YAML, the skill would not load)", skills.every((s) => {
    const fm = /^---\n([\s\S]*?)\n---/.exec(text(path.join(skillsDir, s, "SKILL.md")).replace(/\r\n/g, "\n"));
    const desc = fm && /^description: (.*)$/m.exec(fm[1]);
    return desc && (/^["'].*["']$/.test(desc[1]) || !desc[1].includes(": "));
  }));
  check("no skill hard-codes the standalone tool prefix (it changes to mcp__plugin_openvidstudio_openvidstudio__ in a plugin)", skills.every((s) => !text(path.join(skillsDir, s, "SKILL.md")).includes("mcp__openvidstudio__")));
  check("the vendored remotion-* skills are not copied into the plugin", skills.every((s) => !s.startsWith("remotion-")));
}

{
  // Repo style: no em dashes in anything the plugin ships.
  const files = listFilesRecursive(pluginDir)
    .map((f) => path.join(pluginDir, f))
    .filter((f) => /\.(md|json|mjs)$/.test(f) && !f.includes(`${path.sep}skills${path.sep}`));
  const bad = files.filter((f) => text(f).includes("—"));
  check("the plugin's own files contain no em dash", bad.length === 0);
}

{
  // The server's new `install` subcommand is what the plugin README sends Desktop users to.
  check("the built server has the install module the plugin README refers to", fs.existsSync(path.join(distDir, "install.js")));
  const readme = text(path.join(pluginDir, "README.md"));
  check("the plugin README gives both install commands with the marketplace name", readme.includes("/plugin marketplace add AnayDhawan/openvidstudio") && readme.includes("/plugin install openvidstudio@openvidstudio"));
}

finish();

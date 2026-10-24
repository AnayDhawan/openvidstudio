# Releasing

How a release goes out. The order matters: the Claude plugin pins an exact version of the server, so that version has to exist on npm before the plugin points at it.

## What gets versioned

| Thing | Where | Moves with |
|---|---|---|
| The six packages (`capture`, `core`, `stem`, `styles`, `mcp-server`, and the root) | each `package.json`, plus `SERVER_VERSION` | One number, `release-version` test enforces it |
| The server version the plugin runs | `PINNED_VERSION` in `plugins/openvidstudio/scripts/launch-mcp.mjs` | A separate, later change (step 6). Never ahead of the packages |
| The plugin's own version | `plugins/openvidstudio/.claude-plugin/plugin.json` | Bumped whenever the plugin's files change: skills, launcher, manifest. Users get an update only when this changes |
| The git tag | `vX.Y.Z` on main, and `openvidstudio--vA.B.C` for the plugin (`claude plugin tag`) | After the matching publish |

## Steps

1. **Release PR.** Bump the six package versions and `SERVER_VERSION` together, move `[Unreleased]` in `CHANGELOG.md` under the new version, run `node scripts/generate-tool-docs.mjs`, `node scripts/sync-skills.mjs`, and the CI test list. Merge on green.
2. **Publish to npm**, in this order: `capture`, `core`, `stem`, `styles`, `mcp-server` (`pnpm publish` rewrites `workspace:*`). Use a granular token scoped to `@openvidstudio` with a short expiry, and revoke it right after. Verify with `npm view @openvidstudio/mcp-server version` and a clean `npm install --prefix /tmp/x @openvidstudio/mcp-server@X.Y.Z`.
3. **Tag and release** `vX.Y.Z` on the merge commit, with release notes that give the install commands (plugin, Claude Desktop, other clients).
4. **Plugin bump PR**, only after step 2 is visible on npm: set `PINNED_VERSION` to the new version, bump the plugin's `version`, and update the plugin README if install steps changed. `claude plugin validate --strict ./plugins/openvidstudio` and `claude plugin validate .` must pass (CI runs both).
5. **Merge, then `claude plugin tag`** from `plugins/openvidstudio` (add `--push`).
6. **Smoke test on a clean profile** (a fresh `CLAUDE_CONFIG_DIR` with your credentials copied in): `claude plugin marketplace add AnayDhawan/openvidstudio`, `claude plugin install openvidstudio@openvidstudio`, `claude mcp list` shows `plugin:openvidstudio:openvidstudio` Connected, and `/openvidstudio:supernova` exists. On a Claude Desktop machine, `npx -y @openvidstudio/mcp-server install claude-desktop` then restart.

Never merge a plugin bump that pins a version that is not on npm yet: the launcher would try to install a package that does not exist and every new install would fail until it is published.

## Later: the Anthropic directory

A listing needs a paid claude.ai plan and the developer portal at claude.ai/directory/manage. Before submitting, add the directory fields to `plugin.json` (`icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`; the `claude plugin validate` shipped before 2.1.281 warns on them, which is why they are not in the file yet), keep the plugin free of a `bin/` folder, and keep `PRIVACY.md` at a stable public URL. Run `claude plugin validate ./plugins/openvidstudio --strict` with a current CLI.

# Contributing to openvidstudio

---

## Quick Setup

This is a pnpm workspace (`packages/*`, `apps/*`, `templates/*`), not a single package, so
most commands need a `--filter` for the piece you're touching.

```bash
git clone https://github.com/AnayDhawan/openvidstudio.git
cd openvidstudio
pnpm install
(no .env required)

# work on the MCP server
pnpm --filter @openvidstudio/mcp-server build

# work on the public site
pnpm --filter @openvidstudio/site dev
```

See README.md Quick Start for setup.

---

## How to Contribute

### Reporting Bugs
Open an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include steps to reproduce, expected vs actual behavior, environment.

### Requesting Features
Open an issue using the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml).

### Submitting a PR

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Verify: `pnpm --filter @openvidstudio/mcp-server test` and/or
   `pnpm --filter @openvidstudio/site build`, whichever package you touched (must pass clean)
4. Open a PR against `main`

---

## Good First Issues

Look for issues labeled [`good first issue`](https://github.com/AnayDhawan/openvidstudio/labels/good%20first%20issue).

Check the issues tab for the current list.

---

## Code Style

- Match the existing code style in this repo.
- Keep functions small and single-purpose.
- Add a test for any new behavior.

---

## PR Guidelines

- One PR per change: keep scope tight
- PR description must explain *why*, not just *what*
- Keep changes focused and include a clear description.
- AI-assisted code is welcome, provided you have reviewed and tested the output

---

## Commit Style

[Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add dark mode toggle
fix: correct timezone offset in tournament dates
docs: update quick start steps
```
Types: `feat | fix | docs | style | refactor | perf | test | ci | chore`

---

## Community

Open an issue or discussion on GitHub.

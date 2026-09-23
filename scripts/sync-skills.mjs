#!/usr/bin/env node
/**
 * Mirrors this repo's own skills (openvidstudio, bgmusic) from .claude/skills, their one
 * source of truth, into the five other tool directories that already carry the vendored
 * remotion-* skills by hand: .agents/skills, .cursor/skills, .github/skills,
 * .opencode/skills, .windsurf/skills.
 *
 * Before this, only .claude/skills had them: an agent running under Codex CLI, Copilot,
 * Cursor, opencode or Windsurf had no way to discover "make a demo video of this project,
 * handle it end to end" as a single invocation, the exact distribution gap
 * github.com/AnayDhawan/openvidstudio#55 asks to close. The remotion-* skills already prove
 * the shape (six identical copies, one per tool) -- this generates that copy mechanically
 * instead of by hand, so a skill added under .claude/skills next time doesn't silently stay
 * .claude-only again.
 *
 * Usage:
 *   node scripts/sync-skills.mjs         mirror .claude/skills' own skills, write the copies
 *   node scripts/sync-skills.mjs --check fail (exit 1) if any target dir is out of sync,
 *                                         without writing -- for CI
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(root, ".claude", "skills");

/**
 * Only skills this repo itself authored get mirrored, not every skill under .claude/skills.
 * The remotion-* skills are vendored from elsewhere (their own copies across the six
 * directories are the upstream source, not .claude/skills), so mirroring them from here
 * would make .claude/skills a second, competing source of truth for content it doesn't own.
 */
const OWNED_SKILLS = ["openvidstudio", "bgmusic"];

const TARGET_DIRS = [
  path.join(root, ".agents", "skills"),
  path.join(root, ".cursor", "skills"),
  path.join(root, ".github", "skills"),
  path.join(root, ".opencode", "skills"),
  path.join(root, ".windsurf", "skills"),
];

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function diffSkill(skillName) {
  const sourceDir = path.join(SOURCE_DIR, skillName);
  const sourceFiles = listFilesRecursive(sourceDir).map((f) => path.relative(sourceDir, f));

  const diffs = [];
  for (const targetRoot of TARGET_DIRS) {
    const targetDir = path.join(targetRoot, skillName);
    for (const rel of sourceFiles) {
      const srcContent = fs.readFileSync(path.join(sourceDir, rel));
      const dstPath = path.join(targetDir, rel);
      const dstContent = fs.existsSync(dstPath) ? fs.readFileSync(dstPath) : null;
      if (dstContent === null || !srcContent.equals(dstContent)) {
        diffs.push({ sourceDir, targetDir, rel, srcPath: path.join(sourceDir, rel), dstPath });
      }
    }
  }
  return diffs;
}

const check = process.argv.includes("--check");
let anyDiffs = false;

for (const skillName of OWNED_SKILLS) {
  const sourceDir = path.join(SOURCE_DIR, skillName);
  if (!fs.existsSync(sourceDir)) {
    console.error(`scripts/sync-skills.mjs: ${sourceDir} does not exist -- update OWNED_SKILLS.`);
    process.exit(1);
  }

  const diffs = diffSkill(skillName);
  if (diffs.length === 0) {
    console.log(`ok   ${skillName} already in sync across ${TARGET_DIRS.length} target dirs`);
    continue;
  }

  anyDiffs = true;
  if (check) {
    console.error(`stale ${skillName}: out of sync in ${new Set(diffs.map((d) => d.targetDir)).size} target dir(s)`);
    for (const d of diffs) console.error(`  ${path.relative(root, d.dstPath)}`);
    continue;
  }

  for (const d of diffs) {
    fs.mkdirSync(path.dirname(d.dstPath), { recursive: true });
    fs.copyFileSync(d.srcPath, d.dstPath);
  }
  console.log(`wrote ${skillName}: ${diffs.length} file(s) synced across ${TARGET_DIRS.length} target dirs`);
}

if (check && anyDiffs) {
  console.error(
    `\n.claude/skills' own skills (${OWNED_SKILLS.join(", ")}) are out of sync with one or more of ` +
      `${TARGET_DIRS.map((d) => path.relative(root, d)).join(", ")}. Run "node scripts/sync-skills.mjs" and commit the result.`,
  );
  process.exit(1);
}

if (!check) console.log("sync-skills ok");

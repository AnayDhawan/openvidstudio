import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export interface RepoInfo {
  owner: string;
  name: string;
  license?: string;
  /** A simple guess, e.g. "TypeScript" -- not a real language-detection pass. */
  language?: string;
  /** True when neither a git remote nor package.json's "repository" field resolved anything real. */
  isFallback: boolean;
}

/**
 * Real owner/repo/license/language for the cta template's RepoCta card, so scaffold_scene
 * never ships "your-org"/"your-repo" placeholders into a video for a project that has a
 * real remote. Git remote wins over package.json's "repository" field, since the remote is
 * where the video's `github.com/<owner>/<name>` caption actually has to resolve to push
 * come to shove. Falls back to literal placeholders only when neither source has anything.
 */
export function detectRepoInfo(projectRoot: string): RepoInfo {
  const pkg = readPackageJson(projectRoot);
  const fromGit = detectFromGitRemote(projectRoot);
  const fromPkg = fromGit ? null : parseRepoSlug(packageJsonRepositoryUrl(pkg));

  const slug = fromGit ?? fromPkg;
  const license = typeof pkg?.license === "string" && pkg.license.trim() ? pkg.license.trim() : undefined;
  const language = guessLanguage(projectRoot);

  return {
    owner: slug?.owner ?? "your-org",
    name: slug?.name ?? "your-repo",
    license,
    language,
    isFallback: slug === null,
  };
}

function detectFromGitRemote(projectRoot: string): { owner: string; name: string } | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseRepoSlug(url);
  } catch {
    return null;
  }
}

function packageJsonRepositoryUrl(pkg: Record<string, unknown> | null): string | undefined {
  const repo = pkg?.repository;
  if (typeof repo === "string") return repo;
  if (repo && typeof repo === "object" && typeof (repo as { url?: unknown }).url === "string") {
    return (repo as { url: string }).url;
  }
  return undefined;
}

/** Handles https/ssh github.com URLs (with or without git+/.git) and the "github:owner/repo" shorthand. */
function parseRepoSlug(url: string | undefined): { owner: string; name: string } | null {
  if (!url) return null;
  const full = url.match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (full) return { owner: full[1], name: full[2] };
  const shorthand = url.match(/^github:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (shorthand) return { owner: shorthand[1], name: shorthand[2] };
  return null;
}

function readPackageJson(projectRoot: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Simple guess from what config files exist at the project root, not real language detection. */
function guessLanguage(projectRoot: string): string | undefined {
  const has = (rel: string) => fs.existsSync(path.join(projectRoot, rel));
  if (has("tsconfig.json")) return "TypeScript";
  if (has("Cargo.toml")) return "Rust";
  if (has("go.mod")) return "Go";
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) return "Python";
  if (has("Gemfile")) return "Ruby";
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) return "Java";
  if (has("package.json")) return "JavaScript";
  return undefined;
}

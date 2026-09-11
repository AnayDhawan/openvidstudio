import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { spawnCapture } from "../util";
import { runTool } from "./mcp";

/**
 * Ranks what a demo video should show, from what the repository already says.
 *
 * Deciding what to show is the hard part of a demo video. Skipping the timeline editor is
 * a convenience; choosing the fifteen seconds that carry the pitch is the part people get
 * wrong, and it is the part a repository is unexpectedly good at answering. The author
 * already ordered the README, already wrote the changelog, already decided which routes
 * exist and which the docs link to most. Nobody reads those as a ranking because reading
 * them that way is tedious, not because the signal is weak.
 *
 * Every candidate carries its evidence. A ranking without evidence is a vibe with a number
 * attached, and the proposed test for this feature is whether the project's own author says
 * "yes, that is my product's best moment", which they cannot judge without seeing why.
 *
 * What this deliberately does not do is write beats. It feeds PLANNING.md's intake rather
 * than replacing it: the intake is where a human says what the video is for, and a ranking
 * of what the repo emphasises is an input to that conversation, not a substitute.
 */

export interface ShotCandidate {
  /** A short name for the moment. */
  title: string;
  /** Where it came from and why it scored. */
  evidence: string[];
  score: number;
  /** A route, command, or file the beat would point at, when the signal named one. */
  target?: string;
  /** What the capture would most likely be, given what this target is. */
  suggestedCapture: "screenshot" | "recording" | "terminal" | "dom-demo";
}

export interface PlanShotsInput {
  /** The repository being filmed. Not the video project. */
  repoRoot: string;
  maxShots?: number;
  /** Days of git history to weigh. Defaults to 180. */
  historyDays?: number;
}

export interface PlanShotsResult {
  candidates: ShotCandidate[];
  signalsUsed: string[];
  signalsMissing: string[];
  notes: string[];
}

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^\s*[-*]\s+(.+)$/;
const BOLD_LEAD = /^\*\*(.+?)\*\*[:.]?\s*(.*)$/;

/** Titles are labels in a ranked list, so they get cut at a word, not mid-word. */
export function shortTitle(text: string, max = 72): string {
  // Asterisks and backticks are markdown. Underscores are left alone: a changelog line is
  // far more likely to name capture_desktop than to use underscore emphasis, and stripping
  // them turned tool names into unreadable run-together words.
  const clean = text.replace(/[*`]/g, "").trim();
  if (clean.length <= max) return clean.replace(/[.,;:]+$/, "");
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]+$/, "");
}

/**
 * Feature claims from a README, in the order the author put them.
 *
 * Order is the signal. The first feature listed is almost always the one the author thinks
 * sells the project, and the tenth is almost always there for completeness. A bold lead-in
 * on a bullet is a second, weaker signal of the same thing.
 */
export function parseReadmeFeatures(markdown: string): { title: string; detail: string; rank: number; bold: boolean }[] {
  const lines = markdown.split(/\r?\n/);
  const out: { title: string; detail: string; rank: number; bold: boolean }[] = [];
  let inFeatureSection = false;
  let rank = 0;

  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      const text = heading[2].toLowerCase();
      // Whatever the author called it. "Features", "What it does", "Why", "Highlights".
      inFeatureSection = /feature|what it|why |highlight|capabilit|how it works/.test(text);
      continue;
    }
    if (!inFeatureSection) continue;
    const bullet = BULLET.exec(line);
    if (!bullet) continue;

    const bold = BOLD_LEAD.exec(bullet[1]);
    rank++;
    out.push({
      title: shortTitle(bold ? bold[1] : bullet[1]),
      detail: (bold ? bold[2] : bullet[1]).replace(/[*_`]/g, "").trim(),
      rank,
      bold: Boolean(bold),
    });
  }
  return out;
}

/**
 * The most recent release's added features.
 *
 * Recency matters twice over: a feature shipped last month is what the project wants seen,
 * and it is the one least likely to already have a video. Fixes are skipped, because
 * "we fixed a crash" is not a demo beat.
 */
export function parseChangelogFeatures(markdown: string): { title: string; version: string }[] {
  const lines = markdown.split(/\r?\n/);
  const out: { title: string; version: string }[] = [];
  let version = "";
  let underAdded = true;

  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      const text = heading[2];
      if (/^\[?v?\d+\.\d+/.test(text) || /unreleased/i.test(text)) {
        // Only the newest section is worth ranking; anything older has had its moment.
        if (version) break;
        version = text.replace(/[[\]]/g, "").split(/\s+/)[0];
        underAdded = true;
      } else {
        underAdded = /add|feature|new|changed/i.test(text);
      }
      continue;
    }
    if (!version || !underAdded) continue;
    const bullet = BULLET.exec(line);
    if (!bullet) continue;
    if (/^fix|^chore|^docs|^deps|dependabot/i.test(bullet[1])) continue;
    out.push({ title: shortTitle(bullet[1]), version });
  }
  return out;
}

/** Routes a Next.js or Remix style tree declares. A route that exists is a thing to film. */
export function discoverRoutes(files: string[]): string[] {
  const routes = new Set<string>();
  for (const file of files) {
    const norm = file.replace(/\\/g, "/");
    const app = /(?:^|\/)(?:src\/)?app\/(.*)\/page\.(tsx|jsx|ts|js)$/.exec(norm);
    if (app) {
      // Route groups in parentheses are organisational and are not part of the URL.
      const route = "/" + app[1].replace(/\((.*?)\)\//g, "").replace(/\/?$/, "");
      routes.add(route === "/" ? "/" : route.replace(/\/+$/, ""));
      continue;
    }
    const pages = /(?:^|\/)(?:src\/)?pages\/(.*)\.(tsx|jsx|ts|js)$/.exec(norm);
    if (pages && !pages[1].startsWith("api/") && !pages[1].startsWith("_")) {
      routes.add("/" + pages[1].replace(/\/?index$/, ""));
    }
  }
  return [...routes].sort();
}

/** How often each route is linked from documentation. A route the docs push is a route users land on. */
export function countRouteMentions(routes: string[], docs: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const route of routes) {
    if (route === "/") continue;
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    counts[route] = (docs.match(new RegExp(escaped, "g")) ?? []).length;
  }
  return counts;
}

/** Directories the recent commits actually touched, which is where the work has been. */
export function summarizeChurn(gitLog: string): Record<string, number> {
  const churn: Record<string, number> = {};
  for (const line of gitLog.split(/\r?\n/)) {
    const file = line.trim();
    if (!file || file.startsWith("commit ") || !file.includes("/")) continue;
    const top = file.split("/").slice(0, 2).join("/");
    churn[top] = (churn[top] ?? 0) + 1;
  }
  return churn;
}

function readIfExists(root: string, names: string[]): { name: string; content: string } | null {
  for (const name of names) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return { name, content: fs.readFileSync(p, "utf8") };
  }
  return null;
}

function listFiles(root: string, max = 4000): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage"]);
  const walk = (dir: string): void => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) return;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out;
}

export async function runPlanShots(input: PlanShotsInput): Promise<PlanShotsResult> {
  const repoRoot = path.resolve(input.repoRoot);
  if (!fs.existsSync(repoRoot)) throw new Error(`${repoRoot} does not exist.`);
  const maxShots = input.maxShots ?? 8;
  const historyDays = input.historyDays ?? 180;

  const signalsUsed: string[] = [];
  const signalsMissing: string[] = [];
  const notes: string[] = [];
  const candidates: ShotCandidate[] = [];

  const readme = readIfExists(repoRoot, ["README.md", "readme.md", "Readme.md"]);
  if (readme) {
    const features = parseReadmeFeatures(readme.content);
    if (features.length > 0) {
      signalsUsed.push(`${readme.name}: ${features.length} feature claims, in the author's own order`);
      for (const feature of features) {
        // Steeply decaying, because README order is steeply meaningful. Fifth place is not
        // half as important as first, it is a footnote.
        const orderScore = Math.max(0, 40 - (feature.rank - 1) * 6);
        const evidence = [`${readme.name} lists this ${ordinal(feature.rank)} under its feature heading`];
        if (feature.bold) evidence.push("the author set it in bold, which is a second vote for it");
        candidates.push({
          title: feature.title,
          evidence,
          score: orderScore + (feature.bold ? 5 : 0),
          suggestedCapture: "dom-demo",
        });
      }
    } else {
      signalsMissing.push(`${readme.name} has no recognisable feature list, so nothing could be ranked from it`);
    }
  } else {
    signalsMissing.push("no README, which is normally the strongest single signal here");
  }

  const changelog = readIfExists(repoRoot, ["CHANGELOG.md", "changelog.md"]);
  if (changelog) {
    const entries = parseChangelogFeatures(changelog.content);
    if (entries.length > 0) {
      signalsUsed.push(`${changelog.name}: ${entries.length} additions in the newest release`);
      for (const entry of entries.slice(0, 6)) {
        const existing = candidates.find((c) => overlaps(c.title, entry.title));
        const recencyNote = `shipped in ${entry.version}, so it is both emphasised and new`;
        if (existing) {
          // Once per candidate. Several changelog lines often brush against the same README
          // bullet, and paying the bonus each time inflates whatever happens to be first.
          if (!existing.evidence.includes(recencyNote)) {
            existing.score += 18;
            existing.evidence.push(recencyNote);
          }
        } else {
          candidates.push({
            title: entry.title,
            evidence: [`${changelog.name} lists this as new in ${entry.version}, and new work is what a project wants seen`],
            score: 22,
            suggestedCapture: "dom-demo",
          });
        }
      }
    }
  } else {
    signalsMissing.push("no CHANGELOG, so recency could not be weighed");
  }

  const files = listFiles(repoRoot);
  const routes = discoverRoutes(files);
  if (routes.length > 0) {
    signalsUsed.push(`${routes.length} routes found in the file tree`);
    const docsText = files
      .filter((f) => /\.mdx?$/.test(f))
      .slice(0, 60)
      .map((f) => {
        try {
          return fs.readFileSync(path.join(repoRoot, f), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    const mentions = countRouteMentions(routes, docsText);

    for (const route of routes) {
      const count = mentions[route] ?? 0;
      const existing = candidates.find((c) => overlaps(c.title, route.replace(/[/-]/g, " ")));
      const evidence = [`the app serves ${route}, so there is a real page to film`];
      if (count > 0) evidence.push(`the docs link it ${count} time${count === 1 ? "" : "s"}`);
      if (existing) {
        existing.target = route;
        // A claim with a route behind it can be filmed for real instead of illustrated.
        existing.suggestedCapture = "screenshot";
        existing.score += 12 + Math.min(count * 4, 16);
        existing.evidence.push(...evidence);
      } else {
        candidates.push({
          title: route === "/" ? "the landing page" : route.replace(/^\//, "").replace(/[/-]/g, " "),
          target: route,
          evidence,
          score: 10 + Math.min(count * 4, 16),
          suggestedCapture: "screenshot",
        });
      }
    }
  } else {
    signalsMissing.push("no routes found, so nothing here can be captured from a browser");
    notes.push(
      "With no routes, this product is a CLI, a library, or a desktop application. Its best moments are " +
        "captured with capture_terminal or capture_desktop, not with a browser, and the suggested capture " +
        "for every candidate below reflects that.",
    );
  }

  const hasCli = files
    .filter((f) => path.basename(f) === "package.json")
    .slice(0, 30)
    .some((f) => {
      try {
        return Boolean((JSON.parse(fs.readFileSync(path.join(repoRoot, f), "utf8")) as { bin?: unknown }).bin);
      } catch {
        return false;
      }
    });
  if (hasCli) {
    signalsUsed.push("a package.json declares a bin, so this ships a command");
    for (const candidate of candidates) {
      if (!candidate.target) candidate.suggestedCapture = "terminal";
    }
    notes.push(
      "This project ships a command, so its strongest beat is usually the command running, recorded with " +
        "capture_terminal rather than reconstructed as a panel.",
    );
  }

  const log = await spawnCapture(
    "git",
    ["log", `--since=${historyDays}.days`, "--name-only", "--pretty=format:commit %H"],
    repoRoot,
  );
  if (log.code === 0 && log.stdout.trim()) {
    const churn = summarizeChurn(log.stdout);
    const ranked = Object.entries(churn).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (ranked.length > 0) {
      signalsUsed.push(`git history: ${historyDays} days of commits, concentrated in ${ranked[0][0]}`);
      for (const [dir, count] of ranked) {
        const match = candidates.find((c) => overlaps(c.title, dir.replace(/[/_-]/g, " ")));
        if (match) {
          match.score += 10;
          match.evidence.push(`${count} file changes in ${dir} over the last ${historyDays} days, so this is where the work is`);
        }
      }
    }
  } else {
    signalsMissing.push("no readable git history, so where the recent work went could not be weighed");
  }

  if (candidates.length === 0) {
    throw new Error(
      `Nothing to rank in ${repoRoot}: no README feature list, no changelog, no routes. This tool reads a ` +
        `repository's own emphasis, and there is none recorded here yet.`,
    );
  }

  candidates.sort((a, b) => b.score - a.score);
  notes.push(
    "This ranks what the repository emphasises. It is an input to PLANNING.md's intake, not a replacement " +
      "for it: the intake is where a human says what this particular video is for.",
  );
  notes.push(
    "The test that matters: show this list to the project's own author before anything is rendered and ask " +
      "whether the top entries are their product's best moments.",
  );

  return { candidates: candidates.slice(0, maxShots), signalsUsed, signalsMissing, notes };
}

function ordinal(n: number): string {
  const names = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  return names[n - 1] ?? `${n}th`;
}

/** Loose title matching, so a README bullet and a route about the same thing merge rather than compete. */
export function overlaps(a: string, b: string): boolean {
  const words = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return false;
  for (const w of left) if (right.has(w)) return true;
  return false;
}

export function registerPlanShots(server: McpServer): void {
  server.registerTool(
    "plan_shots",
    {
      title: "Rank what a demo should show, from the repository's own emphasis",
      description:
        "Reads a repository and proposes what the video should show, ranked, with the evidence for every " +
        "entry. Deciding what to show is the hard part of a demo video; skipping the timeline editor is a " +
        "convenience. The signals are ones the repository already carries: the order the README lists its " +
        "features in (the first one is almost always what the author thinks sells the project, the tenth is " +
        "there for completeness), what the newest changelog section added (recent work is both what the " +
        "project wants seen and what has no video yet), which routes actually exist and how often the docs " +
        "link each one, whether the package ships a command, and which directories the recent commits " +
        "touched. Every candidate reports why it scored, because a ranking without evidence is a guess with " +
        "a number on it, and because the test for this is whether the project's own author agrees these are " +
        "their best moments. It also says which signals were missing, so a thin result is explained rather " +
        "than mysterious. It does not write beats: it feeds PLANNING.md's intake, where a human says what " +
        "this particular video is for.",
      inputSchema: {
        repoRoot: z.string().min(1).describe("The repository being filmed, not the video project."),
        maxShots: z.number().int().positive().optional(),
        historyDays: z.number().int().positive().optional(),
      },
    },
    async (input) => runTool("plan_shots", () => runPlanShots(input)),
  );
}

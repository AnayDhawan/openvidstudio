import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, spawnCapture } from "../util";
import {
  DEFAULT_VIEWPORT,
  detectAndCompensateZoom,
  launchChromium,
  replayInteractions,
  viewportSchema,
  interactionSchema,
  type Interaction,
  type Viewport,
} from "@openvidstudio/capture";
import { compareFrames, judgeDrift } from "../frameDiff";
import { discoverRoutes } from "./planShots";
import { runTool } from "./mcp";

/**
 * Two refs in, a what's-new clip out.
 *
 * Today a project makes one demo video, ever. This is the change that turns that into one
 * video per release, which is the difference between a tool someone uses once and a tool
 * wired into how they ship.
 *
 * The hard part is not capturing twice. It is not making a video about nothing: a release
 * is mostly dependency bumps and refactors, and a "what's new" clip that shows four
 * identical pages is worse than no clip. So every candidate route is captured on both
 * sides and compared, and the ones that did not actually change visually are dropped, with
 * the numbers reported so the decision is auditable rather than mysterious.
 *
 * What this needs from the caller is two running instances, one per ref. It does not check
 * out, build, and serve an arbitrary project, because doing that safely for any stack is
 * not a thing a video tool should claim it can do. In practice both instances already
 * exist: a preview deployment and production are exactly this, and so are two local ports.
 * The git refs are used for what git is actually good for here, which is working out which
 * routes are worth looking at in the first place.
 */

export interface ReleaseDiffInput {
  /** The video project, where the captures and the draft manifest land. */
  projectRoot?: string;
  videoName: string;
  /** The product repository, used only to work out which routes changed. */
  repoRoot: string;
  beforeRef: string;
  afterRef: string;
  /** A running instance of each ref. A preview deployment and production are the usual pair. */
  beforeUrl: string;
  afterUrl: string;
  /** Skip route detection and check exactly these. */
  routes?: string[];
  interactions?: Interaction[];
  viewport?: Viewport;
  changedRatioThreshold?: number;
  meanDeltaThreshold?: number;
}

export interface RouteChange {
  route: string;
  changed: boolean;
  reason: string;
  changedRatio: number;
  meanDelta: number;
  beforePath: string;
  afterPath: string;
  diffPath: string;
}

export interface ReleaseDiffResult {
  beforeRef: string;
  afterRef: string;
  routesConsidered: string[];
  changedRoutes: string[];
  routes: RouteChange[];
  /** Draft manifest, written to disk but deliberately NOT installed as the video's beats.json. */
  draftPath: string;
  nextSteps: string[];
}

const REF = /^[A-Za-z0-9._\-/]{1,200}$/;

function sanitizeRef(ref: string): string {
  if (!REF.test(ref) || ref.includes("..")) {
    throw new Error(`"${ref}" is not a usable git ref. Use a branch, tag, or commit sha.`);
  }
  return ref;
}

/** Turns a route into a beat id and a file name. */
export function routeSlug(route: string): string {
  const slug = route.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "home";
}

/**
 * Which routes a diff between two refs could plausibly have changed.
 *
 * Deliberately generous. A changed component under src/components has no route of its own
 * but can repaint every page, so when anything outside the route tree changes, every route
 * becomes a candidate. The visual comparison is what narrows it back down, and it is a far
 * more reliable filter than guessing at an import graph.
 */
export function routesFromDiff(changedFiles: string[], allRoutes: string[]): string[] {
  const changedRoutes = discoverRoutes(changedFiles);
  const touchedShared = changedFiles.some(
    (f) => !/(?:^|\/)(?:src\/)?(?:app|pages)\//.test(f.replace(/\\/g, "/")) && /\.(tsx|jsx|ts|js|css|scss)$/.test(f),
  );
  if (touchedShared) return allRoutes;
  return changedRoutes.length > 0 ? changedRoutes : [];
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
      if (entry.name.startsWith(".")) continue;
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out;
}

/**
 * The draft manifest: a before/after pair per changed route.
 *
 * Both sides are `existing-asset` beats, because that is what they honestly are. The
 * "before" frame cannot be re-captured from a live URL once the release is out, and the
 * "after" frame was captured at a specific ref rather than from whatever is running now.
 * Attribution on each says which ref it came from, which is the point of that field.
 *
 * `vo` is left empty on purpose. Writing the narration is drafting content, this server
 * does not draft content, and PLANNING.md's approval gate exists precisely so a human sees
 * the words before they are spoken over their product. The suggested word count is included
 * so whoever writes them knows what fits.
 */
export function buildDraftManifest(opts: {
  videoName: string;
  beforeRef: string;
  afterRef: string;
  changes: RouteChange[];
  fps: number;
  beatFrames: number;
}): unknown {
  const { beforeRef, afterRef, changes, fps, beatFrames } = opts;
  const seconds = beatFrames / fps;
  const beats: unknown[] = [];
  let start = 0;

  for (const change of changes) {
    const slug = routeSlug(change.route);
    for (const [side, ref, assetPath] of [
      ["before", beforeRef, change.beforePath],
      ["after", afterRef, change.afterPath],
    ] as const) {
      beats.push({
        id: `${slug}-${side}`,
        start,
        duration: beatFrames,
        vo: "",
        visual: {
          captureMethod: "existing-asset",
          assetPath,
          attribution: `${change.route} captured from ${ref}`,
          caption: `${change.route} ${side === "before" ? "before" : "after"} ${ref}`,
        },
      });
      start += beatFrames;
    }
  }

  return {
    fps,
    title: `What changed between ${beforeRef} and ${afterRef}`,
    // Anything reading this file should know it is not finished.
    draft: true,
    suggestedWordsPerBeat: Math.round(seconds * 2.6),
    beats,
  };
}

export async function runReleaseDiff(input: ReleaseDiffInput): Promise<ReleaseDiffResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const repoRoot = path.resolve(input.repoRoot);
  const beforeRef = sanitizeRef(input.beforeRef);
  const afterRef = sanitizeRef(input.afterRef);

  if (!fs.existsSync(repoRoot)) throw new Error(`${repoRoot} does not exist.`);

  const allRoutes = discoverRoutes(listFiles(repoRoot));
  let routes = input.routes?.length ? input.routes : [];
  if (routes.length === 0) {
    const diff = await spawnCapture("git", ["diff", "--name-only", `${beforeRef}..${afterRef}`], repoRoot);
    if (diff.code !== 0) {
      throw new Error(
        `git could not diff ${beforeRef}..${afterRef} in ${repoRoot}:\n${diff.stderr.slice(-600)}\n` +
          `Pass an explicit routes list to skip detection.`,
      );
    }
    routes = routesFromDiff(diff.stdout.split(/\r?\n/).filter(Boolean), allRoutes);
  }
  if (routes.length === 0) {
    throw new Error(
      `Nothing between ${beforeRef} and ${afterRef} touches a route, so there is no UI change to film. ` +
        `That is a real answer: not every release has a visual story. Pass an explicit routes list to ` +
        `check anyway.`,
    );
  }

  const outRel = path.join("public", "images", "release", videoName);
  const outAbs = path.join(projectRoot, outRel);
  fs.mkdirSync(path.join(outAbs, "before"), { recursive: true });
  fs.mkdirSync(path.join(outAbs, "after"), { recursive: true });

  const target = input.viewport ?? DEFAULT_VIEWPORT;
  const changes: RouteChange[] = [];
  const browser = await launchChromium();

  try {
    for (const route of routes) {
      const slug = routeSlug(route);
      const shots: Record<"before" | "after", string> = { before: "", after: "" };

      for (const [side, baseUrl] of [
        ["before", input.beforeUrl],
        ["after", input.afterUrl],
      ] as const) {
        const rel = path.join(outRel, side, `${slug}.png`);
        const page = await browser.newPage();
        try {
          await page.setViewportSize(target);
          await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "networkidle" });
          // Same compensation the normal capture path uses. Without it the two sides can be
          // captured at different effective viewports and every route reads as changed.
          await detectAndCompensateZoom(page, target);
          await replayInteractions(page, input.interactions);
          await page.screenshot({ path: path.join(projectRoot, rel) });
          shots[side] = rel;
        } finally {
          await page.close();
        }
      }

      const diffRel = path.join(outRel, `${slug}.diff.png`);
      const comparison = await compareFrames(
        path.join(projectRoot, shots.before),
        path.join(projectRoot, shots.after),
        { diffPath: path.join(projectRoot, diffRel) },
      );
      const verdict = judgeDrift(comparison, {
        changedRatio: input.changedRatioThreshold,
        meanDelta: input.meanDeltaThreshold,
      });

      changes.push({
        route,
        changed: verdict.drifted,
        reason: verdict.reason,
        changedRatio: comparison.changedRatio,
        meanDelta: comparison.meanDelta,
        beforePath: shots.before,
        afterPath: shots.after,
        diffPath: diffRel,
      });
    }
  } finally {
    await browser.close();
  }

  const changed = changes.filter((c) => c.changed);
  const draftRel = path.join("output", "release", videoName, "beats.draft.json");
  const draftAbs = path.join(projectRoot, draftRel);
  fs.mkdirSync(path.dirname(draftAbs), { recursive: true });
  fs.writeFileSync(
    draftAbs,
    JSON.stringify(
      buildDraftManifest({ videoName, beforeRef, afterRef, changes: changed, fps: 30, beatFrames: 90 }),
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const nextSteps =
    changed.length === 0
      ? [
          `None of the ${changes.length} routes checked actually changed on screen between ${beforeRef} and ` +
            `${afterRef}. This release has no visual story, which is a real answer: a what's-new clip showing ` +
            `four identical pages is worse than no clip.`,
        ]
      : [
          `${changed.length} of ${changes.length} routes changed: ${changed.map((c) => c.route).join(", ")}.`,
          `The draft manifest at ${draftRel} has a before/after pair per route, with every "vo" left empty.`,
          `Write the narration (roughly ${Math.round((90 / 30) * 2.6)} words per beat at this duration), show ` +
            `the full draft to the dev for approval, then write_beats_file. This tool does not draft the ` +
            `script and does not install the manifest.`,
          `Then scaffold_scene each beat, stitch_composition, and render_video with incremental: true.`,
        ];

  return {
    beforeRef,
    afterRef,
    routesConsidered: routes,
    changedRoutes: changed.map((c) => c.route),
    routes: changes,
    draftPath: draftRel,
    nextSteps,
  };
}

export function registerReleaseDiff(server: McpServer): void {
  server.registerTool(
    "release_diff",
    {
      title: "Two refs in, a what's-new clip's manifest out",
      description:
        "Works out which UI surfaces changed between two releases, captures each on both sides, drops the " +
        "ones that did not actually change on screen, and drafts a before/after manifest for a what's-new " +
        "clip. This is the change that turns one demo video per project into one per release. The filtering " +
        "is the important half: a release is mostly dependency bumps and refactors, and a clip showing four " +
        "identical pages is worse than no clip, so every candidate route is compared and the numbers are " +
        "reported. Route detection uses git: a changed file under app/ or pages/ names its own route, and a " +
        "change anywhere else in the source makes every route a candidate, since a shared component can " +
        "repaint all of them. It needs a running instance per ref (a preview deployment and production are " +
        "exactly this pair, and so are two local ports): it will not check out, build, and serve an " +
        "arbitrary project, because doing that safely for any stack is not something a video tool should " +
        "claim. The draft is written to output/release/<videoName>/beats.draft.json and is deliberately not " +
        "installed as the video's beats.json, with every `vo` left empty: writing narration is drafting " +
        "content, and the approval gate exists so a human sees the words before they are spoken over their " +
        "product.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        repoRoot: z.string().min(1).describe("The product repository, used only for route detection."),
        beforeRef: z.string().min(1),
        afterRef: z.string().min(1),
        beforeUrl: z.string().url().describe("A running instance of beforeRef."),
        afterUrl: z.string().url().describe("A running instance of afterRef."),
        routes: z.array(z.string()).optional().describe("Skip detection and check exactly these."),
        interactions: z.array(interactionSchema).optional(),
        viewport: viewportSchema.optional(),
        changedRatioThreshold: z.number().positive().optional(),
        meanDeltaThreshold: z.number().positive().optional(),
      },
    },
    async (input) => runTool("release_diff", () => runReleaseDiff(input)),
  );
}

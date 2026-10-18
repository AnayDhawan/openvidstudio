import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TEMPLATE_DIR, DOCS_DIR } from "../paths";
import { configPath, writeConfig, type OpenvidstudioConfig, type ProductionMode, type VideoConfig } from "../config";
import { resolveProjectRoot, sanitizeSegment, copyTemplateTree } from "../util";
import {
  PREFLIGHT_BENCHMARK_COMPOSITION_ID,
  PREFLIGHT_BENCHMARK_VIDEO_NAME,
  readRegistry,
  renderRootTsx,
  writeRegistry,
} from "./stitchComposition";
import { runTool } from "./mcp";

export interface InitProjectInput {
  name: string;
  projectRoot?: string;
  targetDurationSeconds?: number;
  hasHiggsfield?: boolean;
  videoConfig?: Partial<VideoConfig>;
  appUrl?: string;
  demo?: boolean;
  /**
   * "standard" (the default) or "supernova", a STEM lesson. A supernova project also gets
   * @openvidstudio/stem (vendored, with its display font), is stored as production.mode, and
   * defaults to a 1080x1920 frame. A standard project's files and config do not change at all.
   */
  mode?: ProductionMode;
}

export interface InitProjectResult {
  projectRoot: string;
  videoDir: string;
  configPath: string;
  templateShellCopied: boolean;
  docsDir: string;
  config: OpenvidstudioConfig;
  demo: boolean;
  nextSteps: string[];
  runtime: { node: string; pnpm: string | null; warnings: string[] };
}

const STEM_DIR = "openvidstudio-stem";
const STEM_DEPENDENCY = "@openvidstudio/stem";
const SUPERNOVA_VIDEO_CONFIG: VideoConfig = { fps: 30, width: 1080, height: 1920 };

/** Adds or removes the stem dependency in the project's package.json, leaving the rest as it is. */
function setStemDependency(projectRoot: string, present: boolean): void {
  const file = path.join(projectRoot, "package.json");
  if (!fs.existsSync(file)) return;
  const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { dependencies?: Record<string, string> };
  const has = pkg.dependencies !== undefined && STEM_DEPENDENCY in pkg.dependencies;
  if (present === has) return;
  pkg.dependencies = pkg.dependencies ?? {};
  if (present) pkg.dependencies[STEM_DEPENDENCY] = `file:./${STEM_DIR}`;
  else delete pkg.dependencies[STEM_DEPENDENCY];
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

/**
 * Makes @openvidstudio/stem importable from a supernova project: the vendored package, the
 * dependency on it, and its display font in public/fonts/ (where the project's local font loader
 * looks). Safe on a project that already has any of them.
 */
function installStem(projectRoot: string): void {
  copyTemplateTree(path.join(TEMPLATE_DIR, STEM_DIR), path.join(projectRoot, STEM_DIR));
  setStemDependency(projectRoot, true);
  const fonts = path.join(projectRoot, STEM_DIR, "public", "fonts");
  if (fs.existsSync(fonts)) copyTemplateTree(fonts, path.join(projectRoot, "public", "fonts"));
}

/**
 * Scaffolds `src/videos/<name>/` in `projectRoot`, copying the bundled project shell
 * (package.json, tsconfig, remotion.config.ts, Root.tsx, public/sfx/, the vendored
 * openvidstudio-core/ -- everything in TEMPLATE_DIR) into the project root on first
 * use, copying the bundled pipeline docs (PLANNING.md, PIPELINE.md, STYLE.md,
 * CAPTURE.md, SCRIPT.md, OVERVIEW.md, HIGGSFIELD.md -- everything in DOCS_DIR) into
 * `<projectRoot>/docs/`, then writing/merging openvidstudio.config.json.
 *
 * `TEMPLATE_DIR`/`DOCS_DIR` (src/paths.ts) resolve relative to this package's own
 * compiled dist/ output, i.e. the copies bundled into packages/mcp-server/templates/
 * and packages/mcp-server/docs/ at build time -- never a monorepo-relative path,
 * which would not exist once this package is installed standalone in someone else's
 * project (see task-3-report.md for how that's verified).
 */
export function runInitProject(input: InitProjectInput): InitProjectResult {
  const name = sanitizeSegment(input.name, "name");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  fs.mkdirSync(projectRoot, { recursive: true });

  // copyTemplateTree never overwrites a file that's already there, so this is safe to
  // call again for a second video in an already-scaffolded project.
  const alreadyScaffolded = fs.existsSync(path.join(projectRoot, "package.json"));
  const supernova = input.mode === "supernova";
  const configExisted = fs.existsSync(configPath(projectRoot));
  // The vendored stem package is part of the bundled shell but belongs only to supernova projects.
  copyTemplateTree(TEMPLATE_DIR, projectRoot, supernova ? undefined : (rel) => rel === STEM_DIR);
  if (supernova) installStem(projectRoot);
  else if (!alreadyScaffolded) setStemDependency(projectRoot, false);

  const docsDir = path.join(projectRoot, "docs");
  copyTemplateTree(DOCS_DIR, docsDir);

  const videoDir = path.join(projectRoot, "src", "videos", name);
  fs.mkdirSync(path.join(videoDir, "scenes"), { recursive: true });

  // Seeds preflight's render-benchmark composition into the registry (idempotent: a
  // second init_project call, or one against an already-scaffolded project, just finds
  // the entry already there and does nothing). This is what lets preflight time a real
  // render before any real video has been planned or stitched -- Root.tsx otherwise stays
  // `return null;` (the bare template) until the first stitch_composition call.
  const registry = readRegistry(projectRoot);
  if (!registry.some((e) => e.videoName === PREFLIGHT_BENCHMARK_VIDEO_NAME)) {
    registry.push({
      id: PREFLIGHT_BENCHMARK_COMPOSITION_ID,
      videoName: PREFLIGHT_BENCHMARK_VIDEO_NAME,
      componentName: "PreflightBenchmark",
      importPath: "./PreflightBenchmark",
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    });
    writeRegistry(projectRoot, registry);
    fs.writeFileSync(
      path.join(projectRoot, "src", "Root.tsx"),
      renderRootTsx(registry, fs.existsSync(path.join(projectRoot, "src", "brand.ts"))),
      "utf8",
    );
  }

  const config = writeConfig(projectRoot, {
    hasHiggsfield: input.hasHiggsfield,
    targetDurationSeconds: input.targetDurationSeconds,
    // A lesson is a vertical video unless the caller (or an existing config) says otherwise.
    videoConfig: input.videoConfig ?? (supernova && !configExisted ? { ...SUPERNOVA_VIDEO_CONFIG } : undefined),
    capture: input.appUrl ? { appUrl: input.appUrl } : undefined,
    production: supernova ? { mode: "supernova" } : undefined,
  });

  // A demo project ships a ready beats.json so the very next call can be
  // scaffold_scene. Without it a new user has nothing to run and no worked example
  // to copy, and any failure in ffmpeg or capture surfaces several steps later.
  const nextSteps: string[] = [];
  if (input.demo) {
    const fps = config.videoConfig.fps;
    const url = config.capture.appUrl;
    const demoBeats = {
      fps,
      title: `${name} demo`,
      beats: [
        {
          id: "hook",
          start: 0,
          duration: fps * 6,
          visual: {
            captureMethod: "screenshot",
            url,
            interactions: [{ type: "wait", ms: config.capture.settleMs }],
            description: "The app's own first screen, camera pushing in.",
          },
          vo: "This is the app, captured from the real thing rather than described to a model.",
        },
        {
          id: "cta",
          start: fps * 6,
          duration: fps * 5,
          visual: { captureMethod: "dom-demo", description: "Repo call to action." },
          vo: "Built with openvidstudio, which turns a running app into a demo video.",
        },
      ],
    };
    fs.writeFileSync(
      path.join(videoDir, "beats.json"),
      JSON.stringify(demoBeats, null, 2) + "\n",
      "utf8",
    );
    nextSteps.push(
      `A two beat, 11 second beats.json is ready at src/videos/${name}/beats.json.`,
      `Next: capture_screenshot for the "hook" beat against ${url},`,
      `then scaffold_scene for both beats, then stitch_composition, then render_video with draft: true.`,
      `That whole path should take about two minutes and proves the install works end to end.`,
    );
  }

  return {
    projectRoot,
    videoDir,
    configPath: path.join(projectRoot, "openvidstudio.config.json"),
    templateShellCopied: !alreadyScaffolded,
    docsDir,
    config,
    demo: Boolean(input.demo),
    nextSteps,
    runtime: {
      node: process.version,
      pnpm: process.env.npm_config_user_agent?.match(/pnpm\/(\S+)/)?.[1] ?? null,
      warnings: Number.parseInt(process.versions.node, 10) < 20 ? ["Node 20 or newer is supported."] : [],
    },
  };
}

export function registerInitProject(server: McpServer): void {
  server.registerTool(
    "init_project",
    {
      title: "Initialize an openvidstudio project",
      description:
        "Scaffolds a video's src/videos/<name>/ directory in the calling agent's current project " +
        "(process.cwd() unless projectRoot is given). On first use also copies the bundled openvidstudio " +
        "project shell (package.json, tsconfig.json, remotion.config.ts, src/Root.tsx, src/index.ts, " +
        "public/sfx/, a vendored openvidstudio-core/ that the shell's package.json depends on via a " +
        "relative file: reference) into the project root, copies the bundled pipeline docs (PLANNING.md, " +
        "PIPELINE.md, STYLE.md, CAPTURE.md, SCRIPT.md, OVERVIEW.md, HIGGSFIELD.md) into <projectRoot>/docs/, " +
        "and writes/merges openvidstudio.config.json there (merges field-by-field, never clobbers a value " +
        "the patch doesn't mention). Never overwrites a file that already exists, so calling this again for " +
        "a second video in the same project is safe. Pass demo: true to also write a ready two beat " +
        "beats.json, so the next call can be capture_screenshot and a new user reaches a rendered video in " +
        "about two minutes instead of authoring a beats file first. Only `name` is required; duration, fps, " +
        "dimensions, capture viewport and the settle delay before a screenshot all have defaults that work.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("Video name: letters, numbers, '-', or '_'. Used for src/videos/<name>/."),
        projectRoot: z
          .string()
          .optional()
          .describe("Absolute path to the target project root. Defaults to process.cwd()."),
        targetDurationSeconds: z.number().positive().optional(),
        hasHiggsfield: z.boolean().optional(),
        appUrl: z
          .string()
          .optional()
          .describe("The running app to film. Stored as capture.appUrl and used as the default for captures."),
        demo: z
          .boolean()
          .optional()
          .describe("Also write a ready two beat beats.json, as a two minute end to end smoke test."),
        mode: z
          .enum(["standard", "supernova"])
          .optional()
          .describe(
            "\"standard\" (default) or \"supernova\", a STEM lesson: also installs @openvidstudio/stem and its " +
              "display font, records production.mode, and defaults the frame to 1080x1920.",
          ),
        videoConfig: z
          .object({
            fps: z.number().positive().optional(),
            width: z.number().positive().optional(),
            height: z.number().positive().optional(),
          })
          .optional(),
      },
    },
    async (input) => runTool("init_project", () => runInitProject(input)),
  );
}

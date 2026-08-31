import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TEMPLATE_DIR, DOCS_DIR } from "../paths";
import { writeConfig, type OpenvidstudioConfig, type VideoConfig } from "../config";
import { resolveProjectRoot, sanitizeSegment, copyTemplateTree } from "../util";
import { runTool } from "./mcp";

export interface InitProjectInput {
  name: string;
  projectRoot?: string;
  targetDurationSeconds?: number;
  hasHiggsfield?: boolean;
  videoConfig?: Partial<VideoConfig>;
}

export interface InitProjectResult {
  projectRoot: string;
  videoDir: string;
  configPath: string;
  templateShellCopied: boolean;
  docsDir: string;
  config: OpenvidstudioConfig;
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
  copyTemplateTree(TEMPLATE_DIR, projectRoot);

  const docsDir = path.join(projectRoot, "docs");
  copyTemplateTree(DOCS_DIR, docsDir);

  const videoDir = path.join(projectRoot, "src", "videos", name);
  fs.mkdirSync(path.join(videoDir, "scenes"), { recursive: true });

  const config = writeConfig(projectRoot, {
    hasHiggsfield: input.hasHiggsfield,
    targetDurationSeconds: input.targetDurationSeconds,
    videoConfig: input.videoConfig,
  });

  return {
    projectRoot,
    videoDir,
    configPath: path.join(projectRoot, "openvidstudio.config.json"),
    templateShellCopied: !alreadyScaffolded,
    docsDir,
    config,
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
        "a second video in the same project is safe.",
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

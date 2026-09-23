import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath } from "../util";
import { runTool } from "./mcp";
import { MOTION_PRIMITIVES, findMotionPrimitive, searchMotionPrimitives } from "../primitives/registry";

/**
 * A searchable catalog of small, tested motion primitives, and a way to drop one's real
 * source into a project. See registry.ts for why this exists: scaffold_scene's 10
 * templates are whole scenes, and below that level there was nothing reusable, so every
 * count-up number or fanned card layout got hand-derived from motion.ts's tween/pop math
 * again for every beat that wanted one.
 */

export interface CatalogMotionPrimitivesInput {
  /** Free-text search over name/title/description/keywords. Omit to browse the whole catalog. */
  query?: string;
  limit?: number;
}

export interface CatalogedPrimitive {
  name: string;
  title: string;
  description: string;
  keywords: string[];
  componentName: string;
}

export interface CatalogMotionPrimitivesResult {
  query: string;
  matchedQuery: boolean;
  total: number;
  primitives: CatalogedPrimitive[];
}

export function runCatalogMotionPrimitives(input: CatalogMotionPrimitivesInput): CatalogMotionPrimitivesResult {
  const limit = input.limit && input.limit > 0 ? input.limit : 10;
  const matches = searchMotionPrimitives(input.query, limit);
  return {
    query: input.query ?? "",
    matchedQuery: Boolean(input.query) && matches.length > 0,
    total: MOTION_PRIMITIVES.length,
    primitives: matches.map(({ primitive }) => ({
      name: primitive.name,
      title: primitive.title,
      description: primitive.description,
      keywords: primitive.keywords,
      componentName: primitive.componentName,
    })),
  };
}

export function registerCatalogMotionPrimitives(server: McpServer): void {
  server.registerTool(
    "catalog_motion_primitives",
    {
      title: "Search the motion primitives catalog",
      description:
        "Searches a small, bundled catalog of reusable motion primitives (a count-up stat card, a fanned " +
        "card stack, a logo outro, a typewriter line, a beat-timeline strip) by free-text query over each " +
        "primitive's name/title/description/keywords. No query returns the whole catalog, for browsing. " +
        "Local and bundled: no network call, no hosted registry, no account. Returns { query, matchedQuery, " +
        "total, primitives: [{ name, title, description, keywords, componentName }] } ranked best match " +
        "first. Pass a primitive's `name` to add_motion_primitive to write its real source into the project.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (input) => runTool("catalog_motion_primitives", () => runCatalogMotionPrimitives(input)),
  );
}

export interface AddMotionPrimitiveInput {
  projectRoot?: string;
  videoName: string;
  /** The catalog entry's `name`, as returned by catalog_motion_primitives. */
  name: string;
  outPath?: string;
  overwrite?: boolean;
}

export interface AddMotionPrimitiveResult {
  written: true;
  path: string;
  name: string;
  componentName: string;
  /** A ready-to-paste relative import, for the scene that will use this primitive. */
  importHint: string;
}

export function runAddMotionPrimitive(input: AddMotionPrimitiveInput): AddMotionPrimitiveResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const primitive = findMotionPrimitive(input.name);
  if (!primitive) {
    const known = MOTION_PRIMITIVES.map((p) => p.name).join(", ");
    throw new Error(`No motion primitive named "${input.name}". Known primitives: ${known}.`);
  }

  const primitivesDir = path.join(projectRoot, "src", "videos", videoName, "primitives");
  if (input.outPath) sanitizeRelativeOutPath(projectRoot, input.outPath, "outPath");
  const filePath = input.outPath
    ? path.join(projectRoot, input.outPath)
    : path.join(primitivesDir, `${primitive.componentName}.tsx`);

  if (fs.existsSync(filePath) && !input.overwrite) {
    throw new Error(
      `${filePath} already exists. Pass overwrite: true to replace a copy the calling agent or dev has ` +
        `already started editing.`,
    );
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, primitive.source, "utf8");

  const importRel = path
    .relative(path.join(projectRoot, "src", "videos", videoName, "scenes"), filePath)
    .replace(/\\/g, "/")
    .replace(/\.tsx$/, "");

  return {
    written: true,
    path: filePath,
    name: primitive.name,
    componentName: primitive.componentName,
    importHint: `import { ${primitive.componentName} } from "${importRel.startsWith(".") ? importRel : `./${importRel}`}";`,
  };
}

export function registerAddMotionPrimitive(server: McpServer): void {
  server.registerTool(
    "add_motion_primitive",
    {
      title: "Copy a catalog motion primitive's source into the project",
      description:
        "Writes the named catalog entry's real .tsx source (found via catalog_motion_primitives) to " +
        "src/videos/<videoName>/primitives/<ComponentName>.tsx by default, so it can be imported into a " +
        "scaffolded or hand-written scene and used as-is or edited freely -- it is your copy, not a live " +
        "reference back to the catalog. Every primitive uses only \"react\", \"remotion\" and " +
        "\"@openvidstudio/core\", the same constraint scaffold_scene's own templates follow, so it drops in " +
        "with no extra dependency. Refuses to overwrite an existing file unless overwrite: true. Returns " +
        "{ written, path, name, componentName, importHint } -- importHint is a ready-to-paste relative " +
        "import for a scene living in the video's scenes/ directory.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        name: z.string().min(1).describe("The catalog entry's name, e.g. \"count-up-stat\" (see catalog_motion_primitives)."),
        outPath: z.string().optional().describe("Override the default src/videos/<videoName>/primitives/<ComponentName>.tsx path."),
        overwrite: z.boolean().optional(),
      },
    },
    async (input) => runTool("add_motion_primitive", () => runAddMotionPrimitive(input)),
  );
}

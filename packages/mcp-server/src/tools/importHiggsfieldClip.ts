import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath } from "../util";
import { runTool } from "./mcp";

/**
 * `import_higgsfield_clip` does NOT call Higgsfield itself. See HIGGSFIELD.md and
 * task-5-report.md for why: an MCP server has no clean, spec-supported way to reach into
 * a *different*, already-authorized MCP connection the calling agent holds (Higgsfield's,
 * in this case) -- there is no server-to-server tool-call primitive in the protocol, only
 * sampling/elicitation/roots as server-to-client requests. The calling agent already has
 * its own Higgsfield MCP connection and calls generate_video/jobs_wait on it directly;
 * this tool's only job is taking whatever result that produced (a URL or a local file
 * path) and landing it at this project's own asset-path convention.
 */
export type HiggsfieldClipSource = { type: "url"; url: string } | { type: "path"; path: string };

export interface ImportHiggsfieldClipInput {
  projectRoot?: string;
  beatId: string;
  source: HiggsfieldClipSource;
  outPath?: string;
}

export interface ImportHiggsfieldClipResult {
  outPath: string;
  beatId: string;
}

/** Injectable so tests can supply a fake fetch instead of hitting a real network. */
export interface ImportHiggsfieldClipDeps {
  fetchImpl?: typeof fetch;
}

async function fetchToBuffer(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new Error(`Failed to fetch source URL "${url}": ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`Source URL "${url}" returned ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function readLocalFile(sourcePath: string): Buffer {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source path "${sourcePath}" does not exist.`);
  }
  if (!fs.statSync(sourcePath).isFile()) {
    throw new Error(`Source path "${sourcePath}" is not a file.`);
  }
  return fs.readFileSync(sourcePath);
}

/**
 * Fetches or copies `input.source` into public/video/<beatId>.mp4 under projectRoot --
 * the same convention capture_screen_recording and scaffold_scene's higgsfield-clip kind
 * use, so a scaffolded higgsfield-clip scene's <OffthreadVideo src=...> finds the asset
 * regardless of which tool produced it. Never reimplements video generation: the bytes
 * are trusted as-is from whichever source the calling agent already produced.
 */
export async function runImportHiggsfieldClip(
  input: ImportHiggsfieldClipInput,
  deps: ImportHiggsfieldClipDeps = {},
): Promise<ImportHiggsfieldClipResult> {
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const outPathRel = input.outPath ?? path.join("public", "video", `${beatId}.mp4`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const outPathAbs = path.join(projectRoot, outPathRel);

  const buffer =
    input.source.type === "url"
      ? await fetchToBuffer(input.source.url, deps.fetchImpl ?? fetch)
      : readLocalFile(input.source.path);

  fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });
  fs.writeFileSync(outPathAbs, buffer);

  return { outPath: outPathAbs, beatId };
}

const sourceSchema = z.union([
  z.object({ type: z.literal("url"), url: z.string().min(1) }),
  z.object({ type: z.literal("path"), path: z.string().min(1) }),
]);

export function registerImportHiggsfieldClip(server: McpServer): void {
  server.registerTool(
    "import_higgsfield_clip",
    {
      title: "Import an already-generated Higgsfield clip into this project's asset convention",
      description:
        "Only registered when openvidstudio.config.json has hasHiggsfield: true. Does NOT call Higgsfield's " +
        "generate_video/jobs_wait tools itself -- MCP servers have no server-to-server tool-call mechanism, " +
        "so the calling agent must call those on its own already-authorized Higgsfield MCP connection first, " +
        "then hand this tool the result. Accepts either a downloadable URL or a local file path, fetches/reads " +
        "it, and writes the bytes to public/video/<beatId>.mp4 under projectRoot (default outPath override " +
        "available for non-default layouts), matching capture_screen_recording's and scaffold_scene's " +
        "higgsfield-clip convention exactly. Returns { outPath, beatId } on success; a structured error " +
        "(never an uncaught throw) on a bad URL, a missing local file, or a failed download.",
      inputSchema: {
        projectRoot: z.string().optional(),
        beatId: z.string().min(1),
        source: sourceSchema,
        outPath: z.string().optional(),
      },
    },
    async (input) => runTool("import_higgsfield_clip", () => runImportHiggsfieldClip(input)),
  );
}

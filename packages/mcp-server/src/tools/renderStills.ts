import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath } from "../util";
import { readRegistry } from "./stitchComposition";
import {
  bundleProject,
  openRenderBrowser,
  renderStillPng,
  resolveComposition,
  type ResolvedComposition,
} from "../remotionBridge";
import type { HeadlessBrowser } from "@remotion/renderer";
import { runTool } from "./mcp";

/**
 * A fast QC loop: render a handful of representative frames (not a full video) so an
 * agent can actually SEE a scene without waiting for a full ffmpeg encode.
 *
 * The speed comes entirely from bundling once: `bundle()` (webpack under the hood) is the
 * slow part of a `remotion still`/`remotion render` CLI invocation, and that CLI re-bundles
 * on every single call. This tool calls it exactly once per tool call, then calls
 * `selectComposition`/`renderStill` (also @remotion/renderer's own public API) once per
 * requested still against that one bundle -- see packages/mcp-server/src/remotionBridge.ts,
 * ported from this repo's reference/scripts/stills.mjs. It also reuses one opened browser
 * (via @remotion/renderer's `puppeteerInstance` option) across every still in the call, so
 * neither the bundle nor the browser launch is repeated per beat.
 */

export interface RenderStillsInput {
  projectRoot?: string;
  videoName: string;
  /** Omit for every beat in this video's composition. */
  beatIds?: string[];
  /**
   * Which frame within each beat to render. "mid" (default) is that beat's own midpoint;
   * "start"/"end" are the beat's first/last frame; a number is an explicit frame offset
   * relative to the beat's own start (clamped into the beat's own duration).
   */
  at?: "start" | "mid" | "end" | number;
  /** Overrides the composition id resolved from src/videos/.registry.json. */
  compositionId?: string;
  /** Overrides the default output/stills/<videoName>/ directory. */
  outDir?: string;
  /** Output resolution multiplier, same meaning as Remotion's own --scale. Defaults to 1. */
  scale?: number;
}

export interface RenderStillOutput {
  beatId: string;
  /** Global frame number against the whole stitched composition. */
  frame: number;
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export interface RenderStillsResult {
  compositionId: string;
  stills: RenderStillOutput[];
  /** How long the one-time bundle step took. This is the cost render_stills amortizes. */
  bundleMs: number;
  /** How long rendering every requested still took, from the SAME bundle. */
  renderMs: number;
  totalMs: number;
}

interface BeatLike {
  id: string;
  start: number;
  duration: number;
}

/** Pure, unit-testable: resolves which global frame a beat's representative still is at. */
export function resolveBeatFrame(beat: BeatLike, at: RenderStillsInput["at"]): number {
  const duration = Math.max(1, beat.duration);
  if (typeof at === "number") {
    const offset = Math.min(Math.max(0, Math.round(at)), duration - 1);
    return beat.start + offset;
  }
  if (at === "start") return beat.start;
  if (at === "end") return beat.start + duration - 1;
  return beat.start + Math.floor(duration / 2);
}

function resolveCompositionId(projectRoot: string, videoName: string, override?: string): string {
  if (override) return override;
  const entry = readRegistry(projectRoot).find((e) => e.videoName === videoName);
  if (!entry) {
    throw new Error(
      `No composition registered for video "${videoName}" in src/videos/.registry.json. Run ` +
        `stitch_composition for this video first, or pass compositionId explicitly.`,
    );
  }
  return entry.id;
}

export async function runRenderStills(input: RenderStillsInput): Promise<RenderStillsResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const beatsFile = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsFile)) {
    throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { beats?: BeatLike[] };
  const allBeats = doc.beats ?? [];
  if (allBeats.length === 0) {
    throw new Error(`${beatsFile} has no beats.`);
  }

  let beats = allBeats;
  if (input.beatIds && input.beatIds.length > 0) {
    const known = new Set(allBeats.map((b) => b.id));
    const unknown = input.beatIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`beatIds not found in beats.json: ${unknown.join(", ")}`);
    }
    const wanted = new Set(input.beatIds);
    beats = allBeats.filter((b) => wanted.has(b.id));
  }

  const compositionId = resolveCompositionId(projectRoot, videoName, input.compositionId);

  const outDirRel = input.outDir ?? path.join("output", "stills", videoName);
  sanitizeRelativeOutPath(projectRoot, outDirRel, "outDir");
  const outDirAbs = path.join(projectRoot, outDirRel);

  const bundleStarted = Date.now();
  const serveUrl = await bundleProject(projectRoot);
  const bundleMs = Date.now() - bundleStarted;

  let browser: HeadlessBrowser | null = null;
  const renderStarted = Date.now();
  try {
    browser = await openRenderBrowser();
    const composition: ResolvedComposition = await resolveComposition(serveUrl, compositionId, browser);

    const stills: RenderStillOutput[] = [];
    for (const beat of beats) {
      const frame = resolveBeatFrame(beat, input.at);
      const outPath = path.join(outDirAbs, `${beat.id}.png`);
      const result = await renderStillPng({
        serveUrl,
        composition,
        frame,
        outPath,
        browser,
        scale: input.scale,
      });
      stills.push({ beatId: beat.id, frame, path: result.outPath, width: result.width, height: result.height, bytes: result.bytes });
    }

    const renderMs = Date.now() - renderStarted;
    return { compositionId, stills, bundleMs, renderMs, totalMs: bundleMs + renderMs };
  } finally {
    if (browser) await browser.close({ silent: true });
  }
}

export function registerRenderStills(server: McpServer): void {
  server.registerTool(
    "render_stills",
    {
      title: "Render representative frames without a full video encode",
      description:
        "Fast QC loop: renders one real frame per beat (default: that beat's own midpoint) so an agent can " +
        "actually see a scene without waiting for a full ffmpeg encode of the whole composition. The speed " +
        "comes from bundling the project with @remotion/bundler exactly once per call and reusing that one " +
        "bundle plus one headless browser for every still (@remotion/renderer's own selectComposition/" +
        "renderStill, the same public SSR API `remotion still` itself wraps) -- a full `remotion still` CLI " +
        "invocation re-bundles on every single call, which is the slow part this avoids. Omit beatIds to " +
        "render every beat in the video; pass `at` (\"start\"/\"mid\"/\"end\", default \"mid\", or an explicit " +
        "frame offset relative to the beat's own start) to pick a different point within each beat. The " +
        "composition id is resolved from src/videos/.registry.json (written by stitch_composition) unless " +
        "overridden. Writes PNGs to output/stills/<videoName>/<beatId>.png by default (gitignored QC output, " +
        "same convention as contact_sheet/qc_extract_frames, not shipped media). Returns { compositionId, " +
        "stills: [{beatId, frame, path, width, height, bytes}], bundleMs, renderMs, totalMs } -- width/" +
        "height/bytes are measured from the real file written, not assumed, so a near-empty render is " +
        "visible in the result rather than silently reported as success.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        beatIds: z.array(z.string()).optional(),
        at: z.union([z.enum(["start", "mid", "end"]), z.number().int().nonnegative()]).optional(),
        compositionId: z.string().optional(),
        outDir: z.string().optional(),
        scale: z.number().positive().optional(),
      },
    },
    async (input) => runTool("render_stills", () => runRenderStills(input)),
  );
}

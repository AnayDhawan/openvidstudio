import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import sharp from "sharp";
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
import type { SceneFinding } from "./validateScenes";
import { readTypeMinimums, runRenderChecks } from "./validateScenesRender";

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
 *
 * It is the review loop's instrument: author a scene, render stills, look (or read the
 * numbers), fix, repeat. So beyond single frames it can sample several frames per beat
 * including both sides of every cut, tile them into one labelled contact grid an agent can
 * judge in a single image, and return the same numeric measurements validate_scenes makes
 * for an agent that cannot see images.
 */

/** Sample positions inside a beat, as a fraction of its length, for `perBeat: "review"`. */
const REVIEW_POSITIONS = [0, 0.25, 0.5, 0.75, 1];
/** Frames inset from a beat's edges in review mode, so the shot straddles the cut rather than sitting on it. */
const REVIEW_EDGE_INSET = 3;

const GRID_TILE_WIDTH = 480;
const MAX_PER_BEAT = 12;

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
  /**
   * Render this many stills per beat, spread from start to end. 1 is the midpoint, 2 is start
   * and end, 3 adds the middle, more are evenly spaced. "review" renders five per beat with the
   * first and last pulled 3 frames inside the beat, so consecutive beats' stills show both
   * sides of the cut between them. Overrides `at`.
   */
  perBeat?: number | "review";
  /**
   * Render exactly these frames, as global frame numbers against the whole composition, instead
   * of sampling beats. Overrides `at`, `perBeat` and `beatIds`.
   */
  frames?: number[];
  /** Overrides the composition id resolved from src/videos/.registry.json. */
  compositionId?: string;
  /** Overrides the default output/stills/<videoName>/ directory. */
  outDir?: string;
  /** Review round. Stills go to a round-<n> subfolder, so each round's grid is kept for comparison. */
  round?: number | string;
  /** Output resolution multiplier, same meaning as Remotion's own --scale. Defaults to 1. */
  scale?: number;
  /** Tile every still into one labelled contact-grid PNG. Defaults to true when there is more than one still. */
  contactGrid?: boolean;
  /**
   * Also return validate_scenes's numeric render findings for the same beats (cropping, size,
   * reading time, contrast, em dashes, safe area, HUD overlap, dead frames), so an agent that
   * cannot view images can still review. Reuses this call's bundle. Defaults to true.
   */
  findings?: boolean;
}

export interface RenderStillOutput {
  beatId: string;
  /** Global frame number against the whole stitched composition. */
  frame: number;
  /** Frame offset from the start of the beat. */
  offset: number;
  /** Human-readable position, for example "start+3" or "mid". Also the tile label in the contact grid. */
  position: string;
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ContactGridOutput {
  path: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  tiles: number;
}

export interface RenderStillsResult {
  compositionId: string;
  stills: RenderStillOutput[];
  /** Present when more than one still was rendered, or contactGrid was true. */
  contactGrid?: ContactGridOutput;
  /** Numeric render findings for the rendered beats, unless findings was false. */
  findings?: SceneFinding[];
  /** Beats the numeric findings could not measure, and why. A skipped beat is never "clean". */
  findingsSkipped?: { beatId: string; reason: string }[];
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

export interface PlannedStill {
  beatId: string;
  frame: number;
  offset: number;
  position: string;
}

/**
 * Pure: which frames of a beat to render. Offsets are clamped into the beat and deduplicated,
 * so a very short beat yields fewer stills rather than the same frame twice.
 */
export function planBeatStills(beat: BeatLike, perBeat: number | "review"): PlannedStill[] {
  const duration = Math.max(1, beat.duration);
  const last = duration - 1;
  const clamp = (n: number) => Math.min(Math.max(0, Math.round(n)), last);
  let picks: { offset: number; position: string }[];

  if (perBeat === "review") {
    picks = REVIEW_POSITIONS.map((p, i) => {
      if (i === 0) return { offset: clamp(REVIEW_EDGE_INSET), position: `start+${clamp(REVIEW_EDGE_INSET)}` };
      if (i === REVIEW_POSITIONS.length - 1) return { offset: clamp(last - REVIEW_EDGE_INSET), position: `end-${Math.min(REVIEW_EDGE_INSET, last)}` };
      return { offset: clamp(last * p), position: p === 0.5 ? "mid" : `${Math.round(p * 100)}%` };
    });
  } else if (perBeat <= 1) {
    picks = [{ offset: Math.floor(duration / 2), position: "mid" }];
  } else {
    picks = Array.from({ length: perBeat }, (_, i) => {
      const fraction = i / (perBeat - 1);
      const offset = clamp(last * fraction);
      const position = i === 0 ? "start" : i === perBeat - 1 ? "end" : fraction === 0.5 ? "mid" : `${Math.round(fraction * 100)}%`;
      return { offset, position };
    });
  }

  const seen = new Set<number>();
  const out: PlannedStill[] = [];
  for (const p of picks) {
    if (seen.has(p.offset)) continue;
    seen.add(p.offset);
    out.push({ beatId: beat.id, frame: beat.start + p.offset, offset: p.offset, position: p.position });
  }
  return out;
}

/** Pure: the beat a global frame belongs to, and its offset into it. Frames past the end clamp to the last beat. */
export function locateFrame(beats: BeatLike[], frame: number): { beat: BeatLike; offset: number } {
  const sorted = [...beats].sort((a, b) => a.start - b.start);
  const hit = sorted.find((b) => frame >= b.start && frame < b.start + b.duration) ?? sorted[sorted.length - 1]!;
  return { beat: hit, offset: Math.min(Math.max(0, frame - hit.start), Math.max(0, hit.duration - 1)) };
}

export function resolveCompositionId(projectRoot: string, videoName: string, override?: string): string {
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

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Tiles rendered stills into one labelled PNG. A beat's stills share a row when perBeat was
 * used, so reading across is time within a beat and reading down is the cut from one beat to
 * the next; otherwise tiles fill rows of up to four. Each tile carries its beat id and
 * position in a bar along its top edge, drawn as SVG so no font file has to be installed.
 */
export async function buildContactGrid(
  stills: Pick<RenderStillOutput, "beatId" | "path" | "position" | "offset" | "frame">[],
  outPath: string,
  opts: { columns?: number } = {},
): Promise<ContactGridOutput> {
  if (stills.length === 0) throw new Error("buildContactGrid needs at least one still.");
  const first = await sharp(stills[0]!.path).metadata();
  const aspect = (first.height ?? 1080) / (first.width ?? 1920);
  const tileW = GRID_TILE_WIDTH;
  const tileH = Math.round(tileW * aspect);
  const gap = 6;

  // One row per beat when every beat has the same number of stills, which is what perBeat gives.
  const perBeatCounts = new Map<string, number>();
  for (const s of stills) perBeatCounts.set(s.beatId, (perBeatCounts.get(s.beatId) ?? 0) + 1);
  const counts = new Set(perBeatCounts.values());
  const rowPerBeat = counts.size === 1 && [...counts][0]! > 1;
  const columns = opts.columns ?? (rowPerBeat ? [...counts][0]! : Math.min(4, stills.length));
  const rows = Math.ceil(stills.length / columns);

  const width = columns * tileW + (columns + 1) * gap;
  const height = rows * tileH + (rows + 1) * gap;
  const barH = 30;

  const layers: sharp.OverlayOptions[] = [];
  for (const [i, s] of stills.entries()) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const left = gap + col * (tileW + gap);
    const top = gap + row * (tileH + gap);
    const tile = await sharp(s.path).resize(tileW, tileH, { fit: "cover" }).png().toBuffer();
    layers.push({ input: tile, left, top });
    const label = escapeXml(`${s.beatId}  ${s.position}  f${s.frame}`);
    const bar = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${barH}"><rect width="${tileW}" height="${barH}" fill="#000" fill-opacity="0.72"/><text x="10" y="21" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#fff">${label}</text></svg>`;
    layers.push({ input: Buffer.from(bar), left, top });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: { r: 18, g: 18, b: 22 } } })
    .composite(layers)
    .png()
    .toFile(outPath);
  return { path: outPath, width, height, columns, rows, tiles: stills.length };
}

export async function runRenderStills(input: RenderStillsInput): Promise<RenderStillsResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const beatsFile = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsFile)) {
    throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { fps?: number; beats?: BeatLike[] };
  const allBeats = doc.beats ?? [];
  if (allBeats.length === 0) {
    throw new Error(`${beatsFile} has no beats.`);
  }
  const totalFrames = Math.max(...allBeats.map((b) => b.start + b.duration));

  let beats = allBeats;
  if (!input.frames && input.beatIds && input.beatIds.length > 0) {
    const known = new Set(allBeats.map((b) => b.id));
    const unknown = input.beatIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`beatIds not found in beats.json: ${unknown.join(", ")}`);
    }
    const wanted = new Set(input.beatIds);
    beats = allBeats.filter((b) => wanted.has(b.id));
  }

  if (typeof input.perBeat === "number" && (!Number.isInteger(input.perBeat) || input.perBeat < 1 || input.perBeat > MAX_PER_BEAT)) {
    throw new Error(`perBeat must be a whole number from 1 to ${MAX_PER_BEAT}, or "review". Got ${input.perBeat}.`);
  }

  const plan: PlannedStill[] = [];
  if (input.frames && input.frames.length > 0) {
    const bad = input.frames.filter((f) => !Number.isInteger(f) || f < 0 || f >= totalFrames);
    if (bad.length > 0) {
      throw new Error(`frames must be whole numbers from 0 to ${totalFrames - 1} (this composition has ${totalFrames} frames). Got: ${bad.join(", ")}.`);
    }
    for (const frame of [...new Set(input.frames)].sort((a, b) => a - b)) {
      const { beat, offset } = locateFrame(allBeats, frame);
      plan.push({ beatId: beat.id, frame, offset, position: `+${offset}` });
    }
    beats = allBeats.filter((b) => plan.some((p) => p.beatId === b.id));
  } else if (input.perBeat !== undefined) {
    for (const beat of beats) plan.push(...planBeatStills(beat, input.perBeat));
  } else {
    for (const beat of beats) {
      const frame = resolveBeatFrame(beat, input.at);
      const offset = frame - beat.start;
      const position = typeof input.at === "number" ? `+${offset}` : (input.at ?? "mid");
      plan.push({ beatId: beat.id, frame, offset, position });
    }
  }

  const compositionId = resolveCompositionId(projectRoot, videoName, input.compositionId);

  const baseOutRel = input.outDir ?? path.join("output", "stills", videoName);
  sanitizeRelativeOutPath(projectRoot, baseOutRel, "outDir");
  const outDirRel = input.round === undefined ? baseOutRel : path.join(baseOutRel, `round-${sanitizeSegment(String(input.round), "round")}`);
  const outDirAbs = path.join(projectRoot, outDirRel);

  // One still per beat keeps the original <beatId>.png name; several per beat or explicit
  // frames cannot, since the beat id alone no longer says which frame it is.
  const perBeatCounts = new Map<string, number>();
  for (const p of plan) perBeatCounts.set(p.beatId, (perBeatCounts.get(p.beatId) ?? 0) + 1);
  const fileFor = (p: PlannedStill) =>
    input.frames || (perBeatCounts.get(p.beatId) ?? 1) > 1 ? `${p.beatId}-f${String(p.offset).padStart(4, "0")}.png` : `${p.beatId}.png`;

  const bundleStarted = Date.now();
  const serveUrl = await bundleProject(projectRoot);
  const bundleMs = Date.now() - bundleStarted;

  let browser: HeadlessBrowser | null = null;
  const renderStarted = Date.now();
  try {
    browser = await openRenderBrowser();
    const composition: ResolvedComposition = await resolveComposition(serveUrl, compositionId, browser);

    const stills: RenderStillOutput[] = [];
    for (const p of plan) {
      const outPath = path.join(outDirAbs, fileFor(p));
      const result = await renderStillPng({ serveUrl, composition, frame: p.frame, outPath, browser, scale: input.scale });
      stills.push({
        beatId: p.beatId,
        frame: p.frame,
        offset: p.offset,
        position: p.position,
        path: result.outPath,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
      });
    }

    let contactGrid: ContactGridOutput | undefined;
    if ((input.contactGrid ?? stills.length > 1) && stills.length > 0) {
      contactGrid = await buildContactGrid(stills, path.join(outDirAbs, "contact-grid.png"));
    }
    const renderMs = Date.now() - renderStarted;

    const result: RenderStillsResult = { compositionId, stills, bundleMs, renderMs, totalMs: bundleMs + renderMs };
    if (contactGrid) result.contactGrid = contactGrid;

    if (input.findings !== false) {
      const measured = await runRenderChecks({
        projectRoot,
        videoName,
        compositionId,
        beats,
        fps: doc.fps ?? 30,
        minimums: readTypeMinimums(path.join(projectRoot, "src", "videos", videoName)),
        bundleDir: serveUrl,
      });
      result.findings = measured.findings;
      result.findingsSkipped = measured.beatsSkipped;
      result.totalMs = Date.now() - bundleStarted;
    }
    return result;
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
        "The review loop's instrument: renders real frames so an agent can see a scene without waiting for a " +
        "full ffmpeg encode of the whole composition. The speed comes from bundling the project with " +
        "@remotion/bundler exactly once per call and reusing that one bundle plus one headless browser for " +
        "every still (@remotion/renderer's own selectComposition/renderStill, the same public SSR API " +
        "`remotion still` itself wraps) -- a full `remotion still` CLI invocation re-bundles on every single " +
        "call, which is the slow part this avoids. By default it renders one frame per beat (that beat's " +
        "midpoint). Pass `at` (\"start\"/\"mid\"/\"end\" or a frame offset into the beat) to pick another, " +
        "`perBeat` for several per beat (a number, or \"review\" for five with the first and last pulled just " +
        "inside the beat so adjacent beats show both sides of every cut), or `frames` for exact global frame " +
        "numbers. With more than one still it also writes a labelled contact-grid PNG (one row per beat when " +
        "perBeat is used: across is time within a beat, down is the cut to the next) so a whole round can be " +
        "judged from one image; `round` keeps each review round in its own folder. It also returns " +
        "validate_scenes's numeric render findings for the same beats (cropping, text size, reading time, " +
        "contrast, em dashes, safe area, HUD overlap, dead frames), reusing this call's bundle, so an agent " +
        "that cannot view images reviews from the numbers; pass findings: false to skip them. The composition " +
        "id is resolved from src/videos/.registry.json (written by stitch_composition) unless overridden. " +
        "Writes PNGs to output/stills/<videoName>/ by default (gitignored QC output, same convention as " +
        "contact_sheet/qc_extract_frames, not shipped media). Returns { compositionId, stills: [{beatId, " +
        "frame, offset, position, path, width, height, bytes}], contactGrid, findings, findingsSkipped, " +
        "bundleMs, renderMs, totalMs } -- width/height/bytes are measured from the real file written, not " +
        "assumed, so a near-empty render is visible in the result rather than silently reported as success.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        beatIds: z.array(z.string()).optional(),
        at: z.union([z.enum(["start", "mid", "end"]), z.number().int().nonnegative()]).optional(),
        perBeat: z.union([z.number().int().min(1).max(MAX_PER_BEAT), z.literal("review")]).optional(),
        frames: z.array(z.number().int().nonnegative()).min(1).optional(),
        compositionId: z.string().optional(),
        outDir: z.string().optional(),
        round: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
        scale: z.number().positive().optional(),
        contactGrid: z.boolean().optional(),
        findings: z.boolean().optional(),
      },
    },
    async (input) => runTool("render_stills", () => runRenderStills(input)),
  );
}

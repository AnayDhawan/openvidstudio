import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, pascalCase, spawnCapture } from "../util";
import { runTool } from "./mcp";

/**
 * A 5 minute video is 9000 frames and takes tens of minutes to render, which is a
 * brutal loop for checking whether the framing is right. Getting it wrong on three
 * scenes meant rendering stills one at a time and tiling them by hand, which is what
 * this automates.
 *
 * Two frames per beat, midpoint and end. The end frame matters as much as the
 * midpoint: a crop that looks fine early pushes the payoff off the bottom once the
 * camera has zoomed in, and PIPELINE.md's QC list calls that out specifically.
 */

export interface ContactSheetInput {
  projectRoot?: string;
  videoName: string;
  compositionId?: string;
  /** Sample only these beats. */
  beatIds?: string[];
  /** Skip the end-of-beat frame and take midpoints only. Halves the time. */
  midpointOnly?: boolean;
  outPath?: string;
  /** Width of each tile in the sheet. */
  tileWidth?: number;
}

export interface ContactSheetResult {
  sheetPath: string;
  frames: { beatId: string; at: "mid" | "end"; frame: number; file: string }[];
  columns: number;
  failed: string[];
}

interface BeatLike {
  id: string;
  start: number;
  duration: number;
}

const COMPOSITION_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Pure filtergraph builder, unit-testable without spawning ffmpeg.
 *
 * ffmpeg's `tile` filter takes exactly ONE input stream. Feeding it N labelled
 * scaled streams directly (the old shape here) fails with "More input link
 * labels specified for filter 'tile' than it has inputs". Every frame is
 * scaled to the same tileWidth (height forced even via -2, since h264/jpeg
 * encoders reject odd dimensions), the N scaled streams are concatenated into
 * ONE stream with `concat`, and only that one stream feeds `tile`. Every frame
 * here is a still of the same compositionId at a different timestamp, so all
 * frames already share one source aspect ratio: scaling each to the same width
 * cannot produce mismatched heights across them, which is what keeps `concat`
 * (which requires identical dimensions on every input) safe without an
 * explicit pad step.
 */
export function buildContactSheetFilterGraph(frameCount: number, tileWidth: number, columns: number, rows: number): string {
  const scaled = Array.from({ length: frameCount }, (_, i) => `[${i}]scale=${tileWidth}:-2[t${i}]`).join(";");
  const refs = Array.from({ length: frameCount }, (_, i) => `[t${i}]`).join("");
  return `${scaled};${refs}concat=n=${frameCount}:v=1:a=0,tile=${columns}x${rows}:padding=8:color=#0B0E14`;
}

/** Pure argv builder, unit-testable without spawning ffmpeg. */
export function buildContactSheetArgs(
  frameFiles: string[],
  tileWidth: number,
  columns: number,
  rows: number,
  sheetPath: string,
): string[] {
  const args: string[] = ["-v", "error"];
  for (const f of frameFiles) args.push("-i", f);
  args.push(
    "-filter_complex",
    buildContactSheetFilterGraph(frameFiles.length, tileWidth, columns, rows),
    "-frames:v", "1", sheetPath, "-y",
  );
  return args;
}

export async function runContactSheet(input: ContactSheetInput): Promise<ContactSheetResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const compositionId = input.compositionId ?? `${pascalCase(videoName)}Demo`;
  // On Windows, npx is a .cmd shim spawned through cmd.exe (see spawnCapture in
  // @openvidstudio/capture), which quote-wraps every argv entry rather than
  // escaping it -- a compositionId override containing a `"` could otherwise
  // break out of that quoting. pascalCase(videoName) can never produce one
  // (sanitizeSegment already restricts videoName), so this only ever fires on
  // an explicit, unsafe override.
  if (!COMPOSITION_ID_RE.test(compositionId)) {
    throw new Error(`compositionId "${compositionId}" is not safe (letters, numbers, "-", "_" only).`);
  }
  const tileWidth = input.tileWidth ?? 480;

  const beatsFile = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsFile)) {
    throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { beats: BeatLike[] };
  const beats = input.beatIds ? doc.beats.filter((b) => input.beatIds!.includes(b.id)) : doc.beats;

  const outDir = path.join(projectRoot, "output", "contact");
  fs.mkdirSync(outDir, { recursive: true });

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const frames: ContactSheetResult["frames"] = [];
  const failed: string[] = [];

  for (const beat of beats) {
    const picks: { at: "mid" | "end"; frame: number }[] = [
      { at: "mid", frame: beat.start + Math.floor(beat.duration * 0.5) },
    ];
    if (!input.midpointOnly) {
      // Two frames back from the cut, so the shot has fully arrived.
      picks.push({ at: "end", frame: beat.start + Math.max(0, beat.duration - 3) });
    }
    for (const pick of picks) {
      const file = path.join(outDir, `${beat.id}-${pick.at}.png`);
      // npx is a .cmd shim on Windows; spawnCapture (not a raw spawnSync) is what routes
      // that one case through cmd.exe, the same fix renderVideo.ts/qcExtractFrames.ts
      // already carry. Without it, spawnSync throws a synchronous EINVAL for every frame
      // on Windows and every call below fails before ffmpeg's tile filter ever runs.
      const r = await spawnCapture(
        npx,
        ["remotion", "still", compositionId, file, `--frame=${pick.frame}`, "--log=error"],
        projectRoot,
      );
      if (r.code === 0 && fs.existsSync(file)) {
        frames.push({ beatId: beat.id, at: pick.at, frame: pick.frame, file });
      } else {
        failed.push(`${beat.id}-${pick.at}`);
      }
    }
  }

  if (frames.length === 0) {
    throw new Error(`No frames rendered. Check that composition "${compositionId}" exists.`);
  }

  const columns = Math.min(4, Math.ceil(Math.sqrt(frames.length)));
  const rows = Math.ceil(frames.length / columns);
  const sheetPath = path.join(projectRoot, input.outPath ?? path.join("output", "contact-sheet.jpg"));
  fs.mkdirSync(path.dirname(sheetPath), { recursive: true });

  const args = buildContactSheetArgs(frames.map((f) => f.file), tileWidth, columns, rows, sheetPath);
  const tile = await spawnCapture("ffmpeg", args, projectRoot);
  if (tile.code !== 0) {
    throw new Error(`ffmpeg could not tile the frames: ${(tile.stderr ?? "").slice(0, 300)}`);
  }

  return { sheetPath, frames, columns, failed };
}

export function registerContactSheet(server: McpServer): void {
  server.registerTool(
    "contact_sheet",
    {
      title: "Render one image showing every beat",
      description:
        "Renders two stills per beat, midpoint and just before the cut, and tiles them into a single " +
        "image. This is the fastest way to check framing across a whole video: a full render of a five " +
        "minute video is 9000 frames and tens of minutes, which is far too slow a loop for catching a " +
        "cropped panel or a caption that has drifted off screen. The end-of-beat frame matters as much as " +
        "the midpoint, because a crop that looks correct early can push the payoff out of frame once the " +
        "camera has zoomed in. Pass midpointOnly to halve the time, or beatIds to sample a few.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        compositionId: z.string().optional(),
        beatIds: z.array(z.string()).optional(),
        midpointOnly: z.boolean().optional(),
        outPath: z.string().optional(),
        tileWidth: z.number().positive().optional(),
      },
    },
    async (input) => runTool("contact_sheet", () => runContactSheet(input)),
  );
}

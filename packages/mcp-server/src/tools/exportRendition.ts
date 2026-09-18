import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import { runTool } from "./mcp";

/**
 * Other renderers over the same beats.
 *
 * The capture engine and the manifest do not care that the output is a video. Video is one
 * consumer of them, and it is not always the one a project needs: the most requested
 * artefact in open source is a README GIF, docs want a numbered screenshot set that stays
 * current, and an app listing wants frames at dimensions the store will actually accept.
 * Each of those is a different renderer over the work already done, not a second pipeline.
 *
 * All three read the finished render plus beats.json rather than re-capturing, so the
 * screenshots in the docs are frames of the same footage the video shows. That is what
 * keeps them honest: a screenshot set assembled separately drifts from the video within a
 * release or two, which is the whole problem with hand-made docs images.
 */

export type Rendition = "gif" | "screenshots" | "store-frames" | "poster";

export interface RenditionBeat {
  id: string;
  start: number;
  duration: number;
  vo?: string;
  visual?: { caption?: string; captureMethod?: string };
}

export interface ExportRenditionInput {
  projectRoot?: string;
  videoName: string;
  format: Rendition;
  inPath?: string;
  outDir?: string;
  outPath?: string;
  /** gif only. 12fps and 720px wide keeps a README GIF under a few megabytes. */
  fps?: number;
  width?: number;
  /** store-frames only. */
  device?: StoreDevice;
  /** store-frames only: beats to export. Defaults to every beat. */
  beatIds?: string[];
  /** poster only. Which beat's midpoint to use as the poster frame. Defaults to the last beat. */
  posterBeatId?: string;
  /** poster only. Exact timestamp in seconds, overriding posterBeatId. */
  posterAt?: number;
  /**
   * poster only. Also write a copy of the render with the poster baked in as the file's
   * embedded thumbnail (an attached_pic stream, the same mechanism a podcast mp3's cover
   * art uses), so players and file browsers show it instead of a black or mid-motion first
   * frame. Defaults to true. The picture itself is untouched frame-for-frame; only a
   * thumbnail stream is added.
   */
  bake?: boolean;
}

export interface ExportRenditionResult {
  format: Rendition;
  files: string[];
  indexPath?: string;
  /** poster only, when bake was not disabled: the render with the poster baked in as its thumbnail. */
  bakedPath?: string;
  notes: string[];
}

/**
 * Exact pixel dimensions each store demands. These are the sizes the review process
 * rejects a submission over, which is precisely why doing this by hand is tedious and
 * doing it from a capture pipeline is nearly free.
 */
export const STORE_DEVICES = {
  "iphone-6.9": { width: 1290, height: 2796, label: "App Store, 6.9 inch iPhone" },
  "iphone-6.5": { width: 1242, height: 2688, label: "App Store, 6.5 inch iPhone" },
  "ipad-13": { width: 2064, height: 2752, label: "App Store, 13 inch iPad" },
  "android-phone": { width: 1080, height: 1920, label: "Play Store, phone" },
  "android-tablet": { width: 1600, height: 2560, label: "Play Store, 10 inch tablet" },
} as const;

export type StoreDevice = keyof typeof STORE_DEVICES;

/** Mid-beat, in seconds. The midpoint is past any transition in and before any transition out. */
export function beatMidpointSeconds(beat: RenditionBeat, fps: number): number {
  return (beat.start + beat.duration / 2) / fps;
}

/**
 * Two-pass GIF, because the one-pass version is why most README GIFs look like that.
 *
 * A GIF is limited to 256 colours. Without a generated palette ffmpeg falls back to a
 * fixed web-safe one and everything banding-dithers into mud, which is the difference
 * between a GIF that sells the product and one that makes it look like a 2003 screencast.
 */
export function buildPaletteArgs(inPath: string, palettePath: string, fps: number, width: number): string[] {
  return [
    "-nostdin",
    "-i",
    inPath,
    "-vf",
    `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    palettePath,
    "-y",
  ];
}

export function buildGifArgs(inPath: string, palettePath: string, outPath: string, fps: number, width: number): string[] {
  return [
    "-nostdin",
    "-i",
    inPath,
    "-i",
    palettePath,
    "-lavfi",
    // bayer dithering rather than the default: it keeps flat UI surfaces flat instead of
    // speckling them, and flat surfaces are most of what a product demo is.
    `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    "-loop",
    "0",
    outPath,
    "-y",
  ];
}

export function buildFrameArgs(inPath: string, seconds: number, outPath: string): string[] {
  // -ss before -i seeks on keyframes, which is fast and can land on the wrong frame. After
  // -i it decodes to the exact timestamp, which is what a documentation screenshot needs.
  return ["-nostdin", "-i", inPath, "-ss", seconds.toFixed(3), "-frames:v", "1", outPath, "-y"];
}

/**
 * One store frame: the shot fitted inside the device's exact canvas, with a dark surround
 * standing in for device chrome.
 *
 * Fitted rather than filled. A store frame that crops the product to fill the canvas
 * removes exactly the UI the screenshot existed to show.
 */
export function buildStoreFrameArgs(
  inPath: string,
  seconds: number,
  outPath: string,
  device: { width: number; height: number },
  bezel: number,
): string[] {
  const innerW = device.width - bezel * 2;
  const innerH = device.height - bezel * 2;
  return [
    "-nostdin",
    "-i",
    inPath,
    "-ss",
    seconds.toFixed(3),
    "-frames:v",
    "1",
    "-vf",
    `scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease,` +
      `pad=${device.width}:${device.height}:(ow-iw)/2:(oh-ih)/2:0x101014`,
    outPath,
    "-y",
  ];
}

/**
 * Attaches a still image to a video as its embedded thumbnail, the mechanism a podcast
 * mp3's cover art uses (an `attached_pic`-disposed stream), rather than by re-encoding the
 * first frame. `-c copy` on the picture stream means the original video and audio are
 * copied byte-for-byte, not re-encoded, so a poster bake never touches the render's actual
 * quality: only a thumbnail stream is added.
 */
export function buildAttachPosterArgs(inPath: string, posterPath: string, outPath: string): string[] {
  return [
    "-nostdin",
    "-i",
    inPath,
    "-i",
    posterPath,
    "-map",
    "0",
    "-map",
    "1",
    "-c",
    "copy",
    "-c:v:1",
    "mjpeg",
    "-disposition:v:1",
    "attached_pic",
    outPath,
    "-y",
  ];
}

/** The docs index. Pairs every shot with what the video says over it, which is already written. */
export function buildScreenshotIndex(videoName: string, entries: { file: string; beat: RenditionBeat }[]): string {
  const rows = entries
    .map(
      ({ file, beat }, i) =>
        `### ${i + 1}. ${beat.visual?.caption ?? beat.id}\n\n` +
        `![${beat.id}](./${file})\n\n` +
        `${beat.vo ?? ""}\n`,
    )
    .join("\n");
  return (
    `# ${videoName} screenshots\n\n` +
    `Generated by openvidstudio's export_rendition from the same render the demo video was cut from, so\n` +
    `these cannot drift from the video. Regenerate rather than editing: this file is overwritten.\n\n` +
    rows
  );
}

function readBeats(projectRoot: string, videoName: string): { fps: number; beats: RenditionBeat[] } {
  const beatsPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`${beatsPath} does not exist. Every rendition is driven by the manifest.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as { fps?: number; beats?: RenditionBeat[] };
  if (!Array.isArray(doc.beats) || doc.beats.length === 0) throw new Error(`${beatsPath} has no beats.`);
  return { fps: doc.fps ?? 30, beats: doc.beats };
}

export async function runExportRendition(input: ExportRenditionInput): Promise<ExportRenditionResult> {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const { fps, beats } = readBeats(projectRoot, videoName);

  const inPathRel = input.inPath ?? path.join("output", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, inPathRel, "inPath");
  if (!fs.existsSync(path.join(projectRoot, inPathRel))) {
    throw new Error(
      `${inPathRel} does not exist. Every rendition is cut from the finished render, which is what keeps ` +
        `them in step with the video. Run render_video first.`,
    );
  }

  const notes: string[] = [];
  const files: string[] = [];

  if (input.format === "gif") {
    const outRel = input.outPath ?? path.join("output", `${videoName}.gif`);
    sanitizeRelativeOutPath(projectRoot, outRel, "outPath");
    fs.mkdirSync(path.dirname(path.join(projectRoot, outRel)), { recursive: true });
    const gifFps = input.fps ?? 12;
    const gifWidth = input.width ?? 720;
    // Beside the gif, not in a fixed directory: the palette is an intermediate and it gets
    // deleted, but if a run dies between the two passes the leftover should be findable.
    const paletteRel = path.join(path.dirname(outRel), `${videoName}-palette.png`);

    const palette = await spawnCapture("ffmpeg", buildPaletteArgs(inPathRel, paletteRel, gifFps, gifWidth), projectRoot);
    if (palette.code !== 0) throw new Error(`palettegen failed:\n${palette.stderr.slice(-1200)}`);
    const gif = await spawnCapture("ffmpeg", buildGifArgs(inPathRel, paletteRel, outRel, gifFps, gifWidth), projectRoot);
    if (gif.code !== 0) throw new Error(`GIF encode failed:\n${gif.stderr.slice(-1200)}`);
    fs.rmSync(path.join(projectRoot, paletteRel), { force: true });

    const bytes = fs.statSync(path.join(projectRoot, outRel)).size;
    files.push(outRel);
    notes.push(`${(bytes / 1_000_000).toFixed(2)}MB at ${gifWidth}px wide and ${gifFps}fps.`);
    if (bytes > 10_000_000) {
      notes.push(
        "GitHub will render this but it is large for a README. Drop the width or the fps, or export a " +
          "shorter cut, before committing it.",
      );
    }
    return { format: "gif", files, notes };
  }

  if (input.format === "screenshots") {
    const dirRel = input.outDir ?? path.join("docs", "screenshots", videoName);
    sanitizeRelativeOutPath(projectRoot, dirRel, "outDir");
    fs.mkdirSync(path.join(projectRoot, dirRel), { recursive: true });

    const entries: { file: string; beat: RenditionBeat }[] = [];
    for (const [i, beat] of beats.entries()) {
      const name = `${String(i + 1).padStart(2, "0")}-${beat.id}.png`;
      const rel = path.join(dirRel, name);
      const shot = await spawnCapture(
        "ffmpeg",
        buildFrameArgs(inPathRel, beatMidpointSeconds(beat, fps), rel),
        projectRoot,
      );
      if (shot.code !== 0) throw new Error(`frame extraction failed for beat "${beat.id}":\n${shot.stderr.slice(-800)}`);
      files.push(rel);
      entries.push({ file: name, beat });
    }

    const indexRel = path.join(dirRel, "README.md");
    fs.writeFileSync(path.join(projectRoot, indexRel), buildScreenshotIndex(videoName, entries), "utf8");
    notes.push(
      "These are frames of the video itself, so they cannot drift from it. Re-export after a re-render " +
        "rather than editing them.",
    );
    return { format: "screenshots", files, indexPath: indexRel, notes };
  }

  if (input.format === "poster") {
    let atSeconds: number;
    if (typeof input.posterAt === "number") {
      atSeconds = input.posterAt;
    } else {
      const beatId = input.posterBeatId ?? beats[beats.length - 1].id;
      const beat = beats.find((b) => b.id === beatId);
      if (!beat) throw new Error(`No beat "${beatId}" in this video's manifest.`);
      atSeconds = beatMidpointSeconds(beat, fps);
    }

    const posterRel = input.outPath ?? path.join("output", `${videoName}-poster.jpg`);
    sanitizeRelativeOutPath(projectRoot, posterRel, "outPath");
    fs.mkdirSync(path.dirname(path.join(projectRoot, posterRel)), { recursive: true });
    const frame = await spawnCapture(
      "ffmpeg",
      buildFrameArgs(inPathRel, atSeconds, posterRel),
      projectRoot,
    );
    if (frame.code !== 0) throw new Error(`poster frame extraction failed:\n${frame.stderr.slice(-800)}`);
    files.push(posterRel);
    notes.push(`Poster taken at ${atSeconds.toFixed(2)}s.`);

    let bakedPath: string | undefined;
    if (input.bake !== false) {
      const bakedRel = path.join(path.dirname(inPathRel), `${videoName}-poster.mp4`);
      const bake = await spawnCapture(
        "ffmpeg",
        buildAttachPosterArgs(inPathRel, posterRel, bakedRel),
        projectRoot,
      );
      if (bake.code !== 0) throw new Error(`baking the poster into the video failed:\n${bake.stderr.slice(-800)}`);
      files.push(bakedRel);
      bakedPath = bakedRel;
      notes.push(
        `${bakedRel} is the same render with the poster baked in as its embedded thumbnail, video and ` +
          `audio copied unchanged. Swap it in for ${inPathRel} once you are happy with the frame.`,
      );
    }

    return { format: "poster", files, notes, ...(bakedPath ? { bakedPath } : {}) };
  }

  const deviceKey = input.device ?? "iphone-6.9";
  const device = STORE_DEVICES[deviceKey];
  if (!device) throw new Error(`Unknown device "${deviceKey}". Known: ${Object.keys(STORE_DEVICES).join(", ")}.`);
  const dirRel = input.outDir ?? path.join("output", "store", deviceKey);
  sanitizeRelativeOutPath(projectRoot, dirRel, "outDir");
  fs.mkdirSync(path.join(projectRoot, dirRel), { recursive: true });

  const wanted = input.beatIds?.length ? beats.filter((b) => input.beatIds!.includes(b.id)) : beats;
  if (wanted.length === 0) throw new Error(`None of the requested beatIds exist in this video's manifest.`);

  const bezel = Math.round(device.width * 0.03);
  for (const [i, beat] of wanted.entries()) {
    const rel = path.join(dirRel, `${String(i + 1).padStart(2, "0")}-${beat.id}.png`);
    const shot = await spawnCapture(
      "ffmpeg",
      buildStoreFrameArgs(inPathRel, beatMidpointSeconds(beat, fps), rel, device, bezel),
      projectRoot,
    );
    if (shot.code !== 0) throw new Error(`store frame failed for beat "${beat.id}":\n${shot.stderr.slice(-800)}`);
    files.push(rel);
  }

  notes.push(
    `${device.label}: exactly ${device.width}x${device.height}, which is the dimension the review process ` +
      `rejects a submission over.`,
  );
  notes.push(
    "The shot is fitted inside the canvas rather than filling it. Filling would crop away the UI the " +
      "screenshot exists to show.",
  );
  return { format: "store-frames", files, notes };
}

export function registerExportRendition(server: McpServer): void {
  server.registerTool(
    "export_rendition",
    {
      title: "Export the same beats as a GIF, a docs screenshot set, or store frames",
      description:
        "Video is one consumer of the capture engine and the manifest, not the only one. This renders the " +
        "same finished video into the other artefacts a project actually needs. format: \"gif\" produces a " +
        "README GIF through a real two-pass palette (a one-pass GIF falls back to a fixed 256 colour palette " +
        "and bands flat UI into mud, which is why most README GIFs look the way they do), defaulting to 720px " +
        "at 12fps and warning when the result is too large to commit. format: \"screenshots\" pulls one frame " +
        "per beat at its midpoint into docs/screenshots/<videoName>/ and writes a README.md pairing each shot " +
        "with that beat's narration, so the docs images are frames of the same footage the video shows and " +
        "cannot drift from it. format: \"store-frames\" produces App Store and Play Store images at the exact " +
        "pixel dimensions each store demands (6.9 and 6.5 inch iPhone, 13 inch iPad, Play Store phone and " +
        "tablet), fitting the shot inside the canvas rather than filling it, because filling crops away the " +
        "UI the screenshot exists to show. format: \"poster\" picks one frame (a beat's midpoint, defaulting " +
        "to the last beat, or an exact posterAt timestamp) and writes it as <videoName>-poster.jpg, then, " +
        "unless bake is set to false, also writes <videoName>-poster.mp4: the same render with that frame " +
        "baked in as the file's embedded thumbnail (an attached_pic stream, the same mechanism a podcast " +
        "mp3's cover art uses), copied not re-encoded, so video and audio quality are untouched. Skipping " +
        "this step is why a shared video's idle thumbnail is so often a black frame or a mid-motion blur " +
        "instead of the frame that was actually chosen to represent it. All four formats read the finished " +
        "render plus beats.json rather than re-capturing, so run render_video first.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        format: z.enum(["gif", "screenshots", "store-frames", "poster"]),
        inPath: z.string().optional().describe("The finished render. Defaults to output/<videoName>.mp4."),
        outDir: z.string().optional(),
        outPath: z.string().optional().describe("gif and poster only."),
        fps: z.number().int().positive().optional().describe("gif only. Defaults to 12."),
        width: z.number().int().positive().optional().describe("gif only. Defaults to 720."),
        device: z
          .enum(["iphone-6.9", "iphone-6.5", "ipad-13", "android-phone", "android-tablet"])
          .optional()
          .describe("store-frames only. Defaults to iphone-6.9."),
        beatIds: z.array(z.string()).optional().describe("store-frames only. Defaults to every beat."),
        posterBeatId: z.string().optional().describe("poster only. Defaults to the last beat."),
        posterAt: z.number().optional().describe("poster only. Exact seconds, overriding posterBeatId."),
        bake: z.boolean().optional().describe("poster only. Defaults to true."),
      },
    },
    async (input) => runTool("export_rendition", () => runExportRendition(input)),
  );
}

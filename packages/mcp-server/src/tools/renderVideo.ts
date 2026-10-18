import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, pascalCase, spawnCapture } from "../util";
import { loadConfig } from "../config";
import {
  CACHE_VERSION,
  buildConcatList,
  buildExtractPcmArgs,
  buildFinalMuxArgs,
  buildIsolateVideoArgs,
  buildSegmentRenderArgs,
  buildVideoOnlyConcatArgs,
  expectedPcmBytes,
  fitPcmLength,
  pcmFileName,
  planSegments,
  readCache,
  renderKey,
  segmentsDir,
  videoOnlyFileName,
  writeCache,
  type BeatLike,
  type CachedSegment,
} from "../renderCache";
import { runTool } from "./mcp";
import { fileBytes, relToProject, writeFactRecord } from "../facts";
import { createJob, updateJobProgress, completeJob, failJob } from "../jobs";

export interface RenderVideoInput {
  projectRoot?: string;
  videoName: string;
  compositionId?: string;
  outPath?: string;
  /**
   * Draft renders at half resolution with a cheaper encode. A five minute video is
   * 9000 frames and tens of minutes at full quality, which is far too slow a loop
   * for checking whether the video is right.
   */
  draft?: boolean;
  /**
   * Parallel render workers. Left unset, Remotion takes as much of the machine as it
   * can: one render here spawned 25 Chrome workers and starved everything else on the
   * box, including a second pipeline step running at the same time.
   */
  concurrency?: number;
  /**
   * Brand-lock gate escape hatch (default false): render_video refuses to run unless
   * src/brand.ts exists (written by extract_brand, even when most of its tokens stayed
   * at the openvidstudio default -- the point is that extract_brand ran and made an
   * honest attempt, not that every token resolved). Pass true only when the project
   * deliberately has no brand to extract, e.g. rendering a demo about openvidstudio
   * itself. This is a fail-closed default, not a hard law: it exists so a video never
   * ships wearing openvidstudio's own navy/Inter look by accident, the single loudest
   * "this looks like a template" signal (see extractBrand.ts).
   */
  skipBrandLock?: boolean;
  /**
   * Render each beat to its own cached segment and concatenate, re-rendering only the
   * beats whose inputs actually changed. Costs one extra ffmpeg stream copy and makes a
   * one caption edit cost one beat instead of nine thousand frames.
   */
  incremental?: boolean;
  /**
   * Start the render without blocking the request. Returns { jobId, estimate } immediately;
   * poll job_status for progress and the eventual RenderVideoResult. Exists because a real
   * render can run 40+ minutes on a modest machine, and an MCP client's own request timeout
   * (Claude Code's MCP_TOOL_TIMEOUT, or the SDK client default) will have long since killed
   * a synchronous call by then. See job_status.ts and README's timeout-guidance section.
   */
  async?: boolean;
}

/** Progress callback shape, shared by the async job-store path and the synchronous
 * MCP-progress-notification path -- both just want to know frames rendered and the current
 * beat, they differ only in what they do with that. */
export type RenderProgress = { framesRendered: number; totalFrames: number; currentBeat: string | null };
export interface RenderVideoOpts {
  onProgress?: (progress: RenderProgress) => void;
}

export interface RenderVideoResult {
  success: boolean;
  outPath: string;
  draft: boolean;
  elapsedSeconds: number;
  stdout: string;
  stderr: string;
  /** True when src/brand.ts existed at render time (whether from this call's skipBrandLock or a real extract_brand run). */
  brandLocked: boolean;
  /** Incremental renders only: beats whose cached segment was reused untouched. */
  reusedBeats?: string[];
  /** Incremental renders only: beats that were actually re-rendered. */
  renderedBeats?: string[];
  /** Incremental renders only: frames sent to the renderer, against the composition's total. */
  framesRendered?: number;
  totalFrames?: number;
}

export interface RenderCommand {
  command: string;
  args: string[];
}

const COMPOSITION_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Pure argv builder, unit-testable without spawning a real process. On Windows, npx is
 * a .cmd shim -- Node's spawn() can only execute that via an internal cmd.exe hop even
 * with shell:false, which is why compositionId/outPath both get sanitized against
 * cmd.exe metacharacters before ever reaching this function (see util.ts).
 */
export function buildRenderCommand(
  compositionId: string,
  outPath: string,
  opts: { draft?: boolean; concurrency?: number; browserExecutable?: string } = {},
): RenderCommand {
  const args = ["remotion", "render", compositionId, outPath];
  if (opts.draft) {
    // Half resolution and a fast x264 preset. Enough to judge framing, motion and
    // timing; not enough to judge final text crispness.
    args.push("--scale=0.5", "--crf=32", "--x264-preset=veryfast");
  } else {
    // Remotion serialises every frame before encoding it, and its default for that step is
    // JPEG at quality 80. On camera footage nobody would notice; on a demo video, which is
    // text and flat UI and hard edges, it is a visible loss applied to every single frame
    // before x264 ever sees it. PNG is lossless and costs render time, which is the right
    // trade for the one pass whose output ships.
    args.push("--image-format=png", "--crf=16");
  }
  if (opts.concurrency && opts.concurrency > 0) {
    args.push(`--concurrency=${Math.floor(opts.concurrency)}`);
  }
  if (opts.browserExecutable) {
    // Reuses the project's configured browser (render.browserExecutable, normally pointed
    // at the same Playwright-managed Chromium capture already launches) instead of Remotion
    // downloading its own chrome-headless-shell, which fails outright with no network.
    args.push(`--browser-executable=${opts.browserExecutable}`);
  }
  // Remotion suppresses its progress bar when stdout is not a TTY, which is always
  // the case here, so a piped render writes an empty log for its whole run and an
  // agent watching it cannot tell progress from a hang.
  args.push("--log=verbose");
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args,
  };
}

interface BeatsDoc {
  fps?: number;
  beats?: BeatLike[];
}

function readBeats(projectRoot: string, videoName: string): BeatsDoc {
  const beatsPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`${beatsPath} does not exist. Call write_beats_file for "${videoName}" first.`);
  }
  return JSON.parse(fs.readFileSync(beatsPath, "utf8")) as BeatsDoc;
}

/** Best-effort total frame count, for a progress denominator and the async estimate. Never
 * throws: a render that isn't beats.json-driven (unusual, but not disallowed) just gets an
 * unknown (0) total rather than failing the whole call over a progress nicety. */
function tryReadTotalFrames(projectRoot: string, videoName: string): number {
  try {
    const doc = readBeats(projectRoot, videoName);
    const beats = doc.beats;
    if (!Array.isArray(beats) || beats.length === 0) return 0;
    const last = beats[beats.length - 1];
    return last.start + last.duration;
  } catch {
    return 0;
  }
}

/**
 * Rough wall-clock estimate for the async path's immediate response, in seconds. This is a
 * placeholder constant, not a measurement: Phase B's preflight render benchmark (real
 * frames/sec on this machine) is what plan_production uses for an estimate worth planning
 * around. This one just needs to be in the right order of magnitude so a caller polling
 * job_status knows roughly how long to expect, not exactly.
 */
function estimateRenderSeconds(totalFrames: number, draft: boolean): number {
  const secondsPerFrame = draft ? 0.15 : 0.6;
  return Math.max(5, Math.round(totalFrames * secondsPerFrame));
}

/**
 * Renders only the beats whose inputs changed, then concatenates every segment.
 *
 * The concat is a stream copy, so a reused segment's bytes reach the final file unchanged
 * rather than being decoded and re-encoded. That is what makes this worth doing: a cache
 * that costs a generation of quality on every reuse is not a cache anyone should want.
 */
async function runIncrementalRender(
  input: RenderVideoInput,
  ctx: {
    projectRoot: string;
    videoName: string;
    compositionId: string;
    outPathRel: string;
    brandLocked: boolean;
    started: number;
    onProgress?: (progress: RenderProgress) => void;
  },
): Promise<RenderVideoResult> {
  const { projectRoot, videoName, compositionId, outPathRel, brandLocked, started, onProgress } = ctx;
  const doc = readBeats(projectRoot, videoName);
  const beats = doc.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error(`src/videos/${videoName}/beats.json has no beats.`);
  }

  const config = loadConfig(projectRoot);
  const fps = doc.fps ?? config.videoConfig.fps;
  const key = renderKey({
    draft: input.draft,
    width: config.videoConfig.width,
    height: config.videoConfig.height,
    fps,
  });

  const { plan } = planSegments({
    projectRoot,
    videoName,
    compositionId,
    beats,
    renderKey: key,
    cache: readCache(projectRoot, videoName),
  });

  const dir = segmentsDir(projectRoot, videoName);
  fs.mkdirSync(dir, { recursive: true });

  const last = beats[beats.length - 1];
  const totalFrames = last.start + last.duration;
  const log: string[] = [];
  const errors: string[] = [];
  // framesRendered (the result field, asserted by existing cache tests) counts only frames
  // actually sent to the renderer this call -- a cache that reports "rendered" frames for a
  // reused segment would make "did this run do any real work" unanswerable from the result.
  // progressFramesDone is the separate, job_status/MCP-progress-facing number: how much of
  // the FINAL video is accounted for so far, where a reused segment is already done.
  let framesRendered = 0;
  let progressFramesDone = 0;
  onProgress?.({ framesRendered: 0, totalFrames, currentBeat: null });

  for (const segment of plan) {
    if (segment.reused) {
      progressFramesDone += segment.lastFrame - segment.firstFrame + 1;
      log.push(`reused  ${segment.beatId} (frames ${segment.firstFrame}-${segment.lastFrame})`);
      onProgress?.({ framesRendered: progressFramesDone, totalFrames, currentBeat: segment.beatId });
      continue;
    }
    const { command, args } = buildSegmentRenderArgs(
      compositionId,
      segment.file,
      segment.firstFrame,
      segment.lastFrame,
      { draft: input.draft, concurrency: input.concurrency, browserExecutable: config.render.browserExecutable },
    );
    const result = await spawnCapture(command, args, projectRoot);
    if (result.code !== 0 || !fs.existsSync(path.join(projectRoot, segment.file))) {
      errors.push(`render of beat "${segment.beatId}" failed:\n${result.stderr.slice(-2000)}`);
      break;
    }
    framesRendered += segment.lastFrame - segment.firstFrame + 1;
    progressFramesDone += segment.lastFrame - segment.firstFrame + 1;
    log.push(`rendered ${segment.beatId} (frames ${segment.firstFrame}-${segment.lastFrame})`);
    onProgress?.({ framesRendered: progressFramesDone, totalFrames, currentBeat: segment.beatId });
  }

  if (errors.length > 0) {
    return {
      success: false,
      outPath: path.join(projectRoot, outPathRel),
      draft: Boolean(input.draft),
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      stdout: log.join("\n"),
      stderr: errors.join("\n\n"),
      brandLocked,
    };
  }

  // Sample-exact audio join (see renderCache.ts's buildFinalMuxArgs doc comment): every
  // segment's audio is decoded to raw PCM and trimmed/padded to duration/fps exactly, so
  // stream-copying every segment's own (encoder-padded) AAC track under one concat demuxer
  // -- the old approach -- can't stack drift beat over beat. The PCM file lives next to its
  // segment and is reused whenever the segment itself is reused, so this costs nothing on a
  // cache hit.
  for (const segment of plan) {
    const pcmAbs = path.join(dir, pcmFileName(segment.beatId));
    if (segment.reused && fs.existsSync(pcmAbs)) continue;
    const extract = await spawnCapture(
      "ffmpeg",
      buildExtractPcmArgs(path.join(projectRoot, segment.file), pcmAbs),
      dir,
    );
    if (extract.code !== 0 || !fs.existsSync(pcmAbs)) {
      errors.push(`audio extract for beat "${segment.beatId}" failed:\n${extract.stderr.slice(-2000)}`);
      break;
    }
    const durationFrames = segment.lastFrame - segment.firstFrame + 1;
    const fitted = fitPcmLength(fs.readFileSync(pcmAbs), expectedPcmBytes(durationFrames, fps));
    fs.writeFileSync(pcmAbs, fitted);
  }

  if (errors.length > 0) {
    return {
      success: false,
      outPath: path.join(projectRoot, outPathRel),
      draft: Boolean(input.draft),
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      stdout: log.join("\n"),
      stderr: errors.join("\n\n"),
      brandLocked,
    };
  }

  // Isolate each segment's video into its own fresh container first (see renderCache.ts's
  // buildIsolateVideoArgs doc comment): a segment's own container duration reflects its
  // longer, padded audio track, and the concat demuxer trusts that duration to place the
  // next file, so concatenating the original segments with `-an` would still leave a
  // silent gap at every join. Isolating drops that stale duration along with the audio.
  const voNames = plan.map((p) => videoOnlyFileName(p.beatId));
  for (let i = 0; i < plan.length; i++) {
    const isolate = await spawnCapture(
      "ffmpeg",
      buildIsolateVideoArgs(path.join(projectRoot, plan[i].file), voNames[i]),
      dir,
    );
    if (isolate.code !== 0 || !fs.existsSync(path.join(dir, voNames[i]))) {
      errors.push(`video isolation for beat "${plan[i].beatId}" failed:\n${isolate.stderr.slice(-2000)}`);
      break;
    }
  }

  if (errors.length > 0) {
    for (const name of voNames) fs.rmSync(path.join(dir, name), { force: true });
    return {
      success: false,
      outPath: path.join(projectRoot, outPathRel),
      draft: Boolean(input.draft),
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      stdout: log.join("\n"),
      stderr: errors.join("\n\n"),
      brandLocked,
    };
  }

  // The list lives beside the segments and names them by basename, so the whole segments
  // directory stays relocatable and ffmpeg's -safe 0 has the least to swallow.
  const listPath = path.join(dir, "concat.txt");
  fs.writeFileSync(listPath, buildConcatList(voNames), "utf8");

  const videoOnlyName = "_video-only.mp4";
  const videoOnly = await spawnCapture("ffmpeg", buildVideoOnlyConcatArgs("concat.txt", videoOnlyName), dir);

  const concatPcmName = "_concat-audio.pcm";
  fs.writeFileSync(
    path.join(dir, concatPcmName),
    Buffer.concat(plan.map((p) => fs.readFileSync(path.join(dir, pcmFileName(p.beatId))))),
  );

  const outAbs = path.join(projectRoot, outPathRel);
  const concat =
    videoOnly.code === 0 && fs.existsSync(path.join(dir, videoOnlyName))
      ? await spawnCapture(
          "ffmpeg",
          buildFinalMuxArgs(videoOnlyName, concatPcmName, path.relative(dir, outAbs)),
          dir,
        )
      : videoOnly;
  const success = concat.code === 0 && fs.existsSync(outAbs);

  for (const name of voNames) fs.rmSync(path.join(dir, name), { force: true });
  fs.rmSync(path.join(dir, videoOnlyName), { force: true });
  fs.rmSync(path.join(dir, concatPcmName), { force: true });

  if (success) {
    const segments: Record<string, CachedSegment> = {};
    const renderedAt = new Date().toISOString();
    for (const segment of plan) {
      const beat = beats.find((b) => b.id === segment.beatId);
      segments[segment.beatId] = {
        hash: segment.hash,
        file: segment.file,
        start: beat?.start ?? segment.firstFrame,
        duration: beat?.duration ?? segment.lastFrame - segment.firstFrame + 1,
        renderedAt,
      };
    }
    writeCache(projectRoot, videoName, { version: CACHE_VERSION, compositionId, renderKey: key, segments });
  }

  onProgress?.({ framesRendered: success ? totalFrames : progressFramesDone, totalFrames, currentBeat: null });
  return {
    success,
    outPath: path.join(projectRoot, outPathRel),
    draft: Boolean(input.draft),
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    stdout: log.join("\n") + "\n" + concat.stdout,
    stderr: concat.stderr,
    brandLocked,
    reusedBeats: plan.filter((p) => p.reused).map((p) => p.beatId),
    renderedBeats: plan.filter((p) => !p.reused).map((p) => p.beatId),
    framesRendered,
    totalFrames,
  };
}

export interface PreparedRenderVideo {
  videoName: string;
  projectRoot: string;
  compositionId: string;
  outPathRel: string;
  brandLocked: boolean;
}

/**
 * The synchronous half of render_video: validate input and the brand-lock gate, throwing
 * immediately on anything wrong, before any real work (a render that will take 40+ minutes,
 * possibly started detached under `async: true`) begins. Split out so the async path can
 * fail a bad call synchronously too, instead of "succeeding" with a jobId that immediately
 * errors.
 */
export function prepareRenderVideo(input: RenderVideoInput): PreparedRenderVideo {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const compositionId = input.compositionId ?? `${pascalCase(videoName)}Demo`;
  if (!COMPOSITION_ID_RE.test(compositionId)) {
    throw new Error(`compositionId "${compositionId}" is not safe (letters, numbers, "-", "_" only).`);
  }
  const outPathRel = input.outPath ?? path.join("output", `${videoName}.mp4`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");

  const brandLocked = fs.existsSync(path.join(projectRoot, "src", "brand.ts"));
  if (!brandLocked && input.skipBrandLock !== true) {
    throw new Error(
      `Brand-lock gate: no src/brand.ts found in this project. Run extract_brand with ` +
        `{ sourceRepo: "${projectRoot}" } before rendering. It writes src/brand.ts from the repo being filmed. ` +
        "If this project deliberately has no brand to extract, pass skipBrandLock: true.",
    );
  }

  fs.mkdirSync(path.dirname(path.join(projectRoot, outPathRel)), { recursive: true });
  return { videoName, projectRoot, compositionId, outPathRel, brandLocked };
}

/**
 * Records what this render actually did next to what was asked: which beats were rendered
 * and which came from the cache, and the size of the file that landed. The result's own
 * stdout/stderr stay out of the record, they are logs, not facts.
 */
export async function runRenderVideo(input: RenderVideoInput, opts: RenderVideoOpts = {}): Promise<RenderVideoResult> {
  const result = await renderVideoUnrecorded(input, opts);
  const projectRoot = resolveProjectRoot(input.projectRoot);
  writeFactRecord(projectRoot, {
    tool: "render_video",
    videoName: sanitizeSegment(input.videoName, "videoName"),
    facts: {
      success: result.success,
      outPath: relToProject(projectRoot, result.outPath),
      bytes: result.success ? fileBytes(result.outPath) : null,
      draft: result.draft,
      incremental: input.incremental === true,
      elapsedSeconds: result.elapsedSeconds,
      brandLocked: result.brandLocked,
      ...(result.renderedBeats ? { renderedBeats: result.renderedBeats } : {}),
      ...(result.reusedBeats ? { reusedBeats: result.reusedBeats } : {}),
      ...(result.framesRendered !== undefined ? { framesRendered: result.framesRendered } : {}),
      ...(result.totalFrames !== undefined ? { totalFrames: result.totalFrames } : {}),
    },
  });
  return result;
}

async function renderVideoUnrecorded(input: RenderVideoInput, opts: RenderVideoOpts): Promise<RenderVideoResult> {
  const { videoName, projectRoot, compositionId, outPathRel, brandLocked } = prepareRenderVideo(input);

  const started = Date.now();
  if (input.incremental === true) {
    return runIncrementalRender(input, {
      projectRoot,
      videoName,
      compositionId,
      outPathRel,
      brandLocked,
      started,
      onProgress: opts.onProgress,
    });
  }

  // No natural per-frame hook on the plain (non-incremental) Remotion CLI path without
  // parsing its verbose stdout, so progress here is coarse: unknown/0, then done. The
  // incremental path above is where real per-beat progress actually comes from.
  const totalFrames = tryReadTotalFrames(projectRoot, videoName);
  opts.onProgress?.({ framesRendered: 0, totalFrames, currentBeat: null });
  const config = loadConfig(projectRoot);
  const { command, args } = buildRenderCommand(compositionId, outPathRel, {
    draft: input.draft,
    concurrency: input.concurrency,
    browserExecutable: config.render.browserExecutable,
  });
  const result = await spawnCapture(command, args, projectRoot);
  const elapsedSeconds = Math.round((Date.now() - started) / 1000);
  opts.onProgress?.({ framesRendered: result.code === 0 ? totalFrames : 0, totalFrames, currentBeat: null });

  return {
    success: result.code === 0,
    outPath: path.join(projectRoot, outPathRel),
    draft: Boolean(input.draft),
    elapsedSeconds,
    stdout: result.stdout,
    stderr: result.stderr,
    brandLocked,
  };
}

export function registerRenderVideo(server: McpServer): void {
  server.registerTool(
    "render_video",
    {
      title: "Render a composition with the Remotion CLI",
      description:
        "Thin wrapper around `npx remotion render <compositionId> <outPath>`, run in projectRoot via " +
        "child_process.spawn with an argv array (never exec/execSync with a shell string), so a " +
        "user-controlled videoName/outPath can't inject shell syntax. Default compositionId is the video's " +
        "PascalCase name + \"Demo\" (matching stitch_composition's naming), default outPath is " +
        "output/<videoName>.mp4 -- the folder a finished render is meant to be picked up or uploaded from. " +
        "Pass draft for a half resolution, fast encode pass: a five minute video is " +
        "9000 frames and tens of minutes at full quality, which is far too slow a loop for checking whether " +
        "the video is right, and draft is usually enough to judge framing, motion and timing. Pass " +
        "concurrency to cap the worker count; left unset Remotion takes as much of the machine as it can, " +
        "and one render here spawned 25 Chrome workers and starved a second pipeline step running " +
        "alongside it. Renders with verbose logging, because Remotion hides its progress bar when stdout " +
        "is not a TTY and a piped render otherwise writes an empty log for its entire run, leaving no way " +
        "to tell progress from a hang. BRAND-LOCK GATE: refuses to run unless src/brand.ts exists (written " +
        "by extract_brand), so a video never ships wearing openvidstudio's own default look by accident. " +
        "Run extract_brand against the repo being filmed first; pass skipBrandLock: true only when the " +
        "project deliberately has no brand to extract. Returns the render's captured stdout/stderr, how " +
        "long it took, and brandLocked (whether src/brand.ts existed at render time). Pass incremental to render "
        + "each beat to its own cached segment under output/segments/<videoName>/ and concatenate them with "
        + "ffmpeg under stream copy, re-rendering only the beats whose inputs actually changed. A segment is "
        + "reused only when the beat's JSON, its scene source, every artifact it references, its narration, and "
        + "the project-wide inputs (brand tokens, the generated composition, the music bed) all hash identical "
        + "to when it was rendered, so a false hit cannot ship a stale frame. This is what makes diff_beats "
        + "actionable: editing one caption in a ten beat video re-renders one beat instead of all of them. The "
        + "result then also reports reusedBeats, renderedBeats, and how many frames were actually rendered. "
        + "Pass async: true to not block on the render at all: input is validated synchronously same as "
        + "always (a bad call still fails immediately), then the render starts detached and this call "
        + "returns { jobId, estimate } right away. Poll job_status with that jobId for progress (frames "
        + "rendered, current beat, a log tail) and the eventual result, which is exactly the "
        + "RenderVideoResult a synchronous call would have returned. Use this for anything that might run "
        + "past about 60 seconds: MCP clients enforce their own request timeout (Claude Code's "
        + "MCP_TOOL_TIMEOUT, or the SDK client default), and a 40-minute render will not survive one. On "
        + "the synchronous path (async not set), real MCP progress notifications are emitted as the render "
        + "progresses, for any client that attached a progressToken to the request.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        compositionId: z.string().optional(),
        outPath: z.string().optional(),
        draft: z.boolean().optional(),
        concurrency: z.number().positive().optional(),
        skipBrandLock: z.boolean().optional(),
        incremental: z.boolean().optional(),
        async: z.boolean().optional(),
      },
    },
    async (input, extra) =>
      runTool("render_video", async () => {
        if (input.async === true) {
          // Validate synchronously first (throws here, caught by runTool, same as any other
          // tool failure) so a bad call never "succeeds" with a jobId that immediately errors.
          const prepared = prepareRenderVideo(input);
          const totalFrames = tryReadTotalFrames(prepared.projectRoot, prepared.videoName);
          const job = createJob<RenderVideoResult>("render_video", totalFrames);
          // Deliberately not awaited: this keeps running on the event loop after this
          // handler returns, exactly what makes the "return now, finish later" contract work.
          runRenderVideo(input, { onProgress: (p) => updateJobProgress(job.id, p) })
            .then((result) => completeJob(job.id, result))
            .catch((err) => failJob(job.id, err instanceof Error ? err.message : String(err)));
          return { jobId: job.id, estimate: estimateRenderSeconds(totalFrames, Boolean(input.draft)) };
        }

        const progressToken = extra._meta?.progressToken;
        const onProgress =
          progressToken === undefined
            ? undefined
            : (p: RenderProgress) => {
                void extra
                  .sendNotification({
                    method: "notifications/progress",
                    params: {
                      progressToken,
                      progress: p.framesRendered,
                      total: p.totalFrames,
                      message: p.currentBeat ? `rendering beat "${p.currentBeat}"` : undefined,
                    },
                  })
                  .catch(() => {});
              };
        return runRenderVideo(input, { onProgress });
      }),
  );
}

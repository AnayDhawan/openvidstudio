import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import { settleSidecarPath, type SettleReport, type TerminalCast } from "@openvidstudio/capture";
import { pngSize } from "../scenes/pngSize";
import { runTool } from "./mcp";

/**
 * Flags capture artifacts that are technically present but wrong in a way nothing else
 * catches before the render, run over what's on disk plus beats.json -- before scaffolding,
 * unlike validate_scenes (which needs a scene file to exist first). The three failure
 * modes here are all silent: the capture succeeds, the file is on disk, and the defect is
 * only visible once someone actually watches the frame.
 *
 * 1. A screenshot smaller than the frame templates.ts's browser-capture template will
 *    build from it. FRAME_W there is `Math.min(1200, w + 80)`: below 1200px native width,
 *    the frame is already larger than the source at rest, before any camera push -- this
 *    reuses that exact formula rather than a separate guessed threshold, so it agrees with
 *    what scaffold_scene will actually do.
 * 2. A recording (or screenshot) whose own `<asset>.settle.json` sidecar says
 *    `settled: false` -- the same signal validate_scenes already reads post-scaffold,
 *    checked here pre-scaffold instead of inventing a new heuristic for "still loading".
 * 3. A terminal cast capture_terminal marked truncated. TerminalCast has no `truncated`
 *    field of its own (see @openvidstudio/capture's terminal.ts) -- truncation is recorded
 *    as a literal `"[openvidstudio: output truncated]"` marker pushed into `events`, which
 *    is what's actually checked here, not a field that doesn't exist on disk.
 */

export interface QcCaptureInput {
  projectRoot?: string;
  videoName: string;
}

export interface QcFinding {
  beatId: string;
  asset: string;
  severity: "error" | "warning";
  message: string;
}

export interface QcCaptureResult {
  ok: boolean;
  assetsChecked: number;
  findings: QcFinding[];
}

/** Below this native pixel width, templates.ts's own FRAME_W formula already upscales the
 * frame at rest (Math.min(1200, w + 80) > w for any w < 1200) -- this is that same formula's
 * crossover point, not a separately chosen number. */
const MIN_SCREENSHOT_WIDTH = 1200;
/** A capture this short is almost certainly broken (a blank/near-instant screenshot), not a
 * legitimately tiny frame -- catches a bad crop or a zero-content page distinctly from the
 * resolution check above. */
const MIN_SCREENSHOT_HEIGHT = 200;

const TRUNCATED_MARKER = "[openvidstudio: output truncated]";

interface BeatLike {
  id: string;
  visual?: { captureMethod?: string; source?: string };
  artifacts?: { screenshotPath?: string; recordingPath?: string; terminalPath?: string };
}

function readSettleSidecar(assetPathAbs: string): SettleReport | null {
  const sidecarPath = settleSidecarPath(assetPathAbs);
  if (!fs.existsSync(sidecarPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as SettleReport;
  } catch {
    return null; // Malformed sidecar: not this tool's job to diagnose, skip rather than crash.
  }
}

function pendingSummary(report: SettleReport): string {
  const pending: string[] = [];
  if (!report.fontsReady) pending.push("fonts");
  if (!report.imagesReady) pending.push("images");
  if (report.pendingAnimations > 0) pending.push(`${report.pendingAnimations} animation(s)`);
  return pending.join(", ") || "unknown";
}

export function runQcCapture(input: QcCaptureInput): QcCaptureResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const beatsFile = path.join(projectRoot, "src", "videos", videoName, "beats.json");

  if (!fs.existsSync(beatsFile)) {
    throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { beats: BeatLike[] };
  const findings: QcFinding[] = [];
  let checked = 0;

  for (const beat of doc.beats) {
    const method = beat.visual?.captureMethod;
    const source = beat.visual?.source ?? "browser";
    const artifacts = beat.artifacts ?? {};

    if (method === "screenshot" && source === "browser") {
      const rel = artifacts.screenshotPath ?? path.join("public", "images", `${beat.id}.png`);
      const assetPathAbs = path.join(projectRoot, rel);
      if (!fs.existsSync(assetPathAbs)) continue; // Not captured yet -- nothing to QC.
      checked++;

      const size = pngSize(assetPathAbs);
      if (size) {
        if (size.width < MIN_SCREENSHOT_WIDTH) {
          findings.push({
            beatId: beat.id,
            asset: rel,
            severity: "warning",
            message:
              `${size.width}px native width is below the ${MIN_SCREENSHOT_WIDTH}px the browser-capture scene ` +
              `template will build a frame from (FRAME_W = min(1200, w + 80)); the frame will be visibly soft ` +
              `even before any camera push. Re-capture at a wider viewport, or raise deviceScaleFactor.`,
          });
        }
        if (size.height < MIN_SCREENSHOT_HEIGHT) {
          findings.push({
            beatId: beat.id,
            asset: rel,
            severity: "error",
            message: `${size.height}px native height is suspiciously small for a real capture -- looks like a broken or empty crop, not a legitimately short beat.`,
          });
        }
      } else {
        findings.push({
          beatId: beat.id,
          asset: rel,
          severity: "error",
          message: `Could not read PNG dimensions from ${rel} -- the file may be missing its PNG header or corrupted.`,
        });
      }

      const settle = readSettleSidecar(assetPathAbs);
      if (settle && !settle.settled) {
        findings.push({
          beatId: beat.id,
          asset: rel,
          severity: "error",
          message: `Settle timed out after ${settle.waitedMs}ms, still pending: ${pendingSummary(settle)}. The frame may still be a loading state, not the product's real one. Re-run capture_screenshot with a larger settleTimeoutMs.`,
        });
      }
    }

    if (method === "recording" && source !== "terminal") {
      const rel = artifacts.recordingPath ?? path.join("public", "video", `${beat.id}.mp4`);
      const assetPathAbs = path.join(projectRoot, rel);
      if (!fs.existsSync(assetPathAbs)) continue;
      checked++;

      // Settling is a browser-capture concept: capture_desktop/mobile have no settlePage
      // call and never write this sidecar, so there is nothing to check for those sources.
      if (source === "browser") {
        const settle = readSettleSidecar(assetPathAbs);
        if (settle && !settle.settled) {
          findings.push({
            beatId: beat.id,
            asset: rel,
            severity: "error",
            message: `Settle timed out after ${settle.waitedMs}ms, still pending: ${pendingSummary(settle)}. The opening of this recording may still show a loading state instead of the product working. Re-run capture_screen_recording with a larger settleTimeoutMs.`,
          });
        }
      }
    }

    if (source === "terminal") {
      const rel = artifacts.terminalPath ?? path.join("public", "terminal", `${beat.id}.json`);
      const assetPathAbs = path.join(projectRoot, rel);
      if (!fs.existsSync(assetPathAbs)) continue;
      checked++;

      try {
        const cast = JSON.parse(fs.readFileSync(assetPathAbs, "utf8")) as TerminalCast;
        const truncatedEvent = cast.events?.find(([, , text]) => text.includes(TRUNCATED_MARKER));
        if (truncatedEvent) {
          findings.push({
            beatId: beat.id,
            asset: rel,
            severity: "error",
            message: `Cast was truncated (capture_terminal's maxOutputChars or retention cap was hit) -- the replay will end mid-output rather than at the command's real completion. Re-run with a larger maxOutputChars, or trim the command to what actually fits a beat.`,
          });
        }
      } catch {
        findings.push({
          beatId: beat.id,
          asset: rel,
          severity: "error",
          message: `Could not parse ${rel} as a terminal cast -- the file may be missing or malformed.`,
        });
      }
    }
  }

  return { ok: !findings.some((f) => f.severity === "error"), assetsChecked: checked, findings };
}

export function registerQcCapture(server: McpServer): void {
  server.registerTool(
    "qc_capture",
    {
      title: "Flag capture artifacts that are present but wrong",
      description:
        "Runs over capture artifacts already on disk (plus beats.json) before scaffolding, checking what " +
        "succeeding at capture time doesn't guarantee: (a) a screenshot narrower than 1200px native width, " +
        "the exact crossover where templates.ts's own browser-capture FRAME_W formula (min(1200, w + 80)) " +
        "starts upscaling the frame at rest, before any camera push -- warning, since it is visible softness " +
        "not a broken file, plus an error if height is under 200px (looks like a broken/empty crop); (b) a " +
        "screenshot or recording whose `<asset>.settle.json` sidecar reports settled: false (the same signal " +
        "validate_scenes reads post-scaffold, reused here rather than a new heuristic for 'still looks like " +
        "loading') -- error, the opening frame may not be the product's real state; (c) a terminal cast " +
        "capture_terminal marked truncated, detected by the literal " +
        "\"[openvidstudio: output truncated]\" marker event it pushes into `events` (TerminalCast has no " +
        "boolean truncated field of its own) -- error, the replay ends mid-output. A beat with no artifact " +
        "on disk yet is skipped, not flagged: this tool checks what exists, it doesn't require everything to " +
        "already be captured. Returns { ok, assetsChecked, findings } with every failure found, never just " +
        "the first.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
      },
    },
    async (input) => runTool("qc_capture", () => runQcCapture(input)),
  );
}

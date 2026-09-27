import * as fs from "node:fs";
import { cursorSidecarPath, type CursorSidecar } from "@openvidstudio/capture";

export interface ResolvedCursorPoint {
  frame: number;
  x: number;
  y: number;
  click: boolean;
}

export interface ResolvedCursorPath {
  points: ResolvedCursorPoint[];
  viewport: { width: number; height: number };
  /** Raw point count before frame assignment, for the scaffold_scene note. */
  pointCount: number;
}

export type CursorTiming =
  | { kind: "even-spread"; durationFrames: number }
  | { kind: "real-time"; durationFrames: number; fps: number };

/**
 * Reads a capture's `<asset>.cursor.json` sidecar (see @openvidstudio/capture's
 * writeCursorSidecar) and assigns each point a frame number, two different ways depending
 * on what kind of beat this is:
 *
 * - A still (screenshot) has no video timeline for the sidecar's real atMs to be relative
 *   to -- every interaction happened within a few hundred milliseconds of headless replay,
 *   and using that directly would compress the whole cursor path into the opening instant
 *   of a multi-second beat. Points are spread evenly across the beat's own duration
 *   instead, using only their ORDER (kind: "even-spread").
 * - A recording has a real timeline, and the sidecar's atMs is already rebased onto the
 *   recording's own start and compressed by `speed` (see capture_screen_recording), so
 *   frame = atMs/1000*fps places the cursor exactly in sync with what the video is doing
 *   (kind: "real-time").
 *
 * Returns null when there's no sidecar (beat not yet captured, or it had no
 * click/hover/fill/select interactions) rather than throwing -- same best-effort shape as
 * pngSize/probeVideoDurationFrames.
 */
export function readCursorPoints(assetPathAbs: string, timing: CursorTiming): ResolvedCursorPath | null {
  const sidecarPath = cursorSidecarPath(assetPathAbs);
  if (!fs.existsSync(sidecarPath)) return null;

  let sidecar: CursorSidecar;
  try {
    sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as CursorSidecar;
  } catch {
    return null;
  }
  if (!sidecar.points || sidecar.points.length === 0) return null;

  const points =
    timing.kind === "even-spread"
      ? spreadEvenly(sidecar.points, timing.durationFrames)
      : addClickDwell(
          sidecar.points.map((p) => ({
            frame: Math.min(
              Math.max(0, Math.round((p.atMs / 1000) * timing.fps)),
              Math.max(0, timing.durationFrames - 1),
            ),
            x: p.x,
            y: p.y,
            click: p.type === "click",
          })),
          timing.durationFrames,
        );

  return { points, viewport: sidecar.viewport, pointCount: sidecar.points.length };
}

/**
 * A real recording's raw interaction timeline keeps moving right through a click: the mouse
 * doesn't stop just because the sidecar happened to log a click event at that instant. Left
 * alone, CursorActor's path interpolates straight through the click frame and on to wherever
 * the cursor goes next, so by the time the click ring is a few frames into its fade the
 * cursor (and, before A7, the ring itself) has visibly moved off the target -- a real repro
 * measured this ~100px off a real button.
 *
 * This inserts two extra keyframes around every click point, both pinned to the click's own
 * x/y: one ~4 frames before it (arrive), one ~7 frames after (dwell). Between "arrive" and
 * the click, and between the click and "dwell", consecutive keyframes share the same x/y, so
 * CursorActor's interpolation is flat across that span -- the cursor visibly settles onto the
 * target before the click and holds there briefly after, instead of arriving and departing on
 * the same continuous sweep. Only affects real-time (recording) paths: an even-spread still
 * already has margin between its points and no continuous motion to arrest.
 */
function addClickDwell(points: ResolvedCursorPoint[], durationFrames: number): ResolvedCursorPoint[] {
  const ARRIVE_BEFORE = 4;
  const DWELL_AFTER = 7;
  const maxFrame = Math.max(0, durationFrames - 1);
  const withDwell: ResolvedCursorPoint[] = [];
  for (const p of points) {
    withDwell.push(p);
    if (p.click) {
      withDwell.push({ frame: Math.max(0, p.frame - ARRIVE_BEFORE), x: p.x, y: p.y, click: false });
      withDwell.push({ frame: Math.min(maxFrame, p.frame + DWELL_AFTER), x: p.x, y: p.y, click: false });
    }
  }
  return withDwell.sort((a, b) => a.frame - b.frame);
}

function spreadEvenly(rawPoints: CursorSidecar["points"], durationFrames: number): ResolvedCursorPoint[] {
  // Leave room at both ends for the entrance/exit rather than starting the cursor at
  // frame 0 (before the caption/camera have settled in) or ending it on the very last
  // frame (before the beat's own out-transition).
  const margin = Math.round(durationFrames * 0.15);
  const span = Math.max(1, durationFrames - margin * 2);
  return rawPoints.map((p, i) => ({
    frame:
      rawPoints.length === 1
        ? Math.round(durationFrames * 0.5)
        : Math.round(margin + (i / (rawPoints.length - 1)) * span),
    x: p.x,
    y: p.y,
    click: p.type === "click",
  }));
}

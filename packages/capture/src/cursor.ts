import * as fs from "node:fs";
import type { Viewport } from "./browser";

/**
 * Real cursor coordinates recorded during replayInteractions, so scaffold_scene's cursor
 * overlay can show the actor landing where the product was actually clicked instead of a
 * hand-drawn guess.
 *
 * The old way: a scene author who wanted a cursor built one from primitives, picking x/y
 * keyframes by eye against a static screenshot. Nothing tied those numbers to where the
 * real click during capture happened, so a redesign that moved a button left the cursor
 * pointing at empty space with no error anywhere -- the same silent-wrongness failure mode
 * validate_scenes exists to catch for framing, just uncaught for this.
 */

export type CursorPointType = "click" | "hover" | "fill" | "select";

export interface CursorPoint {
  /** Index into the interactions array this point came from, in replay order. */
  index: number;
  type: CursorPointType;
  selector: string;
  /**
   * The target's bounding-rect center, in the CSS-pixel viewport space the capture ran in
   * (the same effective, zoom-compensated space captureWidth/captureHeight describe) --
   * NOT multiplied by deviceScaleFactor. Measured after scrolling the target into view,
   * matching what a real click/hover action does before it acts.
   */
  x: number;
  y: number;
  /**
   * Milliseconds since replayInteractions started measuring this beat's interactions.
   * capture_screen_recording rewrites this to be relative to the RECORDING's own start
   * (adding back the navigation+settle time that ran before replay began) before writing
   * the sidecar, so a consumer can turn it into a frame via fps directly. capture_screenshot
   * leaves it replay-relative: a still has no video timeline for it to be relative to.
   */
  atMs: number;
}

export interface CursorSidecar {
  /**
   * The CSS-pixel viewport the points were measured in. Carried here explicitly rather
   * than assumed, so a consumer can convert a point into its own stage/frame geometry
   * without having to reprobe or guess the capture's own viewport.
   */
  viewport: Viewport;
  points: CursorPoint[];
}

export function cursorSidecarPath(outPathAbs: string): string {
  return `${outPathAbs}.cursor.json`;
}

/**
 * Persists recorded cursor points next to the artifact they describe, mirroring settle's
 * `<outPath>.settle.json` sidecar convention. Writes nothing when there are no points, so a
 * beat with no click/hover/fill/select interactions (most `dom-demo`-adjacent capture
 * beats, or one that only scrolls/waits) produces no sidecar rather than an empty,
 * meaningless file that scaffold_scene would otherwise have to special-case around.
 */
export function writeCursorSidecar(outPathAbs: string, viewport: Viewport, points: CursorPoint[]): void {
  if (points.length === 0) return;
  const sidecar: CursorSidecar = { viewport, points };
  fs.writeFileSync(cursorSidecarPath(outPathAbs), JSON.stringify(sidecar, null, 2) + "\n", "utf8");
}

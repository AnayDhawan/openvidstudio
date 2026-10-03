import * as fs from "node:fs";
import type { Interaction, Viewport } from "./browser";

/**
 * What docs_drift and release_diff need to re-capture a reference frame the SAME way it
 * was captured the first time, instead of guessing a CSS viewport back out of the reference
 * image's own pixel dimensions.
 *
 * That guess is the bug this sidecar exists to kill: a screenshot taken at a 1440x900 CSS
 * viewport with deviceScaleFactor 2 is a 2880x1800 PNG on disk, and treating 2880x1800 as
 * the viewport to re-navigate to is a completely different, much wider layout -- not the
 * page that was actually captured, just a bigger one. Every re-capture built on that guess
 * reports drift on a page that never changed.
 *
 * `viewport` here is the *requested* CSS viewport (the same value passed to
 * `detectAndCompensateZoom` as `target`), not the compensated size that call returned.
 * Re-feeding the request through that same live zoom-detection path on whatever machine
 * does the re-capture is what CAPTURE.md's "never hardcode the ratio, it differs per
 * machine/profile" rule requires -- baking in one machine's already-compensated size would
 * just move the guessing problem, not remove it. `zoom` is carried along anyway, purely as
 * a record of what this capture measured; nothing re-derives a viewport from it.
 */
export interface CaptureSidecar {
  url: string;
  viewport: Viewport;
  deviceScaleFactor: number;
  /** The zoom-desync ratio measured at capture time. Informational: a re-capture measures its own. */
  zoom: number;
  /** Replayed before the capture. Absent when there were none. */
  interactions?: Interaction[];
  /** ISO-8601 timestamp of the capture. */
  capturedAt: string;
}

/** Sidecar path for a capture artifact, mirroring settle's/cursor's `<outPath>.*.json` convention. */
export function captureSidecarPath(outPathAbs: string): string {
  return `${outPathAbs}.capture.json`;
}

/**
 * Persists a CaptureSidecar next to the artifact it describes. Written for every capture,
 * cropSelector-based ones included: docs_drift already requires an explicit binding for a
 * cropSelector beat (its reference is a crop of a page, not a view of one), and this sidecar
 * does not change that, it just gives every OTHER beat a real binding to read instead of a
 * guess.
 */
export function writeCaptureSidecar(outPathAbs: string, sidecar: CaptureSidecar): void {
  fs.writeFileSync(captureSidecarPath(outPathAbs), JSON.stringify(sidecar, null, 2) + "\n", "utf8");
}

/** Reads the sidecar for a capture artifact, or undefined when there isn't one (a legacy asset). */
export function readCaptureSidecar(outPathAbs: string): CaptureSidecar | undefined {
  const sidecarPath = captureSidecarPath(outPathAbs);
  if (!fs.existsSync(sidecarPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as CaptureSidecar;
  } catch {
    return undefined;
  }
}

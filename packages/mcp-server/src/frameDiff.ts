import sharp from "sharp";

/**
 * Frame comparison, shared by visual regression and docs-drift detection.
 *
 * Both answer the same question, "has this picture changed enough to care", and both have
 * the same failure mode if done naively: a strict byte comparison reports a difference on
 * every run, because an encoder is not deterministic at the pixel level and antialiasing
 * moves under a font update. A comparison that is useful has to separate "a few pixels
 * shifted by one value" from "this panel is a different colour now".
 *
 * So there are two numbers, and they say different things. `meanDelta` is the average
 * per-pixel difference across the frame, which catches a global change (a palette swap, a
 * brightness shift) that moves everything slightly. `changedRatio` is the fraction of
 * pixels that moved more than a per-pixel threshold, which catches a local change (one
 * button, one line of text) that leaves the mean almost untouched. A threshold on either
 * alone misses half the real cases.
 */

export interface FrameComparison {
  /** Average absolute per-channel difference, 0 to 1. */
  meanDelta: number;
  /** Fraction of pixels whose worst channel moved past the per-pixel threshold, 0 to 1. */
  changedRatio: number;
  /** The size both frames were normalized to before comparing. */
  width: number;
  height: number;
  /** True when the inputs were not the same size, which is itself usually the finding. */
  resized: boolean;
}

export interface CompareOptions {
  /**
   * Per-channel difference, 0-255, above which a pixel counts as changed. 12 ignores
   * encoder noise and subpixel antialiasing while still catching any real repaint.
   */
  pixelThreshold?: number;
  /**
   * Frames are compared at this width. Downscaling first is not a shortcut: it is what
   * makes the comparison stable, since it averages away the single-pixel antialiasing
   * differences that are not what anyone means by "the page changed".
   */
  compareWidth?: number;
  /** When set, a PNG highlighting the changed pixels in red is written here. */
  diffPath?: string;
}

export const DEFAULT_PIXEL_THRESHOLD = 12;
export const DEFAULT_COMPARE_WIDTH = 640;

interface Normalized {
  data: Buffer;
  width: number;
  height: number;
}

async function normalize(input: string, width: number, height?: number): Promise<Normalized> {
  const pipeline = sharp(input).removeAlpha();
  const resized = height ? pipeline.resize(width, height, { fit: "fill" }) : pipeline.resize({ width });
  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Compares two image files and, optionally, writes a diff image.
 *
 * The second frame is forced to the first's dimensions rather than refused. A page that
 * got taller has genuinely changed, and reporting that as an error instead of as a
 * difference would hide the finding behind a crash.
 */
export async function compareFrames(
  beforePath: string,
  afterPath: string,
  opts: CompareOptions = {},
): Promise<FrameComparison> {
  const threshold = opts.pixelThreshold ?? DEFAULT_PIXEL_THRESHOLD;
  const compareWidth = opts.compareWidth ?? DEFAULT_COMPARE_WIDTH;

  const before = await normalize(beforePath, compareWidth);
  const beforeMeta = await sharp(beforePath).metadata();
  const afterMeta = await sharp(afterPath).metadata();
  const after = await normalize(afterPath, before.width, before.height);

  const pixels = before.width * before.height;
  const channels = 3;
  let sum = 0;
  let changed = 0;
  const diff = opts.diffPath ? Buffer.alloc(pixels * channels) : null;

  for (let p = 0; p < pixels; p++) {
    const i = p * channels;
    const dr = Math.abs(before.data[i] - after.data[i]);
    const dg = Math.abs(before.data[i + 1] - after.data[i + 1]);
    const db = Math.abs(before.data[i + 2] - after.data[i + 2]);
    sum += dr + dg + db;
    const worst = Math.max(dr, dg, db);
    const isChanged = worst > threshold;
    if (isChanged) changed++;
    if (diff) {
      if (isChanged) {
        diff[i] = 255;
        diff[i + 1] = 32;
        diff[i + 2] = 32;
      } else {
        // Unchanged pixels stay visible but dimmed, so the highlight reads as a mark on
        // the page rather than as a red shape floating on nothing.
        const grey = Math.round((after.data[i] + after.data[i + 1] + after.data[i + 2]) / 3 / 3);
        diff[i] = grey;
        diff[i + 1] = grey;
        diff[i + 2] = grey;
      }
    }
  }

  if (diff && opts.diffPath) {
    await sharp(diff, { raw: { width: before.width, height: before.height, channels: 3 } })
      .png()
      .toFile(opts.diffPath);
  }

  return {
    meanDelta: sum / (pixels * channels) / 255,
    changedRatio: changed / pixels,
    width: before.width,
    height: before.height,
    resized: beforeMeta.width !== afterMeta.width || beforeMeta.height !== afterMeta.height,
  };
}

export interface DriftVerdict {
  drifted: boolean;
  reason: string;
}

/**
 * Turns the two numbers into one answer.
 *
 * Either signal alone is enough, because they catch different shapes of change: a
 * repainted button barely moves the mean, and a palette shift barely moves the changed
 * pixel count.
 */
export function judgeDrift(
  comparison: FrameComparison,
  thresholds: { changedRatio?: number; meanDelta?: number } = {},
): DriftVerdict {
  const changedLimit = thresholds.changedRatio ?? 0.02;
  const meanLimit = thresholds.meanDelta ?? 0.01;

  if (comparison.resized) {
    return {
      drifted: true,
      reason: "the frame is a different size than the reference, which is a layout change by itself",
    };
  }
  if (comparison.changedRatio > changedLimit) {
    return {
      drifted: true,
      reason:
        `${(comparison.changedRatio * 100).toFixed(2)}% of pixels moved, past the ` +
        `${(changedLimit * 100).toFixed(2)}% limit`,
    };
  }
  if (comparison.meanDelta > meanLimit) {
    return {
      drifted: true,
      reason:
        `the average pixel moved ${(comparison.meanDelta * 100).toFixed(2)}%, past the ` +
        `${(meanLimit * 100).toFixed(2)}% limit, which is the shape of a palette or brightness change`,
    };
  }
  return { drifted: false, reason: "within both thresholds" };
}

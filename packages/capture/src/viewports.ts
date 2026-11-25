import * as path from "node:path";
import { z } from "zod";
import { DEFAULT_DEVICE_SCALE, type Viewport } from "./browser";

/**
 * Several viewports in one capture call.
 *
 * One page is usually three pages: a desktop layout, a tablet one and a phone one, and a demo
 * that shows the responsive layout needs all of them from the same URL and the same state. Each
 * viewport gets its own browser context, so its own viewport and its own device pixel ratio (a
 * phone is 3x, a desktop 1x or 2x, and a context cannot change that after it is created), and its
 * own output file named for it.
 */

export interface ViewportSpec {
  /** File-name suffix for this viewport (hook-phone.png). Defaults to the size, e.g. "1920x1080". */
  name?: string;
  width: number;
  height: number;
  /** Pixels per CSS pixel for this viewport. Defaults to the call's deviceScaleFactor. */
  deviceScaleFactor?: number;
}

export interface ResolvedViewport {
  name: string;
  viewport: Viewport;
  deviceScaleFactor: number;
}

/** Named sizes a caller can ask for by name. The pixel ratios are what real devices of that class report. */
export const VIEWPORT_PRESETS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  laptop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  tablet: { width: 834, height: 1194, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, deviceScaleFactor: 3 },
} as const;

export type ViewportPresetName = keyof typeof VIEWPORT_PRESETS;

export const viewportSpecSchema = z.object({
  name: z.string().min(1).optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive().optional(),
});

/** A request entry: a preset name ("phone") or an explicit { width, height, ... }. */
export const viewportRequestSchema = z.union([z.enum(Object.keys(VIEWPORT_PRESETS) as [ViewportPresetName, ...ViewportPresetName[]]), viewportSpecSchema]);

export type ViewportRequest = ViewportPresetName | ViewportSpec;

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Turns a request list into one entry per viewport with a name and a pixel ratio, or throws
 * before any browser opens. Names have to be unique and safe to put in a file name; two entries
 * that would write the same file are an error, never a silent overwrite.
 */
export function resolveViewports(requests: ViewportRequest[], defaultDeviceScaleFactor: number = DEFAULT_DEVICE_SCALE): ResolvedViewport[] {
  if (requests.length === 0) throw new Error("viewports is empty. Pass at least one viewport, or omit it for the single default.");
  const out: ResolvedViewport[] = [];
  const seen = new Set<string>();
  requests.forEach((req, i) => {
    const spec: ViewportSpec & { presetName?: string } =
      typeof req === "string" ? { ...VIEWPORT_PRESETS[req], name: req } : req;
    if (typeof req === "string" && !(req in VIEWPORT_PRESETS)) {
      throw new Error(`viewports[${i}]: "${req}" is not a preset. Presets: ${Object.keys(VIEWPORT_PRESETS).join(", ")}.`);
    }
    if (!(spec.width > 0) || !(spec.height > 0)) throw new Error(`viewports[${i}]: width and height must be positive.`);
    const name = spec.name ?? `${spec.width}x${spec.height}`;
    if (!SAFE_NAME.test(name)) {
      throw new Error(`viewports[${i}].name "${name}" must be letters, digits, "-" or "_" (it becomes part of a file name).`);
    }
    if (seen.has(name)) {
      throw new Error(`viewports[${i}].name "${name}" is used twice, so two captures would write the same file. Give each viewport its own name.`);
    }
    seen.add(name);
    out.push({
      name,
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: spec.deviceScaleFactor ?? defaultDeviceScaleFactor,
    });
  });
  return out;
}

/** `public/images/hook.png` -> `public/images/hook-phone.png`: the viewport's name goes before the extension. */
export function viewportOutPath(outPath: string, name: string): string {
  const ext = path.extname(outPath);
  return `${outPath.slice(0, outPath.length - ext.length)}-${name}${ext}`;
}

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * openvidstudio.config.json's shape, written by init_project into a *user's* project
 * root (not this monorepo). hasHiggsfield is what import_higgsfield_clip's tool
 * registration gates on (read once at server-startup by stdio.ts, see registerTools);
 * targetDurationSeconds/videoConfig are read by stitch_composition and render_video for
 * defaults not stated by beats.json itself.
 */
export interface VideoConfig {
  fps: number;
  width: number;
  height: number;
}

export interface CaptureConfig {
  /** The running app every capture points at unless a beat names its own url. */
  appUrl: string;
  width: number;
  height: number;
  /** Milliseconds to wait after load, so entrance animations finish before the shot. */
  settleMs: number;
}

export interface NarrationConfig {
  engine: "edge-tts" | "say" | "espeak";
  voice: string;
}

export interface RenderConfig {
  /**
   * Absolute path to a Chromium/Chrome executable, passed to the Remotion CLI as
   * --browser-executable so it reuses that browser instead of downloading its own
   * chrome-headless-shell. Point this at the same build capture already launches
   * (chromium.executablePath() from @openvidstudio/capture, which is what preflight's
   * "chromium" check reports) so a render works on a machine that has Playwright's
   * browser installed but no route to download Remotion's separate one. No default: an
   * unset value means "let Remotion manage its own browser," today's existing behavior.
   */
  browserExecutable?: string;
}

export type CreativeLevel = "peak" | "mid" | "literal";

/**
 * "standard" is every product video: a story built from real captures, with a creative level.
 * "supernova" is a STEM lesson: a script-first, narrated 1080x1920 explanation with no real
 * product behind it. It is a different kind of production, not a fourth creative level.
 */
export type ProductionMode = "standard" | "supernova";
export const PRODUCTION_MODES: readonly ProductionMode[] = ["standard", "supernova"];

export interface ProductionConfig {
  /**
   * Stored only when it is "supernova": a standard project's config file never gains the key.
   * Read it through productionMode(), which gives "standard" when it is absent.
   */
  mode?: ProductionMode;
  /**
   * peak: full creative liberty (bespoke story, design system, motion language, score).
   * mid: strong defaults, template-leaning, lighter review. literal: do exactly what was
   * specified, nothing added. Set once per video by plan_production's intake, mirrored
   * into that video's beats.json so a tool reading beats.json alone (not this config)
   * still knows the level. No default: unlike every other section here, there's no sane
   * guess for this one, it has to come from asking.
   */
  creativeLevel?: CreativeLevel;
  /** Wall-clock minutes the user is willing to wait for the finished video. Also no default. */
  timeBudgetMinutes?: number;
}

export interface OpenvidstudioConfig {
  hasHiggsfield: boolean;
  targetDurationSeconds: number;
  videoConfig: VideoConfig;
  capture: CaptureConfig;
  narration: NarrationConfig;
  render: RenderConfig;
  production: ProductionConfig;
  /**
   * Lines write_description appends, each exactly once, at the end of every lesson description ("Constructed
   * animation, not footage", an exam-board non-affiliation line). Absent by default, and then the key is not written.
   */
  disclaimers?: string[];
}

export interface ConfigPatch {
  hasHiggsfield?: boolean;
  targetDurationSeconds?: number;
  videoConfig?: Partial<VideoConfig>;
  capture?: Partial<CaptureConfig>;
  narration?: Partial<NarrationConfig>;
  render?: Partial<RenderConfig>;
  production?: Partial<ProductionConfig>;
  disclaimers?: string[];
}

/**
 * Defaults chosen so a bare request works with no configuration.
 *
 * `settleMs` is deliberately not zero. A capture taken the instant a page loads
 * catches entrance animations mid-flight, and the resulting frame looks broken
 * rather than obviously wrong, so it survives review. 1200ms clears a typical
 * entrance without making capture feel slow.
 */
export const DEFAULT_CONFIG: OpenvidstudioConfig = {
  hasHiggsfield: false,
  targetDurationSeconds: 60,
  videoConfig: { fps: 30, width: 1920, height: 1080 },
  capture: { appUrl: "http://localhost:3000", width: 1440, height: 900, settleMs: 1200 },
  narration: { engine: "edge-tts", voice: "en-US-AndrewNeural" },
  render: {},
  production: {},
};

/** A project's production mode: "standard" unless its config says "supernova". */
export function productionMode(config: { production?: ProductionConfig }): ProductionMode {
  return config.production?.mode === "supernova" ? "supernova" : "standard";
}

export const CONFIG_FILE_NAME = "openvidstudio.config.json";

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_FILE_NAME);
}

/** Reads openvidstudio.config.json, filling in defaults for any field it omits. */
export function loadConfig(projectRoot: string): OpenvidstudioConfig {
  const file = configPath(projectRoot);
  if (!fs.existsSync(file)) {
    return {
      hasHiggsfield: DEFAULT_CONFIG.hasHiggsfield,
      targetDurationSeconds: DEFAULT_CONFIG.targetDurationSeconds,
      videoConfig: { ...DEFAULT_CONFIG.videoConfig },
      capture: { ...DEFAULT_CONFIG.capture },
      narration: { ...DEFAULT_CONFIG.narration },
      render: { ...DEFAULT_CONFIG.render },
      production: { ...DEFAULT_CONFIG.production },
    };
  }

  let raw: Partial<OpenvidstudioConfig>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<OpenvidstudioConfig>;
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    hasHiggsfield: raw.hasHiggsfield ?? DEFAULT_CONFIG.hasHiggsfield,
    targetDurationSeconds: raw.targetDurationSeconds ?? DEFAULT_CONFIG.targetDurationSeconds,
    videoConfig: {
      fps: raw.videoConfig?.fps ?? DEFAULT_CONFIG.videoConfig.fps,
      width: raw.videoConfig?.width ?? DEFAULT_CONFIG.videoConfig.width,
      height: raw.videoConfig?.height ?? DEFAULT_CONFIG.videoConfig.height,
    },
    capture: {
      appUrl: raw.capture?.appUrl ?? DEFAULT_CONFIG.capture.appUrl,
      width: raw.capture?.width ?? DEFAULT_CONFIG.capture.width,
      height: raw.capture?.height ?? DEFAULT_CONFIG.capture.height,
      settleMs: raw.capture?.settleMs ?? DEFAULT_CONFIG.capture.settleMs,
    },
    narration: {
      engine: raw.narration?.engine ?? DEFAULT_CONFIG.narration.engine,
      voice: raw.narration?.voice ?? DEFAULT_CONFIG.narration.voice,
    },
    render: {
      browserExecutable: raw.render?.browserExecutable ?? DEFAULT_CONFIG.render.browserExecutable,
    },
    production: {
      mode: raw.production?.mode ?? DEFAULT_CONFIG.production.mode,
      creativeLevel: raw.production?.creativeLevel ?? DEFAULT_CONFIG.production.creativeLevel,
      timeBudgetMinutes: raw.production?.timeBudgetMinutes ?? DEFAULT_CONFIG.production.timeBudgetMinutes,
    },
    ...(Array.isArray(raw.disclaimers) ? { disclaimers: raw.disclaimers.filter((d): d is string => typeof d === "string") } : {}),
  };
}

/**
 * Merges `patch` over whatever config already exists (or the defaults, if none does),
 * writes the result, and returns it. Only fields actually present in `patch` override
 * the existing value -- an `undefined` field in `patch` (the common case, since every
 * init_project input field is optional) never clobbers an existing real value.
 */
export function writeConfig(projectRoot: string, patch: ConfigPatch): OpenvidstudioConfig {
  const existing = loadConfig(projectRoot);
  const merged: OpenvidstudioConfig = {
    hasHiggsfield: patch.hasHiggsfield ?? existing.hasHiggsfield,
    targetDurationSeconds: patch.targetDurationSeconds ?? existing.targetDurationSeconds,
    videoConfig: {
      fps: patch.videoConfig?.fps ?? existing.videoConfig.fps,
      width: patch.videoConfig?.width ?? existing.videoConfig.width,
      height: patch.videoConfig?.height ?? existing.videoConfig.height,
    },
    capture: {
      appUrl: patch.capture?.appUrl ?? existing.capture.appUrl,
      width: patch.capture?.width ?? existing.capture.width,
      height: patch.capture?.height ?? existing.capture.height,
      settleMs: patch.capture?.settleMs ?? existing.capture.settleMs,
    },
    narration: {
      engine: patch.narration?.engine ?? existing.narration.engine,
      voice: patch.narration?.voice ?? existing.narration.voice,
    },
    render: {
      browserExecutable: patch.render?.browserExecutable ?? existing.render.browserExecutable,
    },
    production: {
      mode: patch.production?.mode ?? existing.production.mode,
      creativeLevel: patch.production?.creativeLevel ?? existing.production.creativeLevel,
      timeBudgetMinutes: patch.production?.timeBudgetMinutes ?? existing.production.timeBudgetMinutes,
    },
    ...((patch.disclaimers ?? existing.disclaimers) !== undefined ? { disclaimers: patch.disclaimers ?? existing.disclaimers } : {}),
  };
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(configPath(projectRoot), JSON.stringify(merged, null, 2) + "\n", "utf8");
  return merged;
}

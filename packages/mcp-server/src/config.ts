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

export interface OpenvidstudioConfig {
  hasHiggsfield: boolean;
  targetDurationSeconds: number;
  videoConfig: VideoConfig;
}

export interface ConfigPatch {
  hasHiggsfield?: boolean;
  targetDurationSeconds?: number;
  videoConfig?: Partial<VideoConfig>;
}

export const DEFAULT_CONFIG: OpenvidstudioConfig = {
  hasHiggsfield: false,
  targetDurationSeconds: 60,
  videoConfig: { fps: 30, width: 1920, height: 1080 },
};

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
  };
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(configPath(projectRoot), JSON.stringify(merged, null, 2) + "\n", "utf8");
  return merged;
}

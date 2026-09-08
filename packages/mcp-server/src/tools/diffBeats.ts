import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import { runTool } from "./mcp";

/**
 * Turns an edited beats.json draft into a concrete rerun plan against the version
 * already on disk, instead of leaving the calling agent to eyeball a JSON diff and
 * guess what still needs redoing. Every capture/scaffold tool is already independently
 * callable per beat (capture_screenshot, capture_screen_recording, scaffold_scene with
 * overwrite: true); this tool is what tells the agent which beat ids actually need one
 * of those calls after an edit, and which don't, so patching one field doesn't turn
 * into re-running the whole pipeline. render_video always re-renders the full
 * composition (Remotion has no partial-render mode), so `rerenderNeeded` is a single
 * yes/no covering the whole video, not a per-beat field.
 */

const CAPTURE_RELEVANT_METHODS = new Set(["screenshot", "recording", "higgsfield"]);
const RESCAFFOLD_FIELDS = new Set(["duration", "vo", "visual", "transition"]);

export type BeatStatus = "added" | "removed" | "unchanged" | "changed";

export interface BeatArtifactPresence {
  screenshot: boolean;
  recording: boolean;
  vo: boolean;
}

export interface BeatDiff {
  id: string;
  status: BeatStatus;
  changedFields: string[];
  /** True when a capture tool (capture_screenshot/capture_screen_recording/import_higgsfield_clip) should rerun for this beat. */
  needsRecapture: boolean;
  /** True when scaffold_scene should rerun (overwrite: true) for this beat. */
  needsRescaffold: boolean;
  /** Whether each convention/override output path actually exists on disk right now, checked against the NEW beat's artifacts. */
  artifactsOnDisk: BeatArtifactPresence;
}

export interface DiffBeatsResult {
  fpsChanged: boolean;
  titleChanged: boolean;
  beats: BeatDiff[];
  summary: { added: number; removed: number; changed: number; unchanged: number };
  /** Remotion renders the whole composition every time; this is the one whole-video signal. */
  rerenderNeeded: boolean;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

interface BeatLike {
  id: string;
  start?: unknown;
  duration?: unknown;
  vo?: unknown;
  visual?: Record<string, unknown>;
  transition?: unknown;
  artifacts?: Record<string, unknown>;
}

function indexById(beats: unknown): Map<string, BeatLike> {
  const map = new Map<string, BeatLike>();
  if (!Array.isArray(beats)) return map;
  for (const raw of beats) {
    if (typeof raw !== "object" || raw === null) continue;
    const beat = raw as BeatLike;
    if (typeof beat.id === "string" && beat.id.length > 0) map.set(beat.id, beat);
  }
  return map;
}

interface BeatArtifactPaths {
  screenshotPath: string;
  recordingPath: string;
  voPath: string;
}

/** Mirrors PIPELINE.md's Asset conventions table / PLANNING.md §4.5's artifacts override. */
function artifactPaths(beat: BeatLike | undefined, beatId: string): BeatArtifactPaths {
  const artifacts = (beat?.artifacts ?? {}) as Record<string, unknown>;
  return {
    screenshotPath: typeof artifacts.screenshotPath === "string" ? artifacts.screenshotPath : path.join("public", "images", `${beatId}.png`),
    recordingPath: typeof artifacts.recordingPath === "string" ? artifacts.recordingPath : path.join("public", "video", `${beatId}.mp4`),
    voPath: typeof artifacts.voPath === "string" ? artifacts.voPath : path.join("public", "audio", "vo", `${beatId}.mp3`),
  };
}

function artifactPresence(beat: BeatLike | undefined, beatId: string, projectRoot: string): BeatArtifactPresence {
  const p = artifactPaths(beat, beatId);
  const exists = (rel: string): boolean => {
    try {
      return fs.existsSync(path.join(projectRoot, rel));
    } catch {
      return false;
    }
  };
  return { screenshot: exists(p.screenshotPath), recording: exists(p.recordingPath), vo: exists(p.voPath) };
}

/**
 * Pure diff over two already-parsed beats.json documents. `projectRoot` is only used
 * to check which artifact files actually exist on disk right now (a fresh checkout or
 * a beat that's never been captured reports every path absent, which is correct, not
 * a bug); it never reads oldBeatsJson/newBeatsJson from disk itself.
 */
export function diffBeatsLogic(oldBeatsJson: unknown, newBeatsJson: unknown, projectRoot: string): DiffBeatsResult {
  const oldRoot = (typeof oldBeatsJson === "object" && oldBeatsJson !== null ? oldBeatsJson : {}) as Record<string, unknown>;
  const newRoot = (typeof newBeatsJson === "object" && newBeatsJson !== null ? newBeatsJson : {}) as Record<string, unknown>;

  const oldBeats = indexById(oldRoot.beats);
  const newBeats = indexById(newRoot.beats);

  const fpsChanged = !deepEqual(oldRoot.fps, newRoot.fps);
  const titleChanged = !deepEqual(oldRoot.title, newRoot.title);

  const ids = new Set<string>([...oldBeats.keys(), ...newBeats.keys()]);
  const beats: BeatDiff[] = [];

  for (const id of ids) {
    const oldBeat = oldBeats.get(id);
    const newBeat = newBeats.get(id);

    if (!oldBeat && newBeat) {
      const captureMethod = String(newBeat.visual?.captureMethod ?? "");
      beats.push({
        id,
        status: "added",
        changedFields: [],
        needsRecapture: CAPTURE_RELEVANT_METHODS.has(captureMethod),
        needsRescaffold: true,
        artifactsOnDisk: artifactPresence(newBeat, id, projectRoot),
      });
      continue;
    }
    if (oldBeat && !newBeat) {
      beats.push({
        id,
        status: "removed",
        changedFields: [],
        needsRecapture: false,
        needsRescaffold: false,
        artifactsOnDisk: { screenshot: false, recording: false, vo: false },
      });
      continue;
    }
    if (!oldBeat || !newBeat) continue;

    const changedFields: string[] = [];
    for (const field of ["start", "duration", "vo", "transition"] as const) {
      if (!deepEqual(oldBeat[field], newBeat[field])) changedFields.push(field);
    }
    if (!deepEqual(oldBeat.visual, newBeat.visual)) changedFields.push("visual");
    if (!deepEqual(oldBeat.artifacts, newBeat.artifacts)) changedFields.push("artifacts");

    const status: BeatStatus = changedFields.length > 0 ? "changed" : "unchanged";
    const captureMethod = String(newBeat.visual?.captureMethod ?? "");
    const needsRecapture = changedFields.includes("visual") && CAPTURE_RELEVANT_METHODS.has(captureMethod);
    const needsRescaffold = changedFields.some((f) => RESCAFFOLD_FIELDS.has(f));

    beats.push({
      id,
      status,
      changedFields,
      needsRecapture,
      needsRescaffold,
      artifactsOnDisk: artifactPresence(newBeat, id, projectRoot),
    });
  }

  const summary = {
    added: beats.filter((b) => b.status === "added").length,
    removed: beats.filter((b) => b.status === "removed").length,
    changed: beats.filter((b) => b.status === "changed").length,
    unchanged: beats.filter((b) => b.status === "unchanged").length,
  };

  const rerenderNeeded = fpsChanged || summary.added + summary.removed + summary.changed > 0;

  return { fpsChanged, titleChanged, beats, summary, rerenderNeeded };
}

export interface DiffBeatsInput {
  projectRoot?: string;
  videoName: string;
  newBeatsJson: unknown;
}

export type DiffBeatsToolResult = DiffBeatsResult & { oldBeatsFileFound: boolean };

export function runDiffBeats(input: DiffBeatsInput): DiffBeatsToolResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const oldPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");

  let oldBeatsJson: unknown = { beats: [] };
  let oldBeatsFileFound = false;
  try {
    oldBeatsJson = JSON.parse(fs.readFileSync(oldPath, "utf8"));
    oldBeatsFileFound = true;
  } catch {
    // No persisted beats.json yet: every beat in newBeatsJson diffs as "added", which is correct
    // for a first draft (nothing to rerun selectively, the whole pipeline runs once).
  }

  const result = diffBeatsLogic(oldBeatsJson, input.newBeatsJson, projectRoot);
  return { ...result, oldBeatsFileFound };
}

export function registerDiffBeats(server: McpServer): void {
  server.registerTool(
    "diff_beats",
    {
      title: "Turn an edited beats.json draft into a per-beat rerun plan",
      description:
        "Compares a new beats.json draft (not yet written to disk) against the version already persisted " +
        "at src/videos/<videoName>/beats.json, and returns a per-beat status (added/removed/unchanged/" +
        "changed, with which fields changed) plus two rerun signals per beat: needsRecapture (true when " +
        "visual.* changed on a screenshot/recording/higgsfield beat, meaning capture_screenshot/" +
        "capture_screen_recording/import_higgsfield_clip should run again for that beat id) and " +
        "needsRescaffold (true when duration/vo/visual/transition changed, meaning scaffold_scene should " +
        "rerun with overwrite: true). Also reports artifactsOnDisk per beat (whether its screenshot/" +
        "recording/vo file actually exists right now, per PIPELINE.md's convention paths or the beat's own " +
        "artifacts override) and a single whole-video rerenderNeeded flag, since Remotion has no partial-" +
        "render mode and always renders the full composition. If no beats.json exists yet at that path, " +
        "every beat in the draft comes back \"added\" (a first draft has nothing to selectively rerun). " +
        "This tool never writes anything: it's read-only comparison, meant to run before write_beats_file " +
        "so the agent (and the dev, at the approval gate) know exactly which capture/scaffold calls the " +
        "edit actually requires instead of redoing the whole pipeline for a one-field change.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        newBeatsJson: z.unknown().describe("The edited beats.json draft (an object), not yet written to disk."),
      },
    },
    async (input) => runTool("diff_beats", () => runDiffBeats(input)),
  );
}

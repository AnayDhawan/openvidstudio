import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, pascalCase } from "../util";
import { loadConfig } from "../config";
import { runTool } from "./mcp";

/**
 * The worst failure class in this pipeline is silent wrongness: a scene renders
 * successfully and is simply wrong.
 *
 * The commonest instance is framing. Scenes lay content out on a 1920x1080 stage, but
 * the camera only ever shows stage divided by scale, so at 1.4 that is 1371x771 and
 * anything wider is cropped at the frame edge. Nothing errors. Building one real video
 * this cropped three scenes, and it was only caught by rendering stills and looking.
 *
 * This reads the scene sources and reports the mismatches that are visible statically:
 * camera scales against the content widths declared in the file, missing capture
 * assets, and scenes that never move.
 */

export interface ValidateScenesInput {
  projectRoot?: string;
  videoName: string;
}

export interface SceneFinding {
  beatId: string;
  scene: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidateScenesResult {
  ok: boolean;
  scenesChecked: number;
  findings: SceneFinding[];
}

const STAGE_W = 1920;
const STAGE_H = 1080;

interface BeatLike {
  id: string;
  visual?: { captureMethod?: string };
}

/** Every numeric `scale:` in the camera array. */
function cameraScales(src: string): number[] {
  return [...src.matchAll(/scale:\s*([\d.]+)/g)]
    .map((m) => Number.parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));
}

/** Explicit pixel widths a scene declares, which is what gets cropped. */
function declaredWidths(src: string): number[] {
  const out: number[] = [];
  for (const m of src.matchAll(/\bwidth[=:]\s*\{?\s*(\d{3,4})\b/g)) out.push(Number(m[1]));
  for (const m of src.matchAll(/\bFRAME_W\s*=\s*(\d{3,4})\b/g)) out.push(Number(m[1]));
  for (const m of src.matchAll(/\bmaxWidth:\s*(\d{3,4})\b/g)) out.push(Number(m[1]));
  return out;
}

export function runValidateScenes(input: ValidateScenesInput): ValidateScenesResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const config = loadConfig(projectRoot);
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  const scenesDir = path.join(videoDir, "scenes");
  const beatsFile = path.join(videoDir, "beats.json");

  if (!fs.existsSync(beatsFile)) {
    throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { beats: BeatLike[] };
  const findings: SceneFinding[] = [];
  let checked = 0;

  for (const beat of doc.beats) {
    const component = pascalCase(beat.id);
    const file = path.join(scenesDir, `${component}.tsx`);
    if (!fs.existsSync(file)) {
      findings.push({
        beatId: beat.id,
        scene: `${component}.tsx`,
        severity: "error",
        message: `No scene file. Run scaffold_scene for this beat.`,
      });
      continue;
    }
    checked++;
    const src = fs.readFileSync(file, "utf8");

    // Framing. The binding number is the scene's highest scale, not its first.
    const scales = cameraScales(src);
    const maxScale = scales.length ? Math.max(...scales) : 1;
    const visibleW = Math.round(STAGE_W / maxScale);
    const visibleH = Math.round(STAGE_H / maxScale);
    for (const w of declaredWidths(src)) {
      if (w > visibleW) {
        findings.push({
          beatId: beat.id,
          scene: `${component}.tsx`,
          severity: "error",
          message:
            `Content declares ${w}px wide but the camera reaches scale ${maxScale}, which shows only ` +
            `${visibleW}x${visibleH} of the stage. It will be cropped at the frame edge and the render ` +
            `will not warn. Narrow the content or lower the camera scale.`,
        });
      }
    }

    // Motion. A frozen frame is a QC fail in STYLE.md.
    if (scales.length >= 2 && new Set(scales).size === 1) {
      const positions = new Set([...src.matchAll(/\bx:\s*(\d+),\s*y:\s*(\d+)/g)].map((m) => `${m[1]},${m[2]}`));
      if (positions.size <= 1) {
        findings.push({
          beatId: beat.id,
          scene: `${component}.tsx`,
          severity: "warning",
          message: `Camera never moves. STYLE.md fails a static frame; give it at least a subtle push.`,
        });
      }
    }
    if (scales.length < 2) {
      findings.push({
        beatId: beat.id,
        scene: `${component}.tsx`,
        severity: "warning",
        message: `Fewer than two camera keyframes, so nothing moves.`,
      });
    }

    // Capture assets the scene references but that are not on disk yet.
    const method = beat.visual?.captureMethod;
    if (method === "screenshot") {
      const asset = path.join(projectRoot, "public", "images", `${beat.id}.png`);
      if (!fs.existsSync(asset)) {
        findings.push({
          beatId: beat.id,
          scene: `${component}.tsx`,
          severity: "error",
          message: `References public/images/${beat.id}.png, which does not exist. Run capture_screenshot.`,
        });
      }
    }
    if (method === "recording" || method === "higgsfield") {
      const asset = path.join(projectRoot, "public", "video", `${beat.id}.mp4`);
      if (!fs.existsSync(asset)) {
        findings.push({
          beatId: beat.id,
          scene: `${component}.tsx`,
          severity: "error",
          message: `References public/video/${beat.id}.mp4, which does not exist.`,
        });
      }
    }

    if (/TODO/.test(src)) {
      findings.push({
        beatId: beat.id,
        scene: `${component}.tsx`,
        severity: "warning",
        message: `Still contains a TODO.`,
      });
    }
  }

  // Narration, which stitch_composition skips silently when absent.
  for (const beat of doc.beats) {
    const vo = path.join(projectRoot, "public", "audio", "vo", `${beat.id}.mp3`);
    if (!fs.existsSync(vo)) {
      findings.push({
        beatId: beat.id,
        scene: "-",
        severity: "warning",
        message:
          `No narration at public/audio/vo/${beat.id}.mp3. stitch_composition skips this silently, so the ` +
          `beat renders with no voice and nothing reports it. Run generate_narration.`,
      });
    }
  }

  void config;
  return { ok: !findings.some((f) => f.severity === "error"), scenesChecked: checked, findings };
}

export function registerValidateScenes(server: McpServer): void {
  server.registerTool(
    "validate_scenes",
    {
      title: "Check scenes for problems that render without erroring",
      description:
        "Reads every scene for a video and reports what would otherwise only be caught by watching the " +
        "output. Chiefly framing: content is laid out on a 1920x1080 stage but the camera shows stage " +
        "divided by scale, so a panel wider than the visible box is cropped at the frame edge with no " +
        "warning at all. Also flags scenes whose camera never moves (a static frame fails STYLE.md), " +
        "capture assets a scene references that are not on disk, leftover TODOs, and beats with no " +
        "narration file, since stitch_composition skips those silently and the beat renders mute. Run it " +
        "after scaffolding and again before rendering.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
      },
    },
    async (input) => runTool("validate_scenes", () => runValidateScenes(input)),
  );
}

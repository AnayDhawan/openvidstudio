import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, pascalCase } from "../util";
import { runTool } from "./mcp";
import {
  pickTemplate,
  renderTemplate,
  type SceneContext,
  type SceneKind,
  type TemplateName,
} from "../scenes/templates";
import { pngSize } from "../scenes/pngSize";
import { castToSteps, serializeSteps, type TerminalCastLike } from "../scenes/castToSteps";
import { probeVideoDurationFrames } from "../scenes/videoDuration";
import { readCursorPoints } from "../scenes/cursorPoints";
import { detectRepoInfo } from "../scenes/repoInfo";

export type { SceneKind };

/**
 * C5: scaffold_scene is one option among three, not the only path to a scene file.
 *  - "template" (default, and every behavior below this point in the file unless noted):
 *    today's existing behavior, a scene that renders immediately from a fixed shape.
 *  - "starter": a minimal file wired to the video's own design.ts (if one exists) and
 *    facts.json (if one exists, C8), with no layout imposed -- a faster starting point
 *    than a blank file for an agent authoring a bespoke scene at peak/mid.
 *  - "blank": writes nothing. Just reports the path and component name stitch_composition
 *    will expect, so the agent knows exactly what to create by hand.
 */
export type ScaffoldSceneMode = "template" | "starter" | "blank";

export interface ScaffoldSceneInput {
  projectRoot?: string;
  videoName: string;
  beatId: string;
  kind: SceneKind;
  overwrite?: boolean;
  /** Override the automatic template choice. Only meaningful for mode: "template". */
  template?: TemplateName;
  /** Defaults to "template". */
  mode?: ScaffoldSceneMode;
}

export interface ScaffoldSceneResult {
  written: true;
  path: string;
  componentName: string;
  /** A template name for mode "template"; "starter" for mode "starter". */
  template: TemplateName | "starter";
  /** True when the beat was found in beats.json and its content was used. */
  usedBeat: boolean;
  notes: string[];
}

/** mode: "blank" never writes a file -- this is what it returns instead. */
export interface ScaffoldSceneBlankResult {
  written: false;
  path: string;
  componentName: string;
  notes: string[];
}

interface BeatLike {
  id: string;
  duration?: number;
  vo?: string;
  visual?: {
    description?: string;
    url?: string;
    captureMethod?: string;
    source?: string;
    assetPath?: string;
    attribution?: string;
  };
  artifacts?: { terminalPath?: string; recordingPath?: string };
}

/**
 * Read the beat (and the manifest's own fps, default 30 per PLANNING.md/PIPELINE.md) out
 * of the project's beats.json so the scaffolded scene can carry that beat's own copy and
 * duration. Without this the template has nothing real to put on screen and the first
 * render says nothing.
 */
function readBeat(
  projectRoot: string,
  videoName: string,
  beatId: string,
): { beat: BeatLike | null; fps: number } {
  const file = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as { fps?: number; beats?: BeatLike[] };
    const fps = typeof doc.fps === "number" && doc.fps > 0 ? doc.fps : 30;
    return { beat: doc.beats?.find((b) => b.id === beatId) ?? null, fps };
  } catch {
    return { beat: null, fps: 30 };
  }
}

/** Collapse to one line and cap length, for text dropped into a `//` comment. */
function commentSafe(s: string, max = 220): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

/**
 * mode: "starter" (C5). A minimal file for an agent authoring a bespoke scene at
 * peak/mid: no on-screen copy, no chosen layout, just real imports wired up so the
 * agent starts from the video's own design system instead of a blank file.
 *
 * Deliberately does not touch any of runScaffoldScene's kind-specific gathering
 * (capture sizing, cursor sidecars, recording duration probing): that machinery
 * exists to feed the "template" templates' own fixed shapes. A bespoke scene
 * composes straight from the beat's real artifacts itself when it needs them.
 */
function renderStarterScene(
  ctx: SceneContext,
  projectRoot: string,
  videoName: string,
): string {
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  const hasDesign = fs.existsSync(path.join(videoDir, "design.ts"));
  const hasFacts = fs.existsSync(path.join(videoDir, "facts.json"));

  const designImport = hasDesign ? `\nimport { design } from "../design";` : "";
  const factsImport = hasFacts ? `\nimport facts from "../facts.json";` : "";
  const designNote = hasDesign
    ? " against this video's own design.ts (palette, type scale, motif, motion personality)"
    : ' against this video\'s own design.ts (none written yet -- see design.ts\'s own header in `@openvidstudio/core`\'s DesignSystem type)';

  return `// Scene for beat "${ctx.beatId}", scaffolded by scaffold_scene in "starter" mode: no
// layout imposed. Compose this beat from @openvidstudio/core's primitive library
// (see docs/API.md)${designNote}, not a fixed template shape.
//
// VO: "${commentSafe(ctx.vo || "(no narration written yet)")}"
// Visual direction: ${commentSafe(ctx.description || "(none written yet)")}

import React from "react";
import { CinematicScene, Layer, E } from "@openvidstudio/core";${designImport}${factsImport}

export const ${ctx.componentName}: React.FC = () => {
  return (
    <CinematicScene
      camera={[
        { frame: 0, x: 960, y: 540, scale: 1.04, rotZ: -0.4 },
        { frame: ${ctx.durationFrames}, x: 960, y: 548, scale: 1.15, rotZ: 0.35, easing: E.drift },
      ]}
    >
      <Layer depth={0}>
        {/* Build this beat's shot here. Motion never stops (STYLE.md): keep or extend
            the camera push above, don't freeze it. */}
        <div />
      </Layer>
    </CinematicScene>
  );
};
`;
}

export function runScaffoldScene(
  input: ScaffoldSceneInput,
): ScaffoldSceneResult | ScaffoldSceneBlankResult {
  const mode = input.mode ?? "template";
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const componentName = pascalCase(beatId);
  const scenesDir = path.join(projectRoot, "src", "videos", videoName, "scenes");
  const filePath = path.join(scenesDir, `${componentName}.tsx`);
  const notes: string[] = [];

  if (mode === "blank") {
    fs.mkdirSync(scenesDir, { recursive: true });
    notes.push(
      `Nothing written. stitch_composition expects this beat's scene at ` +
        `scenes/${componentName}.tsx, exporting a component named ${componentName}. Write it by hand, ` +
        `composed from @openvidstudio/core's primitive library against this video's design.ts -- see ` +
        `CLAUDE.md's "Before you write a scene" section.`,
    );
    return { written: false, path: filePath, componentName, notes };
  }

  if (fs.existsSync(filePath) && !input.overwrite) {
    throw new Error(
      `${filePath} already exists. Pass overwrite: true to replace a scene the calling agent or dev has ` +
        `already started editing.`,
    );
  }

  const { beat, fps } = readBeat(projectRoot, videoName, beatId);
  if (!beat) {
    notes.push(
      `No beat "${beatId}" found in beats.json, so the scene was scaffolded with placeholder copy. ` +
        `Run write_beats_file first to get a scene that carries this beat's own content.`,
    );
  }

  const description = beat?.visual?.description ?? "";
  const ctx: SceneContext = {
    beatId,
    componentName,
    description,
    vo: beat?.vo ?? "",
    durationFrames: beat?.duration ?? 300,
    url: beat?.visual?.url,
  };

  if (mode === "starter") {
    const source = renderStarterScene(ctx, projectRoot, videoName);
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(filePath, source, "utf8");
    return {
      written: true,
      path: filePath,
      componentName,
      template: "starter",
      usedBeat: Boolean(beat),
      notes,
    };
  }

  if (input.kind === "real-screenshot") {
    const png = path.join(projectRoot, "public", "images", `${beatId}.png`);
    const size = pngSize(png);
    if (size) {
      ctx.captureWidth = size.width;
      ctx.captureHeight = size.height;
      notes.push(`Frame sized from the real capture: ${size.width}x${size.height}.`);
    } else {
      notes.push(
        `No capture found at public/images/${beatId}.png, so the frame uses a 1440x900 default. ` +
          `Re-run scaffold_scene after capture_screenshot to size the frame from the real file.`,
      );
    }

    const cursor = readCursorPoints(png, { kind: "even-spread", durationFrames: ctx.durationFrames });
    if (cursor) {
      ctx.cursorPoints = cursor.points;
      ctx.cursorViewport = cursor.viewport;
      notes.push(
        `Cursor path recorded from ${cursor.pointCount} real interaction(s) during capture, spread evenly ` +
          `across the beat (a still has no video timeline for real timing to be relative to).`,
      );
    }
  }

  if (input.kind === "real-recording" || input.kind === "higgsfield-clip") {
    const recordingRel = beat?.artifacts?.recordingPath ?? path.join("public", "video", `${beatId}.mp4`);
    const recordingPath = path.join(projectRoot, recordingRel);
    if (fs.existsSync(recordingPath)) {
      const frames = probeVideoDurationFrames(recordingPath, fps);
      if (frames !== null) {
        ctx.recordingDurationFrames = frames;
        if (frames < ctx.durationFrames) {
          notes.push(
            `Real recording is ${frames} frames at ${fps}fps, ${ctx.durationFrames - frames} short of this ` +
              `beat's ${ctx.durationFrames}. The scene holds the recording's true last frame for the remainder.`,
          );
        }
      } else {
        notes.push(
          `Could not probe ${recordingRel}'s duration (ffprobe missing or the file isn't a readable video), ` +
            `so the scene does not hold a last frame if the recording runs short of the beat's duration.`,
        );
      }

      const cursor = readCursorPoints(recordingPath, { kind: "real-time", durationFrames: ctx.durationFrames, fps });
      if (cursor) {
        ctx.cursorPoints = cursor.points;
        ctx.cursorViewport = cursor.viewport;
        notes.push(
          `Cursor path recorded from ${cursor.pointCount} real interaction(s), timed to when they actually ` +
            `happened in the recording, so the overlay stays in sync with the video.`,
        );
      }
    } else {
      notes.push(
        `No recording found at ${recordingRel} yet, so the scene has no real length to hold on. Re-run ` +
          `scaffold_scene with overwrite: true after capturing it.`,
      );
    }
  }

  if (input.kind === "terminal-cast") {
    const castRel = beat?.artifacts?.terminalPath ?? path.join("public", "terminal", `${beatId}.json`);
    const castPath = path.join(projectRoot, castRel);
    try {
      const cast = JSON.parse(fs.readFileSync(castPath, "utf8")) as TerminalCastLike;
      const steps = castToSteps(cast);
      ctx.termSteps = serializeSteps(steps);
      ctx.termTitle = (cast.command ?? "terminal").split(/\s+/)[0] ?? "terminal";
      notes.push(
        `Replaying the real recorded session: ${steps.length} steps from ${castRel}, original timing preserved.`,
      );
    } catch {
      // A scene that renders an empty terminal is worse than useless, it looks like a
      // successful render of nothing, so say plainly which tool produces the missing file.
      ctx.termSteps = "[]";
      notes.push(
        `No terminal cast found at ${castRel}, so the scene has no steps and will render an empty ` +
          `terminal. Run capture_terminal for this beat, then re-run scaffold_scene with overwrite: true.`,
      );
    }
  }

  if (input.kind === "existing-asset") {
    const assetRel = beat?.visual?.assetPath;
    if (!assetRel) {
      notes.push(
        `This beat has no visual.assetPath, so the scene falls back to public/images/${beatId}.png. ` +
          `An existing-asset beat should name the real file it is showing.`,
      );
    }
    const rel = assetRel ?? path.join("public", "images", `${beatId}.png`);
    // staticFile() resolves against public/, so the prefix has to come off.
    ctx.assetStaticPath = rel.replace(/\\/g, "/").replace(/^public\//, "");
    ctx.attribution = beat?.visual?.attribution;
    const size = pngSize(path.join(projectRoot, rel));
    if (size) {
      ctx.captureWidth = size.width;
      ctx.captureHeight = size.height;
      notes.push(`Frame sized from the real asset: ${size.width}x${size.height}.`);
    }
    if (!ctx.attribution) {
      notes.push(
        `This beat has no visual.attribution, so the credit reads "source not stated". validate_beats ` +
          `requires attribution; fix the beat rather than the scene.`,
      );
    }
  }

  const template = input.template ?? pickTemplate(input.kind, description);

  if (template === "cta") {
    const repo = detectRepoInfo(projectRoot);
    ctx.repo = repo;
    notes.push(
      repo.isFallback
        ? `No git remote and no package.json "repository" field found, so the cta scene still ships ` +
            `the your-org/your-repo placeholders. Fix package.json or the remote, then re-run scaffold_scene ` +
            `with overwrite: true.`
        : `RepoCta filled from the real repo: ${repo.owner}/${repo.name}` +
            `${repo.license ? `, license ${repo.license}` : " (no package.json \"license\" field found)"}` +
            `${repo.language ? `, guessed language ${repo.language}` : ""}.`,
    );
  }

  const source = renderTemplate(template, ctx, input.kind);

  fs.mkdirSync(scenesDir, { recursive: true });
  fs.writeFileSync(filePath, source, "utf8");

  return {
    written: true,
    path: filePath,
    componentName,
    template,
    usedBeat: Boolean(beat),
    notes,
  };
}

export function registerScaffoldScene(server: McpServer): void {
  server.registerTool(
    "scaffold_scene",
    {
      title: "Scaffold a working scene for one beat",
      description:
        "Writes src/videos/<videoName>/scenes/<BeatId>.tsx. Three modes, pick with `mode` (default " +
        "\"template\"): \"template\" renders immediately with no TODOs, from a fixed shape chosen by " +
        "capture method and description; \"starter\" writes a minimal file wired to this video's own " +
        "design.ts and facts.json (if either exists) with no layout imposed, for composing a bespoke " +
        "scene from @openvidstudio/core's primitive library at peak/mid; \"blank\" writes nothing and " +
        "just reports the path and component name stitch_composition will expect, for writing the file " +
        "by hand from nothing. PLANNING.md and CLAUDE.md's \"Before you write a scene\" section cover " +
        "which mode fits which creative level. Modes \"template\" and \"starter\" both read the beat out " +
        "of beats.json and use its own description, narration and duration. The rest of this description " +
        "covers \"template\" mode specifically. Pick the shape with `template`, or let it choose from the " +
        "capture method and what the beat's description talks about. Templates: browser-capture and " +
        "recording (for real captures), terminal, split-panel, checklist, stat, code, comparison, cta, " +
        "title. For real-screenshot beats " +
        "the frame is sized from the actual PNG on disk rather than guessed, so the page is not letterboxed. " +
        "For real-recording/higgsfield-clip beats, the real recording's length is probed with ffprobe and, " +
        "when it's shorter than the beat's own duration, the scene holds the recording's true last frame for " +
        "the remainder (Remotion's Freeze pattern) instead of letting OffthreadVideo show whatever frame it " +
        "happens to have past the source's own end. For real-screenshot/real-recording/higgsfield-clip beats, " +
        "a `<asset>.cursor.json` sidecar left by capture_screenshot/capture_screen_recording (real " +
        "click/hover/fill/select target coordinates) is also read if present and rendered as a CursorActor: " +
        "evenly spread across the beat's duration for a still (a capture has no video timeline for real " +
        "timing to be relative to), or timed to when each interaction actually happened for a recording, so " +
        "the overlay stays in sync with the video. No sidecar, no cursor -- nothing is invented. " +
        "Constructed scenes use a gentle camera push and a safe content width, because the visible area is " +
        "the stage divided by the camera scale and content built at full stage size gets cropped at the " +
        "frame edge. Refuses to overwrite an existing scene unless overwrite: true.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        beatId: z.string().min(1),
        kind: z.enum(["real-screenshot", "real-recording", "dom-demo", "higgsfield-clip", "terminal-cast", "existing-asset"]),
        overwrite: z.boolean().optional(),
        mode: z.enum(["template", "starter", "blank"]).optional(),
        template: z
          .enum([
            "browser-capture",
            "recording",
            "terminal",
            "split-panel",
            "checklist",
            "stat",
            "code",
            "comparison",
            "cta",
            "title",
            "terminal-cast",
            "existing-asset",
          ])
          .optional(),
      },
    },
    async (input) => runTool("scaffold_scene", () => runScaffoldScene(input)),
  );
}

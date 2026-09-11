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

export type { SceneKind };

export interface ScaffoldSceneInput {
  projectRoot?: string;
  videoName: string;
  beatId: string;
  kind: SceneKind;
  overwrite?: boolean;
  /** Override the automatic template choice. */
  template?: TemplateName;
}

export interface ScaffoldSceneResult {
  written: true;
  path: string;
  componentName: string;
  template: TemplateName;
  /** True when the beat was found in beats.json and its content was used. */
  usedBeat: boolean;
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
  artifacts?: { terminalPath?: string };
}

/**
 * Read the beat out of the project's beats.json so the scaffolded scene can carry
 * that beat's own copy and duration. Without this the template has nothing real to
 * put on screen and the first render says nothing.
 */
function readBeat(projectRoot: string, videoName: string, beatId: string): BeatLike | null {
  const file = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as { beats?: BeatLike[] };
    return doc.beats?.find((b) => b.id === beatId) ?? null;
  } catch {
    return null;
  }
}

export function runScaffoldScene(input: ScaffoldSceneInput): ScaffoldSceneResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const componentName = pascalCase(beatId);
  const scenesDir = path.join(projectRoot, "src", "videos", videoName, "scenes");
  const filePath = path.join(scenesDir, `${componentName}.tsx`);
  const notes: string[] = [];

  if (fs.existsSync(filePath) && !input.overwrite) {
    throw new Error(
      `${filePath} already exists. Pass overwrite: true to replace a scene the calling agent or dev has ` +
        `already started editing.`,
    );
  }

  const beat = readBeat(projectRoot, videoName, beatId);
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
        "Writes src/videos/<videoName>/scenes/<BeatId>.tsx as a scene that renders immediately, with no " +
        "TODOs to fill in. It reads the beat out of beats.json and uses that beat's own description, " +
        "narration and duration for the on-screen copy and timings, so the first render already says " +
        "something. Pick the shape with `template`, or let it choose from the capture method and what the " +
        "beat's description talks about. Templates: browser-capture and recording (for real captures), " +
        "terminal, split-panel, checklist, stat, code, comparison, cta, title. For real-screenshot beats " +
        "the frame is sized from the actual PNG on disk rather than guessed, so the page is not letterboxed. " +
        "Constructed scenes use a gentle camera push and a safe content width, because the visible area is " +
        "the stage divided by the camera scale and content built at full stage size gets cropped at the " +
        "frame edge. Refuses to overwrite an existing scene unless overwrite: true.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        beatId: z.string().min(1),
        kind: z.enum(["real-screenshot", "real-recording", "dom-demo", "higgsfield-clip", "terminal-cast", "existing-asset"]),
        overwrite: z.boolean().optional(),
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

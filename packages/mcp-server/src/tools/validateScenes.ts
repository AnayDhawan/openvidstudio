import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, pascalCase } from "../util";
import { loadConfig } from "../config";
import { settleSidecarPath, type SettleReport } from "@openvidstudio/capture";
import { runTool } from "./mcp";
import { writeFactRecord } from "../facts";
import { resolveCompositionId } from "./renderStills";
import { readTypeMinimums, runRenderChecks } from "./validateScenesRender";

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
  /**
   * Also mount the composition in a real browser and measure the rendered frames. Slower
   * (it bundles the project) and needs the video stitched, but it is the only way to see
   * cropping, text size, reading time and dead frames as they actually render.
   */
  render?: boolean;
  /** With render: overrides the composition id resolved from src/videos/.registry.json. */
  compositionId?: string;
  /** With render: limit the measurement to these beats. Static checks always cover every beat. */
  beatIds?: string[];
}

export interface SceneFinding {
  beatId: string;
  scene: string;
  severity: "error" | "warning";
  message: string;
  /** Which pass produced this: reading the source, or measuring the real render. */
  source?: "static" | "render";
  /**
   * For render findings, which check: crop, text-size, reading-time, dead-frames, em-dash,
   * contrast, safe-area, hud-overlap or render-skipped.
   */
  check?: string;
}

export interface ValidateScenesResult {
  ok: boolean;
  scenesChecked: number;
  findings: SceneFinding[];
  /** Present only when render mode ran. */
  render?: {
    compositionId: string;
    beatsMeasured: number;
    beatsSkipped: { beatId: string; reason: string }[];
    bundleMs: number;
    totalMs: number;
  };
}

const STAGE_W = 1920;
const STAGE_H = 1080;

interface BeatLike {
  id: string;
  /** A bespoke scene path relative to the video directory (C5), replacing scenes/<Pascal>.tsx. */
  scene?: string;
  visual?: { captureMethod?: string; source?: string; assetPath?: string };
  artifacts?: { screenshotPath?: string; recordingPath?: string; terminalPath?: string };
  // (expectedArtifact below resolves these into the one path this beat actually needs.)
}

/**
 * Reads the `<asset>.settle.json` sidecar capture_screenshot/capture_screen_recording
 * write next to their output (see @openvidstudio/capture's writeSettleSidecar) and
 * reports a timed-out settle loudly: that beat's frame may have been caught mid-
 * transition, and the only previous evidence was a field in a tool result nobody kept.
 * No sidecar (settle:false, or an asset captured before this existed) is not an error,
 * it just means nothing to check.
 */
function checkSettleSidecar(
  assetPathAbs: string,
  beatId: string,
  component: string,
  findings: SceneFinding[],
): void {
  const sidecarPath = settleSidecarPath(assetPathAbs);
  if (!fs.existsSync(sidecarPath)) return;

  let report: SettleReport;
  try {
    report = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as SettleReport;
  } catch {
    return; // Malformed sidecar: not this tool's job to diagnose, skip rather than crash validation.
  }

  if (!report.settled) {
    const pending: string[] = [];
    if (!report.fontsReady) pending.push("fonts");
    if (!report.imagesReady) pending.push("images");
    if (report.pendingAnimations > 0) pending.push(`${report.pendingAnimations} animation(s)`);
    findings.push({
      beatId,
      scene: `${component}.tsx`,
      severity: "error",
      message:
        `Capture timed out waiting to settle after ${report.waitedMs}ms, still pending: ` +
        `${pending.join(", ") || "unknown"}. The frame may be caught mid-transition. Re-run the capture tool ` +
        `with a larger settleTimeoutMs, or fix whatever on the page never finishes loading/animating.`,
    });
  }
}

/** Every numeric `scale:` in the camera array. */
function cameraScales(src: string): number[] {
  return [...src.matchAll(/scale:\s*([\d.]+)/g)]
    .map((m) => Number.parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));
}

/**
 * Core components that wrap `CinematicScene` with their own hardcoded internal camera
 * keyframes (see e.g. RepoCta.tsx's `camera={[...]}`), so a scene built from one needs no
 * external camera layered on top -- the generated .tsx just renders the component with
 * content props and has no `scale:`/`camera` array of its own to find. Checked in packages/
 * core/src for anything else similarly wrapping CinematicScene internally: RepoCta is the
 * only one today. Extend this list if another one is added.
 */
const SELF_CAMERA_COMPONENTS = ["RepoCta"];

function usesSelfManagedCamera(src: string): boolean {
  return SELF_CAMERA_COMPONENTS.some((name) => new RegExp(`\\b${name}\\b`).test(src));
}

/** Explicit pixel widths a scene declares, which is what gets cropped. */
function declaredWidths(src: string): number[] {
  const out: number[] = [];
  for (const m of src.matchAll(/\bwidth[=:]\s*\{?\s*(\d{3,4})\b/g)) out.push(Number(m[1]));
  for (const m of src.matchAll(/\bFRAME_W\s*=\s*(\d{3,4})\b/g)) out.push(Number(m[1]));
  for (const m of src.matchAll(/\bmaxWidth:\s*(\d{3,4})\b/g)) out.push(Number(m[1]));
  return out;
}

/**
 * The one artifact a beat actually needs, plus the command that produces it.
 *
 * Returns null for beats that need no capture at all (dom-demo), so the caller does not
 * have to special-case them. Honours an `artifacts` override, since a beat is allowed to
 * put its capture somewhere other than the convention path.
 */
/**
 * Numbers a scene types into its own copy. C8: a scene that shows a number must get it from
 * facts.json (what collect_facts merged out of the real tool runs) or from a capture, never
 * from the author's memory, because a retyped number is the one that goes stale or was never
 * true. This reads the scene source for numbers inside visible text (JSX text, and the string
 * props text, label, title, name, caption, value) and returns them. Years, version strings
 * and single digits are not claims and are skipped.
 */
export function typedNumbers(src: string): string[] {
  const candidates: string[] = [];
  for (const m of src.matchAll(/>([^<>{}]*\d[^<>{}]*)</g)) candidates.push(m[1]!);
  for (const m of src.matchAll(/\b(?:text|label|title|name|caption|value)\s*=\s*(?:"([^"]*\d[^"]*)"|'([^']*\d[^']*)')/g)) candidates.push((m[1] ?? m[2])!);
  const found: string[] = [];
  for (const text of candidates) {
    for (const m of text.matchAll(/(?<![\w.])(v?)(\d(?:[\d,]*\d)?(?:\.\d+)?)(?![\w])/g)) {
      const token = m[2]!;
      if (m[1] === "v") continue;
      if (/^(19|20)\d{2}$/.test(token)) continue;
      if (/^\d$/.test(token)) continue;
      if (/^\d+\.\d+\.\d+/.test(token)) continue;
      found.push(token);
    }
  }
  return [...new Set(found)];
}

function importsFacts(src: string): boolean {
  return /from\s+["'][^"']*facts(?:\.json)?["']/.test(src);
}

function expectedArtifact(
  beat: BeatLike,
  method: string | undefined,
  source: string,
): { rel: string; fix: string } | null {
  const a = beat.artifacts ?? {};

  if (method === "existing-asset") {
    const rel = beat.visual?.assetPath;
    return rel
      ? { rel, fix: `This beat shows an asset the project already publishes; put the real file at that path.` }
      : null;
  }

  if (method === "screenshot") {
    return {
      rel: a.screenshotPath ?? `public/images/${beat.id}.png`,
      fix: "Run capture_screenshot.",
    };
  }

  if (method === "recording") {
    if (source === "terminal") {
      return {
        rel: a.terminalPath ?? `public/terminal/${beat.id}.json`,
        fix: "Run capture_terminal for this beat.",
      };
    }
    const rel = a.recordingPath ?? `public/video/${beat.id}.mp4`;
    if (source === "desktop") return { rel, fix: "Run capture_desktop for this beat." };
    if (source === "mobile") return { rel, fix: "Run capture_mobile for this beat." };
    return { rel, fix: "Run capture_screen_recording." };
  }

  if (method === "higgsfield") {
    return {
      rel: a.recordingPath ?? `public/video/${beat.id}.mp4`,
      fix: "Run import_higgsfield_clip.",
    };
  }

  return null;
}

function recordValidateScenes(input: ValidateScenesInput, result: ValidateScenesResult): void {
  writeFactRecord(resolveProjectRoot(input.projectRoot), {
    tool: "validate_scenes",
    videoName: sanitizeSegment(input.videoName, "videoName"),
    facts: {
      ok: result.ok,
      scenesChecked: result.scenesChecked,
      renderMode: result.render !== undefined,
      errors: result.findings.filter((f) => f.severity === "error").length,
      warnings: result.findings.filter((f) => f.severity === "warning").length,
      findings: result.findings,
      ...(result.render ? { render: result.render } : {}),
    },
  });
}

export function runValidateScenes(input: ValidateScenesInput): ValidateScenesResult {
  const result = staticPass(input);
  recordValidateScenes(input, result);
  return result;
}

function staticPass(input: ValidateScenesInput): ValidateScenesResult {
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
    // A beat can point at a bespoke scene (C5's `scene` field); stitch_composition imports that
    // file instead of scenes/<Pascal>.tsx, so this has to read the same one.
    const overridden = beat.scene ? path.join(videoDir, beat.scene.replace(/\.(tsx|ts|jsx|js)$/, "") + ".tsx") : null;
    const component = overridden ? path.basename(overridden, ".tsx") : pascalCase(beat.id);
    const file = overridden ?? path.join(scenesDir, `${component}.tsx`);
    if (!fs.existsSync(file)) {
      findings.push({
        beatId: beat.id,
        scene: `${component}.tsx`,
        severity: "error",
        message: overridden
          ? `Scene override ${beat.scene} does not exist.`
          : `No scene file. Run scaffold_scene for this beat.`,
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
    if (scales.length < 2 && !usesSelfManagedCamera(src)) {
      findings.push({
        beatId: beat.id,
        scene: `${component}.tsx`,
        severity: "warning",
        message: `Fewer than two camera keyframes, so nothing moves.`,
      });
    }

    // Capture assets the scene references but that are not on disk yet.
    //
    // Which artifact a beat needs, and which tool produces it, both depend on the beat's
    // `source` as well as its captureMethod. Telling someone to run capture_screenshot
    // for a `source: "desktop"` beat is worse than saying nothing: the suggested command
    // cannot produce the missing file.
    const method = beat.visual?.captureMethod;
    const source = beat.visual?.source ?? "browser";
    const expected = expectedArtifact(beat, method, source);
    if (expected) {
      const assetPathAbs = path.join(projectRoot, expected.rel);
      if (!fs.existsSync(assetPathAbs)) {
        findings.push({
          beatId: beat.id,
          scene: `${component}.tsx`,
          severity: "error",
          message: `References ${expected.rel}, which does not exist. ${expected.fix}`,
        });
      } else if (source === "browser" && (method === "screenshot" || method === "recording")) {
        // Settling is a browser-capture concept: capture_desktop/mobile/terminal have no
        // settlePage call and never write this sidecar.
        checkSettleSidecar(assetPathAbs, beat.id, component, findings);
      }
    }

    // C8: numbers shown on screen come from facts or a capture. A scene that types numbers into its
    // own copy without importing facts.json is asserting them from memory. A file can opt out of the
    // check with a `// ovs-numbers-ok: <reason>` comment (a step counter, a fixed price).
    if (!importsFacts(src) && !src.includes("ovs-numbers-ok")) {
      const typed = typedNumbers(src);
      if (typed.length > 0) {
        findings.push({
          beatId: beat.id,
          scene: `${component}.tsx`,
          severity: "warning",
          check: "numbers-sourcing",
          message:
            `Shows ${typed.length === 1 ? "a number" : "numbers"} typed into the scene (${typed.slice(0, 4).join(", ")}` +
            `${typed.length > 4 ? ", ..." : ""}) without importing facts.json. A number on screen should come from ` +
            `a real tool run (collect_facts merges them into src/videos/${videoName}/facts.json) or from a capture. ` +
            `If this one is a label rather than a claim, add "// ovs-numbers-ok: <why>" to the file.`,
        });
      }
    }

    const todo = src.match(/TODO/g);
    if (todo) {
      const offset = src.indexOf("TODO");
      const line = src.slice(0, offset).split("\n").length;
      findings.push({
        beatId: beat.id,
        scene: `${component}.tsx`,
        severity: "warning",
        message: `Still contains a TODO at ${component}.tsx:${line}.`,
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
  const tagged = findings.map((f): SceneFinding => ({ source: "static", ...f }));
  return { ok: !tagged.some((f) => f.severity === "error"), scenesChecked: checked, findings: tagged };
}

/**
 * The static pass plus, when `render` is set, the render-based pass. Async because the
 * render pass bundles the project and drives a browser; runValidateScenes stays synchronous
 * for every caller that only wants the static read.
 */
export async function runValidateScenesFull(input: ValidateScenesInput): Promise<ValidateScenesResult> {
  const result = staticPass(input);
  if (!input.render) {
    recordValidateScenes(input, result);
    return result;
  }

  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  const doc = JSON.parse(fs.readFileSync(path.join(videoDir, "beats.json"), "utf8")) as {
    fps?: number;
    beats: { id: string; start: number; duration: number }[];
  };

  let beats = doc.beats;
  if (input.beatIds && input.beatIds.length > 0) {
    const known = new Set(beats.map((b) => b.id));
    const unknown = input.beatIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`beatIds not found in beats.json: ${unknown.join(", ")}`);
    const wanted = new Set(input.beatIds);
    beats = beats.filter((b) => wanted.has(b.id));
  }
  const compositionId = resolveCompositionId(projectRoot, videoName, input.compositionId);
  const rendered = await runRenderChecks({
    projectRoot,
    videoName,
    compositionId,
    beats,
    fps: doc.fps ?? 30,
    minimums: readTypeMinimums(videoDir),
  });

  const findings = [...result.findings, ...rendered.findings];
  const full: ValidateScenesResult = {
    ok: !findings.some((f) => f.severity === "error"),
    scenesChecked: result.scenesChecked,
    findings,
    render: {
      compositionId,
      beatsMeasured: rendered.beatsMeasured,
      beatsSkipped: rendered.beatsSkipped,
      bundleMs: rendered.bundleMs,
      totalMs: rendered.totalMs,
    },
  };
  recordValidateScenes(input, full);
  return full;
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
        "capture assets a scene references that are not on disk, a browser capture whose settle sidecar " +
        "reports a timeout (the frame may be mid-transition -- see capture_screenshot/" +
        "capture_screen_recording's settle/settleTimeoutMs), leftover TODOs, and beats with no " +
        "narration file, since stitch_composition skips those silently and the beat renders mute. Run it " +
        "after scaffolding and again before rendering. Pass render: true to also mount the stitched composition " +
        "in a real browser and measure what actually renders: text cropped at the frame edge (camera-" +
        "transformed content only, found through the real DOM), text below the design system's minimum " +
        "size (a Pill/ToolChip label gets its own, lower floor rather than body's), on-screen text that " +
        "needs longer to read than the beat lasts (3.5 words/sec plus 0.8s, the same budget validate_beats " +
        "applies), beats whose frames never change, em dashes in on-screen copy, text colour against the " +
        "pixels rendered behind it (WCAG 4.5:1, 3:1 for large text), text outside the title-safe area, and " +
        "scene text that overlaps the chapter HUD. Needs stitch_composition to have run. A beat that cannot be mounted (a screen " +
        "recording played through OffthreadVideo) is reported as render-skipped, never as clean.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        render: z.boolean().optional(),
        compositionId: z.string().optional(),
        beatIds: z.array(z.string()).optional(),
      },
    },
    async (input) => runTool("validate_scenes", () => runValidateScenesFull(input)),
  );
}

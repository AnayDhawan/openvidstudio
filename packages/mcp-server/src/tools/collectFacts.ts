import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import { FACT_SCHEMA_VERSION, RUNS_DIR_REL, readFactRecords, type FactRecord } from "../facts";
import { runTool } from "./mcp";

/**
 * collect_facts: merges the run records tools wrote (see facts.ts) into one
 * src/videos/<name>/facts.json for a video.
 *
 * It reports what ran, then sets that against what beats.json claims. A beat that claims a
 * real capture with no capture record behind it, or a capture whose file has since vanished,
 * shows up under `discrepancies`. It does not decide whether a discrepancy matters; that is
 * the reader's call.
 */

export interface CollectFactsInput {
  projectRoot?: string;
  videoName: string;
}

interface BeatLike {
  id: string;
  start?: number;
  duration?: number;
  visual?: { captureMethod?: string; source?: string };
}

export interface BeatFacts {
  /** What beats.json says this beat's picture is. */
  claimed: { captureMethod: string | null; source: string | null };
  /** "capture" if a capture tool ran for it, "construction" if the beat claims no capture. */
  provenance: "capture" | "construction" | "unverified";
  /** The latest record per capture tool for this beat. */
  captures: Record<string, unknown>[];
  render: { status: "rendered" | "reused" | "unknown"; recordedAt: string } | null;
  validation: { tool: string; recordedAt: string; findings: Record<string, unknown>[] }[];
}

export interface FactsDocument {
  schemaVersion: number;
  videoName: string;
  collectedAt: string;
  recordsRead: number;
  recordsUsed: number;
  beats: Record<string, BeatFacts>;
  video: {
    composition: Record<string, unknown> | null;
    render: Record<string, unknown> | null;
    validation: Record<string, unknown>;
  };
  discrepancies: { beatId: string; kind: string; detail: string }[];
}

export interface CollectFactsResult {
  factsPath: string;
  recordsRead: number;
  recordsUsed: number;
  beatsWithCapture: string[];
  discrepancies: FactsDocument["discrepancies"];
}

/** beats.json captureMethod values that promise a real, captured visual. */
const CAPTURE_METHODS = new Set(["screenshot", "recording", "higgsfield"]);
const CAPTURE_TOOLS = new Set([
  "capture_screenshot",
  "capture_screen_recording",
  "capture_terminal",
  "capture_desktop",
  "capture_mobile",
  "import_higgsfield_clip",
]);

function latestBy<T>(items: T[], key: (t: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(key(item), item); // input is oldest first, so the last write wins
  return [...map.values()];
}

/** Pure: builds the document from records and a beats list. File checks go through `fileExists`. */
export function buildFactsDocument(opts: {
  videoName: string;
  beats: BeatLike[];
  records: FactRecord[];
  fileExists: (relPath: string) => boolean;
  now?: Date;
}): FactsDocument {
  const { videoName, beats, records, fileExists } = opts;
  const beatIds = new Set(beats.map((b) => b.id));

  // A record belongs to this video when it names it, or when it is a per-beat record (a
  // capture takes no video name) for a beat this video has.
  const mine = records.filter((r) =>
    r.videoName !== undefined ? r.videoName === videoName : r.beatId !== undefined && beatIds.has(r.beatId),
  );

  const captureRecords = mine.filter((r) => CAPTURE_TOOLS.has(r.tool) && r.beatId);
  const validations = mine.filter((r) => r.tool === "validate_scenes" || r.tool === "validate_beats");
  const renders = mine.filter((r) => r.tool === "render_video");
  const latestRender = renders[renders.length - 1] ?? null;
  const latestStitch = [...mine].reverse().find((r) => r.tool === "stitch_composition") ?? null;

  const discrepancies: FactsDocument["discrepancies"] = [];
  const beatFacts: Record<string, BeatFacts> = {};

  for (const beat of beats) {
    const method = beat.visual?.captureMethod ?? null;
    const captures = latestBy(
      captureRecords.filter((r) => r.beatId === beat.id),
      (r) => r.tool,
    ).map((r): Record<string, unknown> => ({ tool: r.tool, recordedAt: r.recordedAt, ...r.facts }));

    let provenance: BeatFacts["provenance"];
    if (captures.length > 0) provenance = "capture";
    else if (method !== null && !CAPTURE_METHODS.has(method)) provenance = "construction";
    else provenance = "unverified";

    if (method !== null && CAPTURE_METHODS.has(method) && captures.length === 0) {
      discrepancies.push({
        beatId: beat.id,
        kind: "claimed-capture-without-record",
        detail: `beats.json says captureMethod "${method}" but no capture tool left a run record for this beat.`,
      });
    }
    for (const c of captures) {
      const out = typeof c.outPath === "string" ? c.outPath : null;
      if (out && !fileExists(out)) {
        discrepancies.push({
          beatId: beat.id,
          kind: "capture-file-missing",
          detail: `${String(c.tool)} recorded ${out} but that file is not on disk now.`,
        });
      }
    }

    let render: BeatFacts["render"] = null;
    if (latestRender) {
      const f = latestRender.facts as { success?: boolean; renderedBeats?: string[]; reusedBeats?: string[] };
      if (f.success !== false) {
        const status = f.reusedBeats?.includes(beat.id)
          ? "reused"
          : f.renderedBeats?.includes(beat.id) || (!f.renderedBeats && !f.reusedBeats)
            ? "rendered"
            : "unknown";
        render = { status, recordedAt: latestRender.recordedAt };
      }
    }

    const validation: BeatFacts["validation"] = [];
    for (const tool of ["validate_scenes", "validate_beats"]) {
      const rec = [...validations].reverse().find((r) => r.tool === tool);
      if (!rec) continue;
      const all = (rec.facts.findings as Record<string, unknown>[] | undefined) ?? [];
      validation.push({ tool, recordedAt: rec.recordedAt, findings: all.filter((f) => f.beatId === beat.id) });
    }

    beatFacts[beat.id] = {
      claimed: { captureMethod: method, source: beat.visual?.source ?? null },
      provenance,
      captures,
      render,
      validation,
    };
  }

  const videoValidation: Record<string, unknown> = {};
  for (const tool of ["validate_scenes", "validate_beats"]) {
    const rec = [...validations].reverse().find((r) => r.tool === tool);
    if (!rec) continue;
    const { findings: _findings, ...summary } = rec.facts as Record<string, unknown>;
    void _findings;
    videoValidation[tool] = {
      recordedAt: rec.recordedAt,
      ...summary,
      // Findings with no beat (a video-level problem) have nowhere else to live.
      videoLevel: ((rec.facts.findings as Record<string, unknown>[] | undefined) ?? []).filter(
        (f) => !f.beatId || !beatIds.has(String(f.beatId)),
      ),
    };
  }

  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    videoName,
    collectedAt: (opts.now ?? new Date()).toISOString(),
    recordsRead: records.length,
    recordsUsed: mine.length,
    beats: beatFacts,
    video: {
      composition: latestStitch ? { recordedAt: latestStitch.recordedAt, ...latestStitch.facts } : null,
      render: latestRender ? { recordedAt: latestRender.recordedAt, ...latestRender.facts } : null,
      validation: videoValidation,
    },
    discrepancies,
  };
}

export function runCollectFacts(input: CollectFactsInput): CollectFactsResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  const beatsFile = path.join(videoDir, "beats.json");
  if (!fs.existsSync(beatsFile)) {
    throw new Error(`No beats.json at ${beatsFile}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { beats?: BeatLike[] };
  const records = readFactRecords(projectRoot);
  if (records.length === 0) {
    throw new Error(
      `No run records in ${path.join(projectRoot, RUNS_DIR_REL)}. Tools write one each time they capture, ` +
        `render, validate or stitch, so run the pipeline first.`,
    );
  }

  const facts = buildFactsDocument({
    videoName,
    beats: doc.beats ?? [],
    records,
    fileExists: (rel) => fs.existsSync(path.join(projectRoot, rel)),
  });

  const factsPath = path.join(videoDir, "facts.json");
  fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2) + "\n", "utf8");
  return {
    factsPath,
    recordsRead: facts.recordsRead,
    recordsUsed: facts.recordsUsed,
    beatsWithCapture: Object.entries(facts.beats)
      .filter(([, b]) => b.provenance === "capture")
      .map(([id]) => id),
    discrepancies: facts.discrepancies,
  };
}

export function registerCollectFacts(server: McpServer): void {
  server.registerTool(
    "collect_facts",
    {
      title: "Merge a video's run records into facts.json",
      description:
        "Reads the run records tools leave in .openvidstudio/runs/ (capture_screenshot, " +
        "capture_screen_recording, capture_terminal, capture_desktop, capture_mobile, " +
        "import_higgsfield_clip, stitch_composition, render_video, validate_scenes, validate_beats) and merges " +
        "the ones belonging to this video into src/videos/<videoName>/facts.json, keyed by beat id: what " +
        "captured it and when, whether the last render rendered or reused it, what each validator flagged. " +
        "Then compares that with beats.json and lists discrepancies, such as a beat that claims a real " +
        "capture with no capture record behind it, or a captured file that is gone. This is how a claim " +
        "gets checked against what actually ran rather than against the plan's own text. Errors if there " +
        "are no run records yet.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
      },
    },
    async (input) => runTool("collect_facts", () => runCollectFacts(input)),
  );
}

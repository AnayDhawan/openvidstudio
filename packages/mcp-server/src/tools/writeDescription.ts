import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import { runTool } from "./mcp";

/**
 * write_brief (the real, now-registered tool) writes brief.json with a shotList, not a flat
 * sampleContent array: each shot carries `real` (boolean) plus `provenance` (which real
 * capture/tool's output, or what was constructed instead) and, when `real` is false,
 * `whyConstructed`. A shot with `real: false` is exactly the thing this tool must disclose.
 * write_brief's full shape (creativeLevel, storyDevice, arc, designSystem, music, and so on)
 * is validated by write_brief itself and is not re-validated here; readBrief below only pulls
 * beatId/real/provenance/whyConstructed off each shotList entry, the same way every other
 * tool in this package reads JSON off disk (cast to Record<string, unknown>, checked by hand).
 *
 * A disclosure-worthy shot: already filtered to real === false, with both strings confirmed present.
 */
interface ConstructedShot {
  beatId: string;
  provenance: string;
  whyConstructed: string;
}

export interface WriteDescriptionInput {
  projectRoot?: string;
  videoName: string;
}

export interface WriteDescriptionResult {
  written: true;
  path: string;
  /** beatIds whose sample-content disclosure was written and round-trip verified against the file on disk. */
  sampleContentDisclosed: string[];
}

interface BriefLike {
  logline?: string;
  audience?: string;
  feeling?: string;
  constructedShots: ConstructedShot[];
}

interface BeatLike {
  id: string;
  duration: number;
  vo: string;
}

/**
 * Reads brief.json if present. Absence is normal, not an error: a literal/quick video can skip
 * write_brief entirely, and this tool must still work without it (just without logline/audience/
 * feeling/shot-disclosure framing).
 *
 * Presence with a malformed shotList entry is not tolerated the same way: silently skipping a
 * shot this tool can't classify as real or constructed would be exactly the silent-disclosure-
 * loss this tool exists to prevent, so a shape violation throws instead of being filtered out
 * quietly. Only shots with real === false are collected; a shot with real === true needs no
 * disclosure and its provenance/focalPoint are write_brief's concern, not read here.
 */
function readBrief(projectRoot: string, videoName: string): BriefLike | undefined {
  const briefPath = path.join(projectRoot, "src", "videos", videoName, "brief.json");
  if (!fs.existsSync(briefPath)) return undefined;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(briefPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse ${briefPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const logline = typeof raw.logline === "string" && raw.logline.trim().length > 0 ? raw.logline.trim() : undefined;
  const audience = typeof raw.audience === "string" && raw.audience.trim().length > 0 ? raw.audience.trim() : undefined;
  const feeling = typeof raw.feeling === "string" && raw.feeling.trim().length > 0 ? raw.feeling.trim() : undefined;

  const constructedShots: ConstructedShot[] = [];
  if (raw.shotList !== undefined) {
    if (!Array.isArray(raw.shotList)) {
      throw new Error(`${briefPath}: "shotList" must be an array if present.`);
    }
    const rawShots = raw.shotList as unknown[];
    rawShots.forEach((shot, i) => {
      if (typeof shot !== "object" || shot === null) {
        throw new Error(`${briefPath}: shotList[${i}] is not an object.`);
      }
      const s = shot as Record<string, unknown>;
      if (typeof s.beatId !== "string" || s.beatId.length === 0) {
        throw new Error(`${briefPath}: shotList[${i}] is missing a valid "beatId".`);
      }
      if (typeof s.real !== "boolean") {
        // Can't safely treat an unclassified shot as real (that would silently skip a
        // disclosure it might owe), so this is a hard error rather than a default.
        throw new Error(`${briefPath}: shotList[${i}] ("${s.beatId}") is missing a boolean "real".`);
      }
      if (s.real === true) return; // A real capture needs no disclosure.

      if (typeof s.provenance !== "string" || s.provenance.trim().length === 0) {
        throw new Error(`${briefPath}: shotList[${i}] ("${s.beatId}", real: false) is missing "provenance".`);
      }
      if (typeof s.whyConstructed !== "string" || s.whyConstructed.trim().length === 0) {
        throw new Error(`${briefPath}: shotList[${i}] ("${s.beatId}", real: false) is missing "whyConstructed".`);
      }
      constructedShots.push({
        beatId: s.beatId,
        provenance: s.provenance.trim(),
        whyConstructed: s.whyConstructed.trim(),
      });
    });
  }

  return { logline, audience, feeling, constructedShots };
}

/**
 * Reads beats.json for the real beat list. Required, unlike brief.json: without it there is
 * nothing to ground the description in, which is the entire point of this tool.
 */
function readBeats(projectRoot: string, videoName: string): { fps: number; beats: BeatLike[] } {
  const beatsPath = path.join(projectRoot, "src", "videos", videoName, "beats.json");
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`No beats.json at ${beatsPath}. Run write_beats_file first.`);
  }
  const doc = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as { fps?: number; beats?: unknown };
  const fps = typeof doc.fps === "number" && doc.fps > 0 ? doc.fps : 30;
  if (!Array.isArray(doc.beats)) {
    throw new Error(`${beatsPath}: "beats" must be an array.`);
  }
  const rawBeats = doc.beats as unknown[];
  const beats: BeatLike[] = rawBeats.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`${beatsPath}: beat[${i}] is not an object.`);
    }
    const b = raw as Record<string, unknown>;
    return {
      id: typeof b.id === "string" && b.id.length > 0 ? b.id : `beat-${i}`,
      duration: typeof b.duration === "number" && b.duration > 0 ? b.duration : 0,
      vo: typeof b.vo === "string" ? b.vo : "",
    };
  });
  return { fps, beats };
}

function formatSeconds(frames: number, fps: number): string {
  const rounded = Math.round((frames / fps) * 10) / 10;
  return rounded % 1 === 0 ? `${rounded}s` : `${rounded.toFixed(1)}s`;
}

/**
 * Builds the markdown body. Pure string assembly, no LLM call: this server doesn't call one for
 * any tool, so "drafting" here means template logic over real facts (brief fields, real beats),
 * never invented content.
 */
function buildDescription(
  videoName: string,
  brief: BriefLike | undefined,
  beatsData: { fps: number; beats: BeatLike[] },
): string {
  const { fps, beats } = beatsData;
  const totalFrames = beats.reduce((sum, b) => sum + b.duration, 0);
  const lines: string[] = [`# ${videoName}`, ""];

  const firstVo = beats.find((b) => b.vo.trim().length > 0)?.vo.trim();
  if (brief?.logline) {
    lines.push(brief.logline);
  } else if (firstVo) {
    lines.push(firstVo);
  } else {
    lines.push(`${videoName}: ${beats.length} beat${beats.length === 1 ? "" : "s"}, no narration recorded yet.`);
  }
  lines.push("");

  lines.push(
    `Length: ${formatSeconds(totalFrames, fps)} across ${beats.length} beat${beats.length === 1 ? "" : "s"}.`,
  );
  if (brief?.audience) {
    lines.push(`Made for: ${brief.audience}.`);
  }
  if (brief?.feeling) {
    lines.push(`Intended feeling: ${brief.feeling}.`);
  }
  lines.push("");

  if (beats.length > 0) {
    lines.push("## What this video shows");
    lines.push("");
    for (const beat of beats) {
      const narration = beat.vo.trim().length > 0 ? beat.vo.trim() : "(no narration recorded for this beat)";
      lines.push(`- **${beat.id}** (${formatSeconds(beat.duration, fps)}): ${narration}`);
    }
    lines.push("");
  }

  const constructedShots = brief?.constructedShots ?? [];
  if (constructedShots.length > 0) {
    lines.push("## Sample content used in this video");
    lines.push("");
    for (const shot of constructedShots) {
      lines.push(
        `The ${shot.beatId} segment shows ${shot.provenance}. It was built specifically for this video, not ` +
          `captured from the real product, because ${shot.whyConstructed}.`,
      );
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Writes output/<videoName>-DESCRIPTION.md and refuses to report success if a constructed
 * shot's disclosure went missing from the file it just wrote (see the round-trip check below).
 * See ShotListEntry/readBrief above for the brief.json shape this reads.
 */
export function runWriteDescription(input: WriteDescriptionInput): WriteDescriptionResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);

  const brief = readBrief(projectRoot, videoName);
  const beatsData = readBeats(projectRoot, videoName);

  const content = buildDescription(videoName, brief, beatsData);

  const outPath = path.join(projectRoot, "output", `${videoName}-DESCRIPTION.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, "utf8");

  const constructedShots = brief?.constructedShots ?? [];
  if (constructedShots.length > 0) {
    // Round-trip: read back what actually landed on disk and confirm every disclosure survived,
    // rather than trusting the string already held in memory. A dropped disclosure is a bug in
    // buildDescription, not a cosmetic gap, so it throws with the half-written file removed,
    // never a silently "successful" result.
    const writtenBack = fs.readFileSync(outPath, "utf8");
    const missing = constructedShots.filter(
      (shot) => !writtenBack.includes(shot.provenance) || !writtenBack.includes(shot.whyConstructed),
    );
    if (missing.length > 0) {
      try {
        fs.unlinkSync(outPath);
      } catch {
        // Best-effort cleanup only; the error below is the one that matters.
      }
      throw new Error(
        `write_description internal error: the disclosure for ${missing.map((s) => s.beatId).join(", ")} is ` +
          `missing from the file this call just wrote. This is a bug in the description template, not a ` +
          `passing result, so the incomplete file was removed instead of being reported as written.`,
      );
    }
  }

  return { written: true, path: outPath, sampleContentDisclosed: constructedShots.map((s) => s.beatId) };
}

export function registerWriteDescription(server: McpServer): void {
  server.registerTool(
    "write_description",
    {
      title: "Write a video's description, with sample content disclosed",
      description:
        "Writes output/<videoName>-DESCRIPTION.md: a short description of the video grounded in its real " +
        "beats.json (beat list and narration, never invented), plus brief.json's logline/audience/feeling if " +
        "that file exists. brief.json is optional -- a literal/quick video that skipped write_brief works " +
        "fine without one -- but beats.json is required, since there is otherwise nothing to describe. " +
        "brief.json's shotList carries the real/constructed split: every shot with real: false is disclosed " +
        "in plain language in its own section, naming which beat it is, what was built instead of the real " +
        "product (provenance), and why (whyConstructed). That disclosure is never silently dropped: after " +
        "writing, the tool reads its own output back and throws rather than returning success if any " +
        "constructed shot's disclosure is missing from it, removing the incomplete file instead of leaving " +
        "it on disk.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
      },
    },
    async (input) => runTool("write_description", () => runWriteDescription(input)),
  );
}

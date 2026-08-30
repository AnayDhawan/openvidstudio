import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool } from "./mcp";

export interface ValidateBeatsResult {
  valid: boolean;
  errors: string[];
}

const EM_DASH = "—";
const MIN_PACE = 2.3;
const MAX_PACE = 2.9;
const CAPTURE_METHODS = ["screenshot", "recording", "dom-demo", "higgsfield"] as const;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Mechanically enforces packages/docs/PLANNING.md §4 (captureMethod field spec) and
 * packages/docs/SCRIPT.md (VO pacing, no em dashes). Takes the drafted beats.json
 * content directly (not yet written to disk, not assumed to already be valid), and
 * returns every failure found rather than stopping at the first -- this is the tool's
 * normal "no" answer, never a thrown exception.
 */
export function validateBeatsLogic(beatsJson: unknown): ValidateBeatsResult {
  const errors: string[] = [];

  if (typeof beatsJson !== "object" || beatsJson === null) {
    return { valid: false, errors: ["beatsJson must be an object"] };
  }
  const root = beatsJson as Record<string, unknown>;

  const fps = typeof root.fps === "number" && root.fps > 0 ? root.fps : 30;

  if (!Array.isArray(root.beats)) {
    return { valid: false, errors: ["beatsJson.beats must be an array"] };
  }
  const beats = root.beats as unknown[];
  if (beats.length === 0) {
    errors.push("beats array is empty");
  }

  const seenIds = new Set<string>();
  let expectedStart = 0;

  beats.forEach((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      errors.push(`beat[${i}]: is not an object`);
      return;
    }
    const beat = raw as Record<string, unknown>;
    const label = typeof beat.id === "string" && beat.id.length > 0 ? `beat "${beat.id}"` : `beat[${i}]`;

    if (typeof beat.id !== "string" || beat.id.length === 0) {
      errors.push(`${label}: missing or invalid "id"`);
    } else if (seenIds.has(beat.id)) {
      errors.push(`${label}: duplicate beat id`);
    } else {
      seenIds.add(beat.id);
    }

    const start = beat.start;
    const duration = beat.duration;
    const hasStart = typeof start === "number";
    const hasDuration = typeof duration === "number" && duration > 0;

    if (!hasStart) {
      errors.push(`${label}: missing or invalid "start"`);
    } else if (start !== expectedStart) {
      errors.push(
        `${label}: "start" (${start}) must equal ${expectedStart} (contiguous timing: the first beat starts ` +
          `at 0, every later beat starts at the previous beat's start + duration)`,
      );
    }
    if (!hasDuration) {
      errors.push(`${label}: missing or invalid "duration" (must be a positive number)`);
    }
    if (hasStart && hasDuration) {
      expectedStart = (start as number) + (duration as number);
    } else if (hasDuration) {
      expectedStart += duration as number;
    }

    const vo = beat.vo;
    if (typeof vo !== "string" || vo.length === 0) {
      errors.push(`${label}: missing or invalid "vo"`);
    } else {
      if (vo.includes(EM_DASH)) {
        errors.push(`${label}: "vo" contains an em dash, rewrite with commas/periods`);
      }
      if (hasDuration) {
        const seconds = (duration as number) / fps;
        if (seconds > 0) {
          const words = wordCount(vo);
          const pace = words / seconds;
          if (pace < MIN_PACE || pace > MAX_PACE) {
            errors.push(
              `${label}: VO pace ${pace.toFixed(2)} words/sec is outside the ${MIN_PACE}-${MAX_PACE} words/sec ` +
                `budget (${words} words over ${seconds.toFixed(2)}s, per SCRIPT.md)`,
            );
          }
        }
      }
    }

    const visual = beat.visual;
    if (typeof visual !== "object" || visual === null) {
      errors.push(`${label}: missing or invalid "visual"`);
      return;
    }
    const v = visual as Record<string, unknown>;

    for (const [key, val] of Object.entries(v)) {
      if (typeof val === "string" && val.includes(EM_DASH)) {
        errors.push(`${label}: visual.${key} contains an em dash, rewrite with commas/periods`);
      }
    }

    const captureMethod = v.captureMethod;
    if (typeof captureMethod !== "string" || !(CAPTURE_METHODS as readonly string[]).includes(captureMethod)) {
      errors.push(
        `${label}: visual.captureMethod must be one of ${CAPTURE_METHODS.map((m) => `"${m}"`).join(", ")}`,
      );
      return;
    }

    if (captureMethod === "screenshot" || captureMethod === "recording") {
      if (typeof v.url !== "string" || v.url.length === 0) {
        errors.push(`${label}: visual.url is required for captureMethod "${captureMethod}"`);
      }
      if (!Array.isArray(v.interactions)) {
        errors.push(
          `${label}: visual.interactions (array, may be empty) is required for captureMethod "${captureMethod}"`,
        );
      }
    } else if (captureMethod === "higgsfield") {
      if (typeof v.higgsfieldPrompt !== "string" || v.higgsfieldPrompt.length === 0) {
        errors.push(`${label}: visual.higgsfieldPrompt is required for captureMethod "higgsfield"`);
      }
    }
    // dom-demo: no additional required fields.
  });

  return { valid: errors.length === 0, errors };
}

export function registerValidateBeats(server: McpServer): void {
  server.registerTool(
    "validate_beats",
    {
      title: "Validate a drafted beats.json",
      description:
        "Mechanically checks a drafted beats.json (an object, not a file path -- it hasn't been written to " +
        "disk yet) against PLANNING.md's captureMethod field spec and SCRIPT.md's pacing rules: contiguous " +
        "frame timing (30fps unless the file states its own fps; the first beat starts at 0, every later " +
        "beat starts at the previous beat's start + duration), no em dashes in vo/visual string fields, VO " +
        "word-count vs the 2.3-2.9 words/sec budget checked in both directions (too many words for the " +
        "duration and suspiciously few), every beat has a captureMethod, and method-specific required " +
        "fields (url + interactions for screenshot/recording, higgsfieldPrompt for higgsfield, nothing extra " +
        "for dom-demo). Returns { valid, errors } with every failure found, never just the first -- this is " +
        "the tool's normal answer for an invalid draft, not an exceptional case, so it never throws for a " +
        "validation failure.",
      inputSchema: {
        beatsJson: z
          .unknown()
          .describe("The drafted beats.json content (an object), not a file path."),
      },
    },
    async ({ beatsJson }) => runTool("validate_beats", () => validateBeatsLogic(beatsJson)),
  );
}

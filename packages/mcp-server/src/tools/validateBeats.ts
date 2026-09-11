import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { interactionSchema } from "@openvidstudio/capture";
import { runTool } from "./mcp";

export interface ValidateBeatsResult {
  valid: boolean;
  errors: string[];
}

const EM_DASH = "—";
const MIN_PACE = 2.3;
const MAX_PACE = 2.9;
const CAPTURE_METHODS = ["screenshot", "recording", "dom-demo", "higgsfield", "existing-asset"] as const;
const TRANSITIONS = ["cut", "whip", "fade"] as const;
const ARTIFACT_KEYS = ["screenshotPath", "recordingPath", "voPath", "terminalPath"] as const;
const CAPTURE_SOURCES = ["browser", "desktop", "mobile", "terminal"] as const;
const CROP_FOCUSES = ["left", "center", "right"] as const;
const MOBILE_DEVICES = ["android", "ios-simulator"] as const;
/** Android's screenrecord truncates silently past this, so a longer beat is a latent bug. */
const ANDROID_MAX_SECONDS = 180;

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

    // reformat_vertical's per-beat override. Checked here rather than left to that tool
    // because a typo in it would otherwise be silent: the reformat would fall back to the
    // inferred crop and look almost right.
    const vertical = beat.vertical;
    if (vertical !== undefined) {
      if (typeof vertical !== "object" || vertical === null) {
        errors.push(`${label}: "vertical" must be an object with a focus and/or a crop`);
      } else {
        const vert = vertical as Record<string, unknown>;
        if (
          vert.focus !== undefined &&
          (typeof vert.focus !== "string" || !(CROP_FOCUSES as readonly string[]).includes(vert.focus))
        ) {
          errors.push(
            `${label}: vertical.focus must be one of ${CROP_FOCUSES.map((f) => `"${f}"`).join(", ")}`,
          );
        }
        if (vert.crop !== undefined) {
          const crop = vert.crop as Record<string, unknown> | null;
          const ok =
            typeof crop === "object" &&
            crop !== null &&
            ["x", "y", "width", "height"].every((k) => typeof crop[k] === "number" && (crop[k] as number) >= 0);
          if (!ok) {
            errors.push(`${label}: vertical.crop must be { x, y, width, height } with non-negative numbers`);
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

    const rawSource = v.source;
    if (rawSource !== undefined && (typeof rawSource !== "string" || !(CAPTURE_SOURCES as readonly string[]).includes(rawSource))) {
      errors.push(
        `${label}: visual.source must be one of ${CAPTURE_SOURCES.map((s) => `"${s}"`).join(", ")} (omit for "browser")`,
      );
      return;
    }
    const source = (rawSource as string) ?? "browser";

    if (source !== "browser" && captureMethod !== "recording") {
      errors.push(
        `${label}: visual.source "${source}" is only valid with captureMethod "recording" (got "${captureMethod}"). ` +
          `A still from a non-browser source is an existing-asset beat, not a screenshot beat.`,
      );
      return;
    }

    if (source === "desktop") {
      if (typeof v.durationSeconds !== "number" || v.durationSeconds <= 0) {
        errors.push(`${label}: visual.durationSeconds (positive number) is required for source "desktop": a screen has no natural end`);
      }
      if (v.window !== undefined && (typeof v.window !== "string" || v.window.length === 0)) {
        errors.push(`${label}: visual.window must be a non-empty window title when present`);
      }
      return;
    }

    if (source === "mobile") {
      if (typeof v.device !== "string" || !(MOBILE_DEVICES as readonly string[]).includes(v.device)) {
        errors.push(`${label}: visual.device must be one of ${MOBILE_DEVICES.map((d) => `"${d}"`).join(", ")} for source "mobile"`);
      }
      if (typeof v.durationSeconds !== "number" || v.durationSeconds <= 0) {
        errors.push(`${label}: visual.durationSeconds (positive number) is required for source "mobile"`);
      } else if (v.device === "android" && v.durationSeconds > ANDROID_MAX_SECONDS) {
        errors.push(
          `${label}: visual.durationSeconds ${v.durationSeconds} exceeds Android screenrecord's ${ANDROID_MAX_SECONDS}s ` +
            `hard limit, which truncates silently rather than failing. Split this into multiple beats.`,
        );
      }
      return;
    }

    if (source === "terminal") {
      if (typeof v.command !== "string" || v.command.length === 0) {
        errors.push(`${label}: visual.command is required for source "terminal"`);
      } else if (/[\s;&|<>]/.test(v.command)) {
        errors.push(
          `${label}: visual.command "${v.command}" must be an executable name only. Put arguments in visual.args; ` +
            `this is never run through a shell, so a command line here would be treated as one long filename.`,
        );
      }
      if (v.args !== undefined && (!Array.isArray(v.args) || v.args.some((a) => typeof a !== "string"))) {
        errors.push(`${label}: visual.args must be an array of strings when present`);
      }
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
      } else {
        // Validate each interaction against the exact zod schema capture_screenshot /
        // capture_screen_recording enforce at replay time (interactionSchema, from
        // capture.ts), so a schema violation (e.g. a "navigate" or "type" step, which
        // this pipeline does not support) surfaces here at draft time, not at capture
        // time.
        v.interactions.forEach((interaction, idx) => {
          const parsed = interactionSchema.safeParse(interaction);
          if (!parsed.success) {
            const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
            errors.push(`${label}: visual.interactions[${idx}] is invalid: ${issues.join("; ")}`);
          }
        });
      }
    } else if (captureMethod === "higgsfield") {
      if (typeof v.higgsfieldPrompt !== "string" || v.higgsfieldPrompt.length === 0) {
        errors.push(`${label}: visual.higgsfieldPrompt is required for captureMethod "higgsfield"`);
      }
    } else if (captureMethod === "existing-asset") {
      if (typeof v.assetPath !== "string" || v.assetPath.length === 0) {
        errors.push(`${label}: visual.assetPath is required for captureMethod "existing-asset"`);
      }
      // Attribution is mandatory by design: a frame this pipeline did not capture is only
      // honest on screen if the video can say where it came from.
      if (typeof v.attribution !== "string" || v.attribution.length === 0) {
        errors.push(
          `${label}: visual.attribution is required for captureMethod "existing-asset" (say where the asset came ` +
            `from, e.g. "from the project's own README"). An unattributed borrowed frame reads as a real capture.`,
        );
      }
    }
    // dom-demo: no additional required fields.

    if ("transition" in beat && beat.transition !== undefined) {
      if (typeof beat.transition !== "string" || !(TRANSITIONS as readonly string[]).includes(beat.transition)) {
        errors.push(`${label}: transition must be one of ${TRANSITIONS.map((t) => `"${t}"`).join(", ")} (omit for "cut")`);
      }
    }

    if ("artifacts" in beat && beat.artifacts !== undefined) {
      const artifacts = beat.artifacts;
      if (typeof artifacts !== "object" || artifacts === null || Array.isArray(artifacts)) {
        errors.push(`${label}: artifacts must be an object`);
      } else {
        const a = artifacts as Record<string, unknown>;
        for (const key of Object.keys(a)) {
          if (!(ARTIFACT_KEYS as readonly string[]).includes(key)) {
            errors.push(`${label}: artifacts.${key} is not a recognized key (expected one of ${ARTIFACT_KEYS.join(", ")})`);
            continue;
          }
          const val = a[key];
          if (typeof val !== "string" || val.length === 0) {
            errors.push(`${label}: artifacts.${key} must be a non-empty string path`);
          } else if (val.includes(EM_DASH)) {
            errors.push(`${label}: artifacts.${key} contains an em dash, rewrite with commas/periods`);
          }
        }
      }
    }
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
        "for dom-demo). For screenshot/recording beats, every interactions[] entry is also validated against " +
        "the exact schema capture_screenshot/capture_screen_recording enforce at replay time (click, fill, " +
        "select, hover, scroll, wait), so a shape mismatch fails here at draft time instead of at capture " +
        "time. Also validates two optional per-beat fields if present: transition (cut/whip/fade, cut assumed " +
        "if omitted) and artifacts (screenshotPath/recordingPath/voPath overrides of the convention output " +
        "paths, each a non-empty string). Returns { valid, errors } with every failure found, never just the " +
        "first -- this is the tool's normal answer for an invalid draft, not an exceptional case, so it never " +
        "throws for a validation failure.",
      inputSchema: {
        beatsJson: z
          .unknown()
          .describe("The drafted beats.json content (an object), not a file path."),
      },
    },
    async ({ beatsJson }) => runTool("validate_beats", () => validateBeatsLogic(beatsJson)),
  );
}

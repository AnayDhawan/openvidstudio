import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment } from "../util";
import { runTool } from "./mcp";

/**
 * brief.json's shape (C1). Written alongside brief.md (free-form prose, not validated here)
 * by write_brief, before any beat gets written -- see PLANNING.md's new section documenting
 * when/how this gets authored. Every string field is checked for em dashes, same writing
 * rule as beats.json (validateBeats.ts), since a brief is a real written artifact too, not
 * just internal scratch.
 */

export interface StoryDevice {
  /** A ticking clock, a before/after, a character's day, a mystery reveal, a build-up
   * montage, a "made with itself" twist, or something else entirely -- freeform on purpose,
   * the point is picking one deliberately, not choosing from a closed list. */
  device: string;
  /** Why this device fits this product, specifically. */
  reason: string;
}

export interface Arc {
  /** Must land within 2 seconds (STYLE.md's "The hook" rule) -- a text description of the
   * hook's idea, not a timing value; the 2s budget is enforced later, on the actual beat. */
  hook: string;
  tension: string;
  turn: string;
  proof: string;
  /** Must resolve the hook. */
  payoff: string;
  cta: string;
}

/**
 * Why design.ts's choices were made, not a copy of the values themselves (those live in
 * design.ts, see packages/core/src/designSystem.ts's defineDesignSystem). One fact in one
 * place: this is the reasoning, design.ts is the value.
 */
export interface DesignRationale {
  /** Repo-relative path to this video's design.ts, e.g. "src/videos/loomcard/design.ts". */
  path: string;
  /** Why these palette roles: what extract_brand found, plus the brief's own mood words. */
  paletteRationale: string;
  /** Mirrors designSystem.ts's Motif union. Kept as a local literal copy (mcp-server does
   * not depend on @openvidstudio/core) -- update MOTIFS here if that union ever changes. */
  motif: "pixel-grid" | "rounded-soft" | "geometric" | "editorial" | "void-spark";
  motifRationale: string;
  motionRationale: string;
}

/** One of defineDesignSystem's five motifs (packages/core/src/designSystem.ts). */
const MOTIFS = ["pixel-grid", "rounded-soft", "geometric", "editorial", "void-spark"] as const;

/** A video score's section vocabulary. Doubles as the section's identity and its intensity. */
const INTENSITY_LABELS = ["intro", "tension", "reveal", "groove", "break", "peak", "outro"] as const;

export interface MusicSection {
  label: (typeof INTENSITY_LABELS)[number];
  startBar: number;
  endBar: number;
}

export interface MusicImpactPoint {
  /** e.g. "reveal". */
  name: string;
  bar: number;
  /** e.g. "beat 'reveal' starts at bar 12". */
  note: string;
}

export interface MusicPlan {
  bpm: number;
  key: string;
  sectionMap: MusicSection[];
  impactPoints: MusicImpactPoint[];
}

export interface ShotListEntry {
  beatId: string;
  /** True: a real capture or another tool's real output backs this shot. False: hand-built. */
  real: boolean;
  /** When real: which capture/tool ("capture_screenshot of /review", "plan_shots pick #2").
   * When constructed: what's being built instead ("dom-demo panel reusing the review card style"). */
  provenance: string;
  /** Required when real is false: why this couldn't be a real capture. */
  whyConstructed?: string;
  /** The one thing in this shot that matters (STYLE.md's "one focal point per shot" rule). */
  focalPoint: string;
  /**
   * True when this beat is meant to hold still (a title card the music breathes under, a
   * deliberate beat of silence). validate_scenes's render mode treats a beat whose frames never
   * change as a dead-frames finding; this is the brief saying that, for this beat, it is intended.
   */
  deliberateHold?: boolean;
}

export interface StyleOverride {
  /** Which STYLE.md default changed, and to what, e.g. "grain: 0% instead of the 4-6% default". */
  rule: string;
  reason: string;
}

/**
 * Discloses a beat whose "real" capture is of constructed sample content (a fictional app,
 * dataset, or repo built specifically to film) rather than the actual product -- same
 * pattern as this repo's own reference/acme-tasks. Consumed by write_description (C9), which
 * refuses to let this go unmentioned: it surfaces in output/<video>-DESCRIPTION.md whenever
 * this array is non-empty.
 */
export interface SampleContentEntry {
  beatId: string;
  /** What the sample content actually is, e.g. "Acme Tasks, a fictional task board app". */
  whatItIs: string;
  /** Why it had to be constructed rather than captured from the real product. */
  whyConstructed: string;
}

export interface BriefJson {
  /** Mirrors openvidstudio.config.json's production.creativeLevel (PLANNING.md §0). Recorded
   * here too because the brief is authored before beats.json exists, so this is the only
   * place on disk that says which level this brief was written under. */
  creativeLevel?: "peak" | "mid" | "literal";
  /** Mirrors production.mode. Omitted means "standard"; "supernova" marks a STEM lesson. */
  mode?: "standard" | "supernova";
  logline: string;
  audience: string;
  /** The one feeling the viewer should leave with. */
  feeling: string;
  storyDevice: StoryDevice;
  arc: Arc;
  designSystem: DesignRationale;
  music: MusicPlan;
  shotList: ShotListEntry[];
  /** Optional: STYLE.md defaults this video overrides, with why. Omit or [] if none. */
  styleOverrides?: StyleOverride[];
  /** Optional: constructed sample content this video discloses. Omit or [] if none. */
  sampleContent?: SampleContentEntry[];
}

export interface ValidateBriefResult {
  valid: boolean;
  errors: string[];
}

const EM_DASH = "—";
const CREATIVE_LEVELS = ["peak", "mid", "literal"] as const;
const ARC_KEYS = ["hook", "tension", "turn", "proof", "payoff", "cta"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(obj: Record<string, unknown>, key: string, label: string, errors: string[]): void {
  const val = obj[key];
  if (typeof val !== "string" || val.trim().length === 0) {
    errors.push(`${label}${key} must be a non-empty string`);
  }
}

/** Recursively scans every string value (object values, array entries) for an em dash, so a
 * nested field doesn't need its own hand-written check to be caught -- same writing rule
 * (no em dashes) validateBeats.ts enforces field by field, applied here in one sweep. */
function collectEmDashErrors(value: unknown, label: string, errors: string[]): void {
  if (typeof value === "string") {
    if (value.includes(EM_DASH)) {
      errors.push(`${label} contains an em dash, rewrite with commas/periods`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectEmDashErrors(item, `${label}[${i}]`, errors));
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      collectEmDashErrors(v, label ? `${label}.${k}` : k, errors);
    }
  }
}

/**
 * Mechanically validates a drafted brief.json against the shape this file documents (and
 * PLANNING.md's new creative-brief section mirrors). Shape only, same philosophy as
 * validateBeatsLogic: a literal-mode brief being "honest about having nothing to add" is
 * about what the agent writes into these fields, not a different schema for that level.
 */
export function validateBriefLogic(briefJson: unknown): ValidateBriefResult {
  const errors: string[] = [];

  if (!isPlainObject(briefJson)) {
    return { valid: false, errors: ["briefJson must be an object"] };
  }
  const b = briefJson;

  // A lesson has no creative level (that scale is for product videos), so it is required only
  // outside supernova mode, and still checked if a lesson brief gives one.
  const creativeLevelOptional = b.mode === "supernova" && b.creativeLevel === undefined;
  if (!creativeLevelOptional && (typeof b.creativeLevel !== "string" || !(CREATIVE_LEVELS as readonly string[]).includes(b.creativeLevel))) {
    errors.push(`creativeLevel must be one of ${CREATIVE_LEVELS.map((l) => `"${l}"`).join(", ")}`);
  }

  if (b.mode !== undefined && b.mode !== "standard" && b.mode !== "supernova") {
    errors.push(`mode must be "standard" or "supernova" (omit for "standard")`);
  }

  requireNonEmptyString(b, "logline", "", errors);
  requireNonEmptyString(b, "audience", "", errors);
  requireNonEmptyString(b, "feeling", "", errors);

  if (!isPlainObject(b.storyDevice)) {
    errors.push(`storyDevice must be an object: { device, reason }`);
  } else {
    requireNonEmptyString(b.storyDevice, "device", "storyDevice.", errors);
    requireNonEmptyString(b.storyDevice, "reason", "storyDevice.", errors);
  }

  if (!isPlainObject(b.arc)) {
    errors.push(`arc must be an object: { ${ARC_KEYS.join(", ")} }`);
  } else {
    for (const key of ARC_KEYS) {
      requireNonEmptyString(b.arc, key, "arc.", errors);
    }
  }

  if (!isPlainObject(b.designSystem)) {
    errors.push(`designSystem must be an object: { path, paletteRationale, motif, motifRationale, motionRationale }`);
  } else {
    const ds = b.designSystem;
    requireNonEmptyString(ds, "path", "designSystem.", errors);
    requireNonEmptyString(ds, "paletteRationale", "designSystem.", errors);
    requireNonEmptyString(ds, "motifRationale", "designSystem.", errors);
    requireNonEmptyString(ds, "motionRationale", "designSystem.", errors);
    if (typeof ds.motif !== "string" || !(MOTIFS as readonly string[]).includes(ds.motif)) {
      errors.push(`designSystem.motif must be one of ${MOTIFS.map((m) => `"${m}"`).join(", ")}`);
    }
  }

  if (!isPlainObject(b.music)) {
    errors.push(`music must be an object: { bpm, key, sectionMap, impactPoints }`);
  } else {
    const music = b.music;
    if (typeof music.bpm !== "number" || music.bpm <= 0) {
      errors.push(`music.bpm must be a positive number`);
    }
    requireNonEmptyString(music, "key", "music.", errors);

    if (!Array.isArray(music.sectionMap) || music.sectionMap.length === 0) {
      errors.push(`music.sectionMap must be a non-empty array of { label, startBar, endBar }`);
    } else {
      music.sectionMap.forEach((raw, i) => {
        const prefix = `music.sectionMap[${i}]`;
        if (!isPlainObject(raw)) {
          errors.push(`${prefix} must be an object: { label, startBar, endBar }`);
          return;
        }
        if (typeof raw.label !== "string" || !(INTENSITY_LABELS as readonly string[]).includes(raw.label)) {
          errors.push(`${prefix}.label must be one of ${INTENSITY_LABELS.map((l) => `"${l}"`).join(", ")}`);
        }
        const hasStart = typeof raw.startBar === "number" && raw.startBar > 0;
        if (!hasStart) errors.push(`${prefix}.startBar must be a positive number`);
        const hasEnd = typeof raw.endBar === "number" && raw.endBar > 0;
        if (!hasEnd) errors.push(`${prefix}.endBar must be a positive number`);
        if (hasStart && hasEnd && (raw.endBar as number) <= (raw.startBar as number)) {
          errors.push(`${prefix}.endBar (${raw.endBar}) must be greater than startBar (${raw.startBar})`);
        }
      });
      // compose_score consumes this map as consecutive section lengths and rejects a gap or an
      // overlap, so a brief that passes here has to be one it can compose. endBar is the first bar
      // of the next section, not the last bar of this one.
      const sections = music.sectionMap as unknown[];
      sections.forEach((raw, i) => {
        if (i === 0 || !isPlainObject(raw)) return;
        const prev = sections[i - 1];
        if (!isPlainObject(prev)) return;
        if (typeof prev.endBar === "number" && typeof raw.startBar === "number" && prev.endBar !== raw.startBar) {
          errors.push(
            `music.sectionMap[${i}].startBar (${raw.startBar}) must equal music.sectionMap[${i - 1}].endBar (${prev.endBar}): ` +
              `sections connect exactly, and endBar is the first bar of the next section (compose_score rejects a gap or overlap)`,
          );
        }
      });
    }

    if (music.impactPoints !== undefined) {
      if (!Array.isArray(music.impactPoints)) {
        errors.push(`music.impactPoints must be an array of { name, bar, note } when present`);
      } else {
        music.impactPoints.forEach((raw, i) => {
          const prefix = `music.impactPoints[${i}]`;
          if (!isPlainObject(raw)) {
            errors.push(`${prefix} must be an object: { name, bar, note }`);
            return;
          }
          requireNonEmptyString(raw, "name", `${prefix}.`, errors);
          if (typeof raw.bar !== "number" || raw.bar <= 0) errors.push(`${prefix}.bar must be a positive number`);
          requireNonEmptyString(raw, "note", `${prefix}.`, errors);
        });
      }
    }
  }

  // A lesson has no real product to be real or constructed about: everything in it is drawn on purpose, so
  // the real/constructed split and the reasons for it do not apply. A shot list is optional there, and an
  // entry only has to say which beat it is about.
  const lesson = b.mode === "supernova";
  if (lesson) {
    if (b.shotList !== undefined && !Array.isArray(b.shotList)) {
      errors.push(`shotList must be an array of { beatId } when present`);
    } else if (Array.isArray(b.shotList)) {
      b.shotList.forEach((raw, i) => {
        if (!isPlainObject(raw)) errors.push(`shotList[${i}] must be an object: { beatId }`);
        else requireNonEmptyString(raw, "beatId", `shotList[${i}].`, errors);
      });
    }
  } else if (!Array.isArray(b.shotList) || b.shotList.length === 0) {
    errors.push(`shotList must be a non-empty array of { beatId, real, provenance, focalPoint }`);
  } else {
    b.shotList.forEach((raw, i) => {
      const prefix = `shotList[${i}]`;
      if (!isPlainObject(raw)) {
        errors.push(`${prefix} must be an object: { beatId, real, provenance, focalPoint }`);
        return;
      }
      requireNonEmptyString(raw, "beatId", `${prefix}.`, errors);
      if (typeof raw.real !== "boolean") {
        errors.push(`${prefix}.real must be a boolean`);
      }
      requireNonEmptyString(raw, "provenance", `${prefix}.`, errors);
      requireNonEmptyString(raw, "focalPoint", `${prefix}.`, errors);
      if (raw.deliberateHold !== undefined && typeof raw.deliberateHold !== "boolean") {
        errors.push(`${prefix}.deliberateHold must be a boolean when present`);
      }
      if (raw.real === false) {
        requireNonEmptyString(raw, "whyConstructed", `${prefix}.`, errors);
      }
    });
  }

  if (b.styleOverrides !== undefined) {
    if (!Array.isArray(b.styleOverrides)) {
      errors.push(`styleOverrides must be an array of { rule, reason } when present`);
    } else {
      b.styleOverrides.forEach((raw, i) => {
        const prefix = `styleOverrides[${i}]`;
        if (!isPlainObject(raw)) {
          errors.push(`${prefix} must be an object: { rule, reason }`);
          return;
        }
        requireNonEmptyString(raw, "rule", `${prefix}.`, errors);
        requireNonEmptyString(raw, "reason", `${prefix}.`, errors);
      });
    }
  }

  if (b.sampleContent !== undefined) {
    if (!Array.isArray(b.sampleContent)) {
      errors.push(`sampleContent must be an array of { beatId, whatItIs, whyConstructed } when present`);
    } else {
      b.sampleContent.forEach((raw, i) => {
        const prefix = `sampleContent[${i}]`;
        if (!isPlainObject(raw)) {
          errors.push(`${prefix} must be an object: { beatId, whatItIs, whyConstructed }`);
          return;
        }
        requireNonEmptyString(raw, "beatId", `${prefix}.`, errors);
        requireNonEmptyString(raw, "whatItIs", `${prefix}.`, errors);
        requireNonEmptyString(raw, "whyConstructed", `${prefix}.`, errors);
      });
    }
  }

  collectEmDashErrors(b, "briefJson", errors);

  return { valid: errors.length === 0, errors };
}

export interface WriteBriefInput {
  projectRoot?: string;
  videoName: string;
  /** Free-form prose: the actual creative reasoning. Written verbatim, not validated. */
  briefMarkdown: string;
  briefJson: unknown;
}

export type WriteBriefResult = { written: true; briefMdPath: string; briefJsonPath: string } | ValidateBriefResult;

/**
 * Mirrors write_beats_file's pattern: runs validateBriefLogic internally (a direct function
 * call, not an MCP round-trip) and refuses to write anything invalid, returning the same
 * { valid: false, errors } shape instead. On success writes BOTH src/videos/<videoName>/
 * brief.md (the raw briefMarkdown string, as given) and brief.json (pretty-printed). Neither
 * file is written unless both inputs are present and briefJson passes validation -- this is
 * one write, not two independent ones.
 */
export function runWriteBrief(input: WriteBriefInput): WriteBriefResult {
  const validation = validateBriefLogic(input.briefJson);
  if (!validation.valid) {
    return validation;
  }

  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  fs.mkdirSync(videoDir, { recursive: true });

  const briefMdPath = path.join(videoDir, "brief.md");
  const md = input.briefMarkdown.endsWith("\n") ? input.briefMarkdown : `${input.briefMarkdown}\n`;
  fs.writeFileSync(briefMdPath, md, "utf8");

  const briefJsonPath = path.join(videoDir, "brief.json");
  fs.writeFileSync(briefJsonPath, `${JSON.stringify(input.briefJson, null, 2)}\n`, "utf8");

  return { written: true, briefMdPath, briefJsonPath };
}

export function registerWriteBrief(server: McpServer): void {
  server.registerTool(
    "write_brief",
    {
      title: "Write a validated creative brief (brief.md + brief.json) to disk",
      description:
        "Writes the creative brief that PLANNING.md's new creative-brief section requires before any beat " +
        "gets written: BOTH src/videos/<videoName>/brief.md (free-form prose, the actual creative reasoning " +
        "-- written verbatim, exactly the string given, no validation of prose content) AND " +
        "src/videos/<videoName>/brief.json (structured, validated). Mirrors write_beats_file's pattern: runs " +
        "its own shape validation internally first (a direct function call, not an MCP round-trip) and " +
        "refuses to write anything invalid, returning { valid: false, errors } naming exactly what's missing " +
        "or wrong instead. Neither file is written unless briefJson passes validation in full. " +
        "briefJson's required shape: creativeLevel (\"peak\"/\"mid\"/\"literal\", mirrors PLANNING.md §0's " +
        "intake); logline, audience, feeling (non-empty strings); storyDevice ({ device, reason }, a " +
        "deliberately chosen device such as a ticking clock, a before/after, a character's day, a mystery " +
        "reveal, a build-up montage, a \"made with itself\" twist, or something else entirely, never " +
        "defaulted); arc ({ hook, tension, turn, proof, payoff, cta }, the hook must land within 2 seconds " +
        "per STYLE.md and the payoff must resolve the hook); designSystem ({ path, paletteRationale, motif " +
        "[\"pixel-grid\"/\"rounded-soft\"/\"geometric\"/\"editorial\"/\"void-spark\", mirrors defineDesignSystem's Motif " +
        "union], motifRationale, motionRationale } -- the WHY behind this video's src/videos/<name>/design.ts, " +
        "never a duplicate copy of its actual color/type/motion values, which live only in design.ts); music " +
        "({ bpm, key, sectionMap: non-empty array of { label [\"intro\"/\"tension\"/\"reveal\"/\"groove\"/" +
        "\"break\"/\"peak\"/\"outro\", whatever subset applies], startBar, endBar }, impactPoints: array of " +
        "{ name, bar, note } }); shotList (non-empty array of { beatId, real [boolean], provenance [which " +
        "real capture/tool's output, or what was constructed instead], whyConstructed [required when real " +
        "is false], focalPoint [the one thing in this shot that matters], deliberateHold [optional boolean: this beat is meant to hold still, so validate_scenes does not report its unchanging frames as dead] }). Optional: styleOverrides (array " +
        "of { rule, reason } for any STYLE.md default this video overrides) and sampleContent (array of " +
        "{ beatId, whatItIs, whyConstructed }, disclosing any beat whose real capture is of constructed " +
        "sample content -- a fictional app/dataset/repo built specifically to film -- rather than the actual " +
        "product; consumed by write_description, which surfaces this in the video's description file). Every " +
        "string field, at any depth, is checked for an em dash. In literal mode the brief is still shaped " +
        "the same way, but should be honest about having nothing to add: it restates the user's own spec " +
        "rather than inventing a story device or arc beyond what was asked for. IMPORTANT: like " +
        "write_beats_file, this tool only enforces schema validity, not dev approval -- show the dev the " +
        "full brief (both files) and get explicit approval before calling this, same protocol as beats.json's " +
        "approval gate (PLANNING.md §5).",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        briefMarkdown: z
          .string()
          .min(1)
          .describe("Free-form prose: the actual creative reasoning. Written verbatim, not a file path."),
        briefJson: z.unknown().describe("The drafted brief.json content (an object), not a file path."),
      },
    },
    async (input) => runTool("write_brief", () => runWriteBrief(input)),
  );
}

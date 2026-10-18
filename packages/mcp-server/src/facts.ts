import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Run records: a small JSON file per tool call that did something worth verifying later.
 *
 * "A claim needs a visual" is a rule this pipeline can only follow by convention while the
 * only record of what happened is beats.json and brief.json, which say what was intended.
 * A run record is the other half: what a tool actually did (this beat was a real capture of
 * that URL, that render reused three cached beats and rendered two, this validator flagged
 * these findings). collect_facts merges them into src/videos/<name>/facts.json so a check, or
 * a person, can hold a claim up against what really ran.
 *
 * Writing a record is best effort and never fails the tool that calls it: a read-only project
 * directory must not turn a successful capture into an error.
 */

export const FACT_SCHEMA_VERSION = 1;

/** Where records go, relative to the project root. Gitignored: they are evidence, not source. */
export const RUNS_DIR_REL = path.join(".openvidstudio", "runs");

export interface FactRecord {
  schemaVersion: number;
  tool: string;
  /** ISO timestamp the record was written. */
  recordedAt: string;
  /** Set when the tool is scoped to one video (render, validate, stitch). */
  videoName?: string;
  /** Set when the tool is scoped to one beat (every capture). */
  beatId?: string;
  facts: Record<string, unknown>;
}

export interface FactRecordInput {
  tool: string;
  videoName?: string;
  beatId?: string;
  facts: Record<string, unknown>;
}

/** A project-relative path with forward slashes, so a record reads the same on every platform. */
export function relToProject(projectRoot: string, abs: string): string {
  return path.relative(projectRoot, abs).split(path.sep).join("/");
}

function fileSafeTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

/**
 * Writes one record and returns its absolute path, or null when it could not be written. The
 * `wx` flag plus a counter keeps two records from the same millisecond (a batch of captures)
 * from overwriting each other.
 */
export function writeFactRecord(projectRoot: string, input: FactRecordInput): string | null {
  try {
    const recordedAt = new Date().toISOString();
    const record: FactRecord = { schemaVersion: FACT_SCHEMA_VERSION, recordedAt, ...input };
    const dir = path.join(projectRoot, RUNS_DIR_REL);
    fs.mkdirSync(dir, { recursive: true });
    const stem = `${input.tool}-${fileSafeTimestamp(recordedAt)}`;
    for (let n = 0; n < 1000; n++) {
      const file = path.join(dir, `${stem}${n === 0 ? "" : `-${n}`}.json`);
      try {
        fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
        return file;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
    return null;
  } catch (err) {
    process.stderr.write(`openvidstudio-mcp: could not write a ${input.tool} run record: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

/** Every readable record in the runs directory, oldest first. A malformed file is skipped, not fatal. */
export function readFactRecords(projectRoot: string): FactRecord[] {
  const dir = path.join(projectRoot, RUNS_DIR_REL);
  if (!fs.existsSync(dir)) return [];
  const out: FactRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as FactRecord;
      if (rec && typeof rec.tool === "string" && typeof rec.recordedAt === "string" && rec.facts) out.push(rec);
    } catch {
      // Half-written or hand-edited; not this tool's job to diagnose.
    }
  }
  return out.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/** Size in bytes of a file that should exist, or null. Records state what is on disk, not what was asked for. */
export function fileBytes(abs: string): number | null {
  try {
    return fs.statSync(abs).size;
  } catch {
    return null;
  }
}

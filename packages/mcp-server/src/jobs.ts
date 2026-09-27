/**
 * In-memory job tracking for tools whose real work can outlast an MCP client's own request
 * timeout (Claude Code's MCP_TOOL_TIMEOUT defaults well under the 40+ minutes a full render
 * can take on a modest machine). A tool that accepts `async: true` starts its real work
 * without awaiting it in the request handler, records it here, and returns a jobId
 * immediately; `job_status` (jobStatus.ts) polls this store.
 *
 * Deliberately in-memory, not persisted: a job dies with the server process, same as the
 * render it's tracking would. This process is a long-lived stdio server for the duration of
 * one MCP connection, so a promise kicked off here and never awaited by its caller keeps
 * running on the same event loop while later requests (including job_status polls) are
 * handled -- that's what makes "return now, finish later" work at all.
 */

export type JobStatus = "running" | "done" | "error";

export interface JobProgress {
  framesRendered: number;
  totalFrames: number;
  currentBeat: string | null;
  /** Most recent lines first isn't the point here; insertion order, capped, is. */
  logTail: string[];
}

export interface JobRecord<T = unknown> {
  id: string;
  tool: string;
  status: JobStatus;
  startedAt: string;
  updatedAt: string;
  progress: JobProgress;
  result?: T;
  error?: string;
}

const MAX_LOG_LINES = 20;
const jobs = new Map<string, JobRecord>();

function newJobId(tool: string): string {
  return `${tool}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createJob<T>(tool: string, totalFrames = 0): JobRecord<T> {
  const now = new Date().toISOString();
  const record: JobRecord<T> = {
    id: newJobId(tool),
    tool,
    status: "running",
    startedAt: now,
    updatedAt: now,
    progress: { framesRendered: 0, totalFrames, currentBeat: null, logTail: [] },
  };
  jobs.set(record.id, record as JobRecord);
  return record;
}

export function updateJobProgress(
  jobId: string,
  patch: Partial<Pick<JobProgress, "framesRendered" | "totalFrames" | "currentBeat">>,
): void {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job.progress, patch);
  job.updatedAt = new Date().toISOString();
}

export function appendJobLog(jobId: string, line: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.progress.logTail = [...job.progress.logTail, line].slice(-MAX_LOG_LINES);
  job.updatedAt = new Date().toISOString();
}

export function completeJob<T>(jobId: string, result: T): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "done";
  job.result = result;
  job.updatedAt = new Date().toISOString();
}

export function failJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "error";
  job.error = error;
  job.updatedAt = new Date().toISOString();
}

export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId);
}

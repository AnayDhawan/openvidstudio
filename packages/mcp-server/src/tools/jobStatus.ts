import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getJob, type JobRecord } from "../jobs";
import { runTool } from "./mcp";

export interface JobStatusInput {
  jobId: string;
}

/**
 * Poll target for a job started with { async: true } on a tool that supports it
 * (render_video today). Returns the job record as-is: status, progress (frames rendered,
 * current beat, a log tail), and result once status is "done" or error once "error".
 * Jobs live only in this server process's memory, so a job from before a server restart is
 * simply gone -- the error message says so rather than pretending the jobId never existed.
 */
export function runJobStatus(input: JobStatusInput): JobRecord {
  const job = getJob(input.jobId);
  if (!job) {
    throw new Error(
      `No job found for jobId "${input.jobId}". Jobs live only in this server process's memory for the ` +
        `duration of the connection; if the server restarted since the job was started, it's gone.`,
    );
  }
  return job;
}

export function registerJobStatus(server: McpServer): void {
  server.registerTool(
    "job_status",
    {
      title: "Poll an async job's progress and result",
      description:
        "Poll target for a job started with { async: true } on a tool that supports it (render_video " +
        "today). Returns { id, tool, status, startedAt, updatedAt, progress, result?, error? }: status is " +
        "\"running\", \"done\", or \"error\"; progress carries framesRendered, totalFrames, currentBeat, " +
        "and logTail (the most recent output lines); result appears once status is \"done\" and is exactly " +
        "what the tool would have returned synchronously (e.g. a RenderVideoResult); error appears once " +
        "status is \"error\". Jobs live only in this server process's memory for the connection's lifetime, " +
        "so a jobId from before a restart is gone, not just stale.",
      inputSchema: {
        jobId: z.string().min(1),
      },
    },
    async ({ jobId }) => runTool("job_status", () => runJobStatus({ jobId })),
  );
}

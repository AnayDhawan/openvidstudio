import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createJob, completeJob, failJob, updateJobProgress } from "../jobs";
import { resolveCanvasInput, runCanvasExplainer, type CanvasExplainerInput, type CanvasExplainerResult } from "../canvasExplainer";
import { runTool } from "./mcp";

export function registerRenderCanvasExplainer(server: McpServer): void {
  server.registerTool(
    "render_canvas_explainer",
    {
      title: "Render an HTML canvas explainer to a video",
      description:
        "Turns a canvas explainer into an mp4. An explainer is one self-contained HTML file with a canvas that exposes " +
        "window.seek(t) (draw the frame at time t in seconds, a pure function of t), window.DURATION (seconds) and " +
        "window.scoreSound(kit) (a Web Audio score), with window.SOUND.renderOffline(scoreSound, seconds, sampleRate, " +
        "{ voiceover }) to render it; a file that does not expose these is refused with the missing ones named. Loads the file " +
        "in headless Chromium, waits for fonts, walks every frame (round(DURATION * fps), 1280x720 at 30 fps by default, " +
        "width 720 and height 1280 for a Reel, both even), pipes the canvas PNGs into ffmpeg (H.264, yuv420p), renders the score, " +
        "and muxes the two. Pass videoName to use the project's beats: src/videos/<videoName>/beats.json becomes window.BEATS " +
        "(an array of { id, start, end, text } in seconds, after fit_beats), DURATION becomes the last beat's end, " +
        "public/audio/vo/<beatId>.mp3 is mixed in at each beat's start over the score rendered with voiceover: true and the score " +
        "ducked at least 6 dB (audio.duckDb, default 9) under the voice, and the beats' text is burned in as captions broken at " +
        "sentence ends inside the safe areas, through window.CAPTIONS.draw(ctx, t, opts) which the explainer can call to caption in its " +
        "own style (the renderer draws them itself if it does not); narration: \"none\" renders silent narration with the full-mix " +
        "sound. audio: false renders no sound. A pre-flight runs validate_canvas_explainer first and refuses to render on an error " +
        "(validate: false skips it). Warns when the file calls Math.random. Returns the frame count, the SHA-256 of the first, middle " +
        "and last frame (render twice and compare them to check the purity promise) and what was mixed. Pass async: true to return a " +
        "jobId at once and poll job_status, as render_video does.",
      inputSchema: {
        projectRoot: z.string().optional(),
        htmlPath: z.string().min(1).describe("The explainer, absolute or relative to the project root."),
        outPath: z.string().min(1).describe("The mp4 to write, relative to the project root or absolute."),
        width: z.number().int().positive().optional().describe("Default 1280. Use 720 with height 1280 for a Reel."),
        height: z.number().int().positive().optional().describe("Default 720."),
        fps: z.number().positive().optional().describe("Default 30."),
        audio: z
          .union([z.literal(false), z.object({ voiceover: z.boolean().optional(), sampleRate: z.number().int().positive().optional(), duckDb: z.number().min(6).optional() })])
          .optional()
          .describe("false for no sound, or { voiceover, sampleRate, duckDb }. Voiceover defaults to on when videoName has narration."),
        videoName: z.string().optional().describe("Use this project video's beats.json, narration clips and captions."),
        captions: z.boolean().optional().describe("Burn the beats' text in as captions. Default true when there is narration."),
        validate: z.boolean().optional().describe("Run the pre-flight first. Default true."),
        async: z.boolean().optional(),
      },
    },
    async (input) =>
      runTool("render_canvas_explainer", async () => {
        const args: CanvasExplainerInput = { projectRoot: input.projectRoot, htmlPath: input.htmlPath, outPath: input.outPath, width: input.width, height: input.height, fps: input.fps, audio: input.audio, videoName: input.videoName, captions: input.captions, validate: input.validate };
        if (input.async === true) {
          // Checked now, so a bad call never "succeeds" with a jobId that immediately errors.
          resolveCanvasInput(args);
          const job = createJob<CanvasExplainerResult>("render_canvas_explainer", 0);
          runCanvasExplainer(args, { onProgress: (p) => updateJobProgress(job.id, p) })
            .then((result) => completeJob(job.id, result))
            .catch((err) => failJob(job.id, err instanceof Error ? err.message : String(err)));
          return { jobId: job.id };
        }
        return runCanvasExplainer(args);
      }),
  );
}

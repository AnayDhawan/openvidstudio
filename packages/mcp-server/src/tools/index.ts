import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenvidstudioConfig } from "../config";
import { registerInitProject } from "./initProject";
import { registerValidateBeats } from "./validateBeats";
import { registerWriteBeatsFile } from "./writeBeatsFile";
import { registerScaffoldScene } from "./scaffoldScene";
import { registerStitchComposition } from "./stitchComposition";
import { registerRenderVideo } from "./renderVideo";
import { registerQcExtractFrames } from "./qcExtractFrames";
import { registerCaptureScreenshot } from "./captureScreenshot";
import { registerCaptureScreenRecording } from "./captureScreenRecording";

/**
 * Registers all 9 of this task's tools. `config` is accepted for shape-compatibility
 * with Task 5 (call_higgsfield's registration will gate on config.hasHiggsfield) but
 * unused here: none of these 9 tools need a server-startup config, each one resolves a
 * project's own openvidstudio.config.json itself, per call, off projectRoot.
 */
export function registerTools(server: McpServer, config?: OpenvidstudioConfig): void {
  registerInitProject(server);
  registerValidateBeats(server);
  registerWriteBeatsFile(server);
  registerScaffoldScene(server);
  registerStitchComposition(server);
  registerRenderVideo(server);
  registerQcExtractFrames(server);
  registerCaptureScreenshot(server);
  registerCaptureScreenRecording(server);
}

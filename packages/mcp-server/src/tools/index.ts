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
import { registerImportHiggsfieldClip } from "./importHiggsfieldClip";
import { registerGenerateNarration } from "./generateNarration";
import { registerPreflight } from "./preflight";
import { registerPlanBeats } from "./planBeats";
import { registerValidateScenes } from "./validateScenes";
import { registerContactSheet } from "./contactSheet";

/**
 * Registers all of this package's tools. All but one need no server-startup config: each
 * resolves a project's own openvidstudio.config.json itself, per call, off projectRoot.
 * import_higgsfield_clip is the one exception -- its registration itself is gated on
 * config.hasHiggsfield, decided once at server-startup time (stdio.ts reads
 * openvidstudio.config.json from process.cwd() before calling createMcpServer). Config is
 * a static file read at startup here, not a live-toggleable runtime setting, so simply not
 * calling registerImportHiggsfieldClip when the gate fails is sufficient: the tool is
 * absent from the tool list entirely, not present-but-erroring.
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
  registerGenerateNarration(server);
  registerPreflight(server);
  registerPlanBeats(server);
  registerValidateScenes(server);
  registerContactSheet(server);
  if (config?.hasHiggsfield === true) {
    registerImportHiggsfieldClip(server);
  }
}

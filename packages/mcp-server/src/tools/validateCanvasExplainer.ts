import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateCanvasExplainer } from "../canvasValidate";
import { runTool } from "./mcp";

export function registerValidateCanvasExplainer(server: McpServer): void {
  server.registerTool(
    "validate_canvas_explainer",
    {
      title: "Check a canvas explainer for problems that render without erroring",
      description:
        "What validate_scenes does for a Remotion composition, for a canvas explainer (see render_canvas_explainer). Loads the HTML " +
        "in headless Chromium and samples frames through window.seek(t). Checks: purity, three times drawn twice with another time " +
        "between, the frames must match (error); text size, by intercepting fillText and strokeText: labels 28px, headlines 44px and " +
        "key numbers 64px at 720 on the shorter side, scaled to the canvas (warning below, error below half; captions drawn through " +
        "window.CAPTIONS are exempt); safe areas, on a tall canvas no text in the top 14% or bottom 22% except captions (warning); the " +
        "lesson arc through the same code as validate_scenes, the first frame with anything drawn beyond the background and the captions " +
        "(diagram-late: warning after 15 s, error after 25 s) and any run of frames that do not change longer than 8 s " +
        "(static-stretch, warning); the sound, by scheduling window.scoreSound into an offline context: the most source nodes " +
        "playing at once (warning above 3) and the peak level (warning at clipping); and Math.random in the source (warning). " +
        "Findings have validate_scenes' shape (beatId, scene, severity, check, message). Pass videoName to use the project's beats " +
        "and captions as render_canvas_explainer does. Returns ok, the findings, the length, the smallest text size and the sound figures.",
      inputSchema: {
        projectRoot: z.string().optional(),
        htmlPath: z.string().min(1),
        width: z.number().int().positive().optional().describe("Default 1280."),
        height: z.number().int().positive().optional().describe("Default 720. Use 720 wide by 1280 high for a Reel."),
        fps: z.number().positive().optional(),
        videoName: z.string().optional(),
        audio: z.boolean().optional().describe("Judge the sound too. Default true."),
        textScale: z.number().positive().optional().describe("Multiply the text minimums by this instead of min(width, height) / 720."),
        diagramWarnSeconds: z.number().positive().optional(),
        diagramErrorSeconds: z.number().positive().optional(),
        staticSeconds: z.number().positive().optional(),
      },
    },
    async (input) => runTool("validate_canvas_explainer", () => validateCanvasExplainer(input)),
  );
}

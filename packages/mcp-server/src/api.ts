/**
 * The programmatic surface.
 *
 * Everything here is also an MCP tool, and an agent should reach it that way. This exists
 * for the cases where there is no agent in the loop: a CI job diffing a render against the
 * last accepted one, a cron job checking whether a docs clip still matches its page. Those
 * want a function, not a stdio protocol handshake.
 *
 * Deliberately a short list rather than everything: the tools that draft, scaffold, or
 * write a manifest are the ones that need an agent's judgement and a human's approval, and
 * exposing them here would be inviting a script to skip both.
 */
export { runVisualRegression, buildRegressionMarkdown } from "./tools/visualRegression";
export type { VisualRegressionInput, VisualRegressionResult, BeatRegression } from "./tools/visualRegression";
export { runDocsDrift, inferBindings } from "./tools/docsDrift";
export type { DocsDriftInput, DocsDriftResult, DriftFinding, DriftBinding } from "./tools/docsDrift";
export { runRenderVideo } from "./tools/renderVideo";
export type { RenderVideoInput, RenderVideoResult } from "./tools/renderVideo";
export { runExportRendition, STORE_DEVICES } from "./tools/exportRendition";
export type { ExportRenditionInput, ExportRenditionResult } from "./tools/exportRendition";
export { runReformatVertical } from "./tools/reformatVertical";
export type { ReformatVerticalInput, ReformatVerticalResult } from "./tools/reformatVertical";
export { runPlanShots } from "./tools/planShots";
export type { PlanShotsInput, PlanShotsResult, ShotCandidate } from "./tools/planShots";
export { runReleaseDiff } from "./tools/releaseDiff";
export type { ReleaseDiffInput, ReleaseDiffResult, RouteChange } from "./tools/releaseDiff";
export { compareFrames, judgeDrift } from "./frameDiff";
export type { FrameComparison, DriftVerdict } from "./frameDiff";

/**
 * @openvidstudio/capture
 *
 * The half of openvidstudio that has nothing to do with video: getting a true frame out
 * of a running product. A real browser with the per-origin zoom desync measured and
 * compensated rather than assumed, interaction replay, and ffmpeg/adb/simctl backends for
 * the desktop, mobile, and terminal surfaces a browser cannot reach.
 *
 * Deliberately free of Remotion, React, and @openvidstudio/core: a team that wants
 * trustworthy capture and does not want to make videos should be able to take this alone.
 */
export * from "./process";
export * from "./browser";
export * from "./native";
export * from "./terminal";

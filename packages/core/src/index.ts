// @openvidstudio/core: public API. Everything a video project needs to build
// scenes in the openvidstudio house style: camera rig, motion helpers, SFX,
// look pass, design tokens, and the shared scene/UI components.

// Camera + layers
export { CameraRig, Layer, useCamera } from "./camera";
export type { CamKeyframe } from "./camera";

// Motion helpers
export { E, SPRING, tween, pop, jitter, staggerDelay } from "./motion";

// SFX
export { KeySound, TypingSfx, Click, Whoosh, Blip, SuccessChime } from "./sfx";

// Look pass
export { FilmGrain, Vignette, ColorGrade, LookPass } from "./look";

// Design tokens
export { color, font, glow, panelShadow, radius } from "./tokens";

// Scene wrapper
export { CinematicScene } from "./CinematicScene";

// Device / UI frames
export { BrowserFrame } from "./DeviceFrame";

// Kinetic typography
export { TitleSlam, Caption } from "./KineticText";

// Terminal replay
export {
  TerminalReplay,
  computeTerminalTimeline,
} from "./TerminalReplay";
export type { TermLine, TermStep } from "./TerminalReplay";

// Code panel
export { CodePanel } from "./CodePanel";
export type { Token, CodeLine } from "./CodePanel";

// Checklist panel
export { ChecklistPanel } from "./ChecklistPanel";
export type { ChecklistItem } from "./ChecklistPanel";

// Cursor actor
export { CursorActor } from "./CursorActor";
export type { CursorKeyframe } from "./CursorActor";

// Repo CTA scene
export { RepoCta } from "./RepoCta";

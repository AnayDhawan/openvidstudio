// @openvidstudio/core: public API. Everything a video project needs to build
// scenes in the openvidstudio house style: camera rig, motion helpers, SFX,
// look pass, design tokens, and the shared scene/UI components.

// Local, offline Inter/JetBrains Mono loading (A2): every scene imports from this
// index, so importing it here means every render gets bundled fonts with zero
// network access, instead of the @remotion/google-fonts loaders that used to be
// scattered across TerminalReplay/RepoCta/ChecklistPanel.
import "./localFonts";

// Camera + layers
export { CameraRig, Layer, useCamera, resolveCamera, projectToScreen, Z_STEP } from "./camera";
export type { CamKeyframe, CameraInfo } from "./camera";

// Directed shot: a flat capture turned into a push-in with tilt, depth of field and a cursor (C4)
export { DirectedShot, directedKeyframes } from "./DirectedShot";
export type { DirectedShotProps, DirectedKeyframeOptions, CaptureRect } from "./DirectedShot";

// Cinematic shots (camera half): the shot vocabulary
export { resolveShot, SHOT_NAMES } from "./shots";
export type { ShotName, ShotOptions, ResolvedShot } from "./shots";

// Cinematic shots (camera half): layered shots and motion blur
export { LayeredShot } from "./LayeredShot";
export type { LayeredShotProps, LayerManifest, ShotLayer } from "./LayeredShot";
export { MotionBlur } from "./motionBlur";
export type { MotionBlurOptions } from "./motionBlur";

// Cinematic shots (camera half): handheld sway and impact shake
export { handheldOffset, holdWeight, useHandheld, impactShake, useImpactShake } from "./handheld";
export type { ShakeOffset } from "./handheld";

// Music-first timing: the score's grid as scene-local frames (C3)
export { MusicClockProvider, useMusicClock, createMusicClock } from "./musicClock";
export { NarrationWordsProvider, useNarrationWords, createNarrationWords } from "./narrationWords";
export type { NarrationWord, NarrationWords, WordAt } from "./narrationWords";
export type { MusicCues, MusicClock } from "./musicClock";

// Motion helpers
export { E, SPRING, tween, pop, jitter, staggerDelay } from "./motion";

// SFX
export {
  TypingSfx,
  Click,
  Whoosh,
  Blip,
  SuccessChime,
  Bell,
  SoftClick,
  Bong,
  Drop,
  MusicBed,
} from "./sfx";

// Look pass
export { FilmGrain, Vignette, ColorGrade, LookPass } from "./look";

// Design tokens
export {
  color, font, glow, panelShadow, radius,
  applyBrand, brandAssets, monoStack, uiStack,
} from "./tokens";
export type { Brand } from "./tokens";

// Design system as code (C2)
export {
  defineDesignSystem, contrastRatio,
  DEFAULT_TYPE_SCALE, DEFAULT_GRID, DEFAULT_MOTION, DEFAULT_TEXTURE, DEFAULT_TRANSITIONS,
} from "./designSystem";
export type { DesignSystem, TypeScale, LayoutGrid, MotionPersonality, CameraEnergy, Motif, Texture } from "./designSystem";

// Scene wrapper
export { CinematicScene } from "./CinematicScene";

// Device / UI frames
export { BrowserFrame } from "./DeviceFrame";

// Kinetic typography
export { TitleSlam, Caption, captionLayout } from "./KineticText";
export type { CaptionPosition, CaptionRect } from "./KineticText";

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
export { CursorActor, cursorPositionAt } from "./CursorActor";
export type { CursorKeyframe } from "./CursorActor";

// Repo CTA scene
export { RepoCta } from "./RepoCta";

// Kinetic text primitives (C4)
export { Words, useTyped, Caret } from "./kinetic";

// Pixel-grid family: dot-matrix text, logo assembler, wipe transition (C4)
export { DotText, PixelLogo, PixelWipe } from "./pixel";
export type { PixelShape } from "./pixel";

// Backgrounds and transition primitives (C4)
export { Atmosphere, DotGrid, Flash, Black, Letterbox } from "./atmosphere";

// UI chrome: windows, JSON viewer, tool chips, badges, glass panel, chapter HUD (C4)
export { Window, JsonView, Check, Cross, ToolChip, Pill, Glass, ChapterHud } from "./panels";
export type { Chapter } from "./panels";

// Transition overlays drawn over a hard cut by stitch_composition, so a beat's `transition`
// field changes the picture without moving any beat boundary
export { TransitionOverlay, TRANSITION_TYPES, transitionEnvelope } from "./TransitionOverlay";
export type { TransitionType } from "./TransitionOverlay";

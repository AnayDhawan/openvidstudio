// @openvidstudio/stem: Supernova mode. STEM lesson primitives and the Void + Spark design system,
// built on @openvidstudio/core. Everything here is a pure function of the frame, takes its sizes
// from useVideoConfig(), and loads its fonts from local files.

import "./localFonts";

export {
  SUBJECTS,
  SUBJECT_ACCENT,
  VOID,
  DISPLAY_FONT,
  BODY_FONT,
  SUPERNOVA_STAGE,
  SUPERNOVA_GRID,
  displayStack,
  bodyStack,
  supernovaDesignSystem,
} from "./designSystem";
export type { Subject, SupernovaDesignSystem } from "./designSystem";

export { Glow, countGlowing, GLOW_ATTR, GLOW_LEVEL_ATTR, GLOW_VISIBLE_LEVEL } from "./glow";
export type { GlowKind } from "./glow";
export { Spark } from "./Spark";
export type { SparkProps } from "./Spark";
export { Nova, NOVA_FLASH_FRAMES } from "./Nova";
export type { NovaProps } from "./Nova";
export { keyframePath, resolvePath, polyline, trace, carry, orbit, split, fall, walk } from "./paths";
export type { Point, Path, Keyframe } from "./paths";

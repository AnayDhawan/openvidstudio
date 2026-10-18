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

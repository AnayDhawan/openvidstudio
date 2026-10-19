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

export { Axes, Plot, NumberLine, useAxes, useNumberLine, lineWeight } from "./graph";
export type { AxesProps, AxesGeometry, Box, PlotProps, PlotPoint, NumberLineProps, NumberLineGeometry } from "./graph";

export { Equation, EQUATION_TERM_FRAMES } from "./Equation";
export type { EquationProps } from "./Equation";
export { texToSvg, loadMathJax } from "./mathjax";

export { FreeBody, ARROW_GROW_FRAMES } from "./FreeBody";
export type { FreeBodyProps, Force } from "./FreeBody";
export { ArrayViz, useArrayViz } from "./ArrayViz";
export type { ArrayVizProps, ArrayPointer, ArrayGeometry } from "./ArrayViz";

export { LessonCaptions, captionChunks, captionInsets } from "./LessonCaptions";
export type { LessonCaptionsProps } from "./LessonCaptions";

export { Derivation, revealFrames, matchTerms, slotOpacity, DERIVATION_MOVE_FRAMES, DERIVATION_TERM_STAGGER, DERIVATION_STACK } from "./Derivation";
export type { DerivationProps, DerivationStep } from "./Derivation";

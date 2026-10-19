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

export { Wave, waveField, WAVE_REVEAL_FRAMES } from "./Wave";
export type { WaveProps, WaveLabels, WaveFieldInput } from "./Wave";
export { Orbit, orbitState, eccentricAnomaly, visViva, inverseSquare, ORBIT_ARROW_FRAMES } from "./Orbit";
export type { OrbitProps, OrbitShape, OrbitState } from "./Orbit";
export { VectorField, vectorFieldGrid, traceFieldLine, FIELD_ARROW_FRAMES } from "./VectorField";
export type { VectorFieldProps, VectorFieldGrid } from "./VectorField";
export { ComplexityCurve, complexityValue, COMPLEXITY_NAMES, COMPLEXITY_COLORS } from "./ComplexityCurve";
export type { ComplexityCurveProps, ComplexityKind } from "./ComplexityCurve";
export { MatrixGrid, matrixGridGeometry, interpolateMatrix, applyMatrix, defaultMatrixBox } from "./MatrixGrid";
export type { MatrixGridProps, MatrixGridGeometry, Matrix2 } from "./MatrixGrid";
export { TreeViz, treeLayout } from "./TreeViz";
export type { TreeVizProps, TreeLayout, TreeNodeLayout, Traversal } from "./TreeViz";
export { GraphViz, GRAPH_ROLES, GRAPH_ROLE_COLOR, adjacencyFrom, bfsOrder, bfsSteps, shortestPath, graphLayout } from "./GraphViz";
export type { GraphVizProps, GraphNode, GraphStep, GraphRole, GraphLayout, Adjacency } from "./GraphViz";

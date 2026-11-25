// Animated beams: a light that travels along lines joining two or more anchor points, for
// architecture and flow beats (a request leaving a client, passing a gateway, reaching a store).
// Ported from the animated-beam effect in the component registries: there it is a framer-motion
// gradient driven by element refs and a CSS animation. Here it is a pure function of the frame
// with anchors given as coordinates, because a render has no layout to measure and no CSS clock.
//
// Frame-driven only. Nothing here uses a CSS animation, a transition, a hover state or Math.random:
// every pixel is a function of the scene-local frame and the props, so two renders of one frame are
// identical and a still at any frame is exactly what the video shows.
//
// Colours come from the design tokens, read at render time (see tokens.ts: a value copied out at
// module scope would keep the openvidstudio default and miss extract_brand's palette).

import React from "react";
import { useCurrentFrame } from "remotion";
import { E } from "./motion";
import { color } from "./tokens";

export interface BeamAnchor {
  x: number;
  y: number;
}

export interface AnimatedBeamsProps {
  /** Two or more points in stage pixels. Unless `connections` is given, each is joined to the next. */
  anchors: BeamAnchor[];
  /** Pairs of anchor indices to join instead of the chain: [[0, 1], [0, 2]] fans out from anchor 0. */
  connections?: [number, number][];
  /** Scene-local frame the first beam starts leaving its anchor. Default 0. */
  at?: number;
  /** Frames one beam takes to travel its whole connection. Default 60. */
  cycle?: number;
  /** Repeat forever (default), or travel once and go dark. */
  loop?: boolean;
  /** With `loop`, frames of rest between one trip and the next. Default 12. */
  gap?: number;
  /** Frames between one connection starting and the next, in connection order. Default 0. */
  stagger?: number;
  /** How far the middle of a connection bows sideways, as a fraction of its length. 0 is straight. Default 0.2. */
  curvature?: number;
  /** Line thickness in stage pixels. Default 4. */
  strokeWidth?: number;
  /** The lit part of a connection, as a fraction of its length. Default 0.25. */
  beamLength?: number;
  /** Opacity of the faint line left under the beam, 0 to hide it. Default 0.18. */
  trackOpacity?: number;
  /** Travel from the later anchor to the earlier one. */
  reverse?: boolean;
  /** Start and end colour of the beam. Defaults to the accent and accentAlt tokens. */
  colors?: [string, string];
  /** Easing of the travel. Default E.drift: a linear beam reads as mechanical on camera. */
  easing?: (t: number) => number;
  /** Size of the drawing area, which the anchors are measured in. Default the 1920x1080 stage. */
  width?: number;
  height?: number;
}

export const DEFAULT_BEAM_CYCLE = 60;
export const DEFAULT_BEAM_GAP = 12;

/**
 * The path joining two anchors: a straight line, or a quadratic curve whose middle is pushed to one
 * side by `curvature` times the connection's length (positive bows to the left of the direction of
 * travel, negative to the right). Also returns the point on the curve at t = 0.5, which the tests
 * and callers placing a label use.
 */
export function beamCurve(a: BeamAnchor, b: BeamAnchor, curvature: number): { d: string; control: BeamAnchor; mid: BeamAnchor } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // Left of the direction of travel, in screen space (y down): (dy, -dx) / len.
  const control = { x: mx + (dy / len) * len * curvature, y: my - (dx / len) * len * curvature };
  const d = curvature === 0 ? `M ${a.x} ${a.y} L ${b.x} ${b.y}` : `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`;
  // A quadratic curve's t = 0.5 point is (a + 2c + b) / 4.
  const mid = { x: (a.x + 2 * control.x + b.x) / 4, y: (a.y + 2 * control.y + b.y) / 4 };
  return { d, control, mid };
}

/**
 * How far along its connection a beam is, 0 to 1 (before easing), or null when it is not showing:
 * before it starts, between loops, or after its one trip. `index` is the connection's position, which
 * with `stagger` is how a chain ripples.
 */
export function beamProgress(
  frame: number,
  opts: { at: number; cycle: number; loop: boolean; gap: number; stagger: number; index: number },
): number | null {
  const local = frame - opts.at - opts.index * opts.stagger;
  if (local < 0) return null;
  if (!opts.loop) return local >= opts.cycle ? null : local / opts.cycle;
  const period = opts.cycle + Math.max(0, opts.gap);
  const inPeriod = local % period;
  return inPeriod >= opts.cycle ? null : inPeriod / opts.cycle;
}

/**
 * The dash that shows a lit stretch of a path measured as length 1 (SVG's pathLength): a dash
 * `beamLength` long that enters at the start, crosses the path and leaves past the end. The path is
 * clipped to its own ends, so the beam grows out of the first anchor and drains into the last.
 */
export function beamDash(progress: number, beamLength: number): { dasharray: string; dashoffset: number } {
  const travelled = progress * (1 + beamLength);
  return { dasharray: `${beamLength} 1`, dashoffset: beamLength - travelled };
}

export const AnimatedBeams: React.FC<AnimatedBeamsProps> = ({
  anchors,
  connections,
  at = 0,
  cycle = DEFAULT_BEAM_CYCLE,
  loop = true,
  gap = DEFAULT_BEAM_GAP,
  stagger = 0,
  curvature = 0.2,
  strokeWidth = 4,
  beamLength = 0.25,
  trackOpacity = 0.18,
  reverse = false,
  colors,
  easing = E.drift,
  width = 1920,
  height = 1080,
}) => {
  const frame = useCurrentFrame();
  const uid = React.useId().replace(/[^A-Za-z0-9]/g, "");
  if (anchors.length < 2) throw new Error("AnimatedBeams needs at least two anchors to join.");
  const pairs: [number, number][] = connections ?? anchors.slice(1).map((_, i) => [i, i + 1] as [number, number]);
  for (const [i, j] of pairs) {
    if (!anchors[i] || !anchors[j]) throw new Error(`AnimatedBeams: connection [${i}, ${j}] names an anchor that does not exist (${anchors.length} given).`);
  }
  // Read now, not at module scope: extract_brand's palette is applied before a scene renders.
  const [from, to] = colors ?? [color.accent, color.accentAlt];

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}
      data-animated-beams=""
    >
      {pairs.map(([i, j], index) => {
        const a = reverse ? anchors[j] : anchors[i];
        const b = reverse ? anchors[i] : anchors[j];
        const { d } = beamCurve(a, b, curvature);
        const gradientId = `beam-${uid}-${index}`;
        const progress = beamProgress(frame, { at, cycle, loop, gap, stagger, index });
        const dash = progress === null ? null : beamDash(easing(progress), beamLength);
        return (
          <g key={`${i}-${j}-${index}`} data-beam={index}>
            <defs>
              {/* In user space, so the colour runs from one anchor to the other whatever the curve does. */}
              <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                <stop offset="0" stopColor={from} />
                <stop offset="1" stopColor={to} />
              </linearGradient>
            </defs>
            {trackOpacity > 0 ? (
              <path d={d} fill="none" stroke={`url(#${gradientId})`} strokeOpacity={trackOpacity} strokeWidth={strokeWidth} strokeLinecap="round" />
            ) : null}
            {dash ? (
              <path
                d={d}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={dash.dasharray}
                strokeDashoffset={dash.dashoffset}
                style={{ filter: `drop-shadow(0 0 ${strokeWidth * 2}px ${from})` }}
                data-beam-lit=""
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

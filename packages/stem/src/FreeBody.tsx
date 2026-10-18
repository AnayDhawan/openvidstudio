import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, displayStack } from "./designSystem";
import { lineWeight } from "./graph";
import type { Point } from "./paths";

export interface Force {
  label: string;
  /** In the units the scale is given in (newtons, say). */
  magnitude: number;
  /** Degrees, counter-clockwise from the right: 0 is right, 90 is up, 270 is down. */
  angle: number;
  color?: string;
}

export interface FreeBodyProps {
  forces: Force[];
  /** Pixels per unit of magnitude. An arrow is exactly `magnitude * scale` px from tail to tip. */
  scale: number;
  /** Unit shown on the scale bar. Default "N". */
  unit?: string;
  /** The length the scale bar stands for, in the same units as `magnitude`. Default: a round value near the largest force. */
  scaleValue?: number;
  /** Where the scale bar's left end sits. Default: lower left of the frame. */
  scaleAt?: Point;
  /** Where the object is. Default: the centre of the frame. */
  origin?: Point;
  /** Side of the object in px. Default 9% of the shorter side. */
  objectSize?: number;
  /** Tilt of the object, degrees clockwise, for a block on a slope. Default 0. */
  objectRotation?: number;
  /** Composition frame the first arrow starts to grow. Default 0. */
  at?: number;
  /** Frames between one arrow starting and the next. Default 18. */
  stagger?: number;
  /** The order the arrows arrive in, as indices into `forces`. Default: as given. */
  order?: number[];
  /** Also draw the net force, a dashed arrow, after the others have arrived. Left out when the net is zero. */
  net?: boolean;
  /** Shown on the object. */
  objectLabel?: string;
}

/** Frames one arrow takes to grow to full length. */
export const ARROW_GROW_FRAMES = 14;

const toRad = (deg: number) => (deg * Math.PI) / 180;

function roundValue(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  const f = v / pow;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * pow;
}

const Arrow: React.FC<{ from: Point; angle: number; length: number; color: string; weight: number; dashed?: boolean; dataset: Record<string, string> }> = ({ from, angle, length, color, weight, dashed, dataset }) => {
  if (length <= 0) return null;
  const dx = Math.cos(toRad(angle));
  const dy = -Math.sin(toRad(angle));
  const head = Math.min(weight * 5, length * 0.6);
  const tip = { x: from.x + dx * length, y: from.y + dy * length };
  const base = { x: from.x + dx * (length - head), y: from.y + dy * (length - head) };
  const half = head * 0.55;
  const left = { x: base.x - dy * half, y: base.y + dx * half };
  const right = { x: base.x + dy * half, y: base.y - dx * half };
  return (
    <g {...dataset}>
      <line x1={from.x} y1={from.y} x2={base.x} y2={base.y} stroke={color} strokeWidth={weight} strokeDasharray={dashed ? `${weight * 2.5} ${weight * 2}` : undefined} />
      <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />
    </g>
  );
};

/**
 * An object with labelled force arrows, the picture a physics lesson explains. The arrows are honest:
 * each is exactly `magnitude * scale` px long, and a scale bar says how much that is, so a viewer can
 * compare two forces by eye and be right. Arrows arrive one at a time. A pure function of the frame.
 */
export const FreeBody: React.FC<FreeBodyProps> = ({ forces, scale, unit = "N", scaleValue, scaleAt, origin, objectSize, objectRotation = 0, at = 0, stagger = 18, order, net = false, objectLabel }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const weight = lineWeight(width, height);
  const o = origin ?? { x: width / 2, y: height / 2 };
  const size = objectSize ?? Math.round(Math.min(width, height) * 0.09);
  const sequence = order ?? forces.map((_, i) => i);
  const labelPx = Math.round(Math.min(width, height) * 0.03);
  const accent = SUBJECT_ACCENT.physics;
  const palette = [accent.accent, "#5CC8FF", accent.accentAlt, "#7CFFB2", "#B58CFF"];

  const grown = (i: number) => {
    const slot = sequence.indexOf(i);
    if (slot < 0) return 0;
    const start = at + slot * stagger;
    return tween(frame, [start, start + ARROW_GROW_FRAMES], [0, 1], E.cinematic);
  };
  const allDone = at + (sequence.length - 1) * stagger + ARROW_GROW_FRAMES;
  const netVec = forces.reduce((acc, f) => ({ x: acc.x + f.magnitude * Math.cos(toRad(f.angle)), y: acc.y + f.magnitude * Math.sin(toRad(f.angle)) }), { x: 0, y: 0 });
  const netMagnitude = Math.hypot(netVec.x, netVec.y);
  const netAngle = (Math.atan2(netVec.y, netVec.x) * 180) / Math.PI;
  const netP = tween(frame, [allDone + 6, allDone + 6 + ARROW_GROW_FRAMES], [0, 1], E.cinematic);

  const maxMagnitude = Math.max(...forces.map((f) => f.magnitude), 1e-9);
  const barValue = scaleValue ?? roundValue(maxMagnitude / 2);
  const barAt = scaleAt ?? { x: Math.round(width * 0.12), y: Math.round(height * 0.88) };
  const barLength = barValue * scale;
  const fmt = (v: number) => String(Number(v.toFixed(2)));

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-freebody="">
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
        <g transform={`rotate(${objectRotation} ${o.x} ${o.y})`}>
          <rect data-ovs-object="" x={o.x - size / 2} y={o.y - size / 2} width={size} height={size} rx={size * 0.08} fill={VOID.panel} stroke={VOID.textDim} strokeWidth={weight} />
        </g>
        {objectLabel && <text x={o.x} y={o.y + labelPx * 0.35} textAnchor="middle" fontSize={labelPx} fill={VOID.textDim} fontFamily={bodyStack()}>{objectLabel}</text>}
        {forces.map((f, i) => {
          const p = grown(i);
          const color = f.color ?? palette[i % palette.length];
          const length = f.magnitude * scale * p;
          const dx = Math.cos(toRad(f.angle));
          const dy = -Math.sin(toRad(f.angle));
          return (
            <g key={i}>
              <Arrow from={o} angle={f.angle} length={length} color={color} weight={weight * 1.6} dataset={{ "data-ovs-force": f.label }} />
              {p >= 0.6 && (
                <text
                  x={o.x + dx * (f.magnitude * scale + labelPx * 1.1)}
                  y={o.y + dy * (f.magnitude * scale + labelPx * 1.1) + labelPx * 0.35}
                  textAnchor="middle"
                  fontSize={labelPx}
                  fill={color}
                  fontFamily={displayStack()}
                  fontWeight={700}
                >
                  {f.label}
                </text>
              )}
            </g>
          );
        })}
        {net && netMagnitude > 1e-3 * maxMagnitude && netP > 0 && (
          <Arrow from={o} angle={netAngle} length={netMagnitude * scale * netP} color={VOID.text} weight={weight * 1.3} dashed dataset={{ "data-ovs-force": "net" }} />
        )}
        <g data-ovs-scale="">
          <line x1={barAt.x} y1={barAt.y} x2={barAt.x + barLength} y2={barAt.y} stroke={VOID.textDim} strokeWidth={weight} />
          <line x1={barAt.x} y1={barAt.y - weight * 3} x2={barAt.x} y2={barAt.y + weight * 3} stroke={VOID.textDim} strokeWidth={weight} />
          <line x1={barAt.x + barLength} y1={barAt.y - weight * 3} x2={barAt.x + barLength} y2={barAt.y + weight * 3} stroke={VOID.textDim} strokeWidth={weight} />
          <text x={barAt.x + barLength + weight * 5} y={barAt.y + labelPx * 0.35} fontSize={labelPx} fill={VOID.textDim} fontFamily={bodyStack()}>{`${fmt(barValue)} ${unit}`}</text>
        </g>
      </svg>
    </div>
  );
};

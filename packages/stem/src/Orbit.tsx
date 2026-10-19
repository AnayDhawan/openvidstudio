import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, displayStack } from "./designSystem";
import { lineWeight } from "./graph";
import { Spark } from "./Spark";
import type { Path, Point } from "./paths";

export interface OrbitProps {
  /** Semi-major axis in px (the radius, for a circle). Default 34% of the shorter side. */
  semiMajor?: number;
  /** 0 is a circle; up to 0.95. The central mass sits at a focus. Default 0. */
  eccentricity?: number;
  /** Frames for one full orbit. Exactly this: the body is back where it started after `period` frames. */
  period: number;
  /** Where the central mass is (the focus the body orbits). Default: placed so the whole ellipse is centred in the frame. */
  centre?: Point;
  /** Direction of periapsis (the closest point) as seen from the centre, degrees counter-clockwise from the right. The body starts there. Default 0. */
  periapsisAngle?: number;
  /** Orbit the other way. Default false (counter-clockwise on screen). */
  clockwise?: boolean;
  /** The speed at a distance of `semiMajor` from the centre, in the caller's units (m/s, say). On a circle this is the speed all the way round. */
  v?: number;
  /** The force at a distance of `semiMajor` from the centre, in the caller's units (N, say). On a circle this is the force all the way round. */
  F?: number;
  /** Override: speed as a function of distance from the centre in px. Default: vis-viva, v * sqrt(2a/r - 1). */
  speedAt?: (r: number) => number;
  /** Override: force as a function of distance from the centre in px. Default: inverse square, F * (a/r)^2. */
  forceAt?: (r: number) => number;
  /** Pixels per unit of magnitude for the two arrows. An arrow is exactly `magnitude * scale` px from tail to tip. */
  scale: { velocity: number; force: number };
  /** Units on the scale bars. Defaults "m/s" and "N". */
  units?: { velocity?: string; force?: string };
  /** The length each scale bar stands for, in the same units as the magnitudes. Default: a round value near half the largest. */
  scaleValue?: { velocity?: number; force?: number };
  /** Draw the velocity and force arrows. Default true. */
  arrows?: boolean;
  /** Composition frame the orbit starts and the body is released. Default 0. */
  at?: number;
  /** Composition frame the arrows start to grow. Default `at + 12`. */
  arrowsAt?: number;
  /** Radius of the central mass in px. Default 3.2% of the shorter side. */
  massRadius?: number;
  /** Shown on the central mass. */
  centreLabel?: string;
}

/** Frames an arrow takes to grow to full length. */
export const ORBIT_ARROW_FRAMES = 14;
const MAX_ECCENTRICITY = 0.95;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface OrbitShape {
  semiMajor: number;
  eccentricity: number;
  period: number;
  periapsisAngle?: number;
  clockwise?: boolean;
}

export interface OrbitState {
  /** Eccentric anomaly, radians. */
  anomaly: number;
  /** Distance from the central mass, px: a (1 - e cos E). */
  r: number;
  /** Offset of the body from the central mass, in screen px. */
  offset: Point;
  /** Unit vector of the direction of motion, in screen coordinates (y down). Tangent to the path. */
  tangent: Point;
  /** Unit vector from the body to the central mass. */
  towardCentre: Point;
}

/** Solves Kepler's equation M = E - e sin E by Newton's method, to better than 1e-12. */
export function eccentricAnomaly(meanAnomaly: number, e: number): number {
  const m = meanAnomaly;
  let x = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 60; i++) {
    const dx = (x - e * Math.sin(x) - m) / (1 - e * Math.cos(x));
    x -= dx;
    if (Math.abs(dx) < 1e-14) break;
  }
  return x;
}

/**
 * The body's place on its orbit `t` frames after release, with no drawing. Time runs by Kepler's
 * equation, so the body is at periapsis at t = 0 and every `period`, and at apoapsis half a period
 * in. Distances are a (1 - e) and a (1 + e) there.
 */
export function orbitState(shape: OrbitShape, t: number): OrbitState {
  const a = shape.semiMajor;
  const e = Math.max(0, Math.min(MAX_ECCENTRICITY, shape.eccentricity));
  const b = a * Math.sqrt(1 - e * e);
  const dir = shape.clockwise ? -1 : 1;
  const pa = toRad(shape.periapsisAngle ?? 0);
  const E_ = eccentricAnomaly((2 * Math.PI * t) / shape.period, e);
  // Perifocal frame: x toward periapsis, y a quarter turn on. Then onto the screen (y down).
  const toScreen = (px: number, py: number): Point => ({
    x: px * Math.cos(pa) - dir * py * Math.sin(pa),
    y: -px * Math.sin(pa) - dir * py * Math.cos(pa),
  });
  const offset = toScreen(a * (Math.cos(E_) - e), b * Math.sin(E_));
  const tv = toScreen(-a * Math.sin(E_), b * Math.cos(E_));
  const tl = Math.hypot(tv.x, tv.y);
  const r = a * (1 - e * Math.cos(E_));
  return { anomaly: E_, r, offset, tangent: { x: tv.x / tl, y: tv.y / tl }, towardCentre: { x: -offset.x / r, y: -offset.y / r } };
}

/** Speed at distance r in the caller's units: vis-viva, v sqrt(2a/r - 1), where v is the speed at r = a. */
export const visViva = (v: number, a: number, r: number): number => v * Math.sqrt(Math.max(0, 2 * a / r - 1));
/** Force at distance r: inverse square, F (a / r)^2, where F is the force at r = a. */
export const inverseSquare = (F: number, a: number, r: number): number => F * (a / r) ** 2;

function roundValue(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  const f = v / pow;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * pow;
}

const Arrow: React.FC<{ from: Point; dir: Point; length: number; color: string; weight: number; dataset: Record<string, string> }> = ({ from, dir, length, color, weight, dataset }) => {
  if (length <= 0) return null;
  const head = Math.min(weight * 5, length * 0.6);
  const tip = { x: from.x + dir.x * length, y: from.y + dir.y * length };
  const base = { x: from.x + dir.x * (length - head), y: from.y + dir.y * (length - head) };
  const half = head * 0.55;
  const left = { x: base.x - dir.y * half, y: base.y + dir.x * half };
  const right = { x: base.x + dir.y * half, y: base.y - dir.x * half };
  return (
    <g {...dataset}>
      <line x1={from.x} y1={from.y} x2={base.x} y2={base.y} stroke={color} strokeWidth={weight} />
      <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />
    </g>
  );
};

/**
 * A body on a circular or elliptical orbit with its velocity and force arrows drawn to scale: each is
 * exactly `magnitude * scale` px from tail to tip, and a scale bar for each says how much that is.
 *
 * What is exact: the position (Kepler's equation, so the body is at periapsis at t = 0 and every
 * `period`, apoapsis half way, at distances a(1 - e) and a(1 + e)); the force arrow always points at
 * the central mass; the velocity arrow is tangent to the path (perpendicular to the radius on a
 * circle); the magnitudes follow vis-viva for speed and the inverse square law for force, both
 * measured from `v` and `F` at r = a. What is not: `v` and `F` are the caller's numbers in the
 * caller's units, so the picture is not checked against a real gravitational constant, and the
 * arrow scale is separate from the scale of the drawn orbit. The body is the one Spark; the central
 * mass is a plain disc. A pure function of the frame.
 */
export const Orbit: React.FC<OrbitProps> = (props) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const at = props.at ?? 0;
  const t = frame - at;
  const weight = lineWeight(width, height);
  const labelPx = Math.round(S * 0.03);
  const accent = SUBJECT_ACCENT.physics;
  const a = props.semiMajor ?? Math.round(S * 0.34);
  const e = Math.max(0, Math.min(MAX_ECCENTRICITY, props.eccentricity ?? 0));
  const b = a * Math.sqrt(1 - e * e);
  const pa = props.periapsisAngle ?? 0;
  const shape: OrbitShape = { semiMajor: a, eccentricity: e, period: props.period, periapsisAngle: pa, clockwise: props.clockwise };
  // The ellipse's own centre is a e from the focus, away from periapsis.
  const focusToCentre = { x: -a * e * Math.cos(toRad(pa)), y: a * e * Math.sin(toRad(pa)) };
  const frameCentre = { x: width / 2, y: height * 0.46 };
  const centre = props.centre ?? { x: frameCentre.x - focusToCentre.x, y: frameCentre.y - focusToCentre.y };
  const ellipseCentre = { x: centre.x + focusToCentre.x, y: centre.y + focusToCentre.y };
  const massRadius = props.massRadius ?? Math.round(S * 0.032);

  const speedAt = props.speedAt ?? ((r: number) => visViva(props.v ?? 0, a, r));
  const forceAt = props.forceAt ?? ((r: number) => inverseSquare(props.F ?? 0, a, r));
  const bodyAt = (local: number): Point => {
    const s = orbitState(shape, local);
    return { x: centre.x + s.offset.x, y: centre.y + s.offset.y };
  };
  const pathFn: Path = bodyAt;

  const arrowsAt = props.arrowsAt ?? at + 12;
  const grow = tween(frame, [arrowsAt, arrowsAt + ORBIT_ARROW_FRAMES], [0, 1], E.cinematic);
  const pathOpacity = tween(frame, [at, at + 12], [0, 1], E.cinematic);

  if (t < 0) return null;
  const st = orbitState(shape, t);
  const body = { x: centre.x + st.offset.x, y: centre.y + st.offset.y };
  const speed = speedAt(st.r);
  const force = forceAt(st.r);
  const vLen = speed * props.scale.velocity;
  const fLen = force * props.scale.force;
  const showArrows = props.arrows !== false && grow > 0;
  const colorV = "#5CC8FF";
  const colorF = accent.accentAlt;

  // Scale bars: the largest values are at periapsis.
  const vMax = speedAt(a * (1 - e));
  const fMax = forceAt(a * (1 - e));
  const bars = [
    { key: "velocity", value: props.scaleValue?.velocity ?? roundValue(Math.max(vMax, 1e-9) / 2), scale: props.scale.velocity, unit: props.units?.velocity ?? "m/s", color: colorV },
    { key: "force", value: props.scaleValue?.force ?? roundValue(Math.max(fMax, 1e-9) / 2), scale: props.scale.force, unit: props.units?.force ?? "N", color: colorF },
  ];
  const barX = Math.round(width * 0.12);
  const barY0 = Math.round(height * 0.72);
  const fmt = (v: number) => String(Number(v.toFixed(2)));

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-orbit="">
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, willChange: "transform" }}>
        <ellipse data-ovs-orbit-path="" data-ovs-semi-major={a} data-ovs-semi-minor={b} data-ovs-eccentricity={e} cx={ellipseCentre.x} cy={ellipseCentre.y} rx={a} ry={b} transform={pa === 0 ? undefined : `rotate(${-pa} ${ellipseCentre.x} ${ellipseCentre.y})`} fill="none" stroke={`rgba(140,135,153,${(pathOpacity * 0.7).toFixed(4)})`} strokeWidth={weight} />
        <circle data-ovs-mass="" cx={centre.x} cy={centre.y} r={massRadius} fill={VOID.textDim} />
        {props.centreLabel && <text x={centre.x} y={centre.y + labelPx * 0.35} textAnchor="middle" fontSize={labelPx} fill={VOID.base} fontFamily={displayStack()} fontWeight={700}>{props.centreLabel}</text>}
        <circle data-ovs-body="" data-ovs-r={st.r.toFixed(4)} cx={body.x} cy={body.y} r={1} fill="none" />
        {showArrows && (
          <>
            <Arrow from={body} dir={st.tangent} length={vLen * grow} color={colorV} weight={weight * 1.6} dataset={{ "data-ovs-arrow": "velocity", "data-ovs-magnitude": String(speed), "data-ovs-length": String(vLen * grow), "data-ovs-dx": String(st.tangent.x), "data-ovs-dy": String(st.tangent.y) }} />
            <Arrow from={body} dir={st.towardCentre} length={fLen * grow} color={colorF} weight={weight * 1.6} dataset={{ "data-ovs-arrow": "force", "data-ovs-magnitude": String(force), "data-ovs-length": String(fLen * grow), "data-ovs-dx": String(st.towardCentre.x), "data-ovs-dy": String(st.towardCentre.y) }} />
            {grow >= 0.6 && (
              <>
                <text x={body.x + st.tangent.x * (vLen + labelPx * 1.1)} y={body.y + st.tangent.y * (vLen + labelPx * 1.1) + labelPx * 0.35} textAnchor="middle" fontSize={labelPx} fill={colorV} fontFamily={displayStack()} fontWeight={700}>v</text>
                <text x={body.x + st.towardCentre.x * (fLen + labelPx * 1.1)} y={body.y + st.towardCentre.y * (fLen + labelPx * 1.1) + labelPx * 0.35} textAnchor="middle" fontSize={labelPx} fill={colorF} fontFamily={displayStack()} fontWeight={700}>F</text>
              </>
            )}
          </>
        )}
        {props.arrows !== false && bars.map((bar, i) => {
          const y = barY0 + i * labelPx * 1.9;
          const len = bar.value * bar.scale;
          return (
            <g key={bar.key} data-ovs-scale={bar.key} data-ovs-scale-length={len}>
              <line x1={barX} y1={y} x2={barX + len} y2={y} stroke={bar.color} strokeWidth={weight} />
              <line x1={barX} y1={y - weight * 3} x2={barX} y2={y + weight * 3} stroke={bar.color} strokeWidth={weight} />
              <line x1={barX + len} y1={y - weight * 3} x2={barX + len} y2={y + weight * 3} stroke={bar.color} strokeWidth={weight} />
              <text x={barX + len + weight * 5} y={y + labelPx * 0.35} fontSize={labelPx} fill={VOID.textDim} fontFamily={bodyStack()}>{`${fmt(bar.value)} ${bar.unit}`}</text>
            </g>
          );
        })}
      </svg>
      <Spark path={pathFn} at={at} trail={18} subject="physics" />
    </div>
  );
};

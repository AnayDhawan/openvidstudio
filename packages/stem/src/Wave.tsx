import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, displayStack } from "./designSystem";
import { lineWeight, type Box } from "./graph";
import { Spark } from "./Spark";
import type { Path, Point } from "./paths";

export interface WaveLabels {
  /** A bracket exactly one wavelength wide, from one crest to the next. Default true. */
  wavelength?: boolean;
  /** An arrow from the rest line to a crest, exactly `amplitude` px long. Default true. */
  amplitude?: boolean;
  /** A marker at the left edge of the wave, with the phase written out. Default true. */
  phase?: boolean;
}

export interface WaveProps {
  /** "travelling" moves along; "standing" has fixed nodes and antinodes that oscillate. Default "travelling". */
  mode?: "travelling" | "standing";
  /** Crest to crest, in px. Default a third of the box width. */
  wavelength?: number;
  /** Rest line to crest, in px. The drawn height of a crest is exactly this. Default 8% of the shorter side. */
  amplitude?: number;
  /** Travelling only: how far a crest moves per frame, in px. Exactly this. Default one wavelength per 60 frames. */
  speed?: number;
  /** Standing only: frames for an antinode to go up, down and back. Default 90. */
  period?: number;
  /** Phase in radians. The displacement at the left edge of the box, at time zero, is `amplitude * cos(phase)`. Default 0. */
  phase?: number;
  /** Composition frame the wave starts to draw. Default 0. */
  at?: number;
  /** Where the wave lives. The rest line runs through the middle of the box. Default: the middle of the frame, inside the Reels safe zone. */
  box?: Box;
  /** Which labels to draw. `false` draws none, `true` (the default) draws all of them. */
  labels?: boolean | WaveLabels;
  /** Words for the labels. Defaults "λ", "A". */
  wavelengthText?: string;
  amplitudeText?: string;
  /** "crest" rides a Spark on a crest (travelling) or an antinode (standing). Default: none. */
  spark?: "crest";
}

/** Frames the wave takes to draw itself from left to right. */
export const WAVE_REVEAL_FRAMES = 24;
const LABEL_FADE_FRAMES = 10;

export interface WaveFieldInput {
  mode: "travelling" | "standing";
  wavelength: number;
  amplitude: number;
  speed: number;
  period: number;
  phase: number;
  /** Left edge of the wave, px. */
  x0: number;
}

/**
 * The maths of the wave, with no drawing. `t` is frames since the wave began. Displacement is upward positive.
 * travelling: d = A cos(k (x - x0 - speed t) + phase), so a crest sits at x0 + speed t + (2 pi n - phase) / k
 * standing:   d = A cos(k (x - x0) + phase) cos(2 pi t / period)
 */
export function waveField(w: WaveFieldInput) {
  const k = (2 * Math.PI) / w.wavelength;
  const displacement = (x: number, t: number): number =>
    w.mode === "travelling" ? w.amplitude * Math.cos(k * (x - w.x0 - w.speed * t) + w.phase) : w.amplitude * Math.cos(k * (x - w.x0) + w.phase) * Math.cos((2 * Math.PI * t) / w.period);
  /** x of the crest (travelling) or the antinode that is at full upward stretch at t = 0 (standing), as a function of n. */
  const crestX = (n: number, t: number): number => w.x0 + (w.mode === "travelling" ? w.speed * t : 0) + (2 * Math.PI * n - w.phase) / k;
  /** Antinodes (maximum swing, either direction) at x0 + (n pi - phase) / k. Standing waves only. */
  const antinodeX = (n: number): number => w.x0 + (Math.PI * n - w.phase) / k;
  /** Nodes (never move) at x0 + ((n + 1/2) pi - phase) / k. Standing waves only. */
  const nodeX = (n: number): number => w.x0 + ((n + 0.5) * Math.PI - w.phase) / k;
  const crestsIn = (from: number, to: number, t: number): number[] => {
    const out: number[] = [];
    const n0 = Math.ceil((k * (from - w.x0 - (w.mode === "travelling" ? w.speed * t : 0)) + w.phase) / (2 * Math.PI) - 1e-9);
    for (let n = n0; crestX(n, t) <= to + 1e-9; n++) out.push(crestX(n, t));
    return out;
  };
  return { k, displacement, crestX, antinodeX, nodeX, crestsIn };
}

const fmtPhase = (phase: number): string => {
  const v = Number((phase / Math.PI).toFixed(2));
  return v === 0 ? "φ = 0" : `φ = ${v}π`;
};

function useWaveParams(p: WaveProps) {
  const { width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const box = p.box ?? { x: Math.round(width * 0.08), y: Math.round(height * 0.38), width: Math.round(width * 0.84), height: Math.round(height * 0.24) };
  const wavelength = p.wavelength ?? box.width / 3;
  return {
    width,
    height,
    S,
    box,
    input: {
      mode: p.mode ?? "travelling",
      wavelength,
      amplitude: p.amplitude ?? Math.round(S * 0.08),
      speed: p.speed ?? wavelength / 60,
      period: p.period ?? 90,
      phase: p.phase ?? 0,
      x0: box.x,
    } as WaveFieldInput,
  };
}

/** Where the Spark rides at wave time t: a crest, kept inside the first wavelength or so of the box by wrapping. */
function sparkPoint(input: WaveFieldInput, box: Box, t: number): Point {
  const f = waveField(input);
  const base = box.y + box.height / 2;
  if (input.mode === "standing") {
    const xc = box.x + box.width / 2;
    const n = Math.ceil((f.k * (xc - input.x0) + input.phase) / (2 * Math.PI));
    return { x: f.crestX(n, 0), y: base - f.displacement(f.crestX(n, 0), t) };
  }
  const lo = input.x0 + input.wavelength * 0.25;
  const raw = input.x0 + input.speed * t - input.phase / f.k;
  const x = lo + (((raw - lo) % input.wavelength) + input.wavelength) % input.wavelength;
  return { x, y: base - f.displacement(x, t) };
}

/**
 * A sine wave, travelling or standing, with the wavelength, amplitude and phase drawn on it: the picture a
 * waves lesson explains. Every number drawn is exact. Crests are exactly `wavelength` px apart, a crest is
 * exactly `amplitude` px above the rest line, and a travelling crest moves exactly `speed` px per frame.
 * The curve is sampled at 24 or more points per wavelength, with a sample on every crest and trough.
 * With `spark="crest"` the one Spark rides a crest. A pure function of the frame.
 */
export const Wave: React.FC<WaveProps> = (props) => {
  const frame = useCurrentFrame();
  const { width, height, S, box, input } = useWaveParams(props);
  const at = props.at ?? 0;
  const weight = lineWeight(width, height);
  const labelPx = Math.round(S * 0.03);
  const accent = SUBJECT_ACCENT.physics;
  const t = frame - at;
  if (t < 0) return null;
  const field = waveField(input);
  const base = box.y + box.height / 2;
  const x1 = box.x + box.width;
  const reveal = tween(frame, [at, at + WAVE_REVEAL_FRAMES], [0, 1], E.cinematic);
  const xEnd = box.x + box.width * reveal;
  const labelOpacity = tween(frame, [at + WAVE_REVEAL_FRAMES, at + WAVE_REVEAL_FRAMES + LABEL_FADE_FRAMES], [0, 1], E.cinematic);
  const want = props.labels === undefined || props.labels === true ? { wavelength: true, amplitude: true, phase: true } : props.labels === false ? { wavelength: false, amplitude: false, phase: false } : { wavelength: props.labels.wavelength ?? true, amplitude: props.labels.amplitude ?? true, phase: props.labels.phase ?? true };

  // Sample positions: a regular lattice that has a point on every extremum, plus both ends.
  const perWave = Math.max(24, 2 * Math.ceil(input.wavelength / 4));
  const step = input.wavelength / perWave;
  const origin = field.crestX(0, input.mode === "travelling" ? t : 0);
  const first = Math.ceil((box.x - origin) / step - 1e-9);
  const xs: number[] = [box.x];
  for (let i = first; origin + i * step < xEnd - 1e-9; i++) if (origin + i * step > box.x + 1e-9) xs.push(origin + i * step);
  if (xEnd > box.x) xs.push(xEnd);
  const pts = xs.map((x) => ({ x, y: base - field.displacement(x, t) }));
  const d = pts.map((q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(3)} ${q.y.toFixed(3)}`).join(" ");

  const crests = input.mode === "travelling" ? field.crestsIn(box.x, x1, t) : [];
  const nodes: number[] = [];
  const antinodes: number[] = [];
  if (input.mode === "standing") {
    for (let n = -200; n <= 200; n++) {
      const nx = field.nodeX(n);
      if (nx >= box.x - 1e-9 && nx <= xEnd + 1e-9) nodes.push(nx);
      const ax = field.antinodeX(n);
      if (ax >= box.x - 1e-9 && ax <= xEnd + 1e-9) antinodes.push(ax);
    }
  }

  // The crest the labels hang on: the first one at or after a quarter wavelength in, one wavelength wide bracket.
  const anchor = sparkPoint(input, box, t).x;
  const bracketY = base - input.amplitude - S * 0.05;
  const showLabels = labelOpacity > 0;
  const sparkPath: Path = (local) => sparkPoint(input, box, local + WAVE_REVEAL_FRAMES);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-ovs-wave-root="">
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
        <line data-ovs-baseline="" x1={box.x} y1={base} x2={x1} y2={base} stroke={VOID.textDim} strokeWidth={weight} strokeDasharray={`${weight * 2.5} ${weight * 2}`} />
        <path
          data-ovs-wave={input.mode}
          data-ovs-wavelength={input.wavelength}
          data-ovs-amplitude={input.amplitude}
          data-ovs-speed={input.speed}
          data-ovs-baseline-y={base}
          data-ovs-crests={crests.map((c) => c.toFixed(3)).join(",")}
          d={d}
          fill="none"
          stroke={accent.accent}
          strokeWidth={weight * 1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {nodes.map((nx, i) => (
          <circle key={`n${i}`} data-ovs-node={nx.toFixed(3)} cx={nx} cy={base} r={weight * 2} fill={VOID.base} stroke={VOID.text} strokeWidth={weight} />
        ))}
        {showLabels && (
          <g opacity={labelOpacity}>
            {want.wavelength && (
              <g data-ovs-label="wavelength" data-ovs-x1={anchor.toFixed(3)} data-ovs-x2={(anchor + input.wavelength).toFixed(3)}>
                <line x1={anchor} y1={bracketY} x2={anchor + input.wavelength} y2={bracketY} stroke={accent.accentAlt} strokeWidth={weight} />
                <line x1={anchor} y1={bracketY - weight * 3} x2={anchor} y2={bracketY + weight * 3} stroke={accent.accentAlt} strokeWidth={weight} />
                <line x1={anchor + input.wavelength} y1={bracketY - weight * 3} x2={anchor + input.wavelength} y2={bracketY + weight * 3} stroke={accent.accentAlt} strokeWidth={weight} />
                <text x={anchor + input.wavelength / 2} y={bracketY - labelPx * 0.5} textAnchor="middle" fontSize={labelPx} fill={accent.accentAlt} fontFamily={displayStack()} fontWeight={700}>{props.wavelengthText ?? "λ"}</text>
              </g>
            )}
            {want.amplitude && (
              <g data-ovs-label="amplitude" data-ovs-length={input.amplitude}>
                <line data-ovs-amplitude-line="" x1={anchor} y1={base} x2={anchor} y2={base - input.amplitude} stroke={VOID.text} strokeWidth={weight} />
                <polygon points={`${anchor},${base - input.amplitude} ${anchor - weight * 2.2},${base - input.amplitude + weight * 4.5} ${anchor + weight * 2.2},${base - input.amplitude + weight * 4.5}`} fill={VOID.text} />
                <text x={anchor + weight * 4} y={base - input.amplitude / 2 + labelPx * 0.35} fontSize={labelPx} fill={VOID.text} fontFamily={displayStack()} fontWeight={700}>{props.amplitudeText ?? "A"}</text>
              </g>
            )}
            {want.phase && (
              <g data-ovs-label="phase" data-ovs-phase={input.phase}>
                <line x1={box.x} y1={base} x2={box.x} y2={base - field.displacement(box.x, t)} stroke={VOID.textDim} strokeWidth={weight} />
                <circle cx={box.x} cy={base - field.displacement(box.x, t)} r={weight * 2.2} fill={VOID.textDim} />
                <text x={box.x} y={base + input.amplitude + labelPx * 1.6} fontSize={labelPx} fill={VOID.textDim} fontFamily={bodyStack()}>{fmtPhase(input.phase)}</text>
              </g>
            )}
          </g>
        )}
        {props.spark === "crest" && (() => {
          const sp = sparkPoint(input, box, t);
          return reveal >= 1 ? <circle data-ovs-crest-spark="" data-ovs-x={sp.x.toFixed(3)} data-ovs-y={sp.y.toFixed(3)} cx={sp.x} cy={sp.y} r={1} fill="none" /> : null;
        })()}
        {antinodes.length > 0 && <g data-ovs-antinodes={antinodes.map((a) => a.toFixed(3)).join(",")} />}
      </svg>
      {props.spark === "crest" && <Spark path={sparkPath} at={at + WAVE_REVEAL_FRAMES} trail={10} subject="physics" />}
    </div>
  );
};

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Glow } from "./glow";
import { SUBJECT_ACCENT, VOID, type Subject } from "./designSystem";
import { resolvePath, type Keyframe, type Path } from "./paths";

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
/** `color` pulled toward the warm white by `k`: the Spark's core is hotter than its bloom. */
function toward(color: string, whiteHex: string, k: number): string {
  const a = hex(color);
  const b = hex(whiteHex);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
}

export interface SparkProps {
  /** Where the Spark is at a local time (frames since `at`), or keyframes. See trace, carry, orbit, fall, walk. */
  path: Path | Keyframe[];
  /** Composition frame the Spark appears. Default 0. */
  at?: number;
  /** How many frames of tail it drags. Default 18. */
  trail?: number;
  /** Defaults to the subject's accent. */
  color?: string;
  /** Picks the default colour. Default "math". */
  subject?: Subject;
  /** Radius of the bright core in px. Default 1.4% of the shorter side of the frame. */
  size?: number;
}

/**
 * A luminous point: a small bright core, a soft bloom and a fading trail. It is the pen, the
 * pointer and the particle of a lesson, so there is exactly one on screen at a time. A pure
 * function of the frame; sizes come from the composition, never from a fixed 1920x1080.
 */
export const Spark: React.FC<SparkProps> = ({ path, at = 0, trail = 18, color, subject = "math", size }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame - at;
  if (t < 0) return null;
  const p = resolvePath(path);
  const tint = color ?? SUBJECT_ACCENT[subject].accent;
  const r = size ?? Math.max(2, Math.round(Math.min(width, height) * 0.014));
  const head = p(t);
  const tail = Array.from({ length: trail }, (_, k) => ({ k: k + 1, pos: p(Math.max(0, t - (k + 1))) }));
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
        {tail.map(({ k, pos }) => {
          const age = k / (trail + 1);
          return <circle key={k} cx={pos.x} cy={pos.y} r={r * (1 - 0.65 * age)} fill={tint} opacity={0.85 * (1 - age) ** 1.6} />;
        })}
      </svg>
      <Glow kind="spark" x={head.x} y={head.y} radius={r * 5} color={tint}>
        <div
          style={{
            position: "absolute",
            left: `calc(50% - ${r}px)`,
            top: `calc(50% - ${r}px)`,
            width: r * 2,
            height: r * 2,
            borderRadius: "50%",
            background: toward(tint, VOID.text, 0.72),
            boxShadow: `0 0 ${r}px ${tint}`,
          }}
        />
      </Glow>
    </div>
  );
};

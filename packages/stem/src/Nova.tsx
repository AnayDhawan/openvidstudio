import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { E, jitter, tween, useMusicClock } from "@openvidstudio/core";
import { Glow } from "./glow";
import { SUBJECT_ACCENT, VOID, type Subject } from "./designSystem";
import type { Point } from "./paths";

export interface NovaProps {
  /** Composition frame of the flash. Or name the score's impact with `beatId` and `impact`. */
  at?: number;
  /** With `impact`: read the frame from this beat's music clock (useMusicClock(beatId).impact(impact)). */
  beatId?: string;
  impact?: string;
  /** Where it goes off. Default: the centre of the frame. */
  origin?: Point;
  /** Defaults to the subject's accent. */
  color?: string;
  subject?: Subject;
  /** Frames from the flash until the content is fully formed. Default 60. */
  duration?: number;
  /** The payoff: condenses from particles. Absent before the flash, fully formed by the end. */
  children?: React.ReactNode;
}

/** Frames the flash lasts. */
export const NOVA_FLASH_FRAMES = 3;
const PARTICLES = 56;

/**
 * The payoff, used once per video, on the aha sentence. Nothing is drawn before it. Then a
 * three-frame flash, a thin shockwave ring that decelerates and fades, and the `children` condense
 * from particles that converge on the origin. The beat of silence before it is the narration's:
 * leave a pause before `at`. Scatter comes from a seeded hash of the particle index, so two renders
 * of a frame are identical. The flash and ring are drawn as one glowing element through the glow
 * helper; the particles do not glow, so a Nova is one entry in the glow budget.
 */
export const Nova: React.FC<NovaProps> = ({ at, beatId, impact, origin, color, subject = "math", duration = 60, children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // The hook is called every time, as hooks must be; it is only consulted when an impact is named.
  const clock = useMusicClock(beatId ?? "");
  const named = beatId !== undefined && impact !== undefined ? clock.impact(impact) : null;
  const start = named ?? at;
  if (start === undefined || start === null) {
    throw new Error("Nova needs `at` (a frame), or `beatId` and `impact` naming an impact point in the score's cues.");
  }
  const t = frame - start;
  if (t < 0) return null;

  const tint = color ?? SUBJECT_ACCENT[subject].accent;
  const o = origin ?? { x: width / 2, y: height / 2 };
  const reach = Math.min(width, height) * 0.9;
  const flash = t < NOVA_FLASH_FRAMES ? 1 - t / NOVA_FLASH_FRAMES : 0;
  const ringLife = Math.max(1, Math.round(duration * 0.8));
  const ringP = Math.min(1, t / ringLife);
  const ringRadius = reach * (1 - (1 - ringP) ** 3);
  const ringOpacity = ringP >= 1 ? 0 : (1 - ringP) ** 1.5;
  const stroke = Math.max(2, Math.round(Math.min(width, height) * 0.0025));

  const condense = tween(t, [NOVA_FLASH_FRAMES, duration], [0, 1], E.cinematic);
  const formed = t >= duration;
  const scatter = Math.min(width, height) * 0.55;
  const particles = formed
    ? []
    : Array.from({ length: PARTICLES }, (_, i) => {
        const angle = jitter(i, 1) * Math.PI * 2;
        const dist = scatter * (0.35 + 0.65 * jitter(i, 2));
        const k = 1 - condense; // 1 at the start, 0 when they have arrived
        return { x: o.x + Math.cos(angle) * dist * k, y: o.y + Math.sin(angle) * dist * k, r: 2 + jitter(i, 3) * 2.5 };
      });
  const particleOpacity = t < NOVA_FLASH_FRAMES ? 0 : Math.min(1, condense * 4) * (1 - condense ** 6);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {children !== undefined && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: formed ? 1 : condense ** 1.5,
            transform: formed ? undefined : `scale(${0.9 + 0.1 * condense})`,
            transformOrigin: `${o.x}px ${o.y}px`,
            filter: formed ? undefined : `blur(${(1 - condense) * 10}px)`,
          }}
        >
          {children}
        </div>
      )}
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
        {particles.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={tint} opacity={particleOpacity} />
        ))}
      </svg>
      <Glow kind="nova" x={o.x} y={o.y} radius={Math.hypot(width, height)} color={VOID.text} level={flash}>
        {null}
      </Glow>
      {ringOpacity > 0 && (
        <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
          <circle cx={o.x} cy={o.y} r={ringRadius} fill="none" stroke={tint} strokeWidth={stroke} opacity={ringOpacity} />
        </svg>
      )}
    </div>
  );
};

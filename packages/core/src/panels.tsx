// UI chrome: windows, a real-JSON viewer, tool-call chips, badges/checks/crosses, a glass
// panel, and the chapter HUD. Ported from reference/launch-video's lib/ui.tsx and
// generalized: colors come from this package's tokens (or a video's DesignSystem) instead
// of one video's theme.ts, and the chapter rail takes any chapter list rather than a fixed
// table, with a music-tempo-locked fill.

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { DEFAULT_GRID, type DesignSystem } from "./designSystem";
import { E, pop, SPRING, tween } from "./motion";
import { DotText } from "./pixel";
import { color, monoStack, radius, uiStack } from "./tokens";

const MAC_CHROME_DOTS = ["#FF5F57", "#FEBC2E", "#28C840"];

export const Window: React.FC<{
  title?: string;
  width: number;
  height?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** light chrome instead of the dark default -- matches BrowserFrame's light mode */
  light?: boolean;
  /** hex color for an outer glow, e.g. when this window is the shot's focal point */
  glow?: string;
  titleRight?: React.ReactNode;
}> = ({ title, width, height, children, style, light, glow, titleRight }) => {
  const border = light ? "#D8DEE7" : color.panelBorder;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius.window,
        background: light ? color.lightCard : `linear-gradient(180deg, ${color.panel} 0%, ${color.bg1} 100%)`,
        border: `1px solid ${border}`,
        boxShadow: `0 40px 120px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)${glow ? `, 0 0 90px ${glow}33` : ""}`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {title !== undefined ? (
        <div
          style={{
            height: 50,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 10,
            borderBottom: `1px solid ${border}`,
            background: light ? "#EDF0F4" : "rgba(255,255,255,0.02)",
            fontFamily: monoStack(),
            fontSize: 17,
            color: light ? "#5B6572" : color.textSecondary,
          }}
        >
          {MAC_CHROME_DOTS.map((c) => (
            <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
          ))}
          <div style={{ marginLeft: 10, flex: 1 }}>{title}</div>
          {titleRight}
        </div>
      ) : null}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>{children}</div>
    </div>
  );
};

/** A JSON syntax palette, distinct from the brand tokens on purpose (CodePanel's TOKEN_COLORS
 * is the precedent: a code/data view reads better with its own fixed highlight colors than
 * with a video's accent repurposed for every token kind). */
const JSON_SYNTAX = {
  key: "#a5b4fc",
  string: "#9fe3c4",
  number: "#f7b27a",
};

function colorizeJsonLine(ln: string): React.ReactNode {
  const m = ln.match(/^(\s*)("(?:[^"\\]|\\.)*")(\s*:\s*)(.*)$/);
  const val = (v: string): React.ReactNode => {
    const t = v.replace(/,$/, "");
    const comma = v.endsWith(",") ? "," : "";
    let col: string = color.textPrimary;
    if (/^".*"$/.test(t)) col = JSON_SYNTAX.string;
    else if (/^-?\d/.test(t)) col = JSON_SYNTAX.number;
    else if (t === "true") col = color.success;
    else if (t === "false") col = color.danger;
    else col = color.textSecondary;
    return (
      <>
        <span style={{ color: col }}>{t}</span>
        <span style={{ color: `${color.textSecondary}99` }}>{comma}</span>
      </>
    );
  };
  if (m) {
    return (
      <>
        {m[1]}
        <span style={{ color: JSON_SYNTAX.key }}>{m[2]}</span>
        <span style={{ color: `${color.textSecondary}99` }}>{m[3]}</span>
        {val(m[4])}
      </>
    );
  }
  const s = ln.match(/^(\s*)(.*)$/) as RegExpMatchArray;
  return (
    <>
      {s[1]}
      {val(s[2])}
    </>
  );
}

/**
 * Syntax-colored JSON of a real object, revealed line by line -- an actually-rendered view,
 * not a screenshot of a JSON blob, the same "ground truth" principle as `TerminalReplay`
 * being DOM text instead of a recorded terminal.
 */
export const JsonView: React.FC<{
  value: unknown;
  at?: number;
  /** frames between each line's reveal */
  perLine?: number;
  fontSize?: number;
  /** returns a hex accent to highlight a line with, or undefined to leave it plain */
  highlight?: (line: string, i: number) => string | undefined;
  maxLines?: number;
  scroll?: number;
}> = ({ value, at = 0, perLine = 1.2, fontSize = 20, highlight, maxLines = 400, scroll = 0 }) => {
  const frame = useCurrentFrame();
  const lines = JSON.stringify(value, null, 2).split("\n").slice(0, maxLines);
  return (
    <div style={{ fontFamily: monoStack(), fontSize, lineHeight: 1.55, padding: "18px 24px", transform: `translateY(${-scroll}px)` }}>
      {lines.map((ln, i) => {
        const t = at + i * perLine;
        if (frame < t) return null;
        const p = tween(frame, [t, t + 6], [0, 1], E.snap);
        const hl = highlight?.(ln, i);
        return (
          <div
            key={i}
            style={{
              whiteSpace: "pre",
              clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`,
              background: hl ? `${hl}1f` : undefined,
              boxShadow: hl ? `inset 3px 0 0 ${hl}` : undefined,
              margin: "0 -24px",
              padding: "0 24px",
            }}
          >
            {colorizeJsonLine(ln)}
          </div>
        );
      })}
    </div>
  );
};

const Spinner: React.FC<{ size: number; color: string }> = ({ size, color: spinColor }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${Math.max(2, size * 0.14)}px solid ${spinColor}33`,
        borderTopColor: spinColor,
        transform: `rotate(${frame * 18}deg)`,
      }}
    />
  );
};

export const Check: React.FC<{ size: number; color?: string; at?: number }> = ({
  size,
  color: checkColor = color.success,
  at = 0,
}) => {
  const frame = useCurrentFrame();
  const p = tween(frame, [at, at + 8], [0, 1], E.snap);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill={`${checkColor}26`} stroke={checkColor} strokeWidth="1.5" />
      <path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke={checkColor}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="16"
        strokeDashoffset={16 * (1 - p)}
      />
    </svg>
  );
};

export const Cross: React.FC<{ size: number; color?: string }> = ({ size, color: crossColor = color.danger }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="11" fill={`${crossColor}26`} stroke={crossColor} strokeWidth="1.5" />
    <path d="M8 8l8 8M16 8l-8 8" stroke={crossColor} strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

/** "▸ tool_name" chip: spinner while running, a `Check` once `doneAt` passes. */
export const ToolChip: React.FC<{
  name: string;
  at: number;
  doneAt?: number;
  color?: string;
  size?: number;
}> = ({ name, at, doneAt, color: chipColor = color.accent, size = 20 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = pop(frame, fps, at, SPRING.pop);
  const done = doneAt !== undefined && frame >= doneAt;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.5,
        padding: `${size * 0.35}px ${size * 0.75}px`,
        borderRadius: radius.pill,
        border: `1px solid ${chipColor}66`,
        background: `${chipColor}18`,
        fontFamily: monoStack(),
        fontSize: size,
        color: color.textPrimary,
        transform: `scale(${0.85 + 0.15 * Math.min(1, s)})`,
        transformOrigin: "left center",
        opacity: Math.min(1, s * 1.5),
      }}
    >
      {done ? <Check size={size * 0.9} color={color.success} at={doneAt} /> : <Spinner size={size * 0.8} color={chipColor} />}
      <span style={{ color: chipColor }}>{name}</span>
    </div>
  );
};

export const Pill: React.FC<{
  children: React.ReactNode;
  color?: string;
  size?: number;
  style?: React.CSSProperties;
}> = ({ children, color: pillColor = color.textSecondary, size = 18, style }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: `${size * 0.3}px ${size * 0.7}px`,
      borderRadius: radius.pill,
      border: `1px solid ${pillColor}55`,
      background: `${pillColor}14`,
      color: pillColor,
      fontFamily: monoStack(),
      fontSize: size,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </span>
);

export const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; pad?: number }> = ({
  children,
  style,
  pad = 28,
}) => (
  <div
    style={{
      background: "rgba(18,22,32,0.72)",
      backdropFilter: "blur(18px) saturate(1.2)",
      WebkitBackdropFilter: "blur(18px) saturate(1.2)",
      border: "1px solid rgba(255,255,255,0.09)",
      borderRadius: 18,
      boxShadow: "0 30px 90px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
      padding: pad,
      fontFamily: uiStack(),
      color: color.textPrimary,
      ...style,
    }}
  >
    {children}
  </div>
);

export type Chapter = { label: string };

/**
 * How many px of `grid.marginBottom`'s reserved band the rail block itself (the thin fill
 * bars plus their number/label row) actually occupies, so the rail's `bottom` offset can be
 * derived from the reserved space instead of a constant: at `DEFAULT_GRID.marginBottom`
 * (110), `110 - 64 = 46`, which is this HUD's original fixed position. A design system that
 * reserves a bigger or smaller bottom band moves the rail by the same amount, instead of it
 * silently sitting too close to the edge or wasting the extra margin.
 */
const HUD_RAIL_FOOTPRINT = 64;

/**
 * Chapter HUD: a dot-matrix chapter number and label top-left, a progress rail bottom. Both
 * are screen-space (meant for a scene's `overlay`, like `Caption`), not camera-transformed.
 * `chapters`/`activeIndex` replace a fixed table: pass this video's own chapter list and
 * which one is live right now.
 */
export const ChapterHud: React.FC<{
  chapters: Chapter[];
  activeIndex: number;
  /** true while this is the chapter's own opening stretch (plays the label-in and the rail
   * fill-in); false just holds the rail filled, no re-animation. */
  firstFrame?: boolean;
  at?: number;
  /** frames the active segment's rail fill tweens over -- pass the chapter's own duration in
   * frames so the fill lands exactly as the chapter ends, not on a guessed constant. */
  fillDurationInFrames?: number;
  design?: DesignSystem;
  accentColor?: string;
}> = ({ chapters, activeIndex, firstFrame = true, at = 4, fillDurationInFrames = 90, design, accentColor }) => {
  const frame = useCurrentFrame();
  const marginBottom = design?.grid.marginBottom ?? DEFAULT_GRID.marginBottom;
  const railBottom = Math.max(16, marginBottom - HUD_RAIL_FOOTPRINT);
  const accent = accentColor ?? design?.color.success ?? color.success;
  const faint = design?.color.textSecondary ?? color.textSecondary;
  const text = design?.color.textPrimary ?? color.textPrimary;
  const line = design?.color.panelBorder ?? color.panelBorder;
  const ch = chapters[activeIndex];
  if (!ch) return null;
  const p = firstFrame ? tween(frame, [at, at + 14], [0, 1], E.snap) : 1;
  const num = String(activeIndex + 1).padStart(2, "0");
  return (
    <>
      <div style={{ position: "absolute", left: 72, top: 60, display: "flex", alignItems: "center", gap: 22, opacity: p }}>
        <DotText text={num} at={firstFrame ? at : -100} px={9} build={firstFrame ? "wipe" : "none"} solid={text} glow={0.3} />
        <div style={{ fontFamily: monoStack(), fontSize: 20, letterSpacing: "0.3em", color: faint, transform: `translateX(${(1 - p) * -20}px)` }}>
          {ch.label}
        </div>
      </div>
      <div style={{ position: "absolute", left: 72, right: 72, bottom: railBottom, display: "flex", gap: 8, opacity: 0.9 }}>
        {chapters.map((c, i) => {
          const fill = i < activeIndex ? 1 : i > activeIndex ? 0 : firstFrame ? tween(frame, [at, at + fillDurationInFrames], [0, 1], E.cinematic) : 1;
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ height: 3, borderRadius: 2, background: line, overflow: "hidden" }}>
                <div style={{ width: `${fill * 100}%`, height: "100%", background: i === activeIndex ? accent : faint }} />
              </div>
              <div style={{ fontFamily: monoStack(), fontSize: 12, letterSpacing: "0.2em", color: i === activeIndex ? text : faint }}>
                {String(i + 1).padStart(2, "0")} {c.label}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

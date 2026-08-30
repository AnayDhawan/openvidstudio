// TerminalReplay: DOM-rendered terminal with typed commands, staggered output reveals,
// blinking cursor, and frame-exact typing SFX. Never screen-recorded HTML (STYLE.md).
// Content must fit the window height (auto-scroll: v2).

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { E, jitter, tween } from "./motion";
import { Blip, TypingSfx } from "./sfx";
import { color, font, glow, panelShadow, radius } from "./tokens";

const { fontFamily: monoFamily } = loadMono("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

export type TermLine = {
  text: string;
  color?: string;
  glow?: boolean;
  bold?: boolean;
};

export type TermStep =
  | { type: "cmd"; text: string }
  | { type: "out"; lines: TermLine[]; stagger?: number; preDelay?: number }
  | { type: "pause"; frames: number };

type ResolvedCmd = {
  type: "cmd";
  text: string;
  start: number;
  charFrames: number[];
  end: number;
};
type ResolvedOut = {
  type: "out";
  lines: TermLine[];
  lineFrames: number[];
  start: number;
  end: number;
};
type Resolved = ResolvedCmd | ResolvedOut;

export const computeTerminalTimeline = (
  steps: TermStep[],
  fps: number,
  cps = 16,
) => {
  const fpc = fps / cps;
  const items: Resolved[] = [];
  let t = 0;
  for (const s of steps) {
    if (s.type === "pause") {
      t += s.frames;
    } else if (s.type === "cmd") {
      const charFrames = Array.from({ length: s.text.length }, (_, i) =>
        Math.round(t + i * fpc + jitter(i, 9) * fpc * 0.6),
      );
      const end = (charFrames[charFrames.length - 1] ?? t) + Math.round(fps * 0.25);
      items.push({ type: "cmd", text: s.text, start: t, charFrames, end });
      t = end;
    } else {
      const preDelay = s.preDelay ?? Math.round(fps * 0.3);
      const stagger = s.stagger ?? 3;
      const lineFrames = s.lines.map((_, j) => t + preDelay + j * stagger);
      const end = (lineFrames[lineFrames.length - 1] ?? t) + Math.round(fps * 0.2);
      items.push({ type: "out", lines: s.lines, lineFrames, start: t, end });
      t = end;
    }
  }
  return { items, totalFrames: t };
};

const LineReveal: React.FC<{
  at: number;
  children: React.ReactNode;
}> = ({ at, children }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const p = tween(frame, [at, at + 7], [0, 1], E.snap);
  return (
    <div
      style={{
        clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`,
        transform: `translateY(${(1 - p) * 6}px)`,
      }}
    >
      {children}
    </div>
  );
};

export const TerminalReplay: React.FC<{
  steps: TermStep[];
  title?: string;
  width?: number;
  fontSize?: number;
  cps?: number;
  /** render SFX for typing/reveals (default true) */
  sfx?: boolean;
  /** show a fresh blinking prompt after all output is done (default true) */
  trailingPrompt?: boolean;
}> = ({
  steps,
  title = "Project",
  width = 1280,
  fontSize = 26,
  cps = 16,
  sfx = true,
  trailingPrompt = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { items, totalFrames } = computeTerminalTimeline(steps, fps, cps);

  const lastCmd = [...items].reverse().find((i) => i.type === "cmd") as
    | ResolvedCmd
    | undefined;
  const typingActive =
    lastCmd && frame >= lastCmd.start && frame <= lastCmd.end;
  const cursorOn = Math.floor(frame / 8) % 2 === 0 || typingActive;
  // cursor sits on the command line only while typing (+ a short beat after);
  // once output streams, it disappears; a fresh prompt appears at the end.
  const showCmdCursor = lastCmd && frame <= lastCmd.end + 12;
  const trailingAt = totalFrames + 14;

  return (
    <div
      style={{
        width,
        borderRadius: radius.window,
        background: "#10141D",
        border: `1px solid ${color.panelBorder}`,
        boxShadow: panelShadow(true),
        overflow: "hidden",
        fontFamily: monoFamily,
      }}
    >
      {/* chrome */}
      <div
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          background: "#151A24",
          borderBottom: `1px solid ${color.panelBorder}`,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div
              key={c}
              style={{ width: 14, height: 14, borderRadius: 7, background: c }}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            color: color.textSecondary,
            fontSize: fontSize * 0.62,
            fontFamily: font.ui,
          }}
        >
          {title}
        </div>
        <div style={{ width: 62 }} />
      </div>
      {/* body */}
      <div
        style={{
          padding: `${fontSize * 1.1}px ${fontSize * 1.3}px`,
          fontSize,
          lineHeight: 1.75,
          color: color.textPrimary,
        }}
      >
        {items.map((item, idx) => {
          if (frame < item.start) return null;
          if (item.type === "cmd") {
            const visible = item.charFrames.filter((f) => f <= frame).length;
            const isCurrent = item === lastCmd;
            // slash-command prefix (e.g. "/components") renders accent+bold
            const prefixMatch = item.text.match(/^\/\S+/);
            const prefixLen = prefixMatch ? prefixMatch[0].length : 0;
            return (
              <div key={idx} style={{ whiteSpace: "pre-wrap" }}>
                <span style={{ color: color.accent, fontWeight: 700 }}>
                  {"❯ "}
                </span>
                {prefixLen > 0 ? (
                  <span style={{ color: color.accentAlt, fontWeight: 700 }}>
                    {item.text.slice(0, Math.min(visible, prefixLen))}
                  </span>
                ) : null}
                <span>{item.text.slice(Math.min(visible, prefixLen), visible)}</span>
                {isCurrent && showCmdCursor && cursorOn ? (
                  <span
                    style={{
                      display: "inline-block",
                      width: fontSize * 0.55,
                      height: fontSize * 1.05,
                      background: color.textPrimary,
                      verticalAlign: "text-bottom",
                      marginLeft: 2,
                    }}
                  />
                ) : null}
              </div>
            );
          }
          return (
            <div key={idx}>
              {item.lines.map((l, j) => (
                <LineReveal key={j} at={item.lineFrames[j]}>
                  <span
                    style={{
                      whiteSpace: "pre-wrap",
                      color: l.color ?? color.textSecondary,
                      fontWeight: l.bold ? 700 : 400,
                      ...(l.glow ? glow(l.color ?? color.accent) : {}),
                    }}
                  >
                    {l.text}
                  </span>
                </LineReveal>
              ))}
            </div>
          );
        })}
        {trailingPrompt && frame >= trailingAt ? (
          <div>
            <span style={{ color: color.accent, fontWeight: 700 }}>{"❯ "}</span>
            {cursorOn ? (
              <span
                style={{
                  display: "inline-block",
                  width: fontSize * 0.55,
                  height: fontSize * 1.05,
                  background: color.textPrimary,
                  verticalAlign: "text-bottom",
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {/* SFX */}
      {sfx
        ? items.map((item, idx) =>
            item.type === "cmd" ? (
              <TypingSfx key={`sfx-${idx}`} charFrames={item.charFrames} />
            ) : (
              <Blip key={`sfx-${idx}`} at={item.lineFrames[0]} />
            ),
          )
        : null}
    </div>
  );
};

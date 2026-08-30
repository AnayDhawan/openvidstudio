// Code panel: manually-tokenized lines (no highlighter dep), optional scroll + row highlight.

import React from "react";
import { color, glow, panelShadow, radius } from "./tokens";

// System-safe fallbacks, avoid @remotion/google-fonts' network fetch (hangs render offline).
const monoFamily = "JetBrains Mono, Consolas, Menlo, monospace";
const uiFamily = "Inter, -apple-system, Segoe UI, Roboto, sans-serif";

export type Token = { t: string; c?: "kw" | "str" | "fn" | "cm" | "num" | "plain" };
export type CodeLine = Token[];

const TOKEN_COLORS: Record<NonNullable<Token["c"]>, string> = {
  kw: "#C792EA",
  str: "#8BD49C",
  fn: "#82AAFF",
  cm: "#5B6572",
  num: "#F78C6C",
  plain: "#D6DEEB",
};

export const CodePanel: React.FC<{
  title: string;
  lines: CodeLine[];
  width?: number;
  height?: number;
  fontSize?: number;
  /** px translateY applied to code body (drive with a tween for scrolling) */
  scroll?: number;
  /** 0-based line indexes to highlight with an accent row + glow */
  highlight?: number[];
}> = ({
  title,
  lines,
  width = 860,
  height = 640,
  fontSize = 22,
  scroll = 0,
  highlight = [],
}) => {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius.window,
        background: "#10141D",
        border: `1px solid ${color.panelBorder}`,
        boxShadow: panelShadow(true),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          padding: "0 18px",
          gap: 10,
          background: "#151A24",
          borderBottom: `1px solid ${color.panelBorder}`,
          fontFamily: uiFamily,
          fontSize: 16,
          color: color.textSecondary,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </div>
        <span style={{ marginLeft: 8 }}>{title}</span>
      </div>
      <div style={{ height: height - 48, overflow: "hidden" }}>
      <div style={{ padding: `${fontSize * 0.7}px 0`, transform: `translateY(${-scroll}px)` }}>
        {lines.map((line, i) => {
          const hl = highlight.includes(i);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                fontFamily: monoFamily,
                fontSize,
                lineHeight: 1.65,
                background: hl ? `${color.accent}1A` : undefined,
                borderLeft: hl ? `3px solid ${color.accent}` : "3px solid transparent",
              }}
            >
              <span
                style={{
                  width: fontSize * 2.4,
                  textAlign: "right",
                  paddingRight: fontSize * 0.8,
                  color: "#3A4252",
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <span style={{ whiteSpace: "pre" }}>
                {line.map((tok, j) => (
                  <span
                    key={j}
                    style={{
                      color: TOKEN_COLORS[tok.c ?? "plain"],
                      ...(hl && tok.c === "str" ? glow(color.accent, 0.6) : {}),
                    }}
                  >
                    {tok.t}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
};

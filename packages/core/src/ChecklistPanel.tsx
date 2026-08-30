// GitHub-style Community Standards checklist panel. Items flip ✗ → ✓ at flipAt frames.

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { pop, SPRING } from "./motion";
import { Blip } from "./sfx";
import { color, panelShadow, radius } from "./tokens";

const { fontFamily: uiFamily } = loadInter("normal", {
  weights: ["500", "700"],
  subsets: ["latin"],
});

export type ChecklistItem = {
  label: string;
  /** absolute scene frame at which this item flips to ✓ (omit = stays ✗) */
  flipAt?: number;
};

export const ChecklistPanel: React.FC<{
  title?: string;
  items: ChecklistItem[];
  width?: number;
  fontSize?: number;
  sfx?: boolean;
}> = ({
  title = "Community Standards",
  items,
  width = 760,
  fontSize = 27,
  sfx = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        width,
        borderRadius: radius.window,
        background: "#10141D",
        border: `1px solid ${color.panelBorder}`,
        boxShadow: panelShadow(true),
        fontFamily: uiFamily,
        padding: `${fontSize}px ${fontSize * 1.2}px`,
      }}
    >
      <div style={{ fontSize: fontSize * 1.15, fontWeight: 700, color: color.textPrimary, marginBottom: fontSize * 0.8 }}>
        {title}
      </div>
      {items.map((item, i) => {
        const flipped = item.flipAt !== undefined && frame >= item.flipAt;
        const s = flipped ? pop(frame, fps, item.flipAt, SPRING.pop) : 1;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: fontSize * 0.6,
              padding: `${fontSize * 0.38}px 0`,
              fontSize,
              color: color.textSecondary,
              borderBottom: i < items.length - 1 ? `1px solid ${color.panelBorder}55` : undefined,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: fontSize * 1.15,
                height: fontSize * 1.15,
                borderRadius: "50%",
                fontWeight: 700,
                fontSize: fontSize * 0.8,
                transform: `scale(${0.7 + s * 0.3})`,
                background: flipped ? `${color.success}22` : `${color.danger}22`,
                color: flipped ? color.success : color.danger,
                border: `1.5px solid ${flipped ? color.success : color.danger}`,
                boxShadow: flipped ? `0 0 18px ${color.success}44` : undefined,
              }}
            >
              {flipped ? "✓" : "✗"}
            </span>
            <span style={{ color: flipped ? color.textPrimary : color.textSecondary }}>{item.label}</span>
          </div>
        );
      })}
      {sfx
        ? items
            .filter((i) => i.flipAt !== undefined)
            .map((i, k) => <Blip key={k} at={i.flipAt as number} volume={0.22} />)
        : null}
    </div>
  );
};

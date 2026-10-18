// Shared CTA scene: glass repo card (informational, no star action, reads as
// self-promo otherwise) → dip to a modest title card.

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import "./localFonts";
import { CinematicScene } from "./CinematicScene";
import { TitleSlam, Caption } from "./KineticText";
import { Layer } from "./camera";
import { E, pop, tween } from "./motion";
import { Whoosh } from "./sfx";
import { color } from "./tokens";

const uiFamily = "Inter, system-ui, sans-serif";

const DIP_AT = 150;

export const RepoCta: React.FC<{
  owner: string;
  name: string;
  description: string;
  chips: string[];
  titleText: string;
  durationInFrames?: number;
}> = ({ owner, name, description, chips, titleText, durationInFrames = 270 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  // Everything is laid out from the frame centre, so the same card centres in 1920x1080 and in a
  // 1080x1920 reel. At 1920x1080 these come out to the 560 / 350 / 180 the card has always had.
  // The card sits 190px above centre in both: in a reel that puts it mid-way through the band
  // the Instagram UI leaves clear (about 14% down to 78% down), not in the middle of the frame.
  const cardW = Math.min(800, width - 160);
  const cardLeft = (width - cardW) / 2;
  const cardTop = Math.round(height / 2 - 190);
  const glowSize = 800;
  const cardIn = pop(frame, fps, 8);
  const dip = tween(frame, [DIP_AT, DIP_AT + 16], [0, 1], E.cinematic);
  const endFade = tween(frame, [durationInFrames - 18, durationInFrames], [0, 1], E.cinematic);

  return (
    <CinematicScene
      camera={[
        { frame: 0, x: width / 2, y: height / 2, scale: 1.0 },
        { frame: durationInFrames, x: width / 2, y: height / 2 - 10, scale: 1.12, easing: E.drift },
      ]}
      overlay={
        <>
          <div style={{ position: "absolute", inset: 0, background: "#07090E", opacity: dip, pointerEvents: "none" }} />
          {frame >= DIP_AT + 14 ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 26,
              }}
            >
              <TitleSlam text={titleText} at={DIP_AT + 16} fontSize={76} color={color.textPrimary} glowColor={color.accent} />
              <Caption text={`github.com/${owner}/${name}`} at={DIP_AT + 38} fontSize={28} />
            </div>
          ) : null}
          <div style={{ position: "absolute", inset: 0, background: "#000", opacity: endFade, pointerEvents: "none" }} />
        </>
      }
    >
      <Layer depth={0.65} maxBlur={16}>
        <div
          style={{
            position: "absolute",
            left: (width - glowSize) / 2,
            top: cardTop - 170,
            width: glowSize,
            height: glowSize,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${color.accent}2e 0%, transparent 65%)`,
          }}
        />
      </Layer>

      <Layer depth={0}>
        <div
          data-ovs-repo-card=""
          style={{
            position: "absolute",
            left: cardLeft,
            top: cardTop,
            width: cardW,
            transform: `scale(${0.85 + cardIn * 0.15}) translateY(${(1 - cardIn) * 60}px)`,
            opacity: Math.min(1, cardIn * 1.3),
            borderRadius: 18,
            background: "rgba(21,26,36,0.5)",
            backdropFilter: "blur(20px) saturate(1.3)",
            WebkitBackdropFilter: "blur(20px) saturate(1.3)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 30px 90px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
            padding: 36,
            fontFamily: uiFamily,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                background: `linear-gradient(135deg, ${color.accent} 0%, ${color.accentAlt} 100%)`,
              }}
            />
            <div style={{ fontSize: 30, fontWeight: 700, color: color.textPrimary }}>
              {owner} <span style={{ color: color.textSecondary }}>/</span> {name}
            </div>
          </div>
          <div style={{ marginTop: 20, fontSize: 23, color: color.textSecondary, lineHeight: 1.5 }}>
            {description}
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 22, fontSize: 19, color: color.textSecondary }}>
            {chips.map((c, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {i === 0 ? <span style={{ width: 12, height: 12, borderRadius: 6, background: "#3178C6" }} /> : null}
                {c}
              </span>
            ))}
          </div>
        </div>
      </Layer>

      <Whoosh at={0} volume={0.22} />
      <Whoosh at={DIP_AT} volume={0.3} />
    </CinematicScene>
  );
};

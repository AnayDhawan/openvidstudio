/**
 * The motion primitives catalog.
 *
 * scaffold_scene's 10 templates are whole scenes. Below that level there was nothing: a
 * scene that wants a count-up number, a fanned card stack, or a typewriter line had to have
 * that animation hand-written from motion.ts's tween/pop/spring primitives every single
 * time (the "stat" template's own counter is a literal hardcoded "0" for exactly this
 * reason -- it never got an animation because writing one inline wasn't worth it for one
 * template). A small, tested, searchable set of these -- catalog_motion_primitives to find
 * one, add_motion_primitive to drop its real source into the project -- means composing a
 * scene from proven pieces instead of re-deriving the tween math each time.
 *
 * Local and bundled on purpose: a hosted registry/account is not what makes this useful, a
 * first working batch is. Each entry's `source` is a real, self-contained .tsx component
 * using only "react", "remotion" and "@openvidstudio/core" -- the same constraint
 * scaffold_scene's own templates follow -- so it drops into any scene unmodified.
 */

export interface MotionPrimitive {
  /** kebab-case id, e.g. "count-up-stat". Stable: add_motion_primitive looks up by this. */
  name: string;
  title: string;
  description: string;
  /** Extra terms a query might use that the title/description don't already contain. */
  keywords: string[];
  /** The component's exported name inside `source`. */
  componentName: string;
  /** Self-contained .tsx source, ready to write to disk as-is. */
  source: string;
}

const HEADER = (p: MotionPrimitive) => `// "${p.title}" motion primitive, from openvidstudio's catalog_motion_primitives.
//
// ${p.description}
// Written by add_motion_primitive; edit freely, it is your copy now.
`;

const countUpStat: MotionPrimitive = {
  name: "count-up-stat",
  title: "Count-up stat card",
  description:
    "A number that counts up from 0 to a target value with a spring pop-in, plus a label underneath. " +
    "For a beat that wants to land on a real metric instead of a static digit.",
  keywords: ["counter", "number", "metric", "stat", "kpi", "count up", "tally"],
  componentName: "CountUpStat",
  source: "",
};
countUpStat.source = `${HEADER(countUpStat)}
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { tween, pop, SPRING, E, color, glow, monoStack } from "@openvidstudio/core";

export interface CountUpStatProps {
  /** The number to land on. */
  value: number;
  label: string;
  /** Frame the count-up starts on. Defaults to 0. */
  at?: number;
  /** How long the count-up itself takes, in frames. Defaults to 24. */
  durationInFrames?: number;
  suffix?: string;
  fontSize?: number;
}

export const CountUpStat: React.FC<CountUpStatProps> = ({
  value,
  label,
  at = 0,
  durationInFrames = 24,
  suffix = "",
  fontSize = 190,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = pop(frame, fps, at, SPRING.pop);
  const raw = tween(frame, [at, at + durationInFrames], [0, value], E.cinematic);
  const shown = Math.round(raw).toLocaleString();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        transform: \`scale(\${0.7 + entrance * 0.3}) translateY(\${(1 - entrance) * 40}px)\`,
        opacity: entrance,
      }}
    >
      <span
        style={{
          fontFamily: monoStack(),
          fontSize,
          fontWeight: 700,
          lineHeight: 1,
          color: color.accent,
          ...glow(color.accent, 0.8),
        }}
      >
        {shown}
        {suffix}
      </span>
      <span
        style={{
          fontFamily: monoStack(),
          fontSize: fontSize * 0.18,
          color: color.textSecondary,
          textAlign: "center",
          maxWidth: 900,
        }}
      >
        {label}
      </span>
    </div>
  );
};
`;

const cardStack: MotionPrimitive = {
  name: "card-stack",
  title: "Fanned card stack",
  description:
    "A small stack of cards that fan out in sequence, each with a spring pop and a slight rotation, " +
    "landing in a loose hand-of-cards arrangement. For 2-4 short items (features, steps, quotes).",
  keywords: ["cards", "stack", "fan", "deck", "features", "steps"],
  componentName: "CardStack",
  source: "",
};
cardStack.source = `${HEADER(cardStack)}
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { pop, tween, staggerDelay, SPRING, E, color, radius, panelShadow, uiStack, monoStack } from "@openvidstudio/core";

export interface StackCard {
  title: string;
  body: string;
}

export interface CardStackProps {
  cards: StackCard[];
  /** Frame the first card starts entering. Defaults to 0. */
  at?: number;
  /** Frame offset between each card's entrance. Defaults to 8. */
  staggerFrames?: number;
  cardWidth?: number;
  cardHeight?: number;
}

/** Fixed fan-out angles/offsets so a re-render is deterministic regardless of card count. */
const FAN = [
  { rotate: -8, x: -140 },
  { rotate: -2, x: -46 },
  { rotate: 4, x: 46 },
  { rotate: 10, x: 140 },
];

export const CardStack: React.FC<CardStackProps> = ({
  cards,
  at = 0,
  staggerFrames = 8,
  cardWidth = 360,
  cardHeight = 460,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ position: "relative", width: cardWidth, height: cardHeight }}>
      {cards.map((card, i) => {
        const delay = at + staggerDelay(i, staggerFrames);
        const entrance = pop(frame, fps, delay, SPRING.soft);
        const fan = FAN[i % FAN.length];
        const settledRotate = fan.rotate;
        const settledX = fan.x;
        const dropIn = tween(frame, [delay, delay + 14], [-60, 0], E.cinematic);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              transformOrigin: "50% 100%",
              transform: \`translate(\${settledX * entrance}px, \${dropIn}px) rotate(\${settledRotate * entrance}deg)\`,
              opacity: entrance,
              zIndex: i,
            }}
          >
            <div
              style={{
                width: cardWidth,
                height: cardHeight,
                borderRadius: radius.window,
                background: color.panel,
                border: \`1px solid \${color.panelBorder}\`,
                boxShadow: panelShadow(true),
                padding: 32,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div
                style={{
                  fontFamily: monoStack(),
                  fontSize: 18,
                  color: color.accent,
                  fontWeight: 700,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div
                style={{
                  fontFamily: uiStack(),
                  fontSize: 30,
                  fontWeight: 700,
                  color: color.textPrimary,
                }}
              >
                {card.title}
              </div>
              <div
                style={{
                  fontFamily: uiStack(),
                  fontSize: 20,
                  color: color.textSecondary,
                  lineHeight: 1.4,
                }}
              >
                {card.body}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
`;

const logoOutro: MotionPrimitive = {
  name: "logo-outro",
  title: "Logo outro",
  description:
    "A center-stage logo (or wordmark text, if no logo asset is given) with a spring pop-in and a " +
    "pulsing glow, plus a title/subtitle beneath. For the last beat of a video.",
  keywords: ["outro", "logo", "end card", "closing", "cta", "wordmark"],
  componentName: "LogoOutro",
  source: "",
};
logoOutro.source = `${HEADER(logoOutro)}
import React from "react";
import { useCurrentFrame, useVideoConfig, staticFile, Img } from "remotion";
import { pop, tween, SPRING, E, color, glow, uiStack } from "@openvidstudio/core";

export interface LogoOutroProps {
  title: string;
  subtitle?: string;
  /** public/-relative path to a logo image. Renders \`title\` as a wordmark if omitted. */
  logoSrc?: string;
  /** Frame the outro starts entering. Defaults to 0. */
  at?: number;
  logoSize?: number;
}

export const LogoOutro: React.FC<LogoOutroProps> = ({
  title,
  subtitle,
  logoSrc,
  at = 0,
  logoSize = 220,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = pop(frame, fps, at, SPRING.pop);
  // A slow, endless pulse -- sin, not a spring, since this has no settled end state to
  // land on and keeps going for as long as the beat holds on this frame.
  const pulse = 1 + Math.sin((frame - at) * 0.08) * 0.03;
  const textIn = tween(frame, [at + 6, at + 22], [0, 1], E.cinematic);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 28,
        transform: \`scale(\${0.7 + entrance * 0.3})\`,
        opacity: entrance,
      }}
    >
      <div
        style={{
          transform: \`scale(\${pulse})\`,
          ...glow(color.accent, 1),
        }}
      >
        {logoSrc ? (
          <Img src={staticFile(logoSrc)} style={{ width: logoSize, height: logoSize, objectFit: "contain" }} />
        ) : (
          <span
            style={{
              fontFamily: uiStack(),
              fontWeight: 900,
              fontSize: logoSize * 0.42,
              color: color.textPrimary,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </span>
        )}
      </div>
      {logoSrc ? (
        <span
          style={{
            fontFamily: uiStack(),
            fontWeight: 900,
            fontSize: 56,
            color: color.textPrimary,
            opacity: textIn,
            transform: \`translateY(\${(1 - textIn) * 16}px)\`,
          }}
        >
          {title}
        </span>
      ) : null}
      {subtitle ? (
        <span
          style={{
            fontFamily: uiStack(),
            fontSize: 26,
            color: color.textSecondary,
            opacity: textIn,
            transform: \`translateY(\${(1 - textIn) * 16}px)\`,
          }}
        >
          {subtitle}
        </span>
      ) : null}
    </div>
  );
};
`;

const typewriterLine: MotionPrimitive = {
  name: "typewriter-line",
  title: "Typewriter line",
  description:
    "Monospace text revealed character by character at a set typing rate, with a blinking cursor. " +
    "For a beat that wants to feel typed rather than appear all at once.",
  keywords: ["typewriter", "typing", "terminal", "code line", "reveal"],
  componentName: "TypewriterLine",
  source: "",
};
typewriterLine.source = `${HEADER(typewriterLine)}
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { color, monoStack } from "@openvidstudio/core";

export interface TypewriterLineProps {
  text: string;
  /** Frame typing starts on. Defaults to 0. */
  at?: number;
  /** Typing speed. Defaults to 18 characters/second. */
  charsPerSecond?: number;
  fontSize?: number;
}

export const TypewriterLine: React.FC<TypewriterLineProps> = ({
  text,
  at = 0,
  charsPerSecond = 18,
  fontSize = 36,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsedSeconds = Math.max(0, (frame - at) / fps);
  const visibleChars = Math.min(text.length, Math.floor(elapsedSeconds * charsPerSecond));
  const done = visibleChars >= text.length;
  // Blinks at ~2Hz once typing is done; stays solid (mid-character) while typing, which
  // reads as "still working" rather than a distracting flicker mid-line.
  const cursorOn = done ? Math.floor(frame / (fps / 4)) % 2 === 0 : true;

  return (
    <span
      style={{
        fontFamily: monoStack(),
        fontSize,
        color: color.textPrimary,
        whiteSpace: "pre",
      }}
    >
      {text.slice(0, visibleChars)}
      <span style={{ opacity: cursorOn ? 1 : 0, color: color.accent }}>_</span>
    </span>
  );
};
`;

const beatTimelineStrip: MotionPrimitive = {
  name: "beat-timeline-strip",
  title: "Beat timeline strip",
  description:
    "A horizontal strip of labeled segments with a moving playhead, the current segment highlighted. " +
    "For a cutaway that shows where this beat sits in the larger structure (an outline, a roadmap, a progress strip).",
  keywords: ["timeline", "progress", "roadmap", "outline", "scrubber", "playhead", "steps"],
  componentName: "BeatTimelineStrip",
  source: "",
};
beatTimelineStrip.source = `${HEADER(beatTimelineStrip)}
import React from "react";
import { color, radius, monoStack } from "@openvidstudio/core";

export interface TimelineSegment {
  id: string;
  label: string;
  /** This segment's share of the strip, in frames. */
  frames: number;
}

export interface BeatTimelineStripProps {
  segments: TimelineSegment[];
  /** The current frame within the strip's own total (sum of every segment's frames), not the composition's. */
  currentFrame: number;
  width?: number;
  height?: number;
}

export const BeatTimelineStrip: React.FC<BeatTimelineStripProps> = ({
  segments,
  currentFrame,
  width = 1400,
  height = 64,
}) => {
  const total = segments.reduce((sum, s) => sum + s.frames, 0) || 1;
  const playheadX = (Math.max(0, Math.min(currentFrame, total)) / total) * width;

  let cursor = 0;
  const withOffsets = segments.map((s) => {
    const start = cursor;
    cursor += s.frames;
    return { ...s, start };
  });

  return (
    <div style={{ position: "relative", width, height: height + 40 }}>
      <div
        style={{
          position: "relative",
          width,
          height,
          display: "flex",
          borderRadius: radius.card,
          overflow: "hidden",
          border: \`1px solid \${color.panelBorder}\`,
        }}
      >
        {withOffsets.map((s) => {
          const active = currentFrame >= s.start && currentFrame < s.start + s.frames;
          return (
            <div
              key={s.id}
              style={{
                flexGrow: s.frames,
                flexBasis: 0,
                background: active ? color.accent : color.panel,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRight: \`1px solid \${color.panelBorder}\`,
              }}
            >
              <span
                style={{
                  fontFamily: monoStack(),
                  fontSize: 16,
                  fontWeight: active ? 700 : 400,
                  color: active ? color.bg0 : color.textSecondary,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  padding: "0 8px",
                }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          top: height,
          left: playheadX - 6,
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderBottom: \`10px solid \${color.accent}\`,
        }}
      />
    </div>
  );
};
`;

export const MOTION_PRIMITIVES: MotionPrimitive[] = [
  countUpStat,
  cardStack,
  logoOutro,
  typewriterLine,
  beatTimelineStrip,
];

function haystack(p: MotionPrimitive): string {
  return `${p.name} ${p.title} ${p.description} ${p.keywords.join(" ")}`.toLowerCase();
}

export interface PrimitiveMatch {
  primitive: MotionPrimitive;
  score: number;
}

/**
 * Ranks the catalog against a free-text query: every query token found in the primitive's
 * name/title/description/keywords adds a point, an exact or prefix match on `name` adds a
 * strong bonus (so searching the id itself always wins), and an empty query returns every
 * primitive in catalog order rather than nothing -- mirroring find_music_bed's "no query
 * means browse everything" behaviour.
 */
export function searchMotionPrimitives(query: string | undefined, limit = 10): PrimitiveMatch[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) {
    return MOTION_PRIMITIVES.slice(0, limit).map((primitive) => ({ primitive, score: 0 }));
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = MOTION_PRIMITIVES.map((primitive) => {
    const hay = haystack(primitive);
    let score = 0;
    if (primitive.name === q) score += 10;
    else if (primitive.name.startsWith(q)) score += 5;
    for (const token of tokens) {
      if (hay.includes(token)) score += 1;
    }
    return { primitive, score };
  }).filter((m) => m.score > 0);
  scored.sort((a, b) => b.score - a.score || a.primitive.name.localeCompare(b.primitive.name));
  return scored.slice(0, limit);
}

export function findMotionPrimitive(name: string): MotionPrimitive | undefined {
  return MOTION_PRIMITIVES.find((p) => p.name === name);
}

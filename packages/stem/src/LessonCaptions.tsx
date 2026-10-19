import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useNarrationWords } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, type Subject } from "./designSystem";

export interface LessonCaptionsProps {
  /** The beat these captions belong to: its word timings are read with `useNarrationWords(beatId)`. */
  beatId: string;
  /** The beat's narration text, its `vo`. The word timings carry bare words, so the punctuation comes from here. */
  text: string;
  /** Where the block sits: above the bottom safe zone, or below the top one. Default "bottom". */
  position?: "bottom" | "top";
  /** Most words in one caption. Default 6. */
  maxWords?: number;
  /** Left edge in px. Default 10% of the width. */
  left?: number;
  /** Width in px. Default: the frame minus the left edge on both sides. */
  width?: number;
  /** Picks the colour of the word being said. Default "math". */
  subject?: Subject;
  /** Font size in px. Default 4.8% of the shorter side. */
  fontSize?: number;
}

/** A caption never starts or stops mid-sentence: a sentence end always breaks, a comma only after this many words. */
const COMMA_BREAK_MIN_WORDS = 3;
const SENTENCE_END = /[.?!:…]["')\]]*$/;
const CLAUSE_END = /[,;]["')\]]*$/;

/**
 * Pure: where each caption starts and ends, as `[from, to)` ranges over the words. A caption breaks after a
 * sentence end, after a comma or semicolon once it holds at least three words, and at `maxWords`. A one word
 * sentence ("Why?") is a caption on its own.
 */
export function captionChunks(words: string[], maxWords = 6): [number, number][] {
  const limit = Math.max(1, Math.floor(maxWords));
  const chunks: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const size = i - from + 1;
    const last = i === words.length - 1;
    if (last || SENTENCE_END.test(words[i]) || (CLAUSE_END.test(words[i]) && size >= COMMA_BREAK_MIN_WORDS) || size >= limit) {
      chunks.push([from, i + 1]);
      from = i + 1;
    }
  }
  return chunks;
}

/** The share of the frame's height kept clear at the bottom and top: Instagram's interface over a vertical reel, a small margin otherwise. */
export function captionInsets(width: number, height: number): { top: number; bottom: number } {
  return height > width ? { top: Math.round(height * 0.14), bottom: Math.round(height * 0.22) } : { top: Math.round(height * 0.08), bottom: Math.round(height * 0.08) };
}

/**
 * Burned-in captions for a lesson, timed to the narration: the words of the beat's `vo` in short chunks that
 * break at sentence ends, with the word being said picked out. One line in a scene, with no dependency on the
 * scene file:
 *
 *   <LessonCaptions beatId="hook" text={vo} />
 *
 * Reads `useNarrationWords(beatId)`. When the text splits into as many words as the timings hold it shows the text
 * with its punctuation; when the counts differ it falls back to the timings' bare words. With no timings at all
 * (an engine that gives none) the words are spread evenly over the scene and the element says so in
 * `data-ovs-captions-timing="estimated"`. The block is tagged `data-ovs-captions`, which validate_scenes uses to
 * ignore the captions when it looks for a diagram or a static stretch. A pure function of the frame.
 */
export const LessonCaptions: React.FC<LessonCaptionsProps> = ({ beatId, text, position = "bottom", maxWords = 6, left, width: boxWidth, subject = "math", fontSize }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const narration = useNarrationWords(beatId);
  const tokens = text.split(/\s+/).filter(Boolean);
  const timed = narration.available;
  const words = timed ? (tokens.length === narration.words.length ? tokens : narration.words.map((w) => w.word)) : tokens;
  const timing = !timed ? "estimated" : tokens.length === narration.words.length ? "matched" : "bare";

  const spoken = timed ? narration.wordAt(frame)?.index ?? -1 : words.length === 0 ? -1 : Math.min(words.length - 1, Math.floor((frame / Math.max(1, durationInFrames)) * words.length));
  const chunks = captionChunks(words, maxWords);
  const chunk = spoken < 0 ? null : chunks.find(([from, to]) => spoken >= from && spoken < to) ?? null;

  const px = fontSize ?? Math.round(Math.min(width, height) * 0.048);
  const edge = left ?? Math.round(width * 0.1);
  const blockWidth = boxWidth ?? width - 2 * edge;
  const insets = captionInsets(width, height);
  const accent = SUBJECT_ACCENT[subject].accent;

  return (
    <div
      data-ovs-captions=""
      data-ovs-captions-timing={timing}
      data-ovs-captions-position={position}
      style={{
        position: "absolute",
        left: edge,
        width: blockWidth,
        ...(position === "bottom" ? { bottom: insets.bottom } : { top: insets.top }),
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      {chunk && (
        <div
          data-ovs-caption=""
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            columnGap: px * 0.28,
            rowGap: px * 0.1,
            maxWidth: "100%",
            padding: `${Math.round(px * 0.3)}px ${Math.round(px * 0.5)}px`,
            borderRadius: Math.round(px * 0.4),
            background: "rgba(7,6,11,0.72)",
            fontFamily: bodyStack(),
            fontSize: px,
            lineHeight: 1.25,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          {words.slice(chunk[0], chunk[1]).map((w, k) => {
            const index = chunk[0] + k;
            const active = index === spoken;
            return (
              <span key={index} data-ovs-word={index} data-active={active ? "true" : "false"} style={{ color: active ? accent : VOID.text }}>
                {w}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

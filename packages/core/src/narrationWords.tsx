// Word timings for the narration (Supernova). A scene that points at the word being spoken needs to
// know when each word starts. generate_narration writes public/audio/vo/<beatId>.words.json with
// the edge-tts engine, and stitch_composition copies the files next to the composition (a scene bundle
// can import JSON from src/ but not from public/) and hands them to the composition through
// NarrationWordsProvider, the same way it hands over the music's cue grid. A scene then asks by beat id:
//
//   const narration = useNarrationWords("hook");
//   const spoken = narration.wordAt(frame);          // the word being said, or the last one said
//   const at = narration.frameOfWord(3);             // scene-local frame the fourth word starts
//
// A beat's narration starts with the beat, so scene-local frame 0 is the start of the clip.

import React, { createContext, useContext, useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

/** One spoken word and when it is said, in milliseconds from the start of the clip. */
export interface NarrationWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface WordAt {
  index: number;
  word: NarrationWord;
  /** True while the word is being said; false in the pause after it, before the next one starts. */
  speaking: boolean;
}

export interface NarrationWords {
  /** False when this beat has no word timings (another engine, or none generated): every helper then answers null. */
  available: boolean;
  fps: number;
  words: NarrationWord[];
  /**
   * The word at a scene-local frame (default: the current one): the word being said, or in a pause
   * the last one that was. null before the first word starts, or when there are no timings.
   */
  wordAt: (frame?: number) => WordAt | null;
  /** The scene-local frame word `index` starts on, rounded to the nearest frame, or null if there is no such word. */
  frameOfWord: (index: number) => number | null;
}

type WordsByBeat = Record<string, NarrationWord[]>;
const NarrationWordsContext = createContext<WordsByBeat>({});

/** Mounted once by the generated composition: the word timings of every beat, for one language. */
export const NarrationWordsProvider: React.FC<{ words: WordsByBeat; children: React.ReactNode }> = ({ words, children }) => (
  <NarrationWordsContext.Provider value={words}>{children}</NarrationWordsContext.Provider>
);

/** The pure core, with the frame passed in rather than read from Remotion, so it can be tested without rendering. */
export function createNarrationWords(words: NarrationWord[] | undefined, fps: number, currentFrame = 0): NarrationWords {
  const list = words ?? [];
  const wordAt = (frame: number = currentFrame): WordAt | null => {
    if (list.length === 0) return null;
    const ms = (frame / fps) * 1000;
    let found = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i].startMs <= ms) found = i;
      else break;
    }
    if (found < 0) return null;
    return { index: found, word: list[found], speaking: ms < list[found].endMs };
  };
  return {
    available: list.length > 0,
    fps,
    words: list,
    wordAt,
    frameOfWord: (index) => (index >= 0 && index < list.length ? Math.round((list[index].startMs / 1000) * fps) : null),
  };
}

/**
 * The narration words of the scene for beat `beatId`. Call it from inside that beat's scene so the
 * default frame is the scene's own.
 */
export function useNarrationWords(beatId: string): NarrationWords {
  const byBeat = useContext(NarrationWordsContext);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = byBeat[beatId];
  return useMemo(() => createNarrationWords(words, fps, frame), [words, fps, frame]);
}

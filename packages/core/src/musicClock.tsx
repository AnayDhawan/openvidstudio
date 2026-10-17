// Music-first timing (C3). A scene that cuts, pulses or lands text "on the music" needs the
// music's grid in frames, local to the scene. compose_score writes that grid to a cues file
// that is exact by construction (every hit is placed at an exact sample), and stitch_composition
// hands it to the composition through MusicClockProvider. A scene then asks for it by beat id:
//
//   const clock = useMusicClock("reveal");
//   const hit = clock.at(8);                 // first downbeat of bar 8, as a scene-local frame
//   const glow = clock.beatPulse();          // 1 on every beat, decaying to 0 before the next
//   if (clock.onDownbeat()) { ... }          // true on the frame a bar starts
//
// Bars are counted from 0 at the start of the track, in 4/4 (what compose_score writes).
// The bed is mounted at composition frame 0, so bar 0 beat 0 is composition frame 0.

import React, { createContext, useContext, useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

/** The fields of compose_score's cues file the clock reads. Everything but bpm is optional. */
export interface MusicCues {
  bpm: number;
  /** Beats per bar. compose_score writes 4/4 only, so this defaults to 4. */
  beatsPerBar?: number;
  /** Seconds from the start of the file to the first downbeat. 0 for compose_score's tracks. */
  offsetSeconds?: number;
  /** Section map, in bars. */
  sections?: { label: string; startBar: number; durationBars: number }[];
  /** Impact points the score was composed around. */
  impacts?: { label: string; atBar: number; atBeat?: number }[];
}

export interface MusicClock {
  /** False when no cues were provided: the clock then runs on a 120 bpm grid so a scene still renders. */
  available: boolean;
  bpm: number;
  beatsPerBar: number;
  fps: number;
  /** Frames from the start of the composition to the start of this scene. */
  sceneStartFrame: number;
  framesPerBeat: number;
  framesPerBar: number;
  /**
   * The scene-local frame of `bar` and `beat` (both 0-based; `beat` may be fractional, so
   * at(8, 2.5) is the "and" of beat 3 in bar 8). Rounded to the nearest frame. Negative when
   * that moment is before the scene starts, which is how a scene knows a hit already passed.
   */
  at: (bar: number, beat?: number) => number;
  /** The bar a scene-local frame falls in, and the beat within it (0-based, fractional). */
  position: (frame: number) => { bar: number; beat: number };
  /** The scene-local frame of the impact point with this label, or null if the score has none. */
  impact: (label: string) => number | null;
  /** The section of the track a scene-local frame falls in, or null when cues carry no sections. */
  sectionAt: (frame: number) => string | null;
  /**
   * 1 on a beat, decaying to 0 by the next one. `decay` is the fraction of a beat the pulse
   * lasts (default 0.6), `strongOnly` pulses on downbeats only. Uses the current frame.
   */
  beatPulse: (opts?: { decay?: number; strongOnly?: boolean }) => number;
  /** True on the frame a bar starts. Uses the current frame. */
  onDownbeat: () => boolean;
  /** True on the frame a beat starts. Uses the current frame. */
  onBeat: () => boolean;
}

/**
 * The pure core of the clock, with the current frame passed in rather than read from Remotion,
 * so it can be tested without rendering and reused by anything that already has a frame.
 */
export function createMusicClock(opts: {
  cues: MusicCues | null | undefined;
  fps: number;
  sceneStartFrame?: number;
  /** The scene-local frame the pulse/downbeat helpers answer for. */
  frame?: number;
}): MusicClock {
  const { cues, fps } = opts;
  const sceneStartFrame = opts.sceneStartFrame ?? 0;
  const frame = opts.frame ?? 0;
  const available = !!cues && Number.isFinite(cues.bpm) && cues.bpm > 0;
  const bpm = available ? cues!.bpm : 120;
  const beatsPerBar = available && cues!.beatsPerBar ? cues!.beatsPerBar : 4;
  const framesPerBeat = (60 / bpm) * fps;
  const framesPerBar = framesPerBeat * beatsPerBar;

  // A track found rather than composed may have its first downbeat a little after the start of
  // the file; the grid is then shifted by that much. compose_score's own tracks start on beat 0.
  const offsetFrames = available && cues!.offsetSeconds ? cues!.offsetSeconds * fps : 0;
  const absolute = (bar: number, beat = 0) => (bar * beatsPerBar + beat) * framesPerBeat + offsetFrames;
  const at = (bar: number, beat = 0) => Math.round(absolute(bar, beat)) - sceneStartFrame;

  const position = (localFrame: number) => {
    const beatsIn = (localFrame + sceneStartFrame - offsetFrames) / framesPerBeat;
    const bar = Math.floor(beatsIn / beatsPerBar + 1e-9);
    return { bar, beat: beatsIn - bar * beatsPerBar };
  };

  // Frames are integers and beats are not. A beat lands on the frame at() gives for it (its exact
  // position rounded to the nearest frame), so the pulse helpers use the same rounding and a
  // scene that cuts on at(8) and pulses on onDownbeat() agrees about which frame that is.
  const framesSinceBeat = () => {
    const abs = frame + sceneStartFrame - offsetFrames;
    // The latest beat whose rounded frame is at or before this one.
    const beatIndex = Math.ceil((abs + 0.5) / framesPerBeat - 1e-9) - 1;
    return { since: Math.round(abs - Math.round(beatIndex * framesPerBeat)), beatIndex };
  };

  return {
    available,
    bpm,
    beatsPerBar,
    fps,
    sceneStartFrame,
    framesPerBeat,
    framesPerBar,
    at,
    position,
    impact: (label) => {
      const hit = cues?.impacts?.find((i) => i.label === label);
      return hit ? at(hit.atBar, hit.atBeat ?? 0) : null;
    },
    sectionAt: (localFrame) => {
      const sections = cues?.sections;
      if (!sections?.length) return null;
      const { bar } = position(localFrame);
      const hit = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.durationBars);
      return hit ? hit.label : null;
    },
    beatPulse: ({ decay = 0.6, strongOnly = false } = {}) => {
      const { since, beatIndex } = framesSinceBeat();
      if (strongOnly && beatIndex % beatsPerBar !== 0) return 0;
      const span = Math.max(1, (strongOnly ? framesPerBar : framesPerBeat) * decay);
      const t = since / span;
      return t >= 1 || t < 0 ? 0 : Math.pow(1 - t, 2);
    },
    onBeat: () => framesSinceBeat().since === 0,
    onDownbeat: () => {
      const { since, beatIndex } = framesSinceBeat();
      return since === 0 && beatIndex % beatsPerBar === 0;
    },
  };
}

interface ProviderValue {
  cues: MusicCues | null;
  /** beat id -> the composition frame the beat's Sequence starts at */
  beatStarts: Record<string, number>;
}

const MusicClockContext = createContext<ProviderValue>({ cues: null, beatStarts: {} });

/**
 * Mounted once by the generated composition. `beatStarts` maps each beat id to the composition
 * frame its Sequence begins on, which is what turns the track's grid into scene-local frames.
 */
export const MusicClockProvider: React.FC<{
  cues: MusicCues | null;
  beatStarts: Record<string, number>;
  children: React.ReactNode;
}> = ({ cues, beatStarts, children }) => {
  const value = useMemo(() => ({ cues, beatStarts }), [cues, beatStarts]);
  return <MusicClockContext.Provider value={value}>{children}</MusicClockContext.Provider>;
};

/**
 * The music clock for the scene of beat `beatId`. Must be called from inside that beat's scene,
 * because the pulse and downbeat helpers read the scene's current frame.
 */
export function useMusicClock(beatId: string): MusicClock {
  const { cues, beatStarts } = useContext(MusicClockContext);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return createMusicClock({ cues, fps, sceneStartFrame: beatStarts[beatId] ?? 0, frame });
}

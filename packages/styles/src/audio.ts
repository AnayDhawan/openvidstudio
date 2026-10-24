import { createRng } from "./rng";

/**
 * A chip-style sound palette: plain data describing notes and envelopes, so it can be rendered by any
 * Web Audio sound kit (scheduleChip below is a small one) or turned into samples offline.
 */
export type ChipWave = "square" | "triangle" | "sawtooth" | "noise";

export interface ChipEnvelope {
  /** Seconds. */
  attack: number;
  decay: number;
  /** 0..1 of the peak. */
  sustain: number;
  release: number;
}

export interface ChipNote {
  /** Start, seconds from the sound's start. */
  at: number;
  /** Held length, seconds, before the release. */
  dur: number;
  /** A note name such as "C5" or "F#4", or a frequency in Hz. Ignored for noise. */
  note: string | number;
  /** Optional glide target, same forms as note. */
  slideTo?: string | number;
}

export interface ChipSound {
  name: string;
  wave: ChipWave;
  gain: number;
  env: ChipEnvelope;
  notes: ChipNote[];
}

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" is 440 Hz. Sharps are "#", flats are "b". A number is returned as given. */
export function noteToHz(note: string | number): number {
  if (typeof note === "number") return note;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`Not a note name: "${note}".`);
  const semis = SEMITONE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (semis - 69) / 12);
}

const SNAP: ChipEnvelope = { attack: 0.004, decay: 0.05, sustain: 0.5, release: 0.04 };

/** The built-in palette. Add a lesson's own sounds with registerChipSound. */
export const CHIP_SOUNDS: Record<string, ChipSound> = {
  blip: { name: "blip", wave: "square", gain: 0.2, env: SNAP, notes: [{ at: 0, dur: 0.06, note: "E5" }] },
  confirm: {
    name: "confirm",
    wave: "square",
    gain: 0.2,
    env: SNAP,
    notes: [
      { at: 0, dur: 0.07, note: "C5" },
      { at: 0.08, dur: 0.12, note: "G5" },
    ],
  },
  wrong: { name: "wrong", wave: "triangle", gain: 0.3, env: SNAP, notes: [{ at: 0, dur: 0.18, note: "E3", slideTo: "A2" }] },
  think: {
    name: "think",
    wave: "triangle",
    gain: 0.25,
    env: { attack: 0.01, decay: 0.08, sustain: 0.4, release: 0.08 },
    notes: [
      { at: 0, dur: 0.1, note: "A4" },
      { at: 0.14, dur: 0.1, note: "C5" },
      { at: 0.28, dur: 0.1, note: "E5" },
    ],
  },
  point: { name: "point", wave: "square", gain: 0.15, env: SNAP, notes: [{ at: 0, dur: 0.05, note: "A5", slideTo: "D6" }] },
  celebrate: {
    name: "celebrate",
    wave: "square",
    gain: 0.18,
    env: { attack: 0.005, decay: 0.06, sustain: 0.6, release: 0.08 },
    notes: [
      { at: 0, dur: 0.08, note: "C5" },
      { at: 0.1, dur: 0.08, note: "E5" },
      { at: 0.2, dur: 0.08, note: "G5" },
      { at: 0.3, dur: 0.22, note: "C6" },
    ],
  },
  step: { name: "step", wave: "noise", gain: 0.12, env: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 }, notes: [{ at: 0, dur: 0.03, note: 0 }] },
  whoosh: { name: "whoosh", wave: "noise", gain: 0.14, env: { attack: 0.08, decay: 0.15, sustain: 0.3, release: 0.12 }, notes: [{ at: 0, dur: 0.3, note: 0 }] },
};

export function registerChipSound(sound: ChipSound, overwrite = false): void {
  if (CHIP_SOUNDS[sound.name] && !overwrite) throw new Error(`A chip sound named "${sound.name}" already exists.`);
  CHIP_SOUNDS[sound.name] = sound;
}

/** Total length in seconds, release included. */
export function chipDuration(sound: ChipSound): number {
  return sound.notes.reduce((end, n) => Math.max(end, n.at + n.dur + sound.env.release), 0);
}

/**
 * Schedules a ChipSound on a Web Audio context at time `when` (the context's clock). Noise is built from
 * the seeded generator, so the same sound is the same samples every time.
 */
export function scheduleChip(ac: BaseAudioContext, sound: ChipSound, when: number, destination: AudioNode = ac.destination): void {
  const { attack, decay, sustain, release } = sound.env;
  for (const n of sound.notes) {
    const start = when + n.at;
    const hold = start + n.dur;
    const amp = ac.createGain();
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(sound.gain, start + attack);
    amp.gain.linearRampToValueAtTime(sound.gain * sustain, start + attack + decay);
    amp.gain.setValueAtTime(sound.gain * sustain, Math.max(hold, start + attack + decay));
    amp.gain.linearRampToValueAtTime(0, Math.max(hold, start + attack + decay) + release);
    amp.connect(destination);
    const stop = Math.max(hold, start + attack + decay) + release;
    if (sound.wave === "noise") {
      const length = Math.max(1, Math.ceil(ac.sampleRate * (n.dur + release + attack + decay)));
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      const rng = createRng(0x5eed + Math.round(n.at * 1000));
      for (let i = 0; i < length; i++) data[i] = rng.next() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(amp);
      src.start(start);
      src.stop(stop);
    } else {
      const osc = ac.createOscillator();
      osc.type = sound.wave;
      osc.frequency.setValueAtTime(noteToHz(n.note), start);
      if (n.slideTo !== undefined) osc.frequency.linearRampToValueAtTime(noteToHz(n.slideTo), hold);
      osc.connect(amp);
      osc.start(start);
      osc.stop(stop);
    }
  }
}

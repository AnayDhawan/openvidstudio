#!/usr/bin/env node
// Synthesizes public/sfx/pulse-bed.mp3, a rhythmic companion to the existing music-bed.mp3
// drone. music-bed is detuned sines plus pink noise: an ambient wash with no pulse to cut
// scenes against. pulse-bed is a four-on-the-floor kick plus offbeat hat at a fixed, known
// BPM, so a video can beat-lock its cuts to it, the way STYLE.md's "Beat-locked cuts"
// section describes.
//
// Written as raw PCM in this script rather than an ffmpeg filter graph, because the exact
// sample position of every hit has to be known to write pulse-bed.cues.json alongside it.
// A filter graph could make a similar sound, but this script would then have to guess at
// its own output to write the cues file. Generating the samples directly means the cues
// are exact by construction, not detected after the fact.
//
// Run manually when the pattern needs to change: `node scripts/generate-pulse-bed.mjs`.
// Not part of the build; the output is committed like the rest of public/sfx/.

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "sfx");

const SAMPLE_RATE = 44100;
const BPM = 112;
const BEAT_SECONDS = 60 / BPM;
const BARS = 28; // 28 bars * 4 beats * (60/112)s per beat = 60.000s, matching music-bed.mp3's duration.
const BEATS_PER_BAR = 4;
const TOTAL_BEATS = BARS * BEATS_PER_BAR;
const DURATION_SECONDS = TOTAL_BEATS * BEAT_SECONDS;
const TOTAL_SAMPLES = Math.round(DURATION_SECONDS * SAMPLE_RATE);

function makeBuffer() {
  return new Float64Array(TOTAL_SAMPLES);
}

/** Sine burst with a fast exponential decay. Low-frequency, so it reads as a kick, not a tone. */
function addKick(buf, atSample, gain) {
  const freq = 58;
  const decay = 55; // higher = faster decay
  const durSamples = Math.min(Math.round(0.14 * SAMPLE_RATE), buf.length - atSample);
  for (let i = 0; i < durSamples; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-decay * t);
    // A slight pitch drop on the way down is what separates a kick from a plain sine blip.
    const freqNow = freq * (1 + 0.6 * env);
    buf[atSample + i] += gain * env * Math.sin(2 * Math.PI * freqNow * t);
  }
}

/** Filtered noise burst, much shorter and quieter than the kick, sitting on the offbeat. */
function addHat(buf, atSample, gain, seed) {
  const decay = 220;
  const durSamples = Math.min(Math.round(0.05 * SAMPLE_RATE), buf.length - atSample);
  let prev = 0;
  let rng = seed;
  for (let i = 0; i < durSamples; i++) {
    // xorshift32, deterministic so re-running this script reproduces byte-identical output.
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    rng |= 0;
    const white = (rng % 2000) / 1000 - 1;
    // First-difference the noise: a crude high-pass that keeps the hat from reading as static.
    const filtered = white - prev;
    prev = white;
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-decay * t);
    buf[atSample + i] += gain * env * filtered * 0.5;
  }
}

const buf = makeBuffer();
let rngSeed = 0x9e3779b9;
const strongCues = [];
const beats = [];

for (let beatIndex = 0; beatIndex < TOTAL_BEATS; beatIndex++) {
  const tSeconds = beatIndex * BEAT_SECONDS;
  const atSample = Math.round(tSeconds * SAMPLE_RATE);
  const isDownbeat = beatIndex % BEATS_PER_BAR === 0;
  const isBarStart = beatIndex % (BEATS_PER_BAR * 4) === 0; // every 4th bar, a stronger accent

  addKick(buf, atSample, isBarStart ? 0.85 : isDownbeat ? 0.7 : 0.5);
  beats.push(Number(tSeconds.toFixed(3)));
  if (isDownbeat) strongCues.push(Number(tSeconds.toFixed(3)));

  // Offbeat hat, halfway to the next beat.
  const offSeconds = tSeconds + BEAT_SECONDS / 2;
  const offSample = Math.round(offSeconds * SAMPLE_RATE);
  if (offSample < buf.length) {
    rngSeed = (rngSeed + 0x6d2b79f5) | 0;
    addHat(buf, offSample, 0.22, rngSeed);
  }
}

// Normalize to a safe headroom, then to 16-bit PCM.
let peak = 0;
for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
const normGain = peak > 0 ? 0.9 / peak : 1;
const pcm = new Int16Array(buf.length);
for (let i = 0; i < buf.length; i++) {
  const s = Math.max(-1, Math.min(1, buf[i] * normGain));
  pcm[i] = Math.round(s * 32767);
}

function writeWav(pathOut, samples, sampleRate) {
  const byteRate = sampleRate * 2;
  const dataSize = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  const body = Buffer.alloc(dataSize);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(samples[i], i * 2);
  writeFileSync(pathOut, Buffer.concat([header, body]));
}

mkdirSync(OUT_DIR, { recursive: true });
const wavPath = join(OUT_DIR, "pulse-bed.wav");
const mp3Path = join(OUT_DIR, "pulse-bed.mp3");
const cuesPath = join(OUT_DIR, "pulse-bed.cues.json");

writeWav(wavPath, pcm, SAMPLE_RATE);

const enc = spawnSync(
  "ffmpeg",
  ["-y", "-i", wavPath, "-c:a", "libmp3lame", "-b:a", "40k", "-ar", "44100", "-ac", "1", mp3Path],
  { encoding: "utf8" },
);
if (enc.status !== 0) {
  process.stderr.write(enc.stderr ?? "ffmpeg failed\n");
  process.exit(1);
}
rmSync(wavPath, { force: true });

writeFileSync(
  cuesPath,
  JSON.stringify(
    {
      track: "pulse-bed.mp3",
      bpm: BPM,
      durationSeconds: Number(DURATION_SECONDS.toFixed(3)),
      // Every beat, evenly spaced by construction: this is a generated track, not a
      // detected one, so there is no estimation error to report.
      beats,
      // Bar downbeats: the strongest, sparsest cue set, meant for scene cuts and reveals.
      strongCues,
      source: "generated",
      generatedBy: "packages/core/scripts/generate-pulse-bed.mjs",
    },
    null,
    2,
  ) + "\n",
);

process.stdout.write(
  `wrote ${mp3Path} (${DURATION_SECONDS.toFixed(1)}s, ${BPM}bpm) and ${cuesPath} ` +
    `(${beats.length} beats, ${strongCues.length} strong cues)\n`,
);

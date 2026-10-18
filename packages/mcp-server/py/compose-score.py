#!/usr/bin/env python3
"""Generalized original-score generator, driven by a JSON spec.

Generalizes reference/score/score.py (a hand-composed 180 second, 84 bar score
written for one specific launch video, fixed at 112bpm in D minor) into an engine
any video's brief can parametrize: bpm, key, a labeled section arc, and impact
points in, a mastered wav plus an exact cue grid out.

What carries over unchanged from the reference: every low-level synthesis
primitive (oscillators, envelopes, filters, the named instruments, the
convolution reverb, the LUFS mastering loop). That part was already solved and
is reused as-is. What is new here is the arrangement layer: a chord-table
builder that works for any tonic and mode instead of one hardcoded chord table,
and a label-driven section renderer covering a seven-word arc vocabulary
(intro, tension, reveal, groove, break, peak, outro) instead of one bar-by-bar
hand-written score.

No samples anywhere. Every sound is synthesized from oscillators and noise, so
there is no licence or attribution question, the same as the reference this
generalizes.

Usage:
    python compose-score.py <spec.json>

spec.json fields:
    bpm            number, beats per minute. 4/4 time is assumed throughout,
                   same as the reference.
    key            string, "<tonic> major" or "<tonic> minor", e.g. "D minor".
    sections       [{label, bars}], contiguous, in order. label is one of
                   intro, tension, reveal, groove, break, peak, outro.
    impacts        [{label, atBar, atBeat}], atBeat defaults to 0.
    mode           "bed" or "music". Sets the default loudness target
                   (-15 LUFS under narration, -14 LUFS for music-only) when
                   targetLufs is not given.
    targetLufs     number, overrides the mode default.
    percussion     "none" (default) or "full". "none" renders no kick, clap, hat or
                   tick, and gives the bass and arp uneven rhythms with small timing
                   and level variation, so nothing repeats identically on a fixed
                   grid. "full" is the old drum-machine arrangement, kept as an opt-in.
    truePeakMaxDbtp  number, default -1.0.
    seed           integer, default 7. Every run with the same spec and seed
                   produces byte-identical output.
    outWav         absolute path to write the mastered wav to.
    outCues        absolute path to write the cues/report JSON to.
    outSpectrogram absolute path to write the diagnostic spectrogram PNG to.
    trackName      string, the "track" field recorded in the cues JSON.

Writes outWav, outCues, outSpectrogram. Prints short progress lines to stdout.
On failure, prints a message to stderr and exits non-zero; no partial outputs
are left in place (any file written before the failure is removed).
"""
import json
import os
import sys
import traceback

import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi, fftconvolve, welch, resample_poly
import soundfile as sf
import pyloudnorm as pyln
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

SR = 48000

# ============================================================== key / harmony
# Pitch class of every spelling this parser accepts, C = 0.
PITCH_CLASS = {
    "C": 0, "B#": 0,
    "C#": 1, "DB": 1,
    "D": 2,
    "D#": 3, "EB": 3,
    "E": 4, "FB": 4,
    "E#": 5, "F": 5,
    "F#": 6, "GB": 6,
    "G": 7,
    "G#": 8, "AB": 8,
    "A": 9,
    "A#": 10, "BB": 10,
    "B": 11, "CB": 11,
}

# role -> (semitone offset from the tonic, triad quality). A small, deliberately
# incomplete set: only the roles this engine's arrangement layer actually calls
# for, not a full diatonic harmony system.
MODE_CHORDS = {
    "minor": {
        "i": (0, "min"), "III": (3, "maj"), "iv": (5, "min"),
        "V": (7, "maj"), "VI": (8, "maj"), "VII": (10, "maj"),
    },
    "major": {
        "I": (0, "maj"), "ii": (2, "min"), "iii": (4, "min"),
        "IV": (5, "maj"), "V": (7, "maj"), "vi": (9, "min"),
    },
}

# Reverse-engineered from the reference's own hardcoded CH table (verified
# exactly against all six of its chords bar one deliberate one-off voicing):
# bass sits in the octave band [33, 44], pad root is bass + 12, arp root is
# bass + 24. Clean, fully general, and matches the reference's real numbers.
BASS_LOW = 33


def parse_key(key):
    s = key.strip().replace("-", " ")
    parts = [p for p in s.split() if p]
    if len(parts) < 2:
        raise ValueError(f'key "{key}" must be "<tonic> <major|minor>", e.g. "D minor"')
    tonic_raw = parts[0].upper()
    mode = parts[1].lower()
    if mode not in ("major", "minor"):
        raise ValueError(f'key "{key}" mode must be "major" or "minor", got "{parts[1]}"')
    if tonic_raw not in PITCH_CLASS:
        raise ValueError(f'key "{key}" tonic "{parts[0]}" is not a recognized pitch (A-G, optional # or b)')
    return PITCH_CLASS[tonic_raw], mode


def chord_notes(tonic_pc, mode, role):
    """MIDI notes for one chord: bass (one note), pad (5 notes), arp (4 notes)."""
    offset, quality = MODE_CHORDS[mode][role]
    third = 4 if quality == "maj" else 3
    root_pc = (tonic_pc + offset) % 12
    bass = BASS_LOW + ((root_pc - BASS_LOW) % 12)
    pad_root = bass + 12
    arp_root = bass + 24
    pad = sorted([pad_root, pad_root + 7, pad_root + 12, pad_root + 12 + third, pad_root + 12 + 7])
    arp = sorted([arp_root, arp_root + 7, arp_root + 12, arp_root + 12 + third])
    return {"bass": bass, "pad": pad, "arp": arp, "quality": quality, "third": third}


# Short idiomatic patterns per label, resampled to however many bars the
# caller's section actually spans. Each one is a generalization of a real
# passage in the reference (see the per-label comments below).
ARC_PATTERNS = {
    "minor": {
        "intro": ["i"],
        "tension": ["i", "i", "VI", "VI", "iv", "V"],
        "reveal": ["III", "VII", "i", "VI"],
        "groove": ["i", "VI", "III", "VII", "i", "VI", "III", "V"],
        "break": ["iv", "VI", "III", "V"],
        "peak": ["i", "VI", "III", "VII", "i", "VI", "III", "V"],
        "outro": ["i", "VI", "III", "VII", "i"],
    },
    "major": {
        "intro": ["I"],
        "tension": ["I", "I", "vi", "vi", "ii", "V"],
        "reveal": ["IV", "V", "I", "vi"],
        "groove": ["I", "V", "vi", "IV", "I", "V", "vi", "V"],
        "break": ["ii", "vi", "IV", "V"],
        "peak": ["I", "V", "vi", "IV", "I", "V", "vi", "V"],
        "outro": ["I", "V", "vi", "IV", "I"],
    },
}

# Characteristic lowpass target (Hz) per label, used to build the pad/arp
# cutoff automation. Generalizes the reference's pad_cut/arp_cut breakpoint
# lists, which rose and fell at this song's own section boundaries, into one
# rule driven by the label instead of this song's specific bar numbers.
PAD_CUTOFF = {"intro": 500, "tension": 1300, "reveal": 4600, "groove": 3200,
              "break": 1300, "peak": 6800, "outro": 1500}
ARP_CUTOFF = {"intro": 700, "tension": 2000, "reveal": 5200, "groove": 4000,
              "break": 1500, "peak": 7200, "outro": 2400}

ARP_PAT = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2]

# Percussion mode. "none" is the default: any perfectly even, short-decay, identically
# voiced hit reads as a ticking clock under a voiceover, so the none mode has no kick,
# clap, hat or tick, and the bass and arp play uneven rhythms with small timing and
# level variation. "full" keeps the original drum-machine arrangement.
PERCUSSION = "none"

# Which of the bar's 16 sixteenth steps (arp) or 8 eighth steps (bass) sound, per bar,
# in "none" mode. Several patterns rotate by bar so the same shape never repeats back
# to back. Step 0 always plays so the harmony stays anchored.
ARP_RHYTHMS = [
    [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1],
    [1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1],
    [1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0],
    [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1],
]
BASS_RHYTHMS = [
    [1, 0, 1, 1, 0, 1, 1, 0],
    [1, 0, 0, 1, 1, 0, 1, 1],
    [1, 1, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1, 1, 0, 1],
]


def full_percussion():
    return PERCUSSION == "full"


def human_t(t, ms=5.0):
    """A small random offset in seconds, so two hits never land on the exact grid."""
    return max(0.0, t + rng.uniform(-ms, ms) / 1000.0)


def human_lvl(level, spread=0.14):
    return level * rng.uniform(1 - spread, 1 + spread)


def arp_steps(bar_index, steps=16):
    """Sixteenth steps of the bar that play. All of them in "full" mode."""
    if full_percussion():
        return list(range(steps))
    pattern = ARP_RHYTHMS[(bar_index * 3 + 1) % len(ARP_RHYTHMS)]
    return [k for k in range(steps) if pattern[k]]


def bass_steps(bar_index):
    """Eighth steps of the bar that play. All eight in "full" mode."""
    if full_percussion():
        return list(range(8))
    pattern = BASS_RHYTHMS[(bar_index * 5 + 2) % len(BASS_RHYTHMS)]
    return [k for k in range(8) if pattern[k]]


def role_sequence(mode, label, nbars):
    pattern = ARC_PATTERNS[mode][label]
    return [pattern[(i * len(pattern)) // nbars] for i in range(nbars)]


# ============================================================== transport
def S(sec):
    return int(round(sec * SR))


def bar_t(b, beat=0.0):
    return b * BAR + beat * BEAT


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def bus():
    return np.zeros((2, N))


BUS_NAMES = ["pad", "bass", "sub", "arp", "lead", "bell", "str", "kick", "clap", "hat", "tick", "fx", "impact"]


def add(busname, start_sec, sig, pan=0.0, gain=1.0):
    """sig: mono (n,) or stereo (2,n)."""
    i = S(start_sec)
    if i >= N or i < 0:
        return
    if sig.ndim == 1:
        l = np.cos((pan + 1) * np.pi / 4)
        r = np.sin((pan + 1) * np.pi / 4)
        st = np.vstack([sig * l * 1.4142, sig * r * 1.4142])
    else:
        st = sig
    n = min(st.shape[1], N - i)
    if n <= 0:
        return
    B[busname][:, i:i + n] += gain * st[:, :n]


# ============================================================== oscillators (unchanged DSP)
def saw(freq, n, phase0=0.0):
    dt = np.full(n, freq / SR) if np.isscalar(freq) else freq / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def env_adsr(n, a, d, s, r, note_len):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = t > note_len
    e[rel] *= np.exp(-(t[rel] - note_len) / max(r, 1e-4) * 3)
    return e


def lp(sig, fc, order=2):
    sos = butter(order, min(fc, SR * 0.45), btype="low", fs=SR, output="sos")
    return sosfilt(sos, sig, axis=-1)


def hp(sig, fc, order=2):
    sos = butter(order, fc, btype="high", fs=SR, output="sos")
    return sosfilt(sos, sig, axis=-1)


def bp(sig, lo, hi, order=2):
    sos = butter(order, [lo, min(hi, SR * 0.45)], btype="band", fs=SR, output="sos")
    return sosfilt(sos, sig, axis=-1)


def auto_lp(stereo, points, block=1024):
    """Time-varying 2-pole lowpass. points: [(sec, hz)], ascending time, interpolated in log space."""
    ts = np.array([p[0] for p in points])
    fs_ = np.log(np.array([p[1] for p in points]))
    out = np.zeros_like(stereo)
    zi = None
    for i in range(0, stereo.shape[1], block):
        tc = (i + block / 2) / SR
        fc = float(np.exp(np.interp(tc, ts, fs_)))
        sos = butter(2, min(fc, SR * 0.45), btype="low", fs=SR, output="sos")
        if zi is None:
            zi = np.stack([sosfilt_zi(sos) * 0 for _ in range(2)], axis=1)
        seg = stereo[:, i:i + block]
        y = np.empty_like(seg)
        for ch in range(2):
            y[ch], zi[:, ch, :] = sosfilt(sos, seg[ch], zi=zi[:, ch, :])
        out[:, i:i + block] = y
    return out


# ============================================================== instruments (unchanged DSP,
# except pad_chord now takes an explicit note list instead of a hardcoded chord name)
def pad_chord(notes, t0, length, level=1.0, add9=False):
    notes = list(notes)
    if add9:
        notes = notes + [notes[2] + 14]
    n = S(length + 1.6)
    out = np.zeros((2, n))
    for m in notes:
        f = mtof(m)
        for ch in range(2):
            v = np.zeros(n)
            for det in (-11, -4, 0, 5, 12):
                d = det + rng.uniform(-2, 2)
                v += saw(f * 2 ** (d / 1200), n, rng.random())
            out[ch] += v / np.sqrt(5)
    e = env_adsr(n, 0.35, 0.8, 0.85, 0.9, length)
    out *= e * level / np.sqrt(len(notes))
    add("pad", t0, out)


def bass_note(m, t0, length, level=1.0, cutoff=900):
    n = S(length + 0.15)
    f = mtof(m)
    s = 0.7 * saw(f, n, 0.0) + 0.3 * saw(f * 1.003, n, 0.5)
    s = lp(s, cutoff, 2)
    e = env_adsr(n, 0.004, 0.25, 0.7, 0.05, length)
    add("bass", t0, s * e * level)
    sub = np.sin(2 * np.pi * f / 2 * np.arange(n) / SR)
    add("sub", t0, sub * env_adsr(n, 0.006, 0.3, 0.9, 0.05, length) * level)


def pluck(m, t0, level=1.0, decay=0.16, pan=0.0):
    n = S(decay * 4 + 0.05)
    f = mtof(m)
    s = 0.6 * saw(f, n, rng.random()) + 0.4 * np.sign(np.sin(2 * np.pi * f * 1.001 * np.arange(n) / SR))
    s = lp(s, 5200, 2)
    t = np.arange(n) / SR
    e = np.minimum(t / 0.002, 1) * np.exp(-t / decay)
    add("arp", t0, s * e * level, pan=pan)


def lead_note(m, t0, length, level=1.0):
    n = S(length + 0.4)
    f = mtof(m)
    t = np.arange(n) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(t / 0.35, 1)
    out = np.zeros((2, n))
    for ch, dets in enumerate(((-7, 3), (-3, 8))):
        v = np.zeros(n)
        for d in dets + (0,):
            v += saw(f * vib * 2 ** (d / 1200), n, rng.random())
        out[ch] = lp(v / np.sqrt(3), 3600, 2)
    e = env_adsr(n, 0.012, 0.35, 0.75, 0.25, length)
    add("lead", t0, out * e * level)


def bell(m, t0, level=1.0, length=2.4, pan=0.0):
    n = S(length)
    f = mtof(m)
    t = np.arange(n) / SR
    idx = 2.2 * np.exp(-t / 0.5)
    s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t))
    s += 0.35 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t / 0.4)
    e = np.minimum(t / 0.003, 1) * np.exp(-t / 0.9)
    add("bell", t0, s * e * level, pan=pan)


def string_note(m, t0, length, level=1.0):
    n = S(length + 0.8)
    f = mtof(m)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for ch in range(2):
        v = saw(f * (1 + 0.003 * np.sin(2 * np.pi * (4.8 + ch * 0.4) * t)), n, rng.random())
        v += saw(f * 2 ** (6 / 1200), n, rng.random())
        out[ch] = lp(v, 1800, 2)
    e = env_adsr(n, 0.6, 1.0, 0.9, 0.6, length)
    add("str", t0, out * e * level)


# kick() records every hit's time, so the sidechain ducking envelope can be built
# from what actually played instead of a hardcoded bar-range list (the reference's
# own kick_env was a literal list of this song's bar numbers; a general version has
# no such list to read, so it has to watch its own kicks instead).
KICK_TIMES = []


def kick(t0, level=1.0):
    n = S(0.45)
    t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t / 0.16)
    s += 0.25 * np.tanh(4 * np.sin(ph)) * np.exp(-t / 0.05)
    click = hp(rng.standard_normal(S(0.006)), 2000) * 0.3
    s[: click.size] += click
    add("kick", t0, s * level)
    KICK_TIMES.append(t0)


def clap(t0, level=1.0):
    n = S(0.35)
    t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 900, 5200)
    e = np.zeros(n)
    for k, off in enumerate((0.0, 0.011, 0.022)):
        m = t >= off
        e[m] += np.exp(-(t[m] - off) / (0.008 if k < 2 else 0.14))
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.4
    add("clap", t0, (noise * e + tone) * level)


def hat(t0, level=1.0, open_=False, pan=0.0):
    n = S(0.3 if open_ else 0.06)
    t = np.arange(n) / SR
    s = hp(rng.standard_normal(n), 7000, 2) * np.exp(-t / (0.09 if open_ else 0.018))
    add("hat", t0, s * level, pan=pan)


def tick(t0, level=1.0, high=True):
    n = S(0.05)
    t = np.arange(n) / SR
    f = 2600 if high else 1900
    s = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.008) + 0.3 * hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.004)
    add("tick", t0, s * level, pan=0.25 if high else -0.25)


def riser(t_end, length, level=1.0):
    length = max(0.05, min(length, max(0.05, t_end)))
    n = S(length)
    if n <= 1:
        return
    t = np.arange(n) / SR
    x = t / length
    noise = rng.standard_normal((2, n))
    out = np.zeros((2, n))
    blk = 1024
    for i in range(0, n, blk):
        c = 300 * (9000 / 300) ** (x[i] ** 1.6)
        out[:, i:i + blk] = bp(noise[:, i:i + blk], c * 0.6, c * 1.5, 1)
    sweep = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (x * 2)) / SR) * 0.25
    out += sweep
    out *= (x ** 2.2) * level
    add("fx", t_end - length, out)


def downsweep(t0, length=1.2, level=1.0):
    n = S(length)
    t = np.arange(n) / SR
    x = t / length
    noise = rng.standard_normal((2, n))
    out = np.zeros((2, n))
    blk = 1024
    for i in range(0, n, blk):
        c = 7000 * (200 / 7000) ** (x[i] ** 0.7)
        out[:, i:i + blk] = bp(noise[:, i:i + blk], c * 0.6, c * 1.5, 1)
    out *= np.exp(-x * 3.5) * np.minimum(t / 0.01, 1) * level
    add("fx", t0, out)


def impact(t0, level=1.0):
    n = S(2.5)
    t = np.arange(n) / SR
    f = 34 + 90 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    body = lp(rng.standard_normal(n), 900) * np.exp(-t / 0.25) * 0.6
    add("impact", t0, (boom + body) * level)
    downsweep(t0, 1.6, 0.35 * level)


# ============================================================== arrangement (new: generalized)
def drone(t0, length, level=0.5):
    """Low sub drone, same shape as the reference's hook/problem drone."""
    n = S(length + 1)
    t = np.arange(n) / SR
    dr = np.sin(2 * np.pi * mtof(26) * t) + 0.4 * np.sin(2 * np.pi * mtof(38) * t)
    env = np.minimum(t / 3.0, 1) * np.exp(-np.maximum(t - length, 0) / 0.3)
    add("sub", t0, dr * env * level)


def groove_bar(b, notes, *, kick_on=True, clap_on=False, hat16=False, openhat=False,
               bass=True, arp=True, arp_lvl=0.8, bass_lvl=0.8):
    if full_percussion():
        if kick_on:
            for k in range(4):
                kick(bar_t(b, k), 0.95)
        if clap_on:
            for k in (1, 3):
                clap(bar_t(b, k), 0.8)
        for k in range(4):
            hat(bar_t(b, k + 0.5), 0.55, pan=0.15)
            if openhat:
                hat(bar_t(b, k + 0.5), 0.28, open_=True, pan=-0.1)
        if hat16:
            for k in range(16):
                if k % 2 == 1:
                    continue
                hat(bar_t(b, k * 0.25), 0.22, pan=-0.2 if k % 4 else 0.2)
    if bass:
        for k in bass_steps(b):
            if full_percussion():
                bass_note(notes["bass"], bar_t(b, k * 0.5), BEAT * 0.45, bass_lvl * (1.0 if k % 2 else 0.8), cutoff=700)
            else:
                bass_note(notes["bass"], human_t(bar_t(b, k * 0.5), 4.0), BEAT * rng.uniform(0.4, 0.6),
                          human_lvl(bass_lvl * (1.0 if k % 2 else 0.8)), cutoff=700)
    if arp:
        tones = notes["arp"]
        for k in arp_steps(b):
            lvl = arp_lvl * (1.0 if k % 4 == 0 else 0.75)
            if full_percussion():
                pluck(tones[ARP_PAT[k]], bar_t(b, k * 0.25), lvl)
            else:
                pluck(tones[ARP_PAT[k]], human_t(bar_t(b, k * 0.25)), human_lvl(lvl, 0.2),
                      decay=rng.uniform(0.11, 0.24), pan=rng.uniform(-0.3, 0.3))


def lead_motif(start_bar, nbars, roles, level=0.7, octave=0):
    """A simple generated contour over each bar's own chord tones (high, low, mid,
    low-ish), not a hand-composed melody. Generalizes the reference's hand-written
    MOTIF, which used fixed absolute MIDI notes that only made sense in D minor."""
    contour = [3, 2, 1, 2]  # indices into the 4-tone arp set: high, low-mid, low, low-mid
    lens_beats = [1.0, 1.0, 0.75, 1.25]
    for i in range(nbars):
        role = roles[i]
        notes = chord_notes(TONIC_PC, MODE, role)
        tones = notes["arp"]
        beat = 0.0
        for k in range(4):
            idx = contour[(i + k) % len(contour)]
            m = tones[idx] + 12 * octave
            ln = lens_beats[(i + k) % len(lens_beats)]
            lead_note(m, bar_t(start_bar + i, beat), ln * BEAT * 0.9, level)
            beat += ln


def render_intro(start_bar, nbars, roles):
    notes = chord_notes(TONIC_PC, MODE, roles[0])
    total = nbars * BAR
    pad_chord(notes["pad"], bar_t(start_bar), total, 0.78)
    drone(bar_t(start_bar), total, 0.55)


def render_tension(start_bar, nbars, roles):
    climb_steps = min(nbars * 2, 8)
    base_pad = chord_notes(TONIC_PC, MODE, roles[0])["pad"]
    climb_root = base_pad[1]  # the pad's own fifth, a comfortable mid register start
    for i, role in enumerate(roles):
        b = start_bar + i
        notes = chord_notes(TONIC_PC, MODE, role)
        if full_percussion():
            for k in range(4):
                tick(bar_t(b, k), 0.65 if k % 2 == 0 else 0.5, high=(k % 2 == 0))
        for k in bass_steps(b):
            if full_percussion():
                bass_note(notes["bass"], bar_t(b, k * 0.5), BEAT * 0.42, 0.52 + 0.04 * i, cutoff=360 + 70 * i)
            else:
                bass_note(notes["bass"], human_t(bar_t(b, k * 0.5), 4.0), BEAT * rng.uniform(0.38, 0.55),
                          human_lvl(0.52 + 0.04 * i), cutoff=360 + 70 * i)
    # chromatic string climb across the section, one note per bar up to climb_steps
    for i in range(climb_steps):
        b = start_bar + (i * nbars) // climb_steps
        string_note(climb_root + i, bar_t(b), BAR, 0.85)
    riser(bar_t(start_bar + nbars), BAR * min(1.6, nbars), 0.75)


def render_reveal(start_bar, nbars, roles):
    impact(bar_t(start_bar), 0.9)
    bell_tones = []
    for i, role in enumerate(roles):
        notes = chord_notes(TONIC_PC, MODE, role)
        bell_tones.append(notes["pad"][2])
        bell_tones.append(notes["pad"][3])
    for i, m in enumerate(bell_tones[:8]):
        bell(m, bar_t(start_bar, i * 0.5), 0.75, pan=0.2 if i % 2 else -0.2)
    for i, role in enumerate(roles):
        notes = chord_notes(TONIC_PC, MODE, role)
        pad_chord(notes["pad"], bar_t(start_bar + i), BAR, 0.95, add9=(i == 0))
        tones = notes["arp"]
        for k in arp_steps(start_bar + i):
            level = 0.2 + 0.35 * ((i * 16 + k) / max(1, nbars * 16))
            if full_percussion():
                pluck(tones[ARP_PAT[k]], bar_t(start_bar + i, k * 0.25), level)
            else:
                pluck(tones[ARP_PAT[k]], human_t(bar_t(start_bar + i, k * 0.25)), human_lvl(level, 0.2),
                      decay=rng.uniform(0.11, 0.24), pan=rng.uniform(-0.3, 0.3))
    riser(bar_t(start_bar + nbars), BAR * 0.5, 0.5)


def render_groove(start_bar, nbars, roles, *, peak=False, lead=True):
    half = nbars // 2
    for i, role in enumerate(roles):
        b = start_bar + i
        notes = chord_notes(TONIC_PC, MODE, role)
        pad_chord(notes["pad"], bar_t(b), BAR, 0.88 if not peak else 0.95)
        groove_bar(
            b, notes,
            clap_on=peak or i >= half // 2,
            hat16=peak or i >= half,
            openhat=peak or i >= nbars - 2,
            arp_lvl=0.9 if peak else 0.8,
            bass_lvl=0.85 if peak else 0.8,
        )
    if lead and nbars >= 2:
        lead_motif(start_bar + nbars // 4, min(4, nbars // 2), roles[nbars // 4: nbars // 4 + min(4, nbars // 2)],
                   level=0.72 if peak else 0.55, octave=1 if peak else 0)


def render_break(start_bar, nbars, roles):
    for i, role in enumerate(roles):
        b = start_bar + i
        notes = chord_notes(TONIC_PC, MODE, role)
        pad_chord(notes["pad"], bar_t(b), BAR, 0.55)
        if full_percussion():
            kick(bar_t(b), 0.55)
        tones = notes["arp"]
        steps = arp_steps(b)
        for k in range(8):
            if full_percussion():
                pluck(tones[ARP_PAT[k]], bar_t(b, k * 0.5), 0.3, decay=0.25)
            elif k * 2 in steps:
                pluck(tones[ARP_PAT[k]], human_t(bar_t(b, k * 0.5)), human_lvl(0.3, 0.2),
                      decay=rng.uniform(0.18, 0.32), pan=rng.uniform(-0.3, 0.3))
        if i == nbars - 1 and full_percussion():
            # snare-roll build into whatever follows: accelerating clap density
            for k in range(16):
                clap(bar_t(b, k * 0.25), 0.2 + 0.5 * k / 16)
    riser(bar_t(start_bar + nbars), BAR * min(1.5, nbars), 0.85)


def render_outro(start_bar, nbars, roles):
    impact(bar_t(start_bar), 1.0)
    for i, role in enumerate(roles[:-1]):
        notes = chord_notes(TONIC_PC, MODE, role)
        pad_chord(notes["pad"], bar_t(start_bar + i), BAR, 0.88)
        groove_bar(start_bar + i, notes, clap_on=True, hat16=True, openhat=True)
    final_role = roles[-1]
    final_notes = chord_notes(TONIC_PC, MODE, final_role)
    tail_start = start_bar + nbars - 1
    impact(bar_t(tail_start), 0.75)
    bass_note(final_notes["bass"], bar_t(tail_start), BAR * 0.9, 0.85)
    bell(final_notes["pad"][2], bar_t(tail_start), 0.65)
    bell(final_notes["pad"][3], bar_t(tail_start, 0.5), 0.5)
    pad_chord(final_notes["pad"], bar_t(tail_start), BAR, 1.0, add9=True)


RENDERERS = {
    "intro": render_intro,
    "tension": render_tension,
    "reveal": render_reveal,
    "groove": lambda sb, nb, roles: render_groove(sb, nb, roles, peak=False),
    "break": render_break,
    "peak": lambda sb, nb, roles: render_groove(sb, nb, roles, peak=True),
    "outro": render_outro,
}


# ============================================================== automated checks
def band_energy_balance(mono):
    freqs, psd = welch(mono, fs=SR, nperseg=8192)
    def band(lo, hi):
        m = (freqs >= lo) & (freqs < hi)
        return float(psd[m].sum())
    low, mid, high = band(20, 250), band(250, 4000), band(4000, 20000)
    total = low + mid + high + 1e-12
    low_pct, mid_pct, high_pct = low / total * 100, mid / total * 100, high / total * 100

    # Narrow-spike detector: the real, confirmed failure mode this is checking for is
    # ffmpeg's showspectrumpic drawing a false constant line on synthesized material
    # (around 1.4kHz on the reference track); scipy/matplotlib is used for the actual
    # spectrogram specifically to avoid that renderer bug, and this is the numeric
    # equivalent check: a 100Hz-wide band should never dominate its neighborhood.
    spike_freq, spike_ratio = None, 1.0
    bins = np.arange(100, 12000, 100)
    for f0 in bins:
        m = (freqs >= f0) & (freqs < f0 + 100)
        nb = (freqs >= max(0, f0 - 300)) & (freqs < f0 + 400) & ~m
        if not m.any() or not nb.any():
            continue
        band_mean = psd[m].mean()
        neighbor_mean = psd[nb].mean() + 1e-15
        ratio = band_mean / neighbor_mean
        if ratio > spike_ratio:
            spike_ratio = ratio
            spike_freq = float(f0)

    verdict = "ok"
    if high_pct < 1.0 and mid_pct < 10.0:
        verdict = "all-bass"
    elif low_pct < 1.0 and mid_pct < 15.0:
        verdict = "all-hiss"
    elif spike_ratio > 12.0:
        verdict = f"narrow spike near {spike_freq:.0f}Hz ({spike_ratio:.1f}x neighborhood)"

    return {
        "lowPct": round(low_pct, 2), "midPct": round(mid_pct, 2), "highPct": round(high_pct, 2),
        "spikeFreqHz": spike_freq, "spikeRatio": round(spike_ratio, 2), "verdict": verdict,
    }


def detect_clicks(mix, threshold_sigma=12.0, window=256):
    diffs = np.abs(np.diff(mix, axis=1))
    power = mix[0] ** 2 + mix[1] ** 2
    kernel = np.ones(window) / window
    local_rms = np.sqrt(np.convolve(power, kernel, mode="same") / 2 + 1e-9)
    local_rms = local_rms[: diffs.shape[1]]
    thresh = np.maximum(threshold_sigma * local_rms, 0.08)
    hits = np.where((diffs[0] > thresh) | (diffs[1] > thresh))[0]
    sample_times = [round(float(h / SR), 4) for h in hits[:20]]
    return int(hits.size), sample_times


PERIODIC_TICK_THRESHOLD = 0.3


def hf_periodicity(mix, lo_ms=150, hi_ms=800):
    """Finds a ticking-clock pattern: short high-frequency bursts that repeat evenly.

    Takes the energy above 5 kHz, smooths it to a 1 ms RMS envelope, and measures how
    strongly that envelope correlates with itself at lags between lo_ms and hi_ms (a
    tick every beat or every eighth note at any tempo from about 75 to 400 bpm). A bed
    with no regular hats or ticks scores near zero (measured 0.03 to 0.18 on clean
    beds); a hat and tick grid scores 0.4 to 0.99. Returns the strongest lag, its
    normalized correlation, and a verdict at PERIODIC_TICK_THRESHOLD.
    """
    mono = mix.mean(axis=0)
    if mono.size < SR * 2:
        return {"peak": 0.0, "lagMs": None, "verdict": "ok", "thresholdPeak": PERIODIC_TICK_THRESHOLD,
                "note": "shorter than two seconds, not measured"}
    high = hp(mono, 5000, 4)
    blk = SR // 1000
    usable = (high.size // blk) * blk
    env = np.sqrt((high[:usable].reshape(-1, blk) ** 2).mean(axis=1))
    # Remove the slow trend (impact and riser decays, section changes) with a 100 ms
    # moving average, so only fast, repeated bursts are left to correlate. Without this
    # a single decaying tail correlates with itself at every short lag.
    trend = np.convolve(env, np.ones(100) / 100, mode="same")
    env = env - trend
    m = env.size
    spec = np.fft.rfft(env, 2 * m)
    ac = np.fft.irfft(spec * np.conj(spec))[:m]
    if ac[0] <= 1e-18:
        return {"peak": 0.0, "lagMs": None, "verdict": "ok", "thresholdPeak": PERIODIC_TICK_THRESHOLD}
    ac = ac / ac[0]
    hi = min(hi_ms, m - 1)
    seg = ac[lo_ms:hi + 1]
    k = int(np.argmax(seg))
    peak = float(seg[k])
    return {
        "peak": round(peak, 3),
        "lagMs": int(lo_ms + k),
        "verdict": "periodic" if peak >= PERIODIC_TICK_THRESHOLD else "ok",
        "thresholdPeak": PERIODIC_TICK_THRESHOLD,
    }


def true_peak_dbtp(mix, oversample=4):
    up = resample_poly(mix, oversample, 1, axis=1)
    peak = float(np.abs(up).max())
    return 20 * np.log10(max(peak, 1e-9))


def per_section_lufs(mix, sections_abs, meter):
    report = []
    for sec in sections_abs:
        a = S(bar_t(sec["startBar"]))
        z = S(bar_t(sec["startBar"] + sec["durationBars"]))
        seg = mix[:, a:z]
        entry = {"label": sec["label"], "startBar": sec["startBar"], "durationBars": sec["durationBars"]}
        if seg.shape[1] < int(0.45 * SR):
            entry["lufs"] = None
            entry["rmsDbfs"] = round(float(20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-12)), 2)
            entry["note"] = "section shorter than pyloudnorm's integration window; rmsDbfs reported instead"
        else:
            try:
                entry["lufs"] = round(float(meter.integrated_loudness(seg.T)), 2)
            except Exception as exc:  # pyloudnorm raises on a few degenerate (near-silent) segments
                entry["lufs"] = None
                entry["note"] = f"integrated_loudness failed: {exc}"
            entry["rmsDbfs"] = round(float(20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-12)), 2)
        entry["peak"] = round(float(np.abs(seg).max()) if seg.size else 0.0, 3)
        report.append(entry)
    return report


def write_spectrogram(mono, out_path):
    fig, ax = plt.subplots(figsize=(10, 4), dpi=130)
    ax.specgram(mono, NFFT=2048, Fs=SR, noverlap=1536, cmap="magma")
    ax.set_xlabel("time (s)")
    ax.set_ylabel("frequency (Hz)")
    ax.set_ylim(0, 12000)
    ax.set_title("compose_score diagnostic spectrogram (scipy/matplotlib, not ffmpeg)")
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


# ============================================================== main
def main():
    if len(sys.argv) < 2:
        print("usage: python compose-score.py <spec.json>", file=sys.stderr)
        return 2
    spec_path = sys.argv[1]
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)

    global BPM, BEAT, BAR, N, rng, B, TONIC_PC, MODE, PERCUSSION

    PERCUSSION = spec.get("percussion", "none")
    if PERCUSSION not in ("none", "full"):
        raise ValueError(f'percussion "{PERCUSSION}" must be "none" or "full"')
    BPM = float(spec["bpm"])
    BEAT = 60 / BPM
    BAR = 4 * BEAT
    TONIC_PC, MODE = parse_key(spec["key"])

    sections_in = spec["sections"]
    sections_abs = []
    bar_cursor = 0
    for s in sections_in:
        sections_abs.append({"label": s["label"], "startBar": bar_cursor, "durationBars": int(s["bars"])})
        bar_cursor += int(s["bars"])
    nbars_total = bar_cursor
    dur = nbars_total * BAR
    N = int(round(dur * SR))
    rng = np.random.default_rng(int(spec.get("seed", 7)))
    B = {k: bus() for k in BUS_NAMES}
    KICK_TIMES.clear()

    mode_default_lufs = -14.0 if spec.get("mode") == "music" else -15.0
    target_lufs = float(spec.get("targetLufs", mode_default_lufs))
    true_peak_max = float(spec.get("truePeakMaxDbtp", -1.0))

    # ---- arrangement
    for sec in sections_abs:
        roles = role_sequence(MODE, sec["label"], sec["durationBars"])
        RENDERERS[sec["label"]](sec["startBar"], sec["durationBars"], roles)

    impacts_abs = []
    for imp in spec.get("impacts", []):
        at_bar = int(imp["atBar"])
        at_beat = float(imp.get("atBeat", 0))
        t0 = bar_t(at_bar, at_beat)
        label = imp.get("label") or "impact"
        impact(t0, 0.95)
        riser(t0, BAR * 0.9, 0.55)
        impacts_abs.append({"label": label, "atBar": at_bar, "atBeat": at_beat, "atSeconds": round(t0, 3)})

    # ---- sidechain ducking, built from the kicks that actually played
    kick_env = np.ones(N)
    for t0 in KICK_TIMES:
        i = S(t0)
        L = min(S(BEAT), N - i)
        if L <= 0:
            continue
        t = np.arange(L) / SR
        kick_env[i:i + L] = np.minimum(kick_env[i:i + L], 1 - 0.55 * np.exp(-t / 0.11))

    # ---- filter automation, driven by each section's label
    pad_cut = [(0.0, PAD_CUTOFF[sections_abs[0]["label"]])]
    arp_cut = [(0.0, ARP_CUTOFF[sections_abs[0]["label"]])]
    for sec in sections_abs:
        t0 = bar_t(sec["startBar"])
        pad_cut.append((max(t0, pad_cut[-1][0] + 1e-3), PAD_CUTOFF[sec["label"]]))
        arp_cut.append((max(t0, arp_cut[-1][0] + 1e-3), ARP_CUTOFF[sec["label"]]))
    pad_cut.append((dur, min(900, PAD_CUTOFF[sections_abs[-1]["label"]])))
    arp_cut.append((dur, min(1400, ARP_CUTOFF[sections_abs[-1]["label"]])))
    B["pad"] = auto_lp(B["pad"], pad_cut)
    B["arp"] = auto_lp(B["arp"], arp_cut)

    # ping-pong delay on arp (dotted eighth), unchanged DSP
    d = S(BEAT * 0.75)
    if d > 0:
        dl = np.zeros_like(B["arp"])
        src = lp(B["arp"], 3000)
        for k in range(1, 6):
            g = 0.38 ** k
            ch = k % 2
            seg = src.mean(axis=0) * g
            dl[ch, d * k:] += seg[: N - d * k]
        B["arp"] = B["arp"] + dl

    GAIN = {"pad": 0.2, "bass": 0.2, "sub": 0.13, "arp": 0.17, "lead": 0.17, "bell": 0.19, "str": 0.12,
            "kick": 0.46, "clap": 0.3, "hat": 0.17, "tick": 0.17, "fx": 0.22, "impact": 0.42}
    SIDECHAIN = {"pad": 1.0, "bass": 1.0, "sub": 0.9, "arp": 0.5, "lead": 0.35, "str": 0.6}
    SEND = {"pad": 0.25, "arp": 0.35, "lead": 0.35, "bell": 0.55, "clap": 0.28, "str": 0.4,
            "tick": 0.25, "impact": 0.35, "fx": 0.3, "hat": 0.08}

    dry = np.zeros((2, N))
    send = np.zeros((2, N))
    for k, v in B.items():
        x = v * GAIN[k]
        if k in SIDECHAIN:
            x = x * (1 - SIDECHAIN[k] * (1 - kick_env))
        dry += x
        send += x * SEND.get(k, 0)

    irn = S(3.0)
    t = np.arange(irn) / SR
    ir = rng.standard_normal((2, irn)) * np.exp(-t * 6.9 / 2.4)
    ir = lp(ir, 6500)
    ir[:, : S(0.012)] = 0
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    wet = np.vstack([fftconvolve(send[0], ir[0])[:N], fftconvolve(send[1], ir[1])[:N]]) * 0.9
    mix = hp(dry + wet, 28)

    # ---- master: gentle glue + soft clip + loudness, same loop as the reference
    meter = pyln.Meter(SR)
    for _ in range(3):
        lufs = meter.integrated_loudness(mix.T)
        mix *= 10 ** ((target_lufs - lufs) / 20)
        mix = np.tanh(mix * 1.1) / 1.1

    # ---- true-peak limiting (new: the reference only clamped sample peak at 0.93;
    # this measures true peak via 4x oversampling and scales down to the real target)
    for _ in range(4):
        tp = true_peak_dbtp(mix, oversample=4)
        if tp <= true_peak_max:
            break
        mix *= 10 ** ((true_peak_max - tp) / 20) * 0.995

    fade = S(min(2.5, dur * 0.15))
    if fade > 1:
        mix[:, -fade:] *= np.linspace(1, 0, fade) ** 1.5

    lufs_final = float(meter.integrated_loudness(mix.T))
    peak_final = float(np.abs(mix).max())
    tp_final = true_peak_dbtp(mix, oversample=4)

    # ---- cue grid, exact by construction (every hit above was placed at an exact sample)
    beats_grid = [round(i * BEAT, 3) for i in range(int(dur / BEAT) + 1) if i * BEAT <= dur + 1e-9]
    bars_grid = [round(bar_t(b), 3) for b in range(nbars_total + 1)]

    click_count, click_times = detect_clicks(mix)
    tick_check = hf_periodicity(mix)
    band_balance = band_energy_balance(mix.mean(axis=0))
    section_lufs = per_section_lufs(mix, sections_abs, meter)

    out_wav = spec["outWav"]
    out_cues = spec["outCues"]
    out_spec = spec["outSpectrogram"]
    os.makedirs(os.path.dirname(out_wav) or ".", exist_ok=True)
    os.makedirs(os.path.dirname(out_cues) or ".", exist_ok=True)
    os.makedirs(os.path.dirname(out_spec) or ".", exist_ok=True)

    sf.write(out_wav, mix.T.astype(np.float32), SR, subtype="PCM_24")
    write_spectrogram(mix.mean(axis=0), out_spec)

    cues = {
        "track": spec.get("trackName", os.path.basename(out_wav)),
        "bpm": BPM,
        "key": spec["key"],
        "mode": spec.get("mode", "bed"),
        "percussion": PERCUSSION,
        "bars": nbars_total,
        "durationSeconds": round(dur, 3),
        "beats": beats_grid,
        "strongCues": bars_grid,
        "sections": [
            {
                "label": s["label"], "startBar": s["startBar"], "durationBars": s["durationBars"],
                "startSeconds": round(bar_t(s["startBar"]), 3),
                "endSeconds": round(bar_t(s["startBar"] + s["durationBars"]), 3),
            }
            for s in sections_abs
        ],
        "impacts": impacts_abs,
        "lufsIntegrated": round(lufs_final, 2),
        "lufsTarget": target_lufs,
        "peakSample": round(peak_final, 3),
        "truePeakDbtp": round(tp_final, 2),
        "truePeakMaxDbtp": true_peak_max,
        "checks": {
            "bandBalance": band_balance,
            "clickCount": click_count,
            "clickSampleTimes": click_times,
            "percussionTick": tick_check,
            "perSectionLufs": section_lufs,
        },
        "spectrogramPath": out_spec,
        "licence": "Pure synthesis, no samples. No attribution or licence obligation.",
        "source": "generated",
        "generatedBy": "packages/mcp-server/scripts/compose-score.py",
    }
    with open(out_cues, "w", encoding="utf-8") as f:
        json.dump(cues, f, indent=1)

    print(f"wrote {out_wav} ({dur:.2f}s, {nbars_total} bars @ {BPM}bpm, {spec['key']})")
    print(f"LUFS {lufs_final:.2f} (target {target_lufs}), true peak {tp_final:.2f} dBTP, sample peak {peak_final:.3f}")
    print(f"band balance: low {band_balance['lowPct']:.1f}% mid {band_balance['midPct']:.1f}% high {band_balance['highPct']:.1f}% ({band_balance['verdict']})")
    print(f"clicks detected: {click_count}")
    print(f"periodic hf transients: autocorrelation {tick_check['peak']} at {tick_check['lagMs']}ms ({tick_check['verdict']})")
    for entry in section_lufs:
        lufs_str = f"{entry['lufs']:.2f} LUFS" if entry["lufs"] is not None else f"{entry['rmsDbfs']:.2f} dBFS (rms)"
        print(f"  section {entry['label']:8s} bars {entry['startBar']:3d}-{entry['startBar']+entry['durationBars']:<3d} {lufs_str}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        # Leave no partial output behind: remove whatever this run may have already written.
        try:
            with open(sys.argv[1], "r", encoding="utf-8") as f:
                spec = json.load(f)
            for key in ("outWav", "outCues", "outSpectrogram"):
                p = spec.get(key)
                if p and os.path.exists(p):
                    os.remove(p)
        except Exception:
            pass
        sys.exit(1)

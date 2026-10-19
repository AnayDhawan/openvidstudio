# Credits for public/sfx/

A rendered video carries no attribution duty from anything here and no content ID.
Four different sources, so all four are recorded.

## Synthesized in this repo

`bell.wav`, `blip.wav`, `success.wav`, `whoosh.wav` and `music-bed.mp3`
come from `scripts/gen-sfx.sh` (ffmpeg, sine and anoisesrc). No sampled or
licensed material went into any of them.

## Mixkit

`click.wav` is "Fast double click on mouse" (Mixkit sound effect 275,
https://mixkit.co/free-sound-effects/click/), supplied by the project owner on 2026-10-19 to
replace a 30 ms synthesized tick. Trimmed to the two clicks (the first lands on the cue frame),
mixed to mono, 48 kHz 16-bit PCM like the rest of the pack, and raised 1.5 dB so its peak is
-1.5 dBFS. Licence: the Mixkit Sound Effects Free License, https://mixkit.co/license/#sfxFree.
Using it in a rendered video needs no attribution. The licence text could not be read when
this file was added, so confirm its terms on redistribution before republishing this pack as
a sound library on its own (a fork that only ships the video tool is a different thing).
Replace it with a synthesized or CC0 click and `click.wav` stops being the only licensed file here.

## Copyright-free recording

`typing-effect.mp3` is a recording of typing, committed as-is. It replaced the four
synthesized key sounds, which sounded like a metronome one sample per character.

## CC0, from Kenney

| File | Original |
|---|---|
| `bong.wav` | Kenney Interface Sounds, `interface/bong_001.ogg` |
| `click_soft.wav` | Kenney Interface Sounds, `interface/click_001.ogg` |
| `drop.wav` | Kenney Interface Sounds, `interface/drop_001.ogg` |

Source: https://kenney.nl. Kenney's asset packs are released under CC0 1.0 (public
domain): https://creativecommons.org/publicdomain/zero/1.0/. Commercial use is allowed
and attribution is not required; this file exists so the provenance is on record, not
because the licence asks for it.

Converted from Vorbis .ogg to 48 kHz mono 16-bit PCM .wav to match the rest of the pack.
CC0 permits the format change.

## Adding your own

Anything you bring in from elsewhere goes in `public/imported_audios/`, not here, so it
stays obvious which sounds carry terms. `plan_sound_effects` enforces that split and
writes an `ATTRIBUTION.md` next to whatever it fetches.

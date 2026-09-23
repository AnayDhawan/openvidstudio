# Credits for public/sfx/

Everything here is free of licence obligations: no attribution required, no content ID,
nothing to breach. Three different reasons for that, so all three are recorded.

## Synthesized in this repo

`bell.wav`, `blip.wav`, `click.wav`, `success.wav`, `whoosh.wav` and `music-bed.mp3`
come from `scripts/gen-sfx.sh` (ffmpeg, sine and anoisesrc). `pulse-bed.mp3` and its
`pulse-bed.cues.json` come from `scripts/generate-pulse-bed.mjs`. No sampled or
licensed material went into any of them.

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

# NARRATION.md: voice, music and sound

Narration used to be entirely the caller's problem. It is not any more:
`generate_narration` reads `beats.json` and writes one clip per beat to the path
`stitch_composition` already looks in. This doc covers what that tool does, what it
deliberately refuses to do, and why generated voiceover usually sounds synthetic.

## The short version

```
generate_narration  ->  public/audio/vo/<beatId>.mp3
stitch_composition  ->  picks them up automatically
```

## Why generated voiceover sounds like a robot

Rarely the engine. Almost always the stretching.

Every engine reads at its own pace, so a clip rarely lands exactly on its beat. The
obvious fix is to time-stretch it to fit. A pitch-preserving stretch past roughly ten
percent is audible, and past twenty it is the drawly, processed sound people mean by
"AI voice". Building the openvidstudio demo, one beat was stretched to **0.645**, a
35 percent slowdown, and that single clip was most of why the whole video sounded
synthetic.

So `generate_narration` clamps stretching to **0.9 to 1.12**. When a line still does
not fit, it says so and names the beat rather than mangling it, because the real fix
is one of:

- **Too short for the beat.** Add a sentence, or shorten the beat.
- **Too long for the beat.** Cut words, or lengthen the beat.

Both are edits to `beats.json`, which is yours to change. Stretching audio to hide a
mismatch trades a timing problem for an audible one.

## Pace

`validate_beats` enforces SCRIPT.md's 2.3 to 2.9 words per second as a hard floor and
ceiling, per beat. It is a floor as well as a ceiling, so a beat can be rejected for
being too sparse, which is not the failure most people expect.

`plan_beats` gives you the word budget per beat up front, so narration is written to
a number instead of guessed and revised.

The word budget is an estimate. A real voice reads plain prose at about 3 words per
second and number-heavy lines nearer 2.2, so after `generate_narration` read each clip's
`spokenSeconds` and size the beat from that (SUPERNOVA.md, "Fit the beats to the voice").
Then regenerate with `overwrite: true`.

## Engines

| Engine | Quality | Speed | Runs locally |
|---|---|---|---|
| `edge-tts` (default; `preflight` synthesizes one word to check it, because Microsoft refused 7.2.8 with a 403 in October 2026 and `pip install -U edge-tts` fixes it) | good | about a minute for five minutes of speech | no, sends text to Microsoft |
| `say` (macOS) | fair | instant | yes |
| `espeak` | poor | instant | yes |

`edge-tts` needs `pip install edge-tts`. When a line comes back with "no usable audio", the warning ends with the last error line edge-tts printed.

**If the text must not leave the machine**, use `say` on macOS, or wire up a local
neural model. A local model on CPU is slow: one measured at a real time factor of
41.9x, meaning six minutes of compute for nine seconds of audio, or about three and
a half hours for a five minute video. Fine overnight, not fine in a loop.

**If you want it to sound genuinely good**, record it yourself. A real voice beats
every engine here, and for a launch video it is worth the hour.

## Word timings

A scene that points at the word being spoken (a Supernova lesson's Spark landing on "slope" as the voice
says it) needs to know when each word starts. With the `edge-tts` engine, `generate_narration` also writes
`public/audio/vo/<beatId>.words.json` next to each clip (`public/audio/vo/<lang>/<beatId>.words.json` for
another language):

```json
[{ "word": "A", "startMs": 100, "endMs": 137 }, { "word": "slope", "startMs": 150, "endMs": 475 }]
```

- The times are in the clip **as written**. The clip is fitted to its beat with a stretch of 0.9 to 1.12, and
  every time is divided by the same factor, so the words stay on the audio.
- They come from the service's own word-boundary events, read through the `edge_tts` Python module (the
  `edge-tts` command only writes sentence-level subtitles). `pip install edge-tts` into the interpreter
  `python3` points at, or the one the `edge-tts` command was installed into, is enough. If neither can
  import it, the clips are still made from the command line and the result's `wordTimings.note` says no
  timings were written.
- The first word starts a little after 0 and the clip carries a short tail of silence after the last word
  (about 0.4 seconds), so the last `endMs` is within that tail of the clip's length, not exactly at it.
- **Other engines** (`say`, `espeak`, `omnivoice`) give no word boundaries. Nothing is written and nothing is
  invented; `wordTimings` says so.
- A clip that already exists is skipped unless `overwrite` is set, and so is its words file.

`stitch_composition` copies the files into `src/videos/<video>/narration.words.json` (a scene bundle can import
JSON from `src/` but not from `public/`) and mounts them, per language, the way it mounts the music cues. A
composition with no word timings is exactly what it was. In a scene:

```tsx
const narration = useNarrationWords("hook");   // inside the "hook" beat's scene
const said = narration.wordAt(frame);          // { index, word: { word, startMs, endMs }, speaking } or null
const at = narration.frameOfWord(3);           // scene-local frame the fourth word starts on
```

`wordAt` gives the word being said, or in a pause the last one said (`speaking` is then false), and `null` before
the first word. `available` is false for a beat with no timings.

## Silence is silent

`stitch_composition` skips a missing `public/audio/vo/<beatId>.mp3` with no error and
no warning. A half generated narration renders successfully and simply plays silent
in those beats.

Two things catch it:

- `generate_narration` reports which beats have audio and which do not
- `validate_scenes` flags every beat with no narration file

Neither is optional if you care whether the video has a voice.

## Music and sound effects

Most of it ships synthesized, generated by `scripts/gen-sfx.sh` with ffmpeg. Three
exceptions: `typing-effect.mp3` is a copyright-free recording, three sounds are CC0
public domain from [Kenney](https://kenney.nl), and `click.wav` is a Mixkit recording.
`public/sfx/CREDITS.md` says which file is which. Either way **a rendered video carries
no audio obligations**: no attribution, no content ID.

| File | Sound |
|---|---|
| `typing-effect.mp3` | 8s of steady typing, played across each typed run (a recording, not synthesized) |
| `click.wav` | Cursor click: a recorded double click (Mixkit, see `public/sfx/CREDITS.md`) |
| `click_soft.wav` | Rounder, quieter click (CC0, Kenney) |
| `whoosh.wav` | Camera move or cut |
| `blip.wav` | UI reveal |
| `bong.wav` | Warm mallet accent for a reveal (CC0, Kenney) |
| `drop.wav` | Low thud for something landing in place (CC0, Kenney) |
| `success.wav` | Rising two tone |
| `bell.wav` | Struck harmonic stack, long decay |
| `music-bed.mp3` | 60s ambient pad, loops |

Regenerate any of them by editing `scripts/gen-sfx.sh` and running it. The
`sfx.tsx` API does not change, so you can swap in a recorded pack later without
touching a scene.

### Bringing in a sound the built-in pack doesn't cover

Drop the file into `public/imported_audios/`, kept separate from `public/sfx/` so
it's always obvious which sounds carry licence terms and which don't. Reference it
from a scene with `staticFile("imported_audios/<filename>")`.

`plan_sound_effects` automates the search-and-checklist part of this: tell it what
the video needs, and it checks the built-in pack first, then returns a Pixabay
search link and the exact filename to save for anything genuinely missing (or
fetches it automatically via Freesound, given your own API token). Either way, the
file lands in `public/imported_audios/`, and anything carrying a licence gets
written to `ATTRIBUTION.md` there, which belongs in the video description.

### Using the music bed

```tsx
import { MusicBed } from "@openvidstudio/core";

<MusicBed durationInFrames={9000} volume={0.16} />
```

Keep it quiet. It sits under narration, and 0.16 is already at the edge of noticeable
when a voice is speaking over it.

### If you want real music instead

`find_music_bed` searches two CC0-1.0 catalogs, [open-lofi](https://github.com/btahir/open-lofi)
(166 lo-fi tracks with real category metadata) and
[CC0-1.0-Music](https://github.com/SoundSafari/CC0-1.0-Music) (~9,200 tracks aggregated
from freepd, chosic, Free Music Archive, freesound and Pixabay). Query it with mood
words, pick from the candidates, then:

```
import_music_bed(id: "lofi:terminal-rain", out: "public/audio/music-bed.mp3", seconds: 45, start: 12)
```

That downloads the track, trims it from `start`, fades both ends, normalizes to -20 LUFS
so it sits under narration, and writes a `<file>.source.json` plus a `MUSIC-SOURCES.md`
row recording where it came from. Both catalogs are public domain, so that record is
provenance, not an attribution requirement. `stitch_composition` picks up
`public/audio/music-bed.mp3` automatically, same as narration.

Nothing is vendored into the package: open-lofi publishes only a 554MB release zip, and
an import reads that zip's directory over HTTP range requests to fetch the few MB of the
one track. The catalog index caches at `output/music-index.json`.

Bringing a file by hand still works. Pixabay Music and the YouTube Audio Library are both
no-attribution; drop the file at `public/audio/music-bed.mp3` yourself.

### Composing an original score

`find_music_bed` finds a track that already exists. `compose_score` builds one that
didn't: an original score arranged to match the video's own arc, the highest-effort of
the three music options and the one `PLANNING.md`'s peak creative level calls for.

```
compose_score(videoName: "demo")
```

It reads the music plan straight off that video's `brief.json` (bpm, key, the section
arc, the impact points), or takes one directly via the `music` input instead of
requiring a brief. The section arc is the same seven-label vocabulary as everywhere
else in this doc set: intro, tension, reveal, groove, break, peak, outro. Sections have
to be contiguous, each one's `endBar` equal to the next one's `startBar`; a gap or
overlap is rejected before anything is composed, naming exactly which two sections
don't connect.

The actual composition and mastering is a Python engine
(`packages/mcp-server/py/compose-score.py`), not this server: key/harmony, the
arrangement engine, LUFS and true-peak limiting, and a set of automated mix checks
(band energy balance, clicks, per-section loudness) all happen there. `preflight`'s
"compose-score-deps" check confirms a python with numpy, scipy, soundfile, pyloudnorm
and matplotlib importable is available; it's non-blocking, since a video with no
original score still renders.

Writes `public/audio/music-bed.mp3` by default, exactly where `stitch_composition`'s
own auto-detection already looks, so a video that had no music wiring at all before
needs none added after. Pass `outFile` to use a different filename, for A/B-ing two
takes. Alongside the mp3, two more files land next to it: `music-bed.cues.json`, with
`source: "generated"` so `plan_music_cues` treats it as ground truth (an exact beat grid,
not an estimate, so cuts can land on it with no re-analysis step), and
`music-bed.spectrogram.png`, a diagnostic worth opening if a mix check below flags
something.

A `warnings` array in the result surfaces the mastering engine's own checks rather than
leaving them readable only by opening the cues file: a band-balance verdict other than
"ok" (the mix leaning all-bass or all-hiss, say), a detected click, a periodic tick
pattern (see below), a true peak over the limiter's ceiling, or an integrated loudness far
from target.

### Why the score has no drums

Short, bright hits that repeat evenly (a hi-hat on every offbeat, a tick on every beat, a
sixteenth-note pluck that never rests) sound like a clock under a voiceover, whatever
instrument they are played on. `compose_score` therefore defaults to `percussion: "none"`:
no kick, clap, hat or tick, and the bass and arp play uneven rhythms with small timing and
level changes so nothing repeats identically. `percussion: "full"` brings back the old
drum-machine arrangement if you want it.

The check behind that warning measures the energy above 5 kHz, smooths it to a 1 ms
envelope, removes the slow trend, and looks for a repeat between 150 and 800 ms. A clean
bed scores near 0.04; the old arrangement scored 0.8. `finalize_video` runs the same
measurement on the final audio, so a ticking track you brought yourself gets flagged too.

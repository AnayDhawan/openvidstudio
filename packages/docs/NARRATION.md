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
second and number-heavy lines nearer 2.2, so after `generate_narration` run `fit_beats`: it
sizes each beat from the clips' measured `spokenSeconds` (plus a half second pad, clamped into the pace window) and
lists any line that cannot fit. Use `dryRun: true` to see the lengths first. Then regenerate with `overwrite: true`.

### Pace by language

The 2.3 to 2.9 words per second is an English number. A voice in another language packs a
different number of whitespace-separated words into a second, so the band moves with the
language. Three languages are measured, each on one voice, the voice in its row:

| Language | Voice | Median words/sec | r | Band (words/sec) | Render verified |
|---|---|---|---|---|---|
| English | `en-US-AndrewNeural` | 3.445 | 1 | 2.3-2.9 (unchanged) | not part of this check |
| Hindi (`hi`) | `hi-IN-MadhurNeural` | 2.732 | 0.7929 | 1.8-2.3 | 2026-11-25, edge-tts 7.3.1, Remotion 4.0.543: passed |
| Spanish (`es`) | `es-ES-AlvaroNeural` | 3.227 | 0.9367 | 2.2-2.7 | 2026-11-25, edge-tts 7.3.1, Remotion 4.0.543: passed |
| German (`de`) | `de-DE-ChristophNeural` | 2.768 | 0.8033 | 1.8-2.3 | 2026-11-25, edge-tts 7.3.1, Remotion 4.0.543: passed |

Each band was measured on the voice in its row. A different voice may read faster or slower, and then the
band is a rougher guide.

**Render verified** means a 3-beat, 16.6 second draft with the language's own narration, rendered through
`stitch_composition` with `languages: ["hi", "es", "de"]` and `render_video` with that language's
`compositionId`, and then `validate_scenes` with `render: true` on the same composition. Each of the three
passed with no errors, 3 of 3 beats measured and no `render-skipped` finding (a pass with skipped render checks
is not a pass). The only findings were three `text-size` warnings per language, from the browser frame's
address pill. Tool versions: `@openvidstudio/mcp-server` 2.0.0, edge-tts 7.3.1, Remotion 4.0.543.

- Hindi: `hi-IN-MadhurNeural`, the base language of the test project (clips at `public/audio/vo/<beatId>.mp3`).
  Passed `validate_scenes` on `PolyDemo`.
- Spanish: `es-ES-AlvaroNeural`, clips at `public/audio/vo/es/`. Passed `validate_scenes` on `PolyDemoEs`.
- German: `de-DE-ChristophNeural`, clips at `public/audio/vo/de/`. Passed `validate_scenes` on `PolyDemoDe`.

### Languages in a render

One `beats.json` carries the base language in `vo` and the others in `voTranslations`. `generate_narration`
takes `languages`, `baseLanguage` and `voices` (name the voice from the table for every language, or the
English default reads the line). `stitch_composition` takes the same `languages` and `baseLanguage` and writes
one composition per language over a single scene tree: `<Name>Demo` for the base language and
`<Name>Demo<Lang>` for each other one (`PolyDemoEs`). `render_video` and `validate_scenes` pick the cut with
`compositionId`.

What the cut per language does not do, found while verifying the three languages above:

- **Captions do not follow the language.** A caption is written into the scene file by `scaffold_scene` from
  the base `vo`, and every language composition shares those scenes, so the Spanish cut of a Hindi project
  shows the Hindi caption over Spanish narration. Only the audio changes per language. For captions in each
  language, scaffold the scenes of a project whose base language is that language.
- **`fit_beats` sizes against the base language only.** Its word count comes from `vo`, so the beat lengths
  fit the base language's clips. The other languages share those lengths: check each language's `tempo` and
  `needsAttention` in `generate_narration`'s per-language report, and lengthen a beat or shorten a line for any
  that overrun. In the test project the Spanish and German clips fitted a Hindi-sized beat except one
  Spanish line that ran 0.04 s past it.
- **`validate_scenes` looks for narration at the base path only** (`public/audio/vo/<beatId>.mp3`), so a
  missing `es` clip is reported by `stitch_composition` (`voBeatsMissing` per language), not by `validate_scenes`.

### Captions in each script

`Caption` draws with the stack `Inter, -apple-system, Segoe UI, Roboto, sans-serif`, and the template bundles
the Latin subset of Inter only. Checked by rendering stills and asking Chrome which font drew each run
(2026-11-25, Windows 11):

| Script | Result |
|---|---|
| Spanish (`ñ á é í ó ú ü ¡ ¿`) | Correct. All 73 glyphs of the test line come from the bundled Inter. |
| German (`ä ö ü ß Ä Ö`) | Correct, including a 34 letter compound word in a 640 px column. All 79 glyphs from Inter. |
| Hindi (Devanagari) | Correct: conjuncts (`ज्ञ क्ष त्र ध्व द्यु श्र द्ध`), reph (`ऊर्जा`), nukta (`ज़`), matras and the danda all shaped, no empty boxes. Drawn by a **system** font (Nirmala UI on Windows), not a bundled one. |

Hindi captions therefore depend on the machine having a Devanagari font. Windows and macOS ship one. A Linux
machine needs one installed (for example the `fonts-noto-core` package) before a render, or the caption shows
empty boxes. That case was not rendered here. Spanish and German need nothing beyond the bundled Inter.

`captionLine` picks the first whole sentence of a long `vo` as the caption, and a sentence ends at `.`, `!`,
`?`, or the Devanagari danda (`।`) or double danda (`॥`), so a long Hindi line is cut at the end of a sentence
and not partway through the next one.

Measured 2026-11-25 with edge-tts 7.3.1, on 12 parallel narration-style sentences of 10 to 30 words
(`packages/mcp-server/scripts/fixtures/pace-corpus.json`), one synthesis per sentence at the voice's
default rate. The corpus includes one number-heavy sentence (years and counts), which is the slowest of the
twelve in all four languages, so the median, not the mean, is used. For each sentence the spoken span is the last word's end minus the first word's start from
`py/edge-words.py`, so the silence edge-tts adds at both ends of a clip does not bias the rate, and words are
whitespace-separated tokens, the rule `validate_beats` counts with. Every number is in
`scripts/fixtures/pace-measurements.json`; `node scripts/measure-language-pace.mjs` repeats the measurement
(it needs network access to Microsoft's speech service).

The formula, with `r` the language's median words/sec over English's median on the same corpus:

```
band = [round1(2.3 * r), round1(2.9 * r)]
```

`round1` rounds to one decimal. The English median (3.445) is above 2.9 because these spans leave out the
silence at both ends of a clip while the band is checked over a whole beat, pad included, so only the ratio
between languages carries over.

`de-DE-ConradNeural` is not in `edge-tts --list-voices` today; the service accepts the name but it is not a
listed voice, so the German band was measured with `de-DE-ChristophNeural`.

Where the band is used:

- Set `language` (a BCP-47 tag; `hi-IN` is read as `hi`) on `plan_beats` and `generate_script`, and the word
  budgets use that band. `generate_script` also writes it to `beatsJson.language`.
- A top-level `language` in `beats.json` makes `validate_beats` hold each beat's `vo` to that band, and
  `fit_beats` size beats into it (its `language` input overrides the file).
- Each `voTranslations` line is checked against its own tag's band. A miss is a warning, never an error,
  because `generate_narration` is where an overrun is decided.
- Any other language gets the English band, and a warning says there is no measured band for it (one warning
  per language, not per beat). Add a language by adding its voice and 12 sentences to the corpus, running the
  script, and pinning the new `r` in `src/languagePace.ts` and `language-pace.test.mjs`.
- `zh`, `ja`, `th`, `km`, `lo` and `my`, and the three-letter codes of the same scripts (`yue`, `cmn`, `zho`,
  `jpn`, `tha`, `khm`, `lao`, `mya`), are written without spaces, so a words-per-second band does not
  apply. `plan_beats`, `generate_script` and `fit_beats` refuse them, and `validate_beats` skips the pace check
  with a warning. Plan those beat lengths by hand from a measured clip.

The band says nothing about which voice `generate_narration` uses. `baseLanguage` only decides which text is
the base `vo` and where the clips go, and without `voices` the edge-tts voice is `en-US-AndrewNeural` (or
`voice`, if you pass one) for every language. Pass `voices` with the voice from the table, for example
`{ "hi": "hi-IN-MadhurNeural" }`; the band is measured for that voice and another voice may read faster or
slower. If you choose another voice, `fit_beats` sizes the beats from its real clips, which is what to trust
over the table.

## Engines

| Engine | Quality | Speed | Runs locally |
|---|---|---|---|
| `edge-tts` (default; `preflight` synthesizes one word to check it, because Microsoft refused 7.2.8 with a 403 in October 2026 and `pip install -U edge-tts` fixes it) | good | about a minute for five minutes of speech | no, sends text to Microsoft |
| `say` (macOS) | fair | instant | yes |
| `espeak` | poor | instant | yes |
| `omnivoice` ([below](#omnivoice-local)) | not rated here; clones a voice, 600+ languages | slow on a CPU: measured at about 35 times real time on one 20-word line, 8-core CPU | yes |

`edge-tts` needs `pip install edge-tts`. When a line comes back with "no usable audio", the warning ends with the last error line edge-tts printed.

**If the text must not leave the machine**, use `omnivoice` (and pass `engine: "omnivoice"`
to `generate_narration`, see below), or `say` on macOS. OmniVoice on a CPU is slow: one
20-word line took about 35 times its audio length to generate on the machine described
below, so budget for long runs or use a GPU.

**If you want it to sound genuinely good**, record it yourself. A real voice beats
every engine here, and for a launch video it is worth the hour.

## OmniVoice (local)

`omnivoice` is a local neural model. The narration text never leaves the machine, it covers 600+
languages with no per-language voice to pick, and it can clone one voice across every language of a
video. Pass `engine: "omnivoice"` to `generate_narration`; the engine input is the only switch.
`generate_narration` does not read `narration.engine` from `openvidstudio.config.json`, so without
the input it uses `edge-tts` and sends the text to Microsoft, whatever the config says.

**Requirements.** Python 3.10 or newer (the package's `requires-python`; omnivoice also needs torch
2.4 or newer), PyTorch, and about 3 GB of disk for the model. Install into a fresh virtual environment:

```
pip install torch torchaudio
pip install omnivoice
```

Add `--index-url https://download.pytorch.org/whl/cpu` to the first line for the CPU-only build. The
measured run below used a CPU-only build (torch 2.13.0+cpu) on Python 3.14.2.

The OmniVoice README has no CPU section. Its pinned lines are two other options: Apple Silicon is
`pip install torch==2.8.0 torchaudio==2.8.0`, and an NVIDIA GPU is
`pip install torch==2.8.0+cu128 torchaudio==2.8.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128`.
It also lists the Intel Arc and `uv` routes.

**PATH.** pip puts the `omnivoice-infer` launcher in the environment's `Scripts` directory on Windows
and `bin` elsewhere. If you do not activate the environment, put that directory on PATH before the MCP
server starts:

```
# PowerShell
$env:PATH = "C:\path\to\omnivoice\.venv\Scripts;$env:PATH"

# macOS, Linux
export PATH="/path/to/omnivoice/.venv/bin:$PATH"
```

With no launcher on PATH, `generate_narration` runs `python -m omnivoice.cli.infer`, then `python3`, so
an interpreter that has omnivoice installed also works.

**Check it.** `preflight` with `engine: "omnivoice"` adds an `omnivoice` check. It passes when
`omnivoice-infer` is on PATH or a python can import `omnivoice`, and otherwise fails without blocking
and prints the install steps above. It does not load the model. With any other engine no `omnivoice`
check runs. If you leave the input out and only `narration.engine` in the config says `omnivoice`,
`preflight` still runs the check but adds a warning to its detail, because `generate_narration` does not
read that setting and needs `engine: "omnivoice"` passed to it as well.

**First run.** The first synthesis downloads `k2-fsa/OmniVoice` from Hugging Face. The cache
(`~/.cache/huggingface/hub/models--k2-fsa--OmniVoice`) was 3,267,472,413 bytes (3.27 GB) on the
machine below. Later runs may still check Hugging Face for a newer version unless `HF_HUB_OFFLINE=1` is
set; the measured runs below set it, and loaded the cached model with no network.

**Speed on a CPU, measured on one 20-word line.** The command, in PowerShell, with the environment's
`Scripts` directory on PATH and nothing else heavy running:

```
$env:HF_HUB_OFFLINE = "1"
$env:PYTHONUTF8 = "1"
omnivoice-infer --model k2-fsa/OmniVoice --text "Today we will look at how a falling object speeds up as it drops toward the ground under gravity alone." --output out.wav
```

The machine: AMD Ryzen AI 7 350, 8 cores and 16 threads, no GPU, Windows 11, Python 3.14.2,
torch 2.13.0+cpu (the CPU build, 8 torch threads), omnivoice 0.2.1.

| Run | Whole command | Start-up and model load | Generation | Audio | Real-time factor (generation) | Real-time factor (whole command) |
|---|---|---|---|---|---|---|
| 1 | 223.79 s | 21.04 s | 202.75 s | 5.86 s | 34.60x | 38.19x |
| 2, straight after | 219.71 s | 16.32 s | 203.39 s | 5.64 s | 36.06x | 38.95x |

The two clips differ in length because sampling is random. Only this one line length was measured, twice.
Both runs spent about 203 s generating for 5.6 to 5.9 s of audio. Whether generation time scales with
the length of the audio, or has a large fixed part, was not tested, so there is no figure here for a
whole video: a per-video estimate would assume it scales, and that assumption is untested. Each line is
its own process, and start-up and model load took 16 to 21 s of the whole command. Upstream's README
quotes a real-time factor as low as 0.025 (40 times faster than real time) on a GPU; that figure is
quoted, not measured here.

**Rendered end to end.** On 2026-11-25 a 3-beat English project of 43 words took its narration from
`generate_narration` with `engine: "omnivoice"` (the venv's `Scripts` directory on PATH, `HF_HUB_OFFLINE=1`).
Three lines, 13.2 seconds of speech, took 730 seconds for the whole call, with the machine also busy building and
testing, so that is a slower factor than the table above. `fit_beats` then resized the beats from the three
clips (501 to 455 frames), and `stitch_composition`, `render_video` (draft) and `validate_scenes` with
`render: true` ran on the result: 3 of 3 beats measured, no `render-skipped` finding, no errors. The mp4 is 15.2
seconds with an AAC track. Without `refAudio` or `instruct` each line gets a voice of the model's choosing, and
the speakers were not compared by ear.

**Choosing the voice.** With no `refAudio` and no `instruct`, the model picks a voice for each call and
sampling is random by default, so lines can sound like different speakers. Set one of these for a
single narrator:

- `refAudio` clones a voice from a clip. Use an absolute path to a 3 to 10 second clip in the same
  language as the lines (a clip in another language gives the lines that language's accent). Give
  `refText`, the clip's transcript, to skip the automatic transcription, which loads a second model.
  With a clip, every language in `languages` is the same voice.
- `instruct` describes a voice with no clip, for example `"female, low pitch, british accent"`. Voice
  design is trained on Chinese and English; other languages can be unstable. If both are given and
  they disagree, the model follows the clip.

**No word timings.** OmniVoice gives no word boundaries, so no `.words.json` files are written and
`wordTimings` says so. See Word timings below.

## Word timings

A scene that points at the word being spoken (a highlight landing on "slope" as the voice
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

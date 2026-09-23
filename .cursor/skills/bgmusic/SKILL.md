---
name: bgmusic
description: Use when a video needs background music beyond the two synthesized beds that ship with openvidstudio, or the user says "find music", "background music", "music bed", "bgm", "the music is boring", "something lo-fi", or asks for a track for a demo, launch or promo video. Searches two CC0 public-domain catalogs, imports one track, and shapes it into a bed. Not for sound effects (plan_sound_effects) and not for voice (generate_narration).
---

# bgmusic

Find a real music bed for a video, from public-domain catalogs, without downloading a
library or owing anyone a credit line.

## When the built-ins are enough

`public/sfx/` already ships two beds and neither costs a request:

- `music-bed.mp3`, a 60s ambient drone. Fine under a short technical walkthrough.
- `pulse-bed.mp3`, 112bpm with an exact cue grid in `pulse-bed.cues.json`. The only
  track where beat-locked cuts are exact rather than estimated, because it was
  synthesized rather than analyzed.

Use them when the video is short, narration-led, or the music only has to not be
silence. Go looking when the video is a launch or promo piece and the bed carries mood.

## The two catalogs

| Source | What | Size |
|---|---|---|
| `lofi` | [btahir/open-lofi](https://github.com/btahir/open-lofi), 166 lo-fi tracks in 10 categories | ~3MB per track |
| `cc0` | [SoundSafari/CC0-1.0-Music](https://github.com/SoundSafari/CC0-1.0-Music), ~9200 tracks from freepd, chosic, Free Music Archive, freesound and Pixabay | 2-15MB per track |

Both are CC0-1.0. Public domain, commercial use fine, no attribution owed, nothing for
the video description. That is why these two are wired in while `plan_sound_effects`
still sends the user to Pixabay by hand for effects.

One caveat worth stating out loud: the corpus is community-aggregated and runs on
takedown requests, so its CC0 claim per track is the maintainer's, not a licence you
have read. For a product video that is fine and the provenance file records the source.
Where a wrong licence would be expensive, stay on `lofi`, which is one author, one
release, one licence statement.

## The flow

```
find_music_bed -> [user auditions] -> import_music_bed -> plan_music_cues -> stitch_composition
```

### 1. find_music_bed

Query with plain mood or scene words: `"calm focus coding"`, `"late night neon"`,
`"warm upbeat"`. Titles and categories are what get matched.

The first call builds an index, about seven GitHub API calls, cached at
`output/music-index.json`. Later searches are a local read. Pass `refresh: true` only
after a catalog publishes a new release.

`lofi` categories are real metadata, so `category: "ambient-lofi"` works. Corpus
tracks have none: a track there is a filename in a folder named after the site it came
from. When nothing matches, the tool returns a plain sample and sets
`matchedQuery: false`. That is a signal to try a word a composer would actually put in
a title, not to give up.

**Let the user pick.** Return three to five candidates with their titles and
categories. Music is taste, and a wrong bed is more noticeable than a wrong font.

### 2. import_music_bed

```
import_music_bed(id: "lofi:terminal-rain", out: "public/audio/music-bed.mp3", seconds: 45, start: 12)
```

What it does beyond downloading: trims `seconds` from `start`, fades in and out, and
normalizes to `-20` LUFS so the bed sits under narration instead of fighting it. Pass
`raw: true` to skip all of that and keep the track as published.

Where to put it:

- `public/audio/music-bed.mp3` for the composition's bed. `stitch_composition` attaches
  that path automatically, so nothing else has to change.
- `public/imported_audios/` (the default) for anything else, which is the folder that
  holds material that did not come from the built-in pack.

It writes `<file>.source.json` and a `MUSIC-SOURCES.md` row beside the track: id, title,
source repo, licence, date. CC0 asks for none of that. It is there so a year later the
provenance of a bed is a file read rather than a guess.

Skip to the middle of a track with `start`. Intros are usually the least useful part,
and a bed that opens on a downbeat needs no editing to feel deliberate.

### 3. plan_music_cues

Call it on the imported file. For any track that is not `pulse-bed.mp3` the grid is
estimated from an onset envelope, so treat it as planning guidance: snap a handful of
major reveals to `strongCues`, not every cut. `docs/STYLE.md` has the tolerances.

## Costs and limits

- Nothing is vendored. open-lofi publishes its tracks only inside a 554MB release zip,
  so an import reads that zip's central directory over HTTP range requests and pulls
  only the chosen member's bytes. The 554MB is never downloaded.
- Shaping a bed needs `ffmpeg` on PATH. `raw: true` does not.
- GitHub's unauthenticated API limit is 60 requests an hour. An index build spends about
  seven. Set `GITHUB_TOKEN` on a machine that rebuilds it often.
- Index cache lives under `output/`, which a scaffolded project already gitignores.

## What not to do

- Do not commit a whole catalog into a project. One bed per video is the unit here.
- Do not put a track in `public/sfx/`. That folder is the pack that ships with the
  package, and `public/sfx/CREDITS.md` says what is in it and why it carries no terms.
- Do not use this for sound effects. `plan_sound_effects` checks the built-in pack
  first and only then goes looking, which is the right order for effects.

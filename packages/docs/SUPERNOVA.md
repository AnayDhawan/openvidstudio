# SUPERNOVA.md: short animated lessons

Supernova is openvidstudio's second kind of production: a STEM concept explained in up to two minutes, vertical
(1080x1920), narrated and captioned, with a script first and pictures that illustrate it. It is a production
**mode** (`production.mode: "supernova"`), not a fourth creative level. The process is the `supernova` skill; the
script rules are in [SCRIPT.md](SCRIPT.md); the primitives are in [API.md](API.md).

Make a lesson project with `init_project` and `mode: "supernova"`. It stores the mode, defaults the frame to
1080x1920, and installs `@openvidstudio/stem`, its display font and the maths renderer.

## One concept in up to two minutes, a series for a big topic

A lesson teaches one thing and takes **at most two minutes**. A big topic is a short series ("Part 2 of
4") and each part ends on the question the next one answers. Every lesson has the same seven-beat shape
(hook, picture, set up, derive, use it, aha, close), written out with times and rules in
[SCRIPT.md](SCRIPT.md#the-arc), so a viewer, and a series, can rely on it.

## The concept card

`src/videos/<name>/concept.json`, next to `beats.json`. `check_script` reads it, and `validate_scenes` lets the
numbers in its worked example appear on screen.

```json
{
  "goal": "tell why a derivative is a slope",
  "terms": ["slope", "derivative"],
  "example": "a ball rolling down a hill, followed for one second",
  "reference": "Calculus 5.1",
  "referenceSpoken": "calculus, topic five point one",
  "maxSeconds": 120
}
```

`goal` is what the viewer can do afterwards, `terms` the two or three that need defining, `example` the one worked
example the lesson keeps coming back to, with its real numbers. `reference` is where the lesson sits (a syllabus
chapter, "Part 2 of 4"), `referenceSpoken` is how it is said, and the opening beat has to say it. Both are
optional. `maxSeconds` is the length budget (default 120). A worked example, projectile motion:

```json
{
  "goal": "work out how far and how high a launched ball goes, from its speed and angle",
  "terms": ["projectile", "range"],
  "example": "a ball launched at 20 m/s at 30 degrees, with g = 9.81 m/s squared: it flies for 2.04 s, lands 35.3 m away and peaks at 5.1 m",
  "reference": "Kinematics, part 1 of 2",
  "referenceSpoken": "kinematics, part one of two"
}
```

Its script, in the shape SCRIPT.md asks for (each beat's duration comes from the measured voice, see
NARRATION.md):

| Beat | Narration |
|---|---|
| hook | How far does a thrown ball go? This is kinematics, part one of two. Throw it harder and it goes farther. But how much farther? |
| picture | Picture a ball leaving your hand at an angle. A ball in flight like this is called a projectile. It rises, slows and falls. |
| set-up | Say it leaves at a speed v and an angle theta. Ignore the air. Gravity pulls it down at g, and nothing pulls it sideways. |
| derive | Split the launch in two. Sideways, x equals v cosine theta times t. Upward, y equals v sine theta times t, minus a half g t squared. It lands when y is zero again, at t equals two v sine theta over g. |
| use-it | Use twenty metres a second at thirty degrees. That is two point oh four seconds in the air. The range is how far it lands: thirty-five point three metres. |
| aha | Now change the angle. Forty-five degrees gives the longest range, and two angles that add to ninety land in the same spot. |
| close | So: two separate motions, one steady, one pulled by gravity. At the very top of the path, what is the ball's acceleration? |

This is a worked example of the format, not a lesson that has been built and listened to.

## Design: Void + Spark

The idea: **light is meaning.** Everything is dark and flat except the one thing the viewer must look at.

| Token | Value |
|---|---|
| Void | `#07060B`, panels `#0E0C16`, hairline grid at 5% white |
| Text | warm white `#F3EFE6` (never pure white), dim `#8C8799` |
| Math | blue giant `#5CC8FF` |
| Physics | solar amber `#FFB347`, ember `#FF7A3D` |
| CS | nebula violet `#B58CFF` |
| Chemistry | red dwarf `#FF4D5E` |
| Biology | aurora `#7CFFB2` |

One accent per subject, so a profile grid of lessons reads as a spectrum. `supernovaDesignSystem(subject)` builds it:
`export const design = supernovaDesignSystem("physics")`. The display face is Space Grotesk, the body face Inter, both from
local files. Equations are in sans-serif maths (MathJax with the Fira font; the comparison with KaTeX is in API.md).

**Glow budget: one glowing element at a time.** The Spark is one; a Nova's flash is one. `validate_scenes` (render
mode) counts them: more than one is a warning, more than two an error, except in a beat that holds a Nova.

## The primitives

All in `@openvidstudio/stem`, documented with stills in [API.md](API.md#supernova-openvidstudiostem):

- `Spark`: the pen, the pointer and the particle. Traces curves, carries a value along a function, orbits, splits,
  falls under gravity, walks pointers through arrays.
- `Nova`: the payoff, once per video, on the aha sentence. Silence, a three-frame flash, a shockwave ring, the result
  condenses from particles.
- `Axes`, `Plot`, `NumberLine`: graphs, tangents, shaded area, intervals.
- `Equation`: sans-serif maths revealed term by term, with a required `spoken` form that must match the narration.
- `FreeBody`: forces as arrows whose length is exactly magnitude times the scale shown.
- `ArrayViz`: cells, named pointers, a lit range and a dimmed one, a Spark-driven pointer.
- `useNarrationWords(beatId)` (in core): when each word of the narration is said, so the Spark can point at it.

One idea on screen at a time, at most two things moving.

## The voice

One fixed voice for the handle, so a viewer knows it by ear and lessons can be made in any order.

| | |
|---|---|
| Engine | `edge-tts` 7.3 or newer (fast, and it gives word timings). It sends the script text to Microsoft, which is fine for public lesson scripts. Version 7.2.8 was refused with a 403 in October 2026: `pip install -U edge-tts` fixes it |
| Voice | `en-US-AndrewNeural` |
| Rate | the engine's default, `+0%`. Pace comes from the script (2.3 to 2.9 words per second); the stretch is clamped to 0.9 to 1.12 so it never sounds processed |
| Final pass | `omnivoice` gives better control but runs about 40 times slower than real time on a CPU: use it for a last pass, never to iterate |

This is a proposal, the default voice of the engine, chosen so there is one. Changing it is a decision for the handle's
owner, made once and for every lesson: pass the same `voice` to `generate_narration` each time.

### Fit the beats to the voice

The voice reads plain prose at about 3 words per second and number-heavy lines at about 2.2, so a word count
alone mis-sizes a beat. Write the beats with provisional lengths, run `generate_narration`, read each clip's
`spokenSeconds`, and set each beat to about the spoken length plus half a second. `validate_beats` still wants
2.3 to 2.9 words per second on the beat length, so a very short line ("Now the honest part.") needs a beat of about
1.7 seconds, and a long maths line needs more words or a longer beat. Rewrite the beats and run `generate_narration`
again with `overwrite: true`. NARRATION.md has the clamp.

## Captions

Burn captions in for silent autoplay. The word timings carry bare words with no punctuation, so take the text from
the beat's `vo`: split it on spaces (it matches the timings one to one) and break the caption at sentence ends, so a
caption never runs one sentence into the next. Keep them inside the safe zone below.

```tsx
const tokens = vo.split(/\s+/).filter(Boolean);           // the beat's narration text
const shown = tokens.length === narr.words.length ? tokens : narr.words.map((w) => w.word);
const breakAfter = (i, size) => /[.?!:]$/.test(shown[i]) || (/[,;]$/.test(shown[i]) && size >= 3) || size >= 6;
```

## Reels safe zones

Instagram draws its own interface over a reel, so keep key content (text, the part of a diagram being explained) out of the
top about 14% (270 px) and the bottom about 22% (420 px) of the 1080x1920 frame, and about 10% (108 px) off the right
edge. `supernovaDesignSystem` sets its layout grid to exactly that (108 / 270 / 420).

Checked against current guidance in October 2026: the top figure agrees with the one most sources cite (14%, about 269 px,
from Meta's percentages for Reels ads). The bottom does not: sources give anywhere from about 340 px to 35% (672 px). The
35% is for ads; 22% is a design choice for an organic reel and a minimum. If a lesson is also run as an ad, keep key content
out of the bottom 35%. Meta publishes percentages, not pixels, and the interface changes, so look at a real upload before
trusting any of these. Backgrounds can run to the edge; key content stays inside.

## Checks

`validate_beats` (pace), `check_script` (the script, the two-minute budget and the reference), `validate_scenes` with
`render: true` (framing, numbers, glow), a contact sheet, then listen. `finalize_video` must report no `audio-tick`. See
the skill for the order. `render_video` asks for a brand lock and a lesson has none, so pass `skipBrandLock: true`.
`validate_scenes` warns "fewer than two camera keyframes" on lesson scenes, which are flat on purpose: ignore it.

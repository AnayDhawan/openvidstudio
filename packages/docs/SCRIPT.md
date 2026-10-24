# SCRIPT.md: VO pacing and writing rules

VO for every video should sound like the same person wrote it: direct,
confident about what's actually shown, never claiming more than the visual
backs up.

## Pace

Target **~2.3-2.9 words/sec**. This is edge-tts's natural reading pace at
default settings, the actual ratio observed across this pipeline's
production use, not a theoretical number. If you're writing VO for a beat
of known duration, word-count budget equals `duration_seconds * pace`;
stay inside that range rather than writing to a "feels about right" length
and hoping it fits.

## Duration formula

When a beat's duration is being derived from its VO (rather than the other
way around):

```
duration = (VO word count / pace) + pad
```

Use a pad of **0.3-0.6s**. The pad exists so the visual doesn't cut the
instant speech ends: a beat that ends exactly when the last word does
reads as clipped, and a small buffer lets the shot breathe for a moment
before the cut.

## The claim-obligates-visual rule

If a beat's VO asserts the product does something, the visual must back it
up: either a real capture (`screenshot`/`recording`) of the product
actually doing it, or an explicitly labeled `dom-demo` mockup built for a
feature that isn't wired up yet. Never let VO overclaim past what's on
screen. If the visual can't back a sentence, rewrite the sentence, don't
leave it in and hope no one checks.

This is the same rule `PIPELINE.md` states for beat authoring generally;
here it's specifically about VO, because VO is usually written first and
is where an overclaim first gets introduced. Use `PLANNING.md`'s
per-feature capture-method decision tree to decide, for each claim,
whether it needs a real capture or an honest `dom-demo`. Don't write a
claim the decision tree can't resolve to something real or
explicitly-labeled-constructed.

## Tone

The claim-obligates-visual rule and the direct, confident voice above are non-negotiable
in every tone. Tone changes energy and pacing, never honesty.

- **default.** Direct, confident, plain. The baseline above with nothing added.
- **release.** Terser still. Built for a changelog/what's-new cut: lead with the change,
  name the beat that shows it, skip framing sentences like "here's what's new."
- **walkthrough.** Slower, more explanatory. Full sentences, a beat's VO may explain why a
  step matters, not just name it. For a docs/tutorial video where the viewer is following
  along, not skimming.
- **quiet.** Understated, almost dry. Short sentences, no adjectives doing marketing work
  ("powerful", "seamless"), let the visual carry the excitement. Fits an audience that
  already trusts the product and wants the facts.

State the tone once at the top of a video's brief if it isn't `default`, so every beat's
VO is written in the same register rather than drifting line to line.

## Music-only videos (no narration)

`beats.json` can carry a top-level `narration`:

```json
{ "narration": "none", "beats": [ ... ] }
```

Omit it and `"voice"` is assumed, matching every `beats.json` written before this existed:
every beat needs `vo`, held to the pace budget above.

Under `"none"`, `vo` is optional on every beat and, if present at all, is not held to that
budget: nothing is going to speak it. A beat can instead carry `onScreenText`, checked
against a reading-time budget instead of a spoken one:

```
duration_seconds >= (onScreenText word count / 3.5) + 0.8
```

3.5 words/sec is a faster ceiling than the spoken 2.3-2.9 range on purpose: a viewer reads
faster than a narrator speaks, and the fixed 0.8s covers a card's own entrance. `onScreenText`
is optional too: a beat can be pure visual-plus-music with nothing to read at all.

`stitch_composition`'s `musicBed` defaults its volume to 1.0 (full level) when narration is
`"none"`, instead of the 0.18 tuned for sitting quietly under a voice.

## Lesson scripts (Supernova mode)

A lesson video (production mode `"supernova"`, see PIPELINE.md) is won or lost on its script, and the
visuals illustrate it. These rules are for a lesson, in addition to the pacing above (which still
applies: 2.3 to 2.9 words per second, checked by `validate_beats`). `check_script` lints them.

A lesson explains **one concept in up to two minutes**, and every lesson has the same shape so a viewer
knows what is coming. A series (a channel, a course) keeps that shape constant; only the content changes.
There are two shapes, chosen by the concept card's `arc`: `"seven-beat"` (the default, below) and `"story"`
([the story arc](#the-story-arc)). A card without `arc` is a seven-beat lesson and is checked exactly as before.

Start from a **concept card**, `src/videos/<name>/concept.json`:

```json
{
  "goal": "explain why a projectile is two independent motions, and use that to find its range",
  "terms": ["projectile", "components"],
  "example": "a ball launched at 20 m/s at 30 degrees, with g = 9.81 m/s squared: it lands 35.3 m away",
  "reference": "Physics A.1 Kinematics",
  "referenceSpoken": "physics, topic A one, kinematics",
  "maxSeconds": 120
}
```

The goal is what the viewer can do afterwards, the terms are the two or three that need defining, and the
example is the one thing the whole lesson keeps coming back to, with its real numbers. `reference` is
where the lesson sits (a syllabus chapter code, "Part 2 of 4"), as it is written on screen, and
`referenceSpoken` is how it is said; both are optional, and when they are set the opening beat has to say
it. `maxSeconds` is the length budget and defaults to 120. Get the script approved before any scene is built.

### The arc

Seven beats, in this order. A beat can take more than one scene, and a lesson that has nothing to derive
(a definition, a classification) replaces the derive beat with a second picture, but never reorders
the others. The times are for a 120 second lesson; shrink them in proportion for a shorter one.

| # | Beat | What it does | About |
|---|---|---|---|
| 1 | Hook | A question or a surprising fact a beginner can feel, in the first sentence. Then say where the lesson sits: the `referenceSpoken` | 10 s |
| 2 | Picture | The diagram starts here, before any formula. Say what the viewer is looking at in everyday words, and define each new term at first use | 20 s |
| 3 | Set up | Name the quantities with their symbols and units, and state the assumptions ("no air resistance", "level ground"). Label them on the diagram | 15 s |
| 4 | Derive | Build the formula line by line from things the viewer has already accepted. One `Derivation` with a step per line, each with its `spoken` form (and a `because`), and say why each step is allowed | 35 s |
| 5 | Use it | One worked example with the real numbers and their units | 20 s |
| 6 | Aha | The result that generalises or surprises, and where it stops being true (the assumption that breaks) | 10 s |
| 7 | Close | A one-line recap, then the check question. End on the question and let the last frame hold | 10 s |

About 270 to 330 words fit (2.3 to 2.9 words per second on plain prose; maths-heavy lines are read slower,
nearer 2.2). The viewer should never wait more than about 8 seconds without something on screen changing,
and the diagram's first element is on screen inside the first 15 seconds. `validate_scenes` with `render: true` checks both
from the frames it samples: `diagram-late` (the first frame with anything drawn beyond the background and the captions:
a warning after 15 s, an error after 25 s) and `static-stretch` (frames that do not change, captions aside, for more
than 8 s: a warning). The thresholds are the options `diagramWarnSeconds`, `diagramErrorSeconds` and `staticSeconds`.
A caption box marked `data-ovs-captions` (`LessonCaptions` does it) is the part ignored; otherwise the bottom 22 percent.

### The story arc

`"arc": "story"` is the story-first lesson. It is not the seven-beat arc: it opens on a real situation told as a
problem, and it ends on a practice question the viewer answers in the comments. Six beats, in this order:

| # | Beat | What it does |
|---|---|---|
| 1 | Situation | A real scene told as a problem (the `situation`), in the first beat |
| 2 | The idea | The narrator (`character`) explains the idea in everyday words, terms defined at first use |
| 3 | The formulas | The key formulas stated on screen, each said as its `spoken` form, in the card's order |
| 4 | Apply | The formulas applied to the story's own numbers |
| 5 | Watch out | One short "watch out": the common mistake or the assumption that breaks |
| 6 | Practice | The original practice question, with a prompt to answer in the comments. End on the question |

The extra card fields, all optional and only read for the story arc:

```json
{
  "goal": "find what a jar of money grows to with compound interest",
  "terms": ["interest"],
  "example": "1000 rupees at five percent for three years",
  "arc": "story",
  "situation": "Maya saves money in a jar at the market",
  "character": "Pixel",
  "formulas": [
    { "tex": "A = P(1+r)^n", "spoken": "A equals P times one plus r to the power n", "source": "IB data booklet" }
  ],
  "practiceQuestion": "How much is in a jar after three years at five percent?",
  "answer": "1157.63"
}
```

`formulas` are listed in the order they are stated: `tex` is what is on screen, `spoken` how it is said, `source`
where it comes from. The pacing rules, sentence length, reading level, terms, `maxSeconds` and `reference` apply to
both arcs. The story arc does not count beats: the six are the shape, not a limit, and a beat may take more than one
scene. Its checks, in `check_script`, replace the seven-beat arc's closing-question check and the hook's "question or a
number" warning (the "in this video" error stays):

- `story-situation` (error): the first beat shares at least two content words with `situation` (all of them if the
  situation has fewer). A warning if the card has no `situation`.
- `story-formula` (error): each `formulas[].spoken` is in the narration, and in the order given. It is matched like an
  `Equation`'s `spoken` string, ignoring case and punctuation; the formulas may fall in different beats.
- `story-practice` (error): the last beat ends with the `practiceQuestion` (it need not be a question mark). A warning
  if the card has no `practiceQuestion`.
- `story-comment` (error): the last beat contains a prompt that matches `/comment/i`.
- `story-subscribe` (warning): a beat says "like and subscribe".
- `story-answer` (warning): the `answer` is in the narration. It is withheld until the pinned comment.

For a story lesson `write_description` puts the practice question and "Drop your answer in the comments." in the
description and writes the answer to `output/<name>-ANSWER.md`, the pinned comment (a line of working comes from an
optional card field `answerWorking`). The config's `disclaimers` array is appended, each line once, at the end of
every lesson description. See [SUPERNOVA.md](SUPERNOVA.md#the-description).

### Rules

1. **Hook in the first sentence**: a question or a surprising fact, with a number if there is one. Never
   "in this video".
2. **Say where it sits** in the first beat, if the card has a `reference`.
3. **Intuition and a concrete example before any formula.** The formula arrives as a shortcut for
   something the viewer already sees.
4. **Define every term in plain words at first use** ("a slope is how steep a line is"), at most two new
   terms in a beat.
5. **One idea per beat. Sentences of about 14 words or fewer**, in spoken English, at about grade 8 or
   below. A lesson is heard once.
6. **Write maths as it is spoken.** Each `Equation` carries a `spoken` string ("x squared plus one") that
   must appear in the narration of its beat.
7. **Derive, do not announce.** A derivation shows each step: what is assumed, what is substituted, what
   cancels. "It can be shown that" is not a derivation. If a step cannot fit in the time, it is a
   Part 2, not a faster voice.
8. **End with a one-line recap, then a check question** the viewer can answer in their head. The last
   beat ends with a question mark.

### Correctness

The linter counts and matches; it cannot tell that a formula is right. Before a script is approved:

- Write the derivation in a file next to the script (`derivation.md`), one line per step with its reason.
- Check every step and every number on screen with code (plain Python or sympy), not by hand: the
  symbolic result, the worked example, and the units (does the result have the dimensions it should?).
- Compute the numbers a scene shows from the same code that checked them, rather than typing them twice.
- Name the assumptions and one place the result fails.
- Have someone who knows the subject read the derivation and the script before a scene is built.

### What `check_script` reports

Each finding points at a beat: average sentence length (warning above 16 words), Flesch-Kincaid reading
level (warning above grade 9), a term used with no definition beside it (note), more than two new terms in
a beat (warning), an `Equation`'s `spoken` string missing from the narration (error), a hook that is not a
question or does not hold a number (warning) or opens "in this video" (error), pace against the beat length
(error, the same budget as `validate_beats`), a last beat that does not end with a question (error), the
whole lesson running over `maxSeconds` (error), and a card `reference` that the first beat does not say
(error; a warning when `referenceSpoken` is missing, because then it cannot be checked). It counts and
matches; it cannot tell you the explanation is good or the derivation is correct, so listen to it, and
check the maths as above. For `"arc": "story"` it adds the six `story-*` checks listed under [the story
arc](#the-story-arc) and leaves out the closing-question check.

## No em dashes

No em dashes in any VO line, ever, same writing rule as every other doc in
this pipeline. Use commas, periods, or a rewritten sentence instead.

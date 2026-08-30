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

## No em dashes

No em dashes in any VO line, ever, same writing rule as every other doc in
this pipeline. Use commas, periods, or a rewritten sentence instead.

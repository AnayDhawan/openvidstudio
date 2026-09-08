# Shot-selection validation test, 2026-09-08

Per dragos_apostol's proposed test (r/reactjs, cited in the plan's OVS Community
signal section): draft the shot plan (`beats.json`, pre-render) for a real popular
OSS project and judge it on whether it captures the product's actual best moment,
not on render polish. Run against two real, popular, unaffiliated projects:
[omacom/omarchy](https://github.com/omacom/omarchy) (39.1k stars) and
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (243k
stars). No render happened, nothing was captured live: this is the planning stage
only, exactly what the test asks for.

## Method

Fetched each repo's real README and (for Omarchy) manual pages via `gh api`, no
invented claims. Ran `PLANNING.md`'s intake process by hand (product name,
3-6 features, target length, Higgsfield access set to "no" since it's unconfirmed
for this exercise, brand/existing-assets skipped since this is shot-selection only,
not full production). Drafted `beats.json` for each, then ran `validate_beats`
against both until clean. Files: `omarchy-beats.json`, `hermes-agent-beats.json` in
this folder, both pass validation.

## The finding: every beat in both plans came out `dom-demo`

Not a drafting choice, a structural one. `PLANNING.md`'s decision tree only routes
a beat to `screenshot`/`recording` when the real product is a running instance
Playwright can drive at a URL. Neither project has one:

- **Omarchy** is a full desktop Linux distribution. There is no localhost URL, no
  DOM, nothing Playwright can navigate to. Its real screenshots exist (the manual's
  theme previews, real captured images of the actual product, mirrored to
  learn.omacom.io) but `beats.json` has no captureMethod for "reuse an existing
  real asset someone else already captured", only screenshot/recording (live
  Playwright capture, which didn't happen here) or dom-demo. Routing to dom-demo
  was the mechanically correct call, not a shortcut.
- **Hermes Agent** is a terminal agent reachable via CLI or chat platforms
  (Telegram, Discord, Slack, WhatsApp, Signal). Its docs site is a web page, but
  screenshotting documentation isn't screenshotting "the running product" per
  `PLANNING.md`'s own rule. The TUI itself isn't a DOM Playwright can drive either.

This is the same gap wearing two faces, not two separate findings: **OVS's capture
model assumes a Playwright-drivable web app.** CLI tools, desktop apps, and OS
distributions, a large and popular slice of real OSS, don't have one, and the
pipeline currently has no honest way to show a real, textured moment of using them.

## Judging shot selection against dragos_apostol's actual bar

Feature selection, independent of the capture-method problem, looks defensible for
both: each hook states the real headline claim in one pass, each demo beat maps to
a distinct, genuinely differentiating capability pulled straight from the README
(not filler), and the differentiator/cta land where you'd expect. If the question
were only "did the agent pick the right things to talk about," the honest answer
here is yes for both.

But dragos_apostol's bar is "does this capture the actual best moment," and for
both projects the actual best moment is something a static panel cannot carry:
watching Hermes stream tool output live while it works, or watching an Omarchy
theme change repaint the whole desktop, terminal, and lock screen at once. A
dom-demo panel describing that in text is not the same claim as showing it, and
risks exactly the "wouldn't trust a vibecoded app" reaction the plan's zero-
vibecode standing rule exists to prevent, just aimed at the demo video instead of
the product itself.

## Recommendation

Not a Day 4/5 fix, flagging for the growth-roadmap doc (Part 3) instead of
building today:

1. **State the scope plainly.** OVS v1 is a web-app demo tool. Say so, rather than
   letting dom-demo silently stand in for real capture on a product it structurally
   can't capture. A confident, narrow claim beats a broad one that's secretly
   propped up by reconstructed panels.
2. **A real captureMethod for terminal/CLI products is the actual unlock**, not a
   nice-to-have: something asciinema-style or a pty-driven recording, so a CLI
   tool's real typed session becomes a real capture instead of a dom-demo guess.
   This would have turned both of today's test cases from all-panels into at least
   partially real captures.

## Open: this still needs Anay's actual read

The test's own bar is a human call ("does a founder say yes, that's my product's
best moment"), not something self-certified by the tool that produced the plan.
Read `omarchy-beats.json` / `hermes-agent-beats.json` and say whether the shot
selection itself holds up independent of the capture-method gap above.

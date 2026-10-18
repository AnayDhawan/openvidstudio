# CAPTURE.md: real screenshots and recordings for scenes

**This document is the browser path, which is the path this project exists for.**
Everything here assumes your frontend loads and works in Chrome under Playwright. That is
a hard requirement, not a preference: if a human cannot click through your app in Chrome,
none of what follows applies and no setting changes it.

Binding for every scene with `captureMethod: "screenshot"` or
`"recording"` (see `PLANNING.md`). This protocol exists because
uncorrected captures reliably come out small, soft, or bleed in content
from a neighboring page section; here's why, and the fix. This is also
what the `capture_screenshot` MCP tool does internally and why: if a
capture from that tool ever comes out wrong, this is the mechanism to
debug against.

## The zoom-desync bug

Playwright MCP's `browser_resize` sets a *requested* viewport, but a
browser profile can carry a per-origin zoom level (set once, persisted,
invisible in the tool output) that desyncs the requested size from the
effective CSS layout Chrome actually renders. Confirmed on a real machine:
requesting 1600x1000 rendered at `window.innerWidth/innerHeight` of
2000x1250 (zoom = 0.8). This is a *consistent ratio*, not noise, so it's
fully correctable, not something to route around by guessing crop
coordinates.

**Never trust a resize at face value. Always verify.**

## The other three things that make a capture wrong

Zoom is the subtlest of four, not the only one. The rest are handled automatically and are
documented here so that a capture that still looks wrong can be debugged against the real
mechanism rather than guessed at.

**Resolution.** A capture is placed on a 1920x1080 stage and then a camera pushes into it,
so a capture taken at 1x is upscaled twice over and arrives soft. Captures default to
`deviceScaleFactor: 2`. Measured on a real page at the size the renderer shows it, 2x keeps
about 1.6x the fine detail. Pass 1 only when you want the old behaviour.

**Timing.** A page is not finished when `load` fires. Webfonts are still swapping, images
are still decoding, and any entrance transition is mid-flight. Capturing then produces a
frame no real user ever sees: fallback type, a blank hero, a panel frozen at 40% opacity
halfway through its fade. Every capture therefore settles first, waiting on
`document.fonts.ready`, on images to decode, and on every running animation to reach its
end.

There is one trap in that last wait and it is worth knowing about: **an infinite animation
never finishes.** A looping spinner, a pulsing dot, a permanently drifting gradient all
return a `finished` promise that never resolves. Waiting on them indiscriminately would
burn the full timeout on most real pages. They are filtered out by their computed timing,
which is also correct on the merits, because a loop has no settled state to wait for. The
result reports how many were skipped, so a page that seems to settle instantly can be
checked rather than trusted.

Use the `settle` interaction to force the same wait mid-script, after a click that opens a
modal or triggers a route change. Use `settle: false` on the tool only when catching a page
mid-transition is the actual point of the beat.

**Encoding.** x264's defaults are tuned for camera footage: grain, motion, no hard edges. A
screen is the opposite, and the default crf 23 puts visible ringing around text. Every
capture path in this project encodes with crf 18 and `-tune stillimage` instead.

## Protocol

1. `browser_resize` to your target size, `browser_navigate`, then
   `page.evaluate(() => [window.innerWidth, window.innerHeight])`. If it
   doesn't match what you requested, you have a desync.
   `zoom = requestedWidth / actualInnerWidth`.
2. Re-request a *compensated* viewport: `browser_resize(targetW * zoom,
   targetH * zoom)`. Verify again: `innerWidth/innerHeight` should now
   equal `targetW/targetH` exactly. This is the size you actually wanted,
   once compensated.
3. Interact with the page (click, select, scroll) to reach the exact state
   the beat needs, in this same compensated viewport.
4. Take a full-viewport screenshot (`scale: "css"`, no `fullPage`, no
   element target, see below for why not element-scoped). This screenshot
   is physically `targetW*zoom x targetH*zoom` px and contains `targetW x
   targetH` worth of real layout, shrunk by `zoom`.
5. Measure the DOM rect of exactly the content the beat wants, with
   `el.getBoundingClientRect()`, in the same effective CSS space as step
   2. Don't eyeball pixel coordinates off the screenshot; measure the real
   element.
6. Run `python scripts/crop-shot.py <raw.png> <out.png> <x> <y> <w> <h>
   <zoom>` (the rect from step 5, the zoom from step 1/2). It crops the
   physical screenshot at `rect * zoom`, then upscales the crop back to
   `rect`'s own size with Lanczos resampling, landing on a pixel-accurate,
   unshrunk capture with no bleed, because the crop rect came from the
   DOM, not a guess.
7. `Read` the output PNG before using it in a scene. Confirm by eye: no
   cut-off text, no chrome from an unrelated section, correct state
   selected.

**Caveat when skipping `cropSelector`:** `capture_screenshot`'s output, with
no `cropSelector` given, is exactly the compensated viewport's own pixel
size (steps 1-2 above), not necessarily the size you originally requested.
On a machine with a real zoom desync (zoom != 1), that means the saved
image comes out smaller, and reads softer once a scene scales it back up,
than the size you asked for. Passing `cropSelector` sidesteps this because
the crop-and-upscale step (6 below) always lands back on the DOM rect's
own true size regardless of the measured zoom; without it, check the
tool's reported `zoom` before trusting the raw image at face value.

**Why not `page.locator(selector).screenshot()`** (element-scoped): it
re-measures and can auto-scroll the element into view at shot time,
independent of what you measured a moment earlier. That mismatch produces
a real bleed bug: an element-scoped shot picking up part of the next
section down. The full-viewport-then-crop approach in steps 4-6 is
deterministic: one screenshot, one measurement, one crop, no hidden
re-layout between them.

## Layers: splitting a capture for parallax

A flat screenshot can only be slid or scaled as one piece. To give a camera real parallax, ask
`capture_screenshot` for `layers`:

```json
{
  "beatId": "hook",
  "url": "http://localhost:3000/dashboard",
  "layers": [
    { "selector": "#sidebar", "name": "sidebar" },
    { "selector": "[data-testid=card]", "name": "card" },
    { "selector": "#toast", "name": "toast", "depth": 2.5 }
  ]
}
```

Next to `public/images/hook.png` it writes:

| File | What |
|---|---|
| `hook-bg.png` | the page with every layer element hidden, same size as the screenshot |
| `hook-layer-<name>.png` | one transparent PNG per matched element |
| `hook.layers.json` | the manifest |

```json
{
  "width": 3200,
  "height": 2000,
  "background": "images/hook-bg.png",
  "layers": [
    { "src": "images/hook-layer-sidebar.png", "x": 0, "y": 0, "width": 480, "height": 2000, "depth": 0.5 },
    { "src": "images/hook-layer-card-1.png", "x": 760, "y": 400, "width": 900, "height": 520, "depth": 1 },
    { "src": "images/hook-layer-card-2.png", "x": 1760, "y": 400, "width": 900, "height": 520, "depth": 1 },
    { "src": "images/hook-layer-toast.png", "x": 2400, "y": 1700, "width": 700, "height": 200, "depth": 2.5 }
  ]
}
```

Sizes and positions are in capture pixels, the same space as the screenshot on disk. Paths are
relative to `public/`, so they go straight into `staticFile`. `depth` says how far from the
background a layer sits: 0 moves with it and a larger number moves more under a camera pan. It
defaults to a spread of 0.5, 1, 1.5 in the order you list the selectors; pass `depth` to
override. A selector that matches several elements gives numbered layers (`card-1`, `card-2`)
that share its depth.

How it works, and why it is not `locator.screenshot()`: the reasons above against element-scoped
shots apply here too. So the layers are cut from ordinary full-viewport screenshots. For each
element the page is switched so everything else is `visibility: hidden` (which, unlike
`display`, moves nothing) and the page background is transparent, the shot is taken with
`omitBackground`, then brought into the saved image's space by the same zoom, device-scale and
`cropSelector` transform as the main image and cropped to the element. The background is the
same shot with the layer elements hidden. Animations are paused first so the main image, the
background and every layer show the same instant, and transitions are switched off while the
toggles happen, otherwise a `transition: all` would keep an element visible for its whole
duration.

Checking the result: composite `-bg.png` and the layers at their `x`, `y` in manifest order and
compare with the screenshot. On a test page with rounded and gradient elements, text and a card
on a fractional pixel, that came out at a mean error of 0.001 of 255 with the worst pixel off by 2.

Limits, so a layer that looks wrong is easy to explain:

- Each rectangle is the element's box plus one capture pixel on every side. Chrome paints a
  pixel past `getBoundingClientRect` once it snaps to the pixel grid, and a layer cut exactly at
  the box lost that column. Anything painted further out (a box shadow, an outline, overflow) is
  not in the layer, and is gone from the background as well, so a card that casts a shadow loses
  the shadow outside its box. Put the shadow on a wrapper that is itself a layer, or accept it.
- A layer inside another layer shows up in both: the outer one is cut with its whole subtree.
  Pick selectors that do not nest, or order them outer first.
- Overlapping layers are cut as if nothing covered them, so a card partly under a toast is
  whole in its own layer. Composite in the order of the manifest and the overlap reads as it did
  on the page, as long as the covering element comes later.
- A selector that matches nothing, matches an element with no size (`display: none`), is not
  valid CSS, or lies outside the captured area (outside the `cropSelector` box, or off screen)
  is an error naming the selector. Nothing is written for a failed call.
- With a `cropSelector` the rectangles are relative to the crop, since the saved image is the
  crop.

## Screen recordings

### Theme toggles

`colorScheme: "dark"` already makes libraries such as `next-themes` start in dark mode.
Do not click a theme toggle afterwards unless the beat explicitly needs light mode: the click
usually flips the capture back to light. Check `document.documentElement.dataset.theme` after
the interaction when a project uses a `data-theme` attribute.

For `captureMethod: "recording"` beats, the same zoom-desync check in step
1 still applies before you start recording: verify the effective viewport
matches what you requested before you hit record, since the desync is set
once per origin and persists for the whole session. v1 scope is fixed
full-viewport recordings only: capture at the compensated viewport size
and composite the whole frame (no post-hoc DOM-rect cropping of a moving
recording, that's future work, see `PIPELINE.md`).

## Terminal casts

Everything above is the browser path. A CLI, a build tool, or a package manager has no URL
and no window worth filming, so `capture_terminal` records the command's output stream as
timed text rather than as pixels, writing a JSON cast to `public/terminal/<beatId>.json`.
Recording text is the point: one cast renders crisply at 1080p or 4K, picks up the palette
`extract_brand` resolved, and replays through the `TerminalReplay` component, instead of
baking in one machine's font, theme, and window size the way a screen recording does.

The cast is JSON, not a video:

```json
{
  "version": 1,
  "command": "npm",
  "cols": 120,
  "rows": 32,
  "durationMs": 4210,
  "exitCode": 0,
  "mode": "pty",
  "events": [[0, "o", "added 1 package in 1s\n"]]
}
```

Each `events` entry is `[timestampMs, stream, text]`, where `stream` is `"o"` for stdout
and `"e"` for stderr. A pty merges the two streams by construction, so every event in a
pty cast is `"o"`; that is the pty's behaviour, not a loss of fidelity this format
introduced.

`mode` records the backend actually used, and it is the first thing to check when a
recording looks flat. `pty` needs the optional `node-pty` module and is what a faithful
recording requires: the program sees a real terminal, so it keeps its colour, progress
bars, and cursor addressing. Without `node-pty` the tool falls back to `pipe`, which needs
no native build but makes most CLIs suppress colour. A dull, colourless recording is
therefore explained by the cast rather than left as a mystery. (`mode` is absent in casts
recorded before pty support existed.)

Two things go wrong on Windows, and the recorder handles both. Python block-buffers
stdout when it is a pipe, so a script's whole output used to arrive as one event at exit
and replay as a single dump; and the Windows console code page is not UTF-8, so a `✓` or
an accented letter raised `UnicodeEncodeError` or came out as mojibake. Every recording
now sets `PYTHONUNBUFFERED=1`, `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` in the child's
environment, the environment forms of `python -u` and `python -X utf8`, so it makes no
difference how the program is launched. They sit below your own environment: a value you
set on purpose wins. The third trap is `command: "bash"`: on Windows a bare `bash` usually
resolves to the WSL launcher in System32, which runs inside a Linux distro with a different
filesystem and PATH, not the shell you meant. `capture_terminal` says so in its `note`
when it sees that; give the full path to Git Bash, or run the program directly.

A beat uses this path by declaring `visual.captureMethod: "recording"` and
`visual.source: "terminal"`. `visual.command` must be an executable name only, with
arguments in `visual.args`; it is never run through a shell. `validate_scenes` requires the
cast for every such beat and, when it is missing, reports the exact path it looked for.
Override the location with `artifacts.terminalPath`; the Asset conventions table in
`PIPELINE.md` shows how this path sits alongside every other asset. For pty/pipe mode,
scripted stdin, and output bounding, see the `capture_terminal` tool description.

## Sizing the frame from the capture

Once you have a clean capture, size `BrowserFrame` to the screenshot's
*native* aspect so the `<Img>` (or `OffthreadVideo`, for a recording)
needs no distortion:

```
FRAME_W = <capture width>
FRAME_H = <capture height> + 56   // BrowserFrame's chrome bar is 56px, added on top of content
LEFT = (1920 - FRAME_W) / 2
TOP = (1080 - FRAME_H) / 2
```

This centers the frame on the 1920x1080 stage exactly: `LEFT + FRAME_W/2`
is always `960` by construction. Push the camera to 115-160% (STYLE.md's
120-250% range) with `x=960` as the base; adjust `y` only if the beat's
important content isn't at the frame's own vertical center.

**Check the bottom edge before locking a static crop.** A static camera
crop that looks fine at scale 1.0 can push important content off the
bottom of frame once you zoom in on it. If a screenshot is taller than
what one crop can show at a good zoom level, animate the camera `y` across
the beat instead of picking one static point: pan from the top
(headline/context) to the bottom (the payoff) rather than compressing
everything into a single frame that's forced to zoom out to fit it all.

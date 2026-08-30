# CAPTURE.md: real screenshots and recordings for scenes

Binding for every scene with `captureMethod: "screenshot"` or
`"recording"` (see `PLANNING.md`). This protocol exists because
uncorrected captures reliably come out small, soft, or bleed in content
from a neighboring page section; here's why, and the fix. This is also
what the `capture_screenshot` MCP tool (not built yet, a later task) does
internally and why: if a capture from that tool ever comes out wrong, this
is the mechanism to debug against.

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

**Why not `page.locator(selector).screenshot()`** (element-scoped): it
re-measures and can auto-scroll the element into view at shot time,
independent of what you measured a moment earlier. That mismatch produces
a real bleed bug: an element-scoped shot picking up part of the next
section down. The full-viewport-then-crop approach in steps 4-6 is
deterministic: one screenshot, one measurement, one crop, no hidden
re-layout between them.

## Screen recordings

For `captureMethod: "recording"` beats, the same zoom-desync check in step
1 still applies before you start recording: verify the effective viewport
matches what you requested before you hit record, since the desync is set
once per origin and persists for the whole session. v1 scope is fixed
full-viewport recordings only: capture at the compensated viewport size
and composite the whole frame (no post-hoc DOM-rect cropping of a moving
recording, that's future work, see `PIPELINE.md`).

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

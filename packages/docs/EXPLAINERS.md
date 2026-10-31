# Canvas explainers: writing one, or having another tool generate one

A canvas explainer is a lesson (or any explainer) drawn on an HTML `<canvas>` and turned into a narrated, captioned video by
`render_canvas_explainer`. It is the second visual path next to Remotion scenes. Use it when the pictures come from somewhere
else: a hand-written canvas file, a generator such as Claude Design, or the pixel narrator in `@openvidstudio/styles`. The script
gates (`check_script`, `validate_beats`, `fit_beats`), the voice (`generate_narration`), the captions and the final pass
(`finalize_video`, `write_description`) are the same as for any lesson. This page is the whole contract, so it can be handed to a
generator as it is. "Canvas explainers" in `PIPELINE.md` has the renderer's behaviour; `SUPERNOVA.md` has the lesson rules.

## The contract

One self-contained HTML file with one `<canvas>`. It must expose:

| Name | What it is |
|---|---|
| `window.seek(t)` | Draws the frame at time `t` (seconds). A pure function of `t` |
| `window.DURATION` | Length in seconds (a number). With a `videoName` the renderer overrides it with the last beat's end |
| `window.scoreSound(kit)` | Schedules the Web Audio score on `kit.ctx` (an `OfflineAudioContext`); `kit.voiceover` is true when a voice will play over it, `kit.duration` is the length |
| `window.SOUND.renderOffline(score, seconds, sampleRate, { voiceover })` | Builds the offline context, calls the score, returns `ctx.startRendering()`. Eight lines, copy them from the skeleton below |

The renderer sets these before the file's own script runs:

| Name | What it is |
|---|---|
| `window.OVS` | `{ width, height, fps, voiceover }`: the size to draw at (1080x1920 for a Reel) |
| `window.BEATS` | With a `videoName`: `[{ id, start, end, text }]` in seconds, from `beats.json` after `fit_beats`. Read the timings from it, do not hard-code them |
| `window.CAPTIONS.draw(ctx, t, opts)` | Burns the beats' text in as captions at the end of a frame, inside the safe areas. `opts`: `font`, `color`, `background`, `size`, `position`. If the file never calls it the renderer draws captions itself |

## Rules the checks enforce

`validate_canvas_explainer` runs before every render and refuses to render on an error. Make a file that passes it.

- **Pure in `t`.** The same `t` draws the same pixels, in any order. No `Math.random`, `Date.now`, `performance.now`, `requestAnimationFrame`, timers or state that grows as frames are drawn. For randomness use a seeded generator (`createRng(seed)` in `@openvidstudio/styles`, or any mulberry32).
- **Nothing fetched.** The file is loaded from disk with no network. Inline images as `data:` URIs, use system fonts or inline a font as base64, and embed anything the picture needs, such as the word timings, at build time.
- **Size.** Draw at `window.OVS.width` by `height`. For a vertical Reel lay out a 720x1280 logical frame and scale by `width / 720` with `ctx.setTransform`, so the same file renders at 720x1280 or 1080x1920. A landscape layout needs its own frame; cropping a landscape layout to vertical is not offered.
- **Text.** At 720 on the shorter side: labels at least 28 px, headlines at least 44 px, a number alone (or a number with a unit, such as `78.7 m`) at least 64 px. Text between 34 and 43 px counts as a headline that is too small. Below half the minimum is an error, below the minimum a warning.
- **Safe areas.** No text in the top 14 percent or bottom 22 percent of a tall frame. Only captions go there.
- **Pixel art.** With a 1.5x render, keep sprites at whole-number scales that stay whole after the factor (scale 4 or 8) and keep their positions on even logical pixels, or the blocks blur.
- **Arc.** Something must be drawn beyond the background by 15 seconds (an error after 25), and the picture must not stay identical for more than 8 seconds.
- **Sound.** At most 3 sources playing at once, a peak under 0 dB, no percussion for a lesson. The voice is mixed over the score with the score ducked at least 6 dB.

## The smallest working explainer

This file is run through the validator and the renderer by a test, so it stays true.

```html
<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#0B0D14">
<canvas id="c"></canvas>
<script>
var OVS = window.OVS || { width: 720, height: 1280, fps: 30, voiceover: false };
var LW = 720, LH = 1280;                        // the logical frame; the canvas is scaled to the real size
var canvas = document.getElementById("c");
canvas.width = OVS.width; canvas.height = OVS.height;
var ctx = canvas.getContext("2d");

var BEATS = window.BEATS || [{ id: "demo", start: 0, end: 4, text: "A demo line." }];
window.DURATION = BEATS[BEATS.length - 1].end;

function ease(p) { return p * p * (3 - 2 * p); }
window.seek = function (t) {
  ctx.setTransform(OVS.width / LW, 0, 0, OVS.height / LH, 0, 0);
  ctx.fillStyle = "#0B0D14"; ctx.fillRect(0, 0, LW, LH);
  var p = ease(Math.min(1, Math.max(0, t / 1.2)));
  ctx.globalAlpha = p;
  ctx.textAlign = "center";
  ctx.fillStyle = "#F3EFE6"; ctx.font = "700 56px sans-serif"; ctx.fillText("One idea", LW / 2, 420);
  ctx.fillStyle = "#FFB347"; ctx.font = "700 96px sans-serif"; ctx.fillText("42", LW / 2, 560);
  ctx.fillStyle = "#A1A1AA"; ctx.font = "32px sans-serif"; ctx.fillText("a label", LW / 2, 640);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#5CC8FF"; ctx.fillRect(100 + (LW - 300) * (t / window.DURATION), 760, 100, 60);
  if (window.CAPTIONS) window.CAPTIONS.draw(ctx, t, {});
};

window.SOUND = {
  renderOffline: function (score, seconds, sampleRate, opts) {
    var ac = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    score({ ctx: ac, voiceover: !!(opts && opts.voiceover), duration: seconds });
    return ac.startRendering();
  }
};
function hz(note) { return 440 * Math.pow(2, (note - 69) / 12); }
window.scoreSound = function (kit) {
  var ac = kit.ctx, quiet = kit.voiceover ? 0.04 : 0.08;
  [57, 64].forEach(function (note, i) {
    var o = ac.createOscillator(), g = ac.createGain(), peak = quiet * (i ? 0.6 : 1);
    o.type = "triangle"; o.frequency.value = hz(note);
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(peak, 1.2);
    g.gain.setValueAtTime(peak, Math.max(1.2, kit.duration - 1.2));
    g.gain.linearRampToValueAtTime(0, kit.duration);
    o.connect(g); g.connect(ac.destination);
    o.start(0); o.stop(kit.duration);
  });
};
</script>
</body></html>
```

## Making a lesson from one

1. Concept card, derivation and verified numbers, then the narration as `beats.json`; `check_script` (the `supernova` skill, steps 2 and 3).
2. `generate_narration`, then `fit_beats`, then `generate_narration` with `overwrite: true`. The beat times now follow the real voice.
3. Get the explainer (write it, or have a generator make it from the prompt below). Inline the word timings from `public/audio/vo/<beatId>.words.json` if it should point at the word being said.
4. `validate_canvas_explainer` with `videoName`, `width: 1080`, `height: 1920`. Fix every error and read every warning.
5. `render_canvas_explainer` with the same arguments, `async: true`, then `job_status`. A 94 second lesson at 1080x1920 takes 15 to 20 minutes on a laptop for a busy scene.
6. `finalize_video` (loudness, poster, no `audio-tick`) and `write_description`. Listen once before it goes anywhere.

To use the pixel narrator, depth kit or layout helpers from `@openvidstudio/styles` in a hand-written explainer, bundle them in: the package ships TypeScript source (its `main` is `src/index.ts`), which esbuild reads as it is. Install `@openvidstudio/styles` and `esbuild`, import from the package in your script, bundle to one script and inline the result into the HTML.

```js
import esbuild from "esbuild";
const out = await esbuild.build({
  entryPoints: ["explainer.src.js"], bundle: true, format: "iife", write: false,
  define: { __WORDS__: JSON.stringify(words), __BEATS__: JSON.stringify(beats) },   // optional: data baked in at build time
});
// write `<script>${out.outputFiles[0].text}</script>` into the HTML
```

## A prompt for a generator

Paste this to another tool, with the lesson's script and beat times after it. It asks for exactly the file this page describes.

```text
Write ONE self-contained HTML file with one <canvas> that draws an explainer animation. No external requests: inline every image
(data: URI) and font, or use system fonts.

It must define, on window: seek(t) which draws the frame at time t in seconds as a PURE function of t (the same t always draws the
same pixels; no Math.random, Date.now, performance.now, requestAnimationFrame, timers or accumulating state; use a seeded generator
for any randomness); DURATION (seconds); scoreSound(kit) which schedules a quiet Web Audio pad on kit.ctx (an OfflineAudioContext;
at most 3 simultaneous sources; no drums; quieter when kit.voiceover is true); and SOUND.renderOffline(score, seconds, sampleRate,
opts) which builds an OfflineAudioContext, calls score({ ctx, voiceover: !!opts.voiceover, duration: seconds }) and returns
ctx.startRendering().

Before your script runs the host sets window.OVS = { width, height, fps } (draw at that size; lay out a 720x1280 logical frame and
scale by width / 720) and window.BEATS = [{ id, start, end, text }] in seconds (take every timing from it; set window.DURATION from
the last beat's end). At the end of seek(t) call window.CAPTIONS.draw(ctx, t, { font, color, background }) if it exists.

Rules: vertical 9:16; keep all text out of the top 14 percent and bottom 22 percent of the frame (captions use the bottom); labels
at least 28 px, headlines at least 44 px, any number or number with a unit at least 64 px (all at 720 wide); draw something
beyond the background within the first 15 seconds and never leave the picture unchanged for 8 seconds; pixel art at whole-number
scales on even coordinates.

Style: <the style, for example whiteboard with a pixel narrator>. Script and beat times: <paste>.
```

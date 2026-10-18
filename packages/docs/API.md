# API.md: everything `@openvidstudio/core` exports

Written because the alternative is reading the library source. If you are an agent
about to write a scene, this file has every prop you need and you should not have to
open `packages/core/src`.

These are **building blocks**, not a template. At peak and mid creative level the agent is
expected to compose scenes from them against the video's own `design.ts`, and to write its
own component when the brief's motif needs something the library does not have. Every
primitive below has a still, rendered for real by `scripts/build-api-gallery.mjs`. The MCP
tools are listed in [TOOLS.md](TOOLS.md).

Import everything from the package root:

```tsx
import { CinematicScene, Layer, TerminalReplay, E, color } from "@openvidstudio/core";
```

---

## Scene wrapper

### `CinematicScene`

Wraps every scene. Grain, vignette and colour grade are always on, and the camera rig
lives inside it. Nothing renders outside one.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `camera` | `CamKeyframe[]` | required | At least two, or nothing moves |
| `stageWidth` | `number` | composition width | 1920 in 16:9, 1080 in a 9:16 reel. Camera x/y are in stage px, so the centre is 960,540 or 540,960 |
| `stageHeight` | `number` | composition height | |
| `variant` | `"dark" \| "light"` | `"dark"` | |
| `grain` | `number` | `0.05` | |
| `vignette` | `number` | `0.32` | |
| `overlay` | `ReactNode` | | Screen space, not camera transformed. Captions and title cards go here |
| `children` | `ReactNode` | required | |

**The overlay is not optional knowledge.** Anything inside `children` moves with the
camera, so a caption placed there drifts off screen as the shot pushes in. Captions,
title cards and dips belong in `overlay`.

---

## Camera

### `CamKeyframe`

```ts
type CamKeyframe = {
  frame: number;
  x: number;        // focal point on the stage, lands at frame centre
  y: number;
  scale: number;    // 1 = stage px equals output px, 1.6 = 160% close up
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  easing?: (t: number) => number;  // easing INTO this keyframe
};
```

**The one thing that catches everyone.** The visible area is the stage divided by
`scale`. At `scale: 1.4` only 1371x771 of a 1920x1080 stage is on screen, so content
laid out at full stage width is cropped at the frame edge, and the render does not
warn. The binding number is the scene's **highest** scale, not its first.

Rules of thumb:

- Real captures: 1.2 to 2.5. STYLE.md requires the camera to sit inside the UI
  rather than showing a flat full-screen grab.
- Constructed panels: 1.04 to 1.15. They are already built at stage size, so they
  need a gentle push, not a zoom.
- Run `validate_scenes` and it will tell you which scenes are cropping. That is a read of
  the source. Pass `render: true` (after `stitch_composition`) to measure the real rendered
  frames instead: cropped text, text below the design system's minimum size, on-screen text
  that takes longer to read than the beat lasts (3 words/sec), and beats that never change.

### `Layer`

| Prop | Type | Default | Notes |
|---|---|---|---|
| `depth` | `number` | `0` | Parallax and blur. `0` is the focal plane |
| `maxBlur` | `number` | `10` | Blur in px at `depth` 1 |
| `style` | `CSSProperties` | | |

One focal plane per shot. Put background elements on a non-zero depth so they blur.

### `CameraRig`, `useCamera`

`CinematicScene` sets these up for you. Reach for them only when building a scene
that needs the camera state directly.

`CameraRig` also takes `viewportWidth` and `viewportHeight`, the size of the window the camera
looks through (default: the composition's size). A rig nested in a smaller box, such as
`DirectedShot`, passes that box's size. `resolveCamera(keyframes, frame)` returns the camera
state the rig renders at a frame, for code that needs to know where the camera is without
rendering.

### `DirectedShot`

A nested camera rig that turns a flat capture into a directed move: a push-in on one point,
an optional tilt, depth of field that follows the focal point, and a cursor, all in the
capture's own pixel space. It owns its own `CameraRig`, so it sits inside a `CinematicScene`
(or anywhere) without touching that scene's camera.

```tsx
<DirectedShot
  src={staticFile("images/dashboard.png")}
  focus={{ x: 1560, y: 280 }}
  push={1.9}
  tilt={{ y: -4, x: 2 }}
  move={{ from: 0, to: 70 }}
  cursor={{ path: [{ frame: 0, x: 900, y: 600 }, { frame: 55, x: 1500, y: 300 }], clicks: [60] }}
/>
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `src` | `string` | | Image URL, usually `staticFile("images/<beat>.png")`. Use `children` for anything else |
| `focus` | `{ x, y }` | required | The point in the capture, in capture pixels, the move pushes into |
| `push` | `number` | `1.4` | End zoom relative to fitting the whole capture in the box. `1` holds the full frame |
| `tilt` | `{ x?, y?, z? }` | | Rotation in degrees at the end of the move. 2 to 6 reads as depth |
| `move` | `{ from?, to?, easing? }` | `0` to `90` | Frames, local to the scene. Defaults to `E.cinematic` |
| `depthOfField` | `number` | `6` | Blur in px away from the focal point. `0` turns it off |
| `cursor` | `{ path, clicks? }` | | A `CursorActor` path and click frames, in capture pixels |
| `captureWidth`, `captureHeight` | `number` | `1920`, `1080` | The capture's natural size |
| `width`, `height` | `number` | the composition | The box the shot fills |

The move starts on the whole capture and ends pushed in on `focus`. The end centre is clamped
so the camera never leaves the capture (empty stage reads as a mistake).

| Start of the move | End of the move |
|---|---|
| ![DirectedShot at frame 0: the whole capture](img/api/directedshot-start.png) | ![DirectedShot at the end: pushed in, tilted, soft at the edges, cursor on the target](img/api/directedshot-end.png) |

---

## Motion

### `E` and `SPRING`

```ts
E.cinematic  // default move: slow out, soft landing
E.whip       // aggressive, for cuts and fast pans
E.drift      // gentle ambient motion inside a shot
E.snap       // snappy UI reaction, button press, blip reveal

SPRING.soft  SPRING.pop  SPRING.heavy
```

**Linear easing fails QC.** There is no linear preset on purpose.

### `tween`, `pop`, `jitter`, `staggerDelay`

```ts
tween(frame, [fromFrame, toFrame], [fromValue, toValue], E.cinematic): number
pop(frame, fps, atFrame): number          // spring entrance scalar
jitter(seed, n): number                   // deterministic 0..1, same every render
staggerDelay(index, step = 3): number     // 3 frames at 30fps is 100ms
```

`jitter` is deterministic. Never use `Math.random()` in a scene: every frame renders
in a separate process and random values differ per frame, which shows up as flicker.

---

## Text

### `TitleSlam`

| Prop | Type | Default |
|---|---|---|
| `text` | `string` | required |
| `at` | `number` | required |
| `fontSize` | `number` | `120` |
| `color` | `string` | `color.textPrimary` |
| `glowColor` | `string` | |
| `align` | `"center" \| "left"` | `"center"` |
| `sfx` | `boolean` | `false` |

Per word entrance. Renders nothing before `at`. `sfx` adds a blip per word; it is off by
default because a blip every few frames sounds like a ticking clock under a title.

### `Caption`

| Prop | Type | Default |
|---|---|---|
| `text` | `string` | required |
| `at` | `number` | required |
| `out` | `number` | |
| `fontSize` | `number` | `34` |

Sits 84px from the bottom. Put it in `overlay`, not `children`.

---

## Panels

### `BrowserFrame`

| Prop | Type | Default |
|---|---|---|
| `url` | `string` | required |
| `width` | `number` | `1360` |
| `height` | `number` | `850` |
| `dark` | `boolean` | `true` |
| `children` | `ReactNode` | required |

Chrome bar is 56px, so `height` must be the capture height plus 56 or the page is
letterboxed. `scaffold_scene` computes this from the real PNG for you.

Screenshots may only appear inside a `BrowserFrame`. Recordings and AI clips must
not: wrapping generated footage in browser chrome makes it look like a captured
page, which STYLE.md's provenance rule forbids.

### `CodePanel`

| Prop | Type | Default |
|---|---|---|
| `title` | `string` | required |
| `lines` | `CodeLine[]` | required |
| `width` | `number` | `860` |
| `height` | `number` | `640` |
| `fontSize` | `number` | `22` |
| `scroll` | `number` | `0` | px translateY, drive with a tween |
| `highlight` | `number[]` | `[]` | 0-based line indexes |

```ts
type Token = { t: string; c?: "kw" | "str" | "fn" | "cm" | "num" | "plain" };
type CodeLine = Token[];
```

```tsx
lines={[
  [{ t: "{", c: "plain" }],
  [{ t: '  "name"', c: "str" }, { t: ": ", c: "plain" }, { t: '"value"', c: "str" }],
]}
```

### `ChecklistPanel`

| Prop | Type | Default |
|---|---|---|
| `title` | `string` | `"Community Standards"` |
| `items` | `ChecklistItem[]` | required |
| `width` | `number` | `760` |
| `fontSize` | `number` | `27` |
| `sfx` | `boolean` | `true` |

```ts
type ChecklistItem = { label: string; flipAt?: number };  // omit flipAt to stay unchecked
```

`flipAt` is an absolute scene frame.

### `TerminalReplay`

| Prop | Type | Default |
|---|---|---|
| `steps` | `TermStep[]` | required |
| `title` | `string` | `"Project"` |
| `width` | `number` | `1280` |
| `fontSize` | `number` | `26` |
| `cps` | `number` | `16` | characters per second |
| `sfx` | `boolean` | `true` |
| `trailingPrompt` | `boolean` | `true` |

```ts
type TermLine = { text: string; color?: string; glow?: boolean; bold?: boolean };
type TermStep =
  | { type: "cmd"; text: string }
  | { type: "out"; lines: TermLine[]; stagger?: number; preDelay?: number }
  | { type: "pause"; frames: number };
```

Terminals are always this component, never a screen recording of a terminal.

`computeTerminalTimeline(steps, fps, cps)` returns `{ items, totalFrames }`, so camera
keyframes can land frame-exact on content events rather than being guessed.

### `CursorActor`

| Prop | Type | Default |
|---|---|---|
| `path` | `CursorKeyframe[]` | required |
| `clicks` | `number[]` | `[]` | frames where a click ring fires |
| `scale` | `number` | `1.6` |
| `sfx` | `boolean` | `true` |

```ts
type CursorKeyframe = { frame: number; x: number; y: number };
```

Coordinates are stage space. Movement is eased automatically; never linear.

### `RepoCta`

| Prop | Type | Default |
|---|---|---|
| `owner` | `string` | required |
| `name` | `string` | required |
| `description` | `string` | required |
| `chips` | `string[]` | required |
| `titleText` | `string` | required |
| `durationInFrames` | `number` | `270` |

A whole scene, not a panel. Do not wrap it in a `CinematicScene`; it brings its own.
No star action by default. Laid out from the composition size, so the card is centred in
1920x1080 and in a 1080x1920 reel.

---

## Sound

Synthesized by `scripts/gen-sfx.sh` with ffmpeg, except `typing-effect.mp3`, a
copyright-free recording, so a rendered video carries no third-party audio rights.
Regenerate the synthesized files with `bash scripts/gen-sfx.sh`.

| Component | Props | Use |
|---|---|---|
| `TypingSfx` | `charFrames`, `volume?` (1) | The typing recording, played across each typed run |
| `Click` | `at`, `volume?` | Cursor click |
| `Whoosh` | `at`, `volume?` | Camera move or cut |
| `Blip` | `at`, `volume?` (0.3) | UI reveal |
| `SuccessChime` | `at`, `volume?` (0.35) | Completion |
| `Bell` | `at`, `volume?` (0.3) | Heavier completion |
| `MusicBed` | `durationInFrames`, `volume?` (0.16) | Ambient bed, loops |

`TerminalReplay` emits its own typing sounds. Pass `sfx={false}` to silence it.

Narration is separate: `generate_narration` writes
`public/audio/vo/<beatId>.mp3` and `stitch_composition` picks it up.

---

## Music clock

The score's grid as scene-local frames, so a cut, a reveal or a glow can land on the music.
`stitch_composition` copies the bed's `<stem>.cues.json` next to the composition and mounts
`MusicClockProvider` with each beat's start frame; a scene just asks for its own beat.

```tsx
const clock = useMusicClock("reveal");   // the beat id, exactly as in beats.json
const hit = clock.at(8);                  // first downbeat of bar 8, as a frame local to this scene
const glow = clock.beatPulse();           // 1 on each beat, decaying to 0 before the next
if (clock.onDownbeat()) { /* a bar starts on this frame */ }
```

![useMusicClock: on a downbeat the pulse is full](img/api/musicclock-downbeat.png)
![...three frames later it has decayed](img/api/musicclock-decay.png)

Bars count from 0 at the start of the track, in 4/4 (what `compose_score` writes), and the bed
is mounted at composition frame 0. `useMusicClock(beatId)` must be called inside that beat's
scene, because the pulse helpers read the scene's current frame.

| Member | Notes |
|---|---|
| `at(bar, beat?)` | Scene-local frame of that bar and beat (`beat` may be fractional: `at(8, 2.5)`). Rounded to the nearest frame; negative when it is before the scene starts |
| `position(frame)` | `{ bar, beat }` a scene-local frame falls in |
| `impact(label)` | Scene-local frame of the score's impact point with that label, or `null` |
| `sectionAt(frame)` | The section label a frame falls in, or `null` without sections |
| `beatPulse({ decay?, strongOnly? })` | 1 on a beat, decaying to 0 over `decay` (0.6) of a beat; `strongOnly` pulses on downbeats only |
| `onBeat()`, `onDownbeat()` | True on the frame a beat or a bar starts, using the same rounding as `at` |
| `available`, `bpm`, `framesPerBeat`, `framesPerBar` | `available` is false when the bed has no cues file; the clock then runs a 120 bpm grid so a scene still renders |

`createMusicClock({ cues, fps, sceneStartFrame, frame })` is the pure core, for tests.
`plan_beats` with `snapToBars` plans beat boundaries onto the same downbeats.

---

## Look pass

`FilmGrain`, `Vignette`, `ColorGrade`, `LookPass`. `CinematicScene` applies these, so
reach for them only when compositing outside a scene.

---

## Tokens

```ts
color.bg0 color.bg1 color.panel color.panelBorder
color.textPrimary color.textSecondary
color.accent color.accentAlt color.success color.warn color.danger
color.lightBg color.lightCard color.lightShadow

font.ui    // "Inter"
font.mono  // "JetBrains Mono"

radius.window  // 12
radius.card    // 10
radius.pill    // 999

glow(color, strength = 1)       // returns { textShadow }
panelShadow(dark = true)        // returns a box-shadow string
```

Use tokens rather than literal hex, so a per-video theme can override them.

---

## Design system

### `defineDesignSystem(overrides?)`

Builds one video's `DesignSystem`: palette, type scale, layout grid, a signature
motif, a motion personality, a transition vocabulary and a texture pass. Call it
once in that video's own `src/videos/<name>/design.ts`:

```ts
export const design = defineDesignSystem({
  motif: "pixel-grid",
  motion: { cameraEnergy: "energetic" },
});
```

Anything omitted falls back to the current brand tokens (`color`/`font`, already
brand-applied if `extract_brand` ran) and STYLE.md's own defaults. The result is a
plain object, frozen at the point `design.ts` is imported, not a live binding: a
later `applyBrand` call never reaches into an already-built `DesignSystem`.

| Field | Type | Notes |
|---|---|---|
| `color`, `font` | tokens | Seeded from the current brand tokens |
| `typeScale` | `{ display, headline, body, mono: [min, max] }` | px |
| `grid` | `{ marginX, marginTop, marginBottom }` | px, at the 1920x1080 stage |
| `motif` | `"pixel-grid" \| "rounded-soft" \| "geometric" \| "editorial"` | Default `"rounded-soft"` |
| `motion` | `{ easing, staggerMs, cameraEnergy, cutRhythmSeconds }` | `easing` names an `E.*` preset by string, not a function reference, so the system stays JSON-serializable |
| `transitions` | `string[]` | Preference order, default `["cut", "whip", "fade"]` |
| `texture` | `{ grainOpacity, vignetteStrength }` | STYLE.md's default ranges |

### `contrastRatio(hexA, hexB)`

WCAG relative-luminance contrast ratio, 1 (no contrast) to 21 (black on white).
Reach for it directly when a bespoke scene picks a text colour against a
background the design system doesn't already pair.

Several primitives below take an optional `design?: DesignSystem` prop: pass
that video's own `design` export and they read palette, motif and motion from
it instead of the package's global tokens.

---

## Kinetic text

### `Words`

![Words: a masked word reveal with one accented word](img/api/words.png)

Per-word masked reveal. Never a plain opacity fade (STYLE.md): each word clips
in from below on its own stagger, and clips back out the same way if `out` is
set.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `text` | `string` | required | Split on spaces, one reveal per word |
| `at` | `number` | required | Frame the first word starts |
| `out` | `number` | | Frame the exit starts. Omit to leave the line on screen |
| `size` | `number` | `72` | |
| `weight` | `number` | `800` | |
| `color` | `string` | `color.textPrimary` | |
| `accent` | `Record<number, string>` | `{}` | Word index to accent colour, for one word landing harder than the rest |
| `stagger` | `number` | | Frames between word starts. Explicit value always wins |
| `design` | `DesignSystem` | | Without `stagger`, reads `design.motion.staggerMs` at the composition's fps; with neither, falls back to 3 frames |
| `align` | `"left" \| "center" \| "right"` | `"left"` | |
| `font`, `tracking`, `lineHeight`, `maxWidth`, `glow`, `italic`, `style` | | | |

### `useTyped(text, at, cps?)`

Typewriter hook. Returns `{ visible, done, charFrames, end }`: the visible slice
of `text` at the current frame, plus the per-character reveal frames, so a
caller can drive `TypingSfx` off the exact same numbers the visible text uses.
`cps` defaults to 22 characters per second.

### `Caret`

![useTyped and Caret: a typed command with a blinking caret in a Window](img/api/typed-caret.png)

| Prop | Type | Default |
|---|---|---|
| `h` | `number` | `40` |
| `color` | `string` | `color.textPrimary` |
| `blink` | `boolean` | `true` |

Blinking text caret, sized to a line height. Pair with `useTyped` for a typed line.

---

## Pixel-grid family

### `DotText`

![DotText: 5x7 dot-matrix text](img/api/dottext.png)

5x7 dot-matrix text, built pixel by pixel rather than drawn with a font file.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `text` | `string` | required | Uppercased; unsupported characters render as a blank cell |
| `at` | `number` | required | |
| `px` | `number` | `14` | px per cell |
| `colors` | `string[] \| "cycle"` | `"cycle"` | `"cycle"` uses the token/design accent, accentAlt, success, warn four |
| `solid` | `string` | | Overrides `colors` with one flat colour for every pixel |
| `build` | `"scatter" \| "wipe" \| "none"` | `"wipe"` | |
| `out` | `number` | | Frame the exit starts |
| `glow` | `number` | `0.6` | |
| `seed` | `number` | `3` | |

### `PixelLogo`

![PixelLogo: a four-square mark assembled from its own rects](img/api/pixellogo.png)

Assembles a pixel-grid logo from its own rect shapes, each flying in from a ring
around the mark (`build="scatter"`) or rendered flat (`build="none"`). The ring's
centre and spread come from the shapes' own bounding box, so this works for any
pixel-grid logo.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `shapes` | `PixelShape[]` | required | `{ x, y, width, height, color }`, the same shape `extract_brand` already produces for an SVG rect |
| `at` | `number` | required | |
| `scale` | `number` | `1` | Output px per source (viewBox) unit |
| `build` | `"scatter" \| "none"` | `"scatter"` | |
| `glow` | `number` | `0.9` | |
| `out` | `number` | | Frame the exit starts |
| `seed` | `number` | `5` | |
| `style` | `CSSProperties` | | |

### `PixelWipe`

![PixelWipe: a pixel-grid transition part-way through clearing](img/api/pixelwipe.png)

Transition pair, pixel-grid's natural home but usable standalone. Call both
ends of a cut with the same `cell`/`seed` so the out and the following in read
as one continuous move across the cut.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `mode` | `"in" \| "out"` | required | `"in"`: starts fully covered, clears. `"out"`: finishes covered at the scene's last frame |
| `at` | `number` | | Defaults to frame 0 (`in`) or `durationInFrames - dur - 1` (`out`) |
| `dur` | `number` | `12` | |
| `cell` | `number` | `60` | |
| `seed` | `number` | `1` | |
| `bg`, `tint` | | | Default to `design`'s colours if `design` is passed, else the package tokens |
| `design` | `DesignSystem` | | Optional; only informs the default tint and background |

---

## Backgrounds and transitions

| Component | Props | Notes |
|---|---|---|
| `Atmosphere` | `intensity?` (1), `colors?`, `seed?` (2) | Soft drifting radial colour fields behind everything, one blob per colour |
| `DotGrid` | `gap?` (36), `color?` (`#ffffff`), `opacity?` (0.05), `w?`, `h?` (composition size) | Faint texture pass behind a constructed (non-capture) panel. Covers the whole frame by default, 1080x1920 included |
| `Flash` | `at`, `color?` (`#ffffff`), `strength?` (0.55), `dur?` (10) | Brief exposure flash on a hard hit |
| `Black` | `from`, `to?` | Holds solid black. Omit `to` to hold forever |
| `Letterbox` | `amount?` (1) | Bars for a cinematic moment. `amount` scales the bar height, 1 = 64/1080 of the frame height (64px at 1080, about 114px at 1920 tall) |

| | |
|---|---|
| ![Atmosphere: drifting colour fields](img/api/atmosphere.png) `Atmosphere` | ![DotGrid: a faint dot texture behind a Glass panel](img/api/dotgrid.png) `DotGrid` |
| ![Flash: the frame during an exposure flash](img/api/flash.png) `Flash` | ![Letterbox: cinematic bars](img/api/letterbox.png) `Letterbox` |
| ![Black: a solid black frame, with the scene held under it](img/api/black.png) `Black` | |

---

## UI chrome

### `Window`

![Window with JsonView: real JSON revealed line by line](img/api/window-jsonview.png)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | `string` | | Omit for no title bar |
| `width` | `number` | required | |
| `height` | `number` | | |
| `light` | `boolean` | | Light chrome instead of the dark default, matches `BrowserFrame`'s light mode |
| `glow` | `string` | | Hex colour for an outer glow, when this window is the shot's focal point |
| `titleRight` | `ReactNode` | | |
| `children` | `ReactNode` | required | |

### `JsonView`

Syntax-coloured JSON of a real object, revealed line by line. An actually-rendered
view, not a screenshot of a JSON blob (the same ground-truth bias as `TerminalReplay`
being DOM text instead of a recorded terminal).

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `unknown` | required | `JSON.stringify(value, null, 2)`, line by line |
| `at` | `number` | `0` | |
| `perLine` | `number` | `1.2` | Frames between each line's reveal |
| `fontSize` | `number` | `20` | |
| `highlight` | `(line, i) => string \| undefined` | | Returns a hex accent to highlight a line with |
| `maxLines` | `number` | `400` | |
| `scroll` | `number` | `0` | |

### `Check`, `Cross`

![Check and Cross inside a Glass panel](img/api/check-cross-glass.png)

| Prop | Type | Default |
|---|---|---|
| `size` | `number` | required |
| `color` | `string` | `color.success` (`Check`) / `color.danger` (`Cross`) |
| `at` | `number` | `0`, `Check` only (draws its tick stroke in) |

### `ToolChip`

![ToolChip with a finished check, and two Pills](img/api/toolchip-pill.png)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `name` | `string` | required | |
| `at` | `number` | required | |
| `doneAt` | `number` | | Swaps the spinner for a `Check` once passed |
| `color` | `string` | `color.accent` | |
| `size` | `number` | `20` | |

"▸ tool_name" chip: spinner while running, a check once done.

### `Pill`

| Prop | Type | Default |
|---|---|---|
| `children` | `ReactNode` | required |
| `color` | `string` | `color.textSecondary` |
| `size` | `number` | `18` |
| `style` | `CSSProperties` | |

### `Glass`

| Prop | Type | Default |
|---|---|---|
| `children` | `ReactNode` | required |
| `style` | `CSSProperties` | |
| `pad` | `number` | `28` |

Frosted glass panel: `backdrop-filter: blur`, for a floating card over motion.

### `ChapterHud`

![ChapterHud: the chapter label top left and the progress rail along the bottom](img/api/chapterhud.png)

Screen space, meant for a scene's `overlay` (like `Caption`), not camera-transformed.
A dot-matrix chapter number and label top-left, a progress rail bottom.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `chapters` | `Chapter[]` | required | `{ label: string }` |
| `activeIndex` | `number` | required | |
| `firstFrame` | `boolean` | `true` | True during this chapter's own opening stretch (plays the label-in and rail fill-in); false just holds the rail filled |
| `at` | `number` | `4` | |
| `fillDurationInFrames` | `number` | `90` | Pass the chapter's own duration so the fill lands exactly as it ends |
| `design` | `DesignSystem` | | Reads `grid.marginBottom` and palette from it when passed |
| `accentColor` | `string` | | Overrides `design`'s or the token success colour |

---

## A scene, end to end

```tsx
import React from "react";
import { CinematicScene, Layer, TerminalReplay, Caption, color, E } from "@openvidstudio/core";

export const Install: React.FC = () => (
  <CinematicScene
    camera={[
      { frame: 0, x: 960, y: 540, scale: 1.05, rotZ: -0.4 },
      { frame: 300, x: 960, y: 548, scale: 1.15, rotZ: 0.35, easing: E.drift },
    ]}
    overlay={<Caption text="one command" at={40} out={240} />}
  >
    <Layer depth={0}>
      <div style={{ position: "absolute", inset: 0, display: "flex",
                    alignItems: "center", justifyContent: "center" }}>
        <TerminalReplay
          width={1400}
          steps={[
            { type: "cmd", text: "npx -y @openvidstudio/mcp-server" },
            { type: "out", lines: [{ text: "connected over stdio", color: color.success, glow: true }] },
          ]}
        />
      </div>
    </Layer>
  </CinematicScene>
);
```

Two keyframes so it moves, content centred inside the safe area, caption in the
overlay, tokens instead of hex.

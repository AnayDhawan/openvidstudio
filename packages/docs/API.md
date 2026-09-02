# API.md: everything `@openvidstudio/core` exports

Written because the alternative is reading the library source. If you are an agent
about to write a scene, this file has every prop you need and you should not have to
open `packages/core/src`.

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
| `stageWidth` | `number` | `1920` | |
| `stageHeight` | `number` | `1080` | |
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
- Run `validate_scenes` and it will tell you which scenes are cropping.

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
| `sfx` | `boolean` | `true` |

Per word entrance. Renders nothing before `at`.

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
No star action by default.

---

## Sound

All synthesized by `scripts/gen-sfx.sh` with ffmpeg, so a rendered video carries no
third-party audio rights. Regenerate with `bash scripts/gen-sfx.sh`.

| Component | Props | Use |
|---|---|---|
| `KeySound` | `at`, `seed?`, `volume?` (0.16) | One keystroke |
| `TypingSfx` | `charFrames`, `volume?` | One key per typed character |
| `EnterKey` | `at`, `volume?` (0.2) | End of a typed command |
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

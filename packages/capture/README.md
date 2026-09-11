# @openvidstudio/capture

Getting a true frame out of a running product. No Remotion, no React, no video pipeline.

This is the half of [openvidstudio](https://github.com/AnayDhawan/openvidstudio) that is
hard, and it is useful on its own. If you want reliable captures of your app and you are
not making a video, take this package and ignore the rest.

## What is in it

**Browser capture that measures the zoom instead of assuming it.** Chrome keeps zoom
per origin, so `setViewportSize(1600x1000)` can leave you with an effective viewport that
is not 1600x1000, and every crop rect computed against the requested size is then wrong.
Nothing errors. `detectAndCompensateZoom` measures `window.innerWidth` live, re-requests a
compensated size, verifies convergence, and throws rather than proceed with a crop measured
against the wrong viewport. The ratio is never hardcoded: it differs per machine and per
profile.

**Interaction replay.** A small declarative `Interaction[]` (click, fill, select, hover,
scroll, wait) with a zod schema, replayed in array order, so two capture callers cannot
drift apart in how they drive the page.

**Backends for what a browser cannot reach.** Desktop windows and regions through ffmpeg
(`gdigrab`, `avfoundation`, `x11grab`, `pipewiregrab`), Android through `adb screenrecord`,
the iOS Simulator through `simctl io recordVideo`, and terminals through a recorded cast.
These are pure argv builders plus a thin spawn wrapper, so they are testable without a
screen attached and safe with argument values containing spaces.

## Install

```bash
npm install @openvidstudio/capture
npx playwright install chromium   # browser capture only
```

`ffmpeg` on PATH is required for the native backends, `adb` for Android, Xcode command
line tools for the iOS Simulator.

## Use

```ts
import { launchChromium, detectAndCompensateZoom, replayInteractions } from "@openvidstudio/capture";

const browser = await launchChromium();
const page = await browser.newPage();
await page.setViewportSize({ width: 1600, height: 1000 });
await page.goto("http://localhost:3000");

const { zoom } = await detectAndCompensateZoom(page, { width: 1600, height: 1000 });
await replayInteractions(page, [{ type: "click", selector: "[data-tour=start]" }]);
await page.screenshot({ path: "shot.png" });
```

```ts
import { buildDesktopCaptureArgs } from "@openvidstudio/capture";

const args = buildDesktopCaptureArgs({
  platform: "win32",
  window: "My App",
  framerate: 30,
  durationSeconds: 8,
  outPath: "out.mp4",
});
// spawn("ffmpeg", args)
```

## License

Apache-2.0

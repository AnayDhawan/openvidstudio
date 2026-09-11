/**
 * Shared beats.json TypeScript types, matching packages/docs/PLANNING.md §4's
 * captureMethod field spec. These describe a beats.json that has already passed
 * validate_beats -- tools that read an *unvalidated* beatsJson (validate_beats
 * itself, write_beats_file's internal check) work off `unknown` instead, since
 * the whole point of validation is to not assume this shape holds yet.
 */

import type { z } from "zod";
import type { interactionSchema } from "@openvidstudio/capture";

export type CaptureMethod = "screenshot" | "recording" | "dom-demo" | "higgsfield" | "existing-asset";

/**
 * Where a captured beat's footage comes from.
 *
 * `browser` is the original and remains the default when the field is absent, so every
 * beats.json written before this existed stays valid and unchanged. The other three
 * exist because Playwright can only drive a web page: a desktop application, a phone,
 * and a terminal each have real, filmable software behind them and no URL, which is why
 * beats about them used to collapse into hand-drawn `dom-demo` panels.
 */
export type CaptureSource = "browser" | "desktop" | "mobile" | "terminal";

/**
 * Derived from capture.ts's `interactionSchema` (the zod discriminated union
 * capture_screenshot/capture_screen_recording actually enforce at replay time), via
 * `z.infer`, rather than restated by hand -- this is the fix for the beats.ts/capture.ts
 * Interaction fork (docs said "navigate"/"click"/"type"/"scroll"/"wait", capture.ts
 * enforced "click"/"fill"/"select"/"hover"/"scroll"/"wait"; capture.ts is the real,
 * enforced schema, so it's now the single source of truth both sides derive from and
 * cannot drift apart from again). `import type` only: no runtime dependency on
 * capture.ts (or its playwright import) is introduced by this type alias.
 */
export type Interaction = z.infer<typeof interactionSchema>;

/** A browser capture. `source` may be omitted entirely, since "browser" is the default. */
export interface CaptureVisual {
  captureMethod: "screenshot" | "recording";
  source?: "browser";
  url: string;
  interactions: Interaction[];
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A desktop app, a single window, or a whole display. Recorded by capture_desktop. */
export interface DesktopVisual {
  captureMethod: "recording";
  source: "desktop";
  /** Window title. Omit to record the whole display. */
  window?: string;
  region?: Region;
  display?: number;
  durationSeconds: number;
}

/** A real phone or simulator. Recorded by capture_mobile. */
export interface MobileVisual {
  captureMethod: "recording";
  source: "mobile";
  device: "android" | "ios-simulator";
  deviceId?: string;
  durationSeconds: number;
}

/** A real command run, recorded as timed text rather than pixels. See capture_terminal. */
export interface TerminalVisual {
  captureMethod: "recording";
  source: "terminal";
  command: string;
  args?: string[];
  cwd?: string;
  script?: { type: "type" | "wait"; text?: string; ms?: number }[];
}

export interface DomDemoVisual {
  captureMethod: "dom-demo";
}

export interface HiggsfieldVisual {
  captureMethod: "higgsfield";
  higgsfieldPrompt: string;
}

/**
 * A real asset the project already published, that this pipeline did not capture.
 *
 * Plenty of projects ship genuine screenshots of themselves (a docs site's images, a
 * manual's figures). Before this existed there was no way to put one on screen: the
 * capture methods all mean "film it now", so a real, existing image had to masquerade
 * as a hand-drawn `dom-demo`. `attribution` is required because the honesty rules only
 * hold if the video can say where a frame came from.
 */
export interface ExistingAssetVisual {
  captureMethod: "existing-asset";
  assetPath: string;
  attribution: string;
}

export type Visual =
  | CaptureVisual
  | DesktopVisual
  | MobileVisual
  | TerminalVisual
  | DomDemoVisual
  | HiggsfieldVisual
  | ExistingAssetVisual;

/** PIPELINE.md §2's cut/whip/fade choice, SFX-cued today but never recorded on the beat itself. */
export type Transition = "cut" | "whip" | "fade";

/**
 * Explicit named references to this beat's on-disk outputs. Every tool already agrees on
 * the convention path (PIPELINE.md's Asset conventions table: public/images/<id>.png,
 * public/video/<id>.mp4, public/audio/vo/<id>.mp3), and capture_screenshot /
 * capture_screen_recording already accept an outPath override and report it back -- this
 * field is what makes that override, and the resulting path, visible on the manifest
 * itself instead of only in a tool call's return value. All optional: omit a key and the
 * convention path is assumed.
 */
export interface Artifacts {
  screenshotPath?: string;
  recordingPath?: string;
  voPath?: string;
  /** capture_terminal's JSON cast, default public/terminal/<beatId>.json. */
  terminalPath?: string;
}

export interface Beat {
  id: string;
  start: number;
  duration: number;
  vo: string;
  visual: Visual;
  /** Cut if omitted, matching current SFX defaults (PIPELINE.md §2). */
  transition?: Transition;
  artifacts?: Artifacts;
}

export interface BeatsFile {
  /** 30fps assumed if omitted, per PLANNING.md / PIPELINE.md. */
  fps?: number;
  title: string;
  beats: Beat[];
}

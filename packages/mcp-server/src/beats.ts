/**
 * Shared beats.json TypeScript types, matching packages/docs/PLANNING.md §4's
 * captureMethod field spec. These describe a beats.json that has already passed
 * validate_beats -- tools that read an *unvalidated* beatsJson (validate_beats
 * itself, write_beats_file's internal check) work off `unknown` instead, since
 * the whole point of validation is to not assume this shape holds yet.
 */

import type { z } from "zod";
import type { interactionSchema } from "./capture";

export type CaptureMethod = "screenshot" | "recording" | "dom-demo" | "higgsfield";

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

export interface CaptureVisual {
  captureMethod: "screenshot" | "recording";
  url: string;
  interactions: Interaction[];
}

export interface DomDemoVisual {
  captureMethod: "dom-demo";
}

export interface HiggsfieldVisual {
  captureMethod: "higgsfield";
  higgsfieldPrompt: string;
}

export type Visual = CaptureVisual | DomDemoVisual | HiggsfieldVisual;

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

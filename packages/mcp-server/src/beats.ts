/**
 * Shared beats.json TypeScript types, matching packages/docs/PLANNING.md §4's
 * captureMethod field spec. These describe a beats.json that has already passed
 * validate_beats -- tools that read an *unvalidated* beatsJson (validate_beats
 * itself, write_beats_file's internal check) work off `unknown` instead, since
 * the whole point of validation is to not assume this shape holds yet.
 */

export type CaptureMethod = "screenshot" | "recording" | "dom-demo" | "higgsfield";

export interface Interaction {
  type: "navigate" | "click" | "type" | "scroll" | "wait";
  selector?: string;
  value?: string;
  ms?: number;
  url?: string;
}

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

export interface Beat {
  id: string;
  start: number;
  duration: number;
  vo: string;
  visual: Visual;
}

export interface BeatsFile {
  /** 30fps assumed if omitted, per PLANNING.md / PIPELINE.md. */
  fps?: number;
  title: string;
  beats: Beat[];
}

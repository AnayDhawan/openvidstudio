/**
 * Converts a capture_terminal cast into TerminalReplay's TermStep[].
 *
 * The cast stores what actually happened: every stdout/stderr chunk with the millisecond
 * offset it arrived at. TerminalReplay thinks in frames and in typed commands versus
 * revealed output. This bridges the two, and the thing it must not lose is the real
 * timing: a build that paused four seconds should pause four seconds on screen, because
 * honest waiting is most of what makes a terminal demo convincing.
 */

export interface TerminalCastLike {
  command?: string;
  cols?: number;
  rows?: number;
  durationMs?: number;
  events?: [number, string, string][];
}

export type TermLine = { text: string; color?: string; glow?: boolean; bold?: boolean };
export type TermStep =
  | { type: "cmd"; text: string }
  | { type: "out"; lines: TermLine[]; stagger?: number; preDelay?: number }
  | { type: "pause"; frames: number };

/** Gaps shorter than this are just chunk boundaries, not real waiting, so they are not drawn. */
const MIN_PAUSE_MS = 220;
/** A very long wait is real but boring; compress it rather than stalling the video on it. */
const MAX_PAUSE_MS = 2500;

const COLOR_STDERR = "color.danger";
const COLOR_STDOUT = "color.textSecondary";

/**
 * Strips ANSI escape sequences. TerminalReplay renders plain text with its own colours,
 * so leaving raw escapes in would print literal garbage like `[0;32m` on screen.
 * Colour intent is preserved coarsely instead, via the stdout/stderr split.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

export function castToSteps(cast: TerminalCastLike, fps = 30): TermStep[] {
  const steps: TermStep[] = [];
  const command = (cast.command ?? "").trim();
  if (command.length > 0) {
    steps.push({ type: "cmd", text: command });
  }

  const events = Array.isArray(cast.events) ? cast.events : [];
  let prevMs = 0;

  for (const event of events) {
    if (!Array.isArray(event) || event.length < 3) continue;
    const [ms, stream, raw] = event;
    if (typeof ms !== "number" || typeof raw !== "string") continue;

    const gap = ms - prevMs;
    prevMs = ms;
    if (gap >= MIN_PAUSE_MS) {
      steps.push({ type: "pause", frames: Math.round((Math.min(gap, MAX_PAUSE_MS) / 1000) * fps) });
    }

    const lines = stripAnsi(raw)
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((text) => ({ text, color: stream === "e" ? COLOR_STDERR : COLOR_STDOUT }));

    if (lines.length > 0) {
      steps.push({ type: "out", lines });
    }
  }

  return steps;
}

/**
 * Serializes steps into the generated scene.
 *
 * `color.textSecondary` has to appear as an identifier in the emitted TSX, not as the
 * string "color.textSecondary", so the scene picks up whatever palette extract_brand
 * resolved. JSON.stringify would quote it, so the quotes are removed afterwards.
 */
export function serializeSteps(steps: TermStep[]): string {
  const json = JSON.stringify(steps, null, 2);
  return json.replace(/"color":\s*"(color\.[A-Za-z]+)"/g, '"color": $1');
}

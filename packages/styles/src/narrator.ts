import { drawSprite, frameAt, makeSprite, type DrawSpriteOptions, type Sprite } from "./sprites";
import { ACCENTS } from "./tokens";

export type Pose = "idle" | "talk" | "point" | "think" | "celebrate";
export const POSES: readonly Pose[] = ["idle", "talk", "point", "think", "celebrate"];

export const NARRATOR_WIDTH = 16;
export const NARRATOR_HEIGHT = 23;

/** The narrator's base palette. "b" (shirt) and "a" (sparkle) take the lesson's accent. */
export function narratorPalette(accent: string = ACCENTS.math): Record<string, string> {
  return {
    o: "#14172B",
    h: "#5B4A8A",
    s: "#FFD2A8",
    e: "#14172B",
    m: "#D6455D",
    b: accent,
    w: "#FFFFFF",
    p: "#3F4B73",
    a: accent,
  };
}

class Grid {
  private rows: string[][];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.rows = Array.from({ length: h }, () => Array<string>(w).fill("."));
  }
  set(x: number, y: number, text: string): void {
    for (let i = 0; i < text.length; i++) {
      const px = x + i;
      if (px >= 0 && px < this.w && y >= 0 && y < this.h) this.rows[y][px] = text[i];
    }
  }
  lines(): string[] {
    return this.rows.map((r) => r.join(""));
  }
}

type Mouth = "closed" | "open" | "half" | "grin";

interface Spec {
  pose: Pose;
  /** Rows the figure sits below the top of the sprite (the headroom is for jumps and the thought dots). */
  oy: number;
  blink?: boolean;
  mouth?: Mouth;
  /** point: how far the arm reaches. think: dots shown. celebrate: sparkle phase. */
  k?: number;
}

function build(spec: Spec): string[] {
  const g = new Grid(NARRATOR_WIDTH, NARRATOR_HEIGHT);
  const y = spec.oy;
  const eyes = spec.blink || spec.pose === "celebrate" ? "ssoossooss" : "sseessseess";
  // head, 9 rows
  g.set(0, y + 0, "....oooooooo....");
  g.set(0, y + 1, "...ohhhhhhhho...");
  g.set(0, y + 2, "..ohhhhhhhhhho..");
  g.set(0, y + 3, "..o" + "hssssssssh" + "o..");
  g.set(0, y + 4, "..o" + eyes + "o..");
  g.set(0, y + 5, "..o" + "ssssssssss" + "o..");
  const mouths: Record<Mouth, [string, string]> = {
    closed: ["ssssmmssss", "ssssssssss"],
    half: ["ssssmmssss", "sssssmssss"],
    open: ["ssssmmssss", "ssssmmssss"],
    grin: ["sssmmmmsss", "ssssssssss"],
  };
  const [mouth1, mouth2] = mouths[spec.mouth ?? "closed"];
  g.set(0, y + 6, "..o" + mouth1 + "o..");
  g.set(0, y + 7, "..o" + mouth2 + "o..");
  g.set(0, y + 8, "...oooooooooo...");

  // torso
  g.set(0, y + 9, "....oooooooo....");
  for (let r = 10; r <= 14; r++) g.set(0, y + r, r === 12 ? "....obbwwbbo...." : "....obbbbbbo....");
  g.set(0, y + 15, "....oooooooo....");

  // legs and shoes
  g.set(0, y + 16, "....oppppppo....");
  g.set(0, y + 17, "....opppoppo....");
  g.set(0, y + 18, "....oppo.ppo....");
  g.set(0, y + 19, "...owwo..owwo...");
  g.set(0, y + 20, "...oooo..oooo...");

  const armDown = (left: boolean): void => {
    for (let r = 10; r <= 14; r++) {
      if (left) {
        g.set(2, y + r, "os");
      } else {
        g.set(12, y + r, "so");
      }
    }
    if (left) g.set(2, y + 15, "oo");
    else g.set(12, y + 15, "oo");
  };

  switch (spec.pose) {
    case "idle":
    case "talk":
      armDown(true);
      armDown(false);
      break;
    case "point": {
      armDown(true);
      const reach = spec.k ?? 0;
      g.set(12, y + 9, "oooo");
      g.set(12, y + 10, "ssss");
      g.set(12, y + 11, "oooo");
      if (reach === 0) {
        g.set(15, y + 9, ".");
        g.set(15, y + 10, ".");
        g.set(15, y + 11, ".");
        g.set(14, y + 9, "o");
        g.set(14, y + 10, "o");
        g.set(14, y + 11, "o");
      }
      break;
    }
    case "think": {
      armDown(true);
      g.set(12, y + 8, "ss");
      g.set(14, y + 8, "o");
      g.set(12, y + 9, "ss");
      g.set(14, y + 9, "o");
      for (let r = 10; r <= 12; r++) g.set(12, y + r, "so");
      const dots = spec.k ?? 0;
      const at = [11, 13, 15];
      for (let i = 0; i < dots && i < 3; i++) g.set(at[i], 0, "w");
      break;
    }
    case "celebrate": {
      for (let r = 3; r <= 10; r++) {
        g.set(0, y + r, "os");
        g.set(14, y + r, "so");
      }
      g.set(2, y + 9, "s");
      g.set(2, y + 10, "s");
      g.set(13, y + 9, "s");
      g.set(13, y + 10, "s");
      g.set(0, y + 2, "ss");
      g.set(14, y + 2, "ss");
      const phase = spec.k ?? 0;
      if (phase === 0) {
        g.set(0, 0, "a");
        g.set(15, 0, "a");
      } else {
        g.set(2, 0, "a");
        g.set(13, 0, "a");
      }
      break;
    }
  }
  return g.lines();
}

const OY = 2;

const FRAMES: Record<Pose, { frames: Spec[]; fps: number }> = {
  idle: {
    fps: 4,
    frames: [
      { pose: "idle", oy: OY },
      { pose: "idle", oy: OY },
      { pose: "idle", oy: OY },
      { pose: "idle", oy: OY },
      { pose: "idle", oy: OY },
      { pose: "idle", oy: OY, blink: true },
      { pose: "idle", oy: OY },
      { pose: "idle", oy: OY },
    ],
  },
  talk: {
    fps: 8,
    frames: [
      { pose: "talk", oy: OY, mouth: "half" },
      { pose: "talk", oy: OY, mouth: "open" },
      { pose: "talk", oy: OY, mouth: "closed" },
      { pose: "talk", oy: OY, mouth: "open" },
    ],
  },
  point: {
    fps: 3,
    frames: [
      { pose: "point", oy: OY, mouth: "half", k: 0 },
      { pose: "point", oy: OY, mouth: "closed", k: 1 },
    ],
  },
  think: {
    fps: 2,
    frames: [
      { pose: "think", oy: OY, k: 0 },
      { pose: "think", oy: OY, k: 1 },
      { pose: "think", oy: OY, k: 2 },
      { pose: "think", oy: OY, k: 3 },
    ],
  },
  celebrate: {
    fps: 5,
    frames: [
      { pose: "celebrate", oy: 1, mouth: "grin", k: 0 },
      { pose: "celebrate", oy: 0, mouth: "grin", k: 1 },
    ],
  },
};

const cache = new Map<string, Sprite>();

/** The narrator sprite for a pose, in an accent colour. Sprites are cached per pose and accent. */
export function narratorSprite(pose: Pose, accent: string = ACCENTS.math): Sprite {
  const key = `${pose}|${accent}`;
  let s = cache.get(key);
  if (!s) {
    const def = FRAMES[pose];
    s = makeSprite(narratorPalette(accent), def.frames.map(build), def.fps);
    cache.set(key, s);
  }
  return s;
}

/** Which animation frame the pose shows at time t (seconds). Pure in t. */
export function narratorFrame(pose: Pose, t: number): number {
  return frameAt(narratorSprite(pose), t);
}

/** Draws the narrator in a pose at time t. (x, y) is the sprite's top-left. */
export function drawNarrator(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  x: number,
  y: number,
  scale: number,
  t: number,
  accent: string = ACCENTS.math,
  opts: DrawSpriteOptions = {},
): void {
  const sprite = narratorSprite(pose, accent);
  drawSprite(ctx, sprite, x, y, scale, frameAt(sprite, t), opts);
}

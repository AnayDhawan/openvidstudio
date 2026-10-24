import { drawSprite, frameAt, makeSprite, type DrawSpriteOptions, type Sprite } from "./sprites";

const BALL = makeSprite(
  { o: "#14172B", r: "#FF4D5E", w: "#FFFFFF" },
  [
    ["..oooo..", ".orrrro.", "orwrrrro", "orrrrrro", "orrrrrro", "orrrrrro", ".orrrro.", "..oooo.."],
    ["..oooo..", ".orrrro.", "orrrrrro", "orrwrrro", "orrrrrro", "orrrrrro", ".orrrro.", "..oooo.."],
  ],
  4,
);

const RULER = makeSprite({ o: "#14172B", y: "#FFD36B", t: "#14172B" }, [
  [
    "oooooooooooooooo",
    "otyytyytyytyytyo",
    "oyyyyyyyyyyyyyyo",
    "oyyyyyyyyyyyyyyo",
    "oooooooooooooooo",
  ],
]);

const BATTERY = makeSprite(
  { o: "#14172B", w: "#E7ECF7", k: "#3A3F55", g: "#7CFFB2" },
  [
    ["..oooo..", "..owwo..", "oooooooo", "okkkkkko", "okggggko", "okggggko", "okkkkkko", "okggggko", "okggggko", "okkkkkko", "okkkkkko", "oooooooo"],
    ["..oooo..", "..owwo..", "oooooooo", "okkkkkko", "okggggko", "okggggko", "okkkkkko", "okggggko", "okkkkkko", "okkkkkko", "okkkkkko", "oooooooo"],
  ],
  2,
);

const CABLE = makeSprite({ o: "#14172B", w: "#E7ECF7", c: "#FFB347" }, [
  [
    "ooo.............",
    "owwoo...........",
    "ooooccc.........",
    ".....cccc.......",
    ".......cccc.....",
    ".........ccccooo",
    "..........ooowwo",
    "...........oooo.",
  ],
]);

const BRIDGE = makeSprite({ o: "#14172B", y: "#C98B4B" }, [
  [
    "........................",
    "oooooooooooooooooooooooo",
    "oyyyyyyyyyyyyyyyyyyyyyyo",
    "oooooooooooooooooooooooo",
    "o..o..o..o..o..o..o..o..",
    "o.o.o.o.o.o.o.o.o.o.o.o.",
    "oo..oo..oo..oo..oo..oo..",
    "oooooooooooooooooooooooo",
  ],
]);

const BAT = makeSprite({ o: "#14172B", k: "#3A3F55", y: "#D9A066" }, [
  [
    "..oo..",
    ".okko.",
    ".okko.",
    ".okko.",
    ".okko.",
    ".okko.",
    ".okko.",
    ".okko.",
    ".okko.",
    ".oyyo.",
    "oyyyyo",
    "oyyyyo",
    "oyyyyo",
    "oyyyyo",
    "oyyyyo",
    ".oooo.",
  ],
]);

const registry = new Map<string, Sprite>([
  ["ball", BALL],
  ["ruler", RULER],
  ["battery", BATTERY],
  ["cable", CABLE],
  ["bridge", BRIDGE],
  ["bat", BAT],
]);

/** Names of the built-in props, in a stable order. */
export const BUILTIN_PROPS = ["ball", "ruler", "battery", "cable", "bridge", "bat"] as const;

/**
 * Adds a prop a lesson needs (a beaker, a magnet, a cell). Build it with makeSprite. A name that
 * already exists is refused unless `overwrite` is set, so a lesson cannot silently change a built-in.
 */
export function registerProp(name: string, sprite: Sprite, overwrite = false): void {
  if (registry.has(name) && !overwrite) throw new Error(`A prop named "${name}" already exists; pass overwrite to replace it.`);
  registry.set(name, sprite);
}

export function getProp(name: string): Sprite {
  const s = registry.get(name);
  if (!s) throw new Error(`No prop named "${name}". Known: ${propNames().join(", ")}.`);
  return s;
}

export function propNames(): string[] {
  return [...registry.keys()];
}

/** Draws a prop by name; animated props (ball, battery) pick their frame from t. */
export function drawProp(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  scale: number,
  t = 0,
  opts: DrawSpriteOptions = {},
): void {
  const sprite = getProp(name);
  drawSprite(ctx, sprite, x, y, scale, frameAt(sprite, t), opts);
}

/**
 * The pixel font. Two paths, both offline-safe by default:
 *
 * 1. BITMAP_FONT: a 5x7 font authored for this package and drawn with fillRect (drawPixelText), so
 *    it needs no file and no network and is as crisp as the sprites. It is Apache-2.0 like the package.
 * 2. PIXEL_FONT: the name and Google Fonts URL of "Press Start 2P" (SIL Open Font License 1.1) for text
 *    that goes through the normal font stack (fitText, captions). Nothing is vendored or fetched by
 *    this package: a lesson that wants it adds the stylesheet link, and text falls back to
 *    PIXEL_FONT.fallback when it is absent.
 */
export const PIXEL_FONT = {
  family: "Press Start 2P",
  fallback: "monospace",
  stack: '"Press Start 2P", monospace',
  stylesheet: "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap",
  license: "SIL Open Font License 1.1",
} as const;

export const GLYPH_W = 5;
export const GLYPH_H = 7;

const SRC: Record<string, string> = {
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#",
  B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.",
  D: "####./#...#/#...#/#...#/#...#/#...#/####.",
  E: "#####/#..../#..../####./#..../#..../#####",
  F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.###.",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: ".###./..#../..#../..#../..#../..#../.###.",
  J: "..###/...#./...#./...#./...#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#",
  L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#",
  N: "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
  P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".####/#..../#..../.###./....#/....#/####.",
  T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..",
  Z: "#####/....#/...#./..#../.#.../#..../#####",
  "0": ".###./#...#/#..##/#.#.#/##..#/#...#/.###.",
  "1": "..#../.##../..#../..#../..#../..#../.###.",
  "2": ".###./#...#/....#/...#./..#../.#.../#####",
  "3": "####./....#/....#/.###./....#/....#/####.",
  "4": "#...#/#...#/#...#/#####/....#/....#/....#",
  "5": "#####/#..../####./....#/....#/#...#/.###.",
  "6": ".###./#..../#..../####./#...#/#...#/.###.",
  "7": "#####/....#/...#./..#../.#.../.#.../.#...",
  "8": ".###./#...#/#...#/.###./#...#/#...#/.###.",
  "9": ".###./#...#/#...#/.####/....#/....#/.###.",
  ".": "...../...../...../...../...../.##../.##..",
  ",": "...../...../...../...../.##../..#../.#...",
  ":": "...../.##../.##../...../.##../.##../.....",
  "!": "..#../..#../..#../..#../..#../...../..#..",
  "?": ".###./#...#/....#/...#./..#../...../..#..",
  "-": "...../...../...../#####/...../...../.....",
  "+": "...../..#../..#../#####/..#../..#../.....",
  "=": "...../...../#####/...../#####/...../.....",
  "/": "....#/....#/...#./..#../.#.../#..../#....",
  "(": "...#./..#../.#.../.#.../.#.../..#../...#.",
  ")": ".#.../..#../...#./...#./...#./..#../.#...",
  "%": "##..#/##..#/...#./..#../.#.../#..##/#..##",
  "'": "..#../..#../.#.../...../...../...../.....",
  " ": "...../...../...../...../...../...../.....",
};

/** Glyph rows by character (uppercase, digits and basic punctuation), each GLYPH_H strings of GLYPH_W. */
export const BITMAP_FONT: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SRC).map(([ch, rows]) => [ch, rows.split("/")]),
);

function glyphFor(ch: string): readonly string[] {
  return BITMAP_FONT[ch.toUpperCase()] ?? BITMAP_FONT["?"];
}

/** Width in px of text drawn by drawPixelText at a scale. */
export function measurePixelText(text: string, scale: number): number {
  const s = Math.max(1, Math.round(scale));
  return text.length === 0 ? 0 : (text.length * (GLYPH_W + 1) - 1) * s;
}

/** Draws text in the built-in bitmap font with fillRect. (x, y) is the top-left. Returns the width drawn. */
export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string,
): number {
  const s = Math.max(1, Math.round(scale));
  const ox = Math.round(x);
  const oy = Math.round(y);
  ctx.save();
  ctx.fillStyle = color;
  let cx = ox;
  for (const ch of text) {
    const rows = glyphFor(ch);
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (rows[r][c] === "#") ctx.fillRect(cx + c * s, oy + r * s, s, s);
      }
    }
    cx += (GLYPH_W + 1) * s;
  }
  ctx.restore();
  return measurePixelText(text, s);
}

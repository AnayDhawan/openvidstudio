/**
 * Palette-indexed string-grid sprites. Each frame is an array of equal-width strings; every
 * character is a palette key, and "." is transparent. Drawing is integer-scale fillRect with
 * smoothing off, so a pixel is exactly scale x scale device pixels with no blending.
 */
export interface Sprite {
  readonly width: number;
  readonly height: number;
  /** Palette key (one character) to a CSS colour. */
  readonly palette: Readonly<Record<string, string>>;
  readonly frames: readonly (readonly string[])[];
  /** Frames per second when played by time (see frameAt). */
  readonly fps: number;
}

export function makeSprite(
  palette: Record<string, string>,
  frames: readonly (readonly string[])[],
  fps = 6,
): Sprite {
  if (frames.length === 0) throw new Error("A sprite needs at least one frame.");
  const height = frames[0].length;
  const width = frames[0][0]?.length ?? 0;
  frames.forEach((frame, f) => {
    if (frame.length !== height) throw new Error(`Sprite frame ${f} has ${frame.length} rows; expected ${height}.`);
    frame.forEach((row, r) => {
      if (row.length !== width) throw new Error(`Sprite frame ${f} row ${r} is ${row.length} wide; expected ${width}.`);
      for (const ch of row) {
        if (ch !== "." && !(ch in palette)) throw new Error(`Sprite frame ${f} row ${r} uses "${ch}", which is not in the palette.`);
      }
    });
  });
  return { width, height, palette, frames, fps };
}

/** Which frame plays at time t (seconds): a pure function of t. */
export function frameAt(sprite: Sprite, t: number): number {
  const n = sprite.frames.length;
  const i = Math.floor(Math.max(0, t) * sprite.fps) % n;
  return i;
}

export interface DrawSpriteOptions {
  /** Draw every opaque pixel in this one colour (a silhouette, for shadows). */
  tint?: string;
  /** Mirror left to right. */
  flipX?: boolean;
  /** Replace palette colours by key for this draw. */
  palette?: Record<string, string>;
}

/**
 * Draws one frame with its top-left at (x, y). The scale is rounded to a whole number of at
 * least 1 and the position to whole pixels, so every sprite pixel stays a crisp block.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  scale = 1,
  frame = 0,
  opts: DrawSpriteOptions = {},
): void {
  const s = Math.max(1, Math.round(scale));
  const ox = Math.round(x);
  const oy = Math.round(y);
  const rows = sprite.frames[((frame % sprite.frames.length) + sprite.frames.length) % sprite.frames.length];
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = "source-over";
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      const ch = row[c];
      if (ch === ".") {
        c++;
        continue;
      }
      let end = c + 1;
      while (end < row.length && row[end] === ch) end++;
      ctx.fillStyle = opts.tint ?? opts.palette?.[ch] ?? sprite.palette[ch];
      const px = opts.flipX ? sprite.width - end : c;
      ctx.fillRect(ox + px * s, oy + r * s, (end - c) * s, s);
      c = end;
    }
  }
  ctx.restore();
}

import * as fs from "node:fs";

/**
 * Width and height from a PNG's IHDR chunk.
 *
 * A capture template needs the real dimensions of the file it is about to composite,
 * otherwise the frame is a guess and the page comes out letterboxed or stretched.
 * The header is fixed layout, so this is a 24 byte read rather than a dependency.
 */
export function pngSize(file: string): { width: number; height: number } | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(24);
    if (fs.readSync(fd, head, 0, 24, 0) < 24) return null;
    // 8 byte signature, then a length + "IHDR" tag, then width and height.
    const isPng = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng || head.subarray(12, 16).toString("ascii") !== "IHDR") return null;
    const width = head.readUInt32BE(16);
    const height = head.readUInt32BE(20);
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* nothing useful to do here */
      }
    }
  }
}

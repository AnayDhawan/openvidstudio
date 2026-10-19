// Local, offline font loading for Supernova's display face (Space Grotesk, SIL OFL). Same
// approach as @openvidstudio/core's localFonts.ts: bundled woff2 files served from the project's
// own public/fonts/ through FontFace, gated on delayRender so a render waits for the glyphs.
// init_project copies them there when a project is created in supernova mode. No network, and no
// @remotion/google-fonts loader, which would fetch fonts.gstatic.com at import time and fail an
// offline render. Inter (the body face) is loaded by core.
//
// Import once, for its side effect, from index.ts.

import { continueRender, delayRender, staticFile } from "remotion";

const FILES = [
  { family: "Space Grotesk", weight: "500", file: "fonts/space-grotesk-latin-500-normal.woff2" },
  { family: "Space Grotesk", weight: "700", file: "fonts/space-grotesk-latin-700-normal.woff2" },
];

declare global {
  // eslint-disable-next-line no-var
  var __ovsStemFontsLoaded: boolean | undefined;
}

if (typeof document !== "undefined" && !globalThis.__ovsStemFontsLoaded) {
  globalThis.__ovsStemFontsLoaded = true;
  const handle = delayRender("@openvidstudio/stem: loading local Space Grotesk");
  Promise.all(
    FILES.map((f) =>
      new FontFace(f.family, `url(${staticFile(f.file)}) format("woff2")`, { weight: f.weight, style: "normal" }).load(),
    ),
  )
    .then((faces) => {
      const fonts = document.fonts as unknown as { add: (font: FontFace) => void };
      faces.forEach((face) => fonts.add(face));
      continueRender(handle);
    })
    .catch((err) => {
      // Fall back to the system sans rather than hang the render on a missing file.
      console.error("@openvidstudio/stem: local font load failed", err);
      continueRender(handle);
    });
}

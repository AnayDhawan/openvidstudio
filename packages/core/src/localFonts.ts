// Local, offline font loading (A2). @remotion/google-fonts' loaders fetch
// fonts.gstatic.com at module load time; every scaffolded scene imports from this
// package's index, so a render with no network access crashes before it ever gets to
// a frame. This module instead loads bundled woff2 files (Inter + JetBrains Mono,
// sourced from the @fontsource/inter and @fontsource/jetbrains-mono npm packages, see
// packages/core/scripts/gen-fonts.sh) from the scaffolded project's own public/fonts/
// via `FontFace`, gated on Remotion's delayRender/continueRender so a render always
// waits for the real glyphs instead of racing them.
//
// Import once, for its side effect, from index.ts. Every other module that used to
// call `loadFont(...)` from @remotion/google-fonts now just references the family by
// name ("Inter, system-ui, sans-serif" / "JetBrains Mono, ui-monospace, monospace").

import { continueRender, delayRender, staticFile } from "remotion";

type LocalFontFile = {
  family: string;
  weight: string;
  file: string;
};

const FILES: LocalFontFile[] = [
  { family: "Inter", weight: "400", file: "fonts/inter-latin-400-normal.woff2" },
  { family: "Inter", weight: "500", file: "fonts/inter-latin-500-normal.woff2" },
  { family: "Inter", weight: "700", file: "fonts/inter-latin-700-normal.woff2" },
  { family: "Inter", weight: "800", file: "fonts/inter-latin-800-normal.woff2" },
  { family: "Inter", weight: "900", file: "fonts/inter-latin-900-normal.woff2" },
  { family: "JetBrains Mono", weight: "400", file: "fonts/jetbrains-mono-latin-400-normal.woff2" },
  { family: "JetBrains Mono", weight: "700", file: "fonts/jetbrains-mono-latin-700-normal.woff2" },
];

declare global {
  // eslint-disable-next-line no-var
  var __ovsLocalFontsLoaded: boolean | undefined;
}

// Module-scope side effect, same as the loadFont() calls this replaces: run once per
// document, gate the render on it. Guarded so importing this module from more than
// one scene (every scene does, via index.ts) only issues the FontFace loads once.
if (typeof document !== "undefined" && !globalThis.__ovsLocalFontsLoaded) {
  globalThis.__ovsLocalFontsLoaded = true;
  const handle = delayRender("@openvidstudio/core: loading local Inter + JetBrains Mono fonts");

  Promise.all(
    FILES.map((f) =>
      new FontFace(f.family, `url(${staticFile(f.file)}) format("woff2")`, {
        weight: f.weight,
        style: "normal",
      }).load(),
    ),
  )
    .then((faces) => {
      // TS's DOM lib doesn't declare add()/delete() on FontFaceSet even though every
      // real implementation supports them (it's Set-like per spec); narrow cast only
      // for this call.
      const fonts = document.fonts as unknown as { add: (font: FontFace) => void };
      faces.forEach((face) => fonts.add(face));
      continueRender(handle);
    })
    .catch((err) => {
      // Never let a font-loading failure hang the render forever: log and continue,
      // same fallback behavior offline @remotion/google-fonts had (fallback glyphs)
      // rather than a stuck delayRender.
      console.error("@openvidstudio/core: local font load failed", err);
      continueRender(handle);
    });
}

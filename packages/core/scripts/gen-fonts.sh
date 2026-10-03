#!/bin/bash
# Copy bundled woff2 files for offline rendering (A2) into templates/default/public/fonts/.
# Source: the @fontsource/inter and @fontsource/jetbrains-mono npm packages (license-clean,
# SIL OFL), not hand-downloaded from fonts.gstatic.com. Re-run after bumping either package
# in packages/core/package.json's devDependencies, or if templates/default/public/fonts/ is
# ever wiped. Requires both packages already installed (pnpm install at repo root).
set -e
cd "$(dirname "$0")/.."

INTER="node_modules/@fontsource/inter/files"
MONO="node_modules/@fontsource/jetbrains-mono/files"
OUT="../../templates/default/public/fonts"

if [ ! -d "$INTER" ] || [ ! -d "$MONO" ]; then
  echo "error: @fontsource/inter or @fontsource/jetbrains-mono not installed under packages/core/node_modules." >&2
  echo "Run: pnpm add -D @fontsource/inter @fontsource/jetbrains-mono --filter @openvidstudio/core" >&2
  exit 1
fi

mkdir -p "$OUT"

for w in 400 500 700 800 900; do
  cp "$INTER/inter-latin-$w-normal.woff2" "$OUT/"
done

for w in 400 700; do
  cp "$MONO/jetbrains-mono-latin-$w-normal.woff2" "$OUT/"
done

echo "fonts generated:"
ls "$OUT"

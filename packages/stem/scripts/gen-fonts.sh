#!/bin/bash
# Copy the bundled woff2 files for Supernova's display face into packages/stem/public/fonts/.
# Source: the @fontsource/space-grotesk npm package (SIL OFL), not hand-downloaded from
# fonts.gstatic.com, so a render never needs the network. Re-run after bumping that package.
# Requires it already installed (pnpm install at the repo root).
set -e
cd "$(dirname "$0")/.."

SRC="node_modules/@fontsource/space-grotesk"
OUT="public/fonts"

if [ ! -d "$SRC/files" ]; then
  echo "error: @fontsource/space-grotesk is not installed under packages/stem/node_modules." >&2
  echo "Run: pnpm add -D @fontsource/space-grotesk --filter @openvidstudio/stem" >&2
  exit 1
fi

mkdir -p "$OUT"
for w in 500 700; do
  cp "$SRC/files/space-grotesk-latin-$w-normal.woff2" "$OUT/"
done
cp "$SRC/LICENSE" "$OUT/SPACE-GROTESK-LICENSE.txt"

echo "fonts generated:"
ls -la "$OUT"

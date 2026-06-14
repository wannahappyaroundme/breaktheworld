#!/usr/bin/env bash
# Render an SVG to a crisp PNG using headless Chrome (full gradient/font fidelity).
# Usage: scripts/render.sh <input.svg> <output.png> <width> <height>
set -euo pipefail
SVG="$1"; OUT="$2"; W="$3"; H="$4"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -t render).html"
{
  echo '<!doctype html><html><head><meta charset="utf-8">'
  echo '<style>html,body{margin:0;padding:0}svg{display:block}</style></head><body>'
  cat "$SVG"
  echo '</body></html>'
} > "$TMP"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size="${W},${H}" \
  --default-background-color=00000000 \
  --screenshot="${OUT}.2x.png" "file://${TMP}" >/dev/null 2>&1
magick "${OUT}.2x.png" -resize "${W}x${H}" "$OUT"
rm -f "${OUT}.2x.png" "$TMP"
echo "rendered $OUT"

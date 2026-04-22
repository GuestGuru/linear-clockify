#!/usr/bin/env bash
# Csomagolja a Chrome extensiont egy terjeszthető zip fájlba.
# Csak a runtime-hoz szükséges fájlok kerülnek bele — docs, tests, zip, stb. kimarad.

set -euo pipefail

cd "$(dirname "$0")"

OUT="linear-clockify.zip"

FILES=(
  manifest.json
  background.js
  content.js
  hs-content.js
  shared.js
  popup.html
  popup.js
  options.html
  options.js
  privacy-policy.html
  icons
)

# Ellenőrzés: minden kötelező fájl létezik
for f in "${FILES[@]}"; do
  if [[ ! -e "$f" ]]; then
    echo "HIBA: hiányzó fájl/mappa: $f" >&2
    exit 1
  fi
done

# Verzió kiolvasása a manifestből (csak kiírja, nem módosít)
VERSION=$(grep -E '"version"' manifest.json | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')

rm -f "$OUT"

# -X: extra attribútumok (macOS metadata) nélkül
# -r: rekurzív (icons mappához)
zip -rX "$OUT" "${FILES[@]}" \
  --exclude '*.DS_Store' \
  --exclude '__MACOSX/*'

SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "✓ Kész: $OUT (v$VERSION, $SIZE)"
echo ""
echo "Tartalom:"
unzip -l "$OUT"

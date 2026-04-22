#!/usr/bin/env bash
# Új release taggelése.
#
# Használat:
#   ./scripts/release.sh patch   # 1.0.0 -> 1.0.1
#   ./scripts/release.sh minor   # 1.0.0 -> 1.1.0
#   ./scripts/release.sh major   # 1.0.0 -> 2.0.0
#   ./scripts/release.sh 1.2.3   # kézi verzió
#
# Mit csinál:
#   1. Bumpolja a manifest.json "version" mezőt
#   2. Commitolja a változást ("chore: bump version to vX.Y.Z")
#   3. Létrehozza a vX.Y.Z git tag-et
#   4. Pushol (commit + tag)
#
# A push után a GitHub Action (.github/workflows/release.yml) automatikusan:
#   - legenerálja a linear-clockify.zip-et
#   - létrehozza a GitHub Release-t
#   - feltölti a zipet asset-ként

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -ne 1 ]]; then
  echo "Használat: $0 <patch|minor|major|X.Y.Z>" >&2
  exit 1
fi

BUMP="$1"

# Munka copy tiszta?
if ! git diff-index --quiet HEAD --; then
  echo "HIBA: uncommitted változások vannak. Commitold vagy stash-eld őket először." >&2
  exit 1
fi

CURRENT=$(grep -E '"version"' manifest.json | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
echo "Jelenlegi verzió: $CURRENT"

case "$BUMP" in
  patch|minor|major)
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
    case "$BUMP" in
      patch) PATCH=$((PATCH + 1)) ;;
      minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
      major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    esac
    NEW="$MAJOR.$MINOR.$PATCH"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    NEW="$BUMP"
    ;;
  *)
    echo "HIBA: érvénytelen argumentum: $BUMP" >&2
    echo "Használj patch/minor/major kulcsszót vagy X.Y.Z formátumot." >&2
    exit 1
    ;;
esac

echo "Új verzió: $NEW"

# Már létező tag?
if git rev-parse "v$NEW" >/dev/null 2>&1; then
  echo "HIBA: v$NEW tag már létezik." >&2
  exit 1
fi

# manifest.json frissítése (portable sed in-place)
TMP=$(mktemp)
sed -E "s/(\"version\"[[:space:]]*:[[:space:]]*\")[^\"]+(\")/\1$NEW\2/" manifest.json > "$TMP"
mv "$TMP" manifest.json

# Ellenőrzés
VERIFY=$(grep -E '"version"' manifest.json | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
if [[ "$VERIFY" != "$NEW" ]]; then
  echo "HIBA: manifest.json frissítés nem sikerült." >&2
  exit 1
fi

echo "Commitolás..."
git add manifest.json
git commit -m "chore: bump version to v$NEW"

echo "Tag létrehozása..."
git tag "v$NEW"

echo ""
echo "Kész a lokális commit + tag. Ha minden rendben, pushold:"
echo ""
echo "  git push && git push origin v$NEW"
echo ""
echo "A GitHub Action ezután automatikusan létrehozza a release-t a linear-clockify.zip-pel."

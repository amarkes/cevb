#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PKG="package.json"
CHANGELOG="CHANGELOG.md"

die() { echo "Error: $*" >&2; exit 1; }

get_version() {
  grep -m1 '"version"' "$PKG" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

set_version() {
  local ver="$1"
  if [[ "$(uname)" == Darwin ]]; then
    sed -i '' -E "s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]+\"/\"version\": \"$ver\"/" "$PKG"
  else
    sed -i -E "s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]+\"/\"version\": \"$ver\"/" "$PKG"
  fi
}

bump_version() {
  local kind="$1" current="$2"
  IFS=. read -r major minor patch _ <<< "$current"
  major="${major:-0}"; minor="${minor:-0}"; patch="${patch:-0}"

  case "$kind" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *) die "invalid bump type: $kind" ;;
  esac
  echo "${major}.${minor}.${patch}"
}

echo "=== Commit Elaborator — build ==="
echo ""
echo "Version bump:"
echo "  1) patch"
echo "  2) minor"
echo "  3) major"
read -r -p "Choose [1-3] (default 1): " choice

case "${choice:-1}" in
  1|patch|p) BUMP="patch" ;;
  2|minor|m) BUMP="minor" ;;
  3|major|M) BUMP="major" ;;
  *) die "invalid choice" ;;
esac

CURRENT="$(get_version)"
NEW="$(bump_version "$BUMP" "$CURRENT")"

echo ""
echo "Version: $CURRENT → $NEW ($BUMP)"
echo ""
echo "What changed? (one line per item, empty line to finish)"
CHANGES=()
while IFS= read -r line; do
  [[ -z "$line" ]] && break
  CHANGES+=("$line")
done

if [[ ${#CHANGES[@]} -eq 0 ]]; then
  read -r -p "No items entered. Short summary: " summary
  [[ -n "$summary" ]] && CHANGES=("$summary")
fi

[[ ${#CHANGES[@]} -gt 0 ]] || die "changelog needs at least one line"

DATE="$(date +%Y-%m-%d)"
set_version "$NEW"

CHANGELOG_MARKER="All notable changes to this extension are documented here."

if [[ ! -f "$CHANGELOG" ]]; then
  cat > "$CHANGELOG" <<EOF
# Changelog

${CHANGELOG_MARKER}

EOF
fi

ENTRY_FILE="$(mktemp)"
{
  echo ""
  echo "## [$NEW] - $DATE"
  for line in "${CHANGES[@]}"; do
    echo "- $line"
  done
  echo ""
} > "$ENTRY_FILE"

if grep -Fq "$CHANGELOG_MARKER" "$CHANGELOG"; then
  awk -v entryfile="$ENTRY_FILE" '
    index($0, "All notable changes to this extension are documented here.") && !done {
      print
      while ((getline line < entryfile) > 0) print line
      close(entryfile)
      done = 1
      next
    }
    { print }
  ' "$CHANGELOG" > "${CHANGELOG}.tmp"
  mv "${CHANGELOG}.tmp" "$CHANGELOG"
else
  cat "$ENTRY_FILE" >> "$CHANGELOG"
fi
rm -f "$ENTRY_FILE"

echo ""
echo "Updated $PKG and $CHANGELOG"
echo ""
echo "Compiling..."
npm run package

echo ""
echo "Packaging VSIX..."
npx --yes @vscode/vsce package --out "$ROOT" --skip-license

VSIX="$ROOT/commit-elaborator-${NEW}.vsix"
[[ -f "$VSIX" ]] || VSIX="$(ls -t "$ROOT"/*.vsix 2>/dev/null | head -1)"

echo ""
echo "Done: v$NEW"
echo "VSIX: $VSIX"

#!/usr/bin/env bash
set -euo pipefail

# prepare-release.sh
# Bumps version, creates git tag, and generates changelog for a new release.
# Usage: bash prepare-release.sh [major|minor|patch|version_number]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CURRENT_VERSION=$(jq -r '.version' package.json)

# Determine new version
case "${1:-patch}" in
    major)
        NEW_VERSION=$(echo "$CURRENT_VERSION" | awk -F. '{print $1+1 ".0.0"}')
        ;;
    minor)
        NEW_VERSION=$(echo "$CURRENT_VERSION" | awk -F. '{print $1 "." $2+1 ".0"}')
        ;;
    patch)
        NEW_VERSION=$(echo "$CURRENT_VERSION" | awk -F. '{print $1 "." $2 "." $3+1}')
        ;;
    *)
        NEW_VERSION="$1"
        ;;
esac

echo "Current version: $CURRENT_VERSION"
echo "New version:     $NEW_VERSION"
echo ""

jq --arg v "$NEW_VERSION" '.version = $v' package.json > package.json.tmp
mv package.json.tmp package.json
echo "✓ Updated package.json to $NEW_VERSION"

# Generate changelog from git log
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
    echo ""
    echo "Changes since $LAST_TAG:"
    echo "---"
    git log --oneline --no-decorate "${LAST_TAG}..HEAD" 2>/dev/null || echo "(initial release)"
    echo "---"
fi

# Commit version bump
git add package.json
git commit -m "chore: bump version to $NEW_VERSION" --no-verify 2>/dev/null || echo "(nothing to commit)"

# Create tag
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
echo "✓ Created tag v$NEW_VERSION"

echo ""
echo "Next steps:"
echo "  git push origin main"
echo "  git push origin v$NEW_VERSION"
echo "  (Push will trigger .gitea/workflows/release.yml)"

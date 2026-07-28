#!/bin/bash
set -euo pipefail

# Two-step release, because `main` is protected by a `pull_request` ruleset:
# direct pushes are rejected, so the version bump has to go through a PR.
#
#   Step 1 (default):  ./scripts/release.sh
#                      Bumps the version on a release branch and opens a PR.
#
#   Step 2 (--tag):    ./scripts/release.sh --tag
#                      Run after the PR merges. Tags the merged commit on main
#                      and pushes the tag, which triggers the Release workflow.
#
# Previously this script pushed straight to the current branch. Run from a
# feature branch it silently produced a tag that was not an ancestor of main
# (see v0.3.40); run from main the push would simply have been rejected.

usage() {
  echo "Usage: $0 [--tag]"
  echo "  (no args)  bump the version on a release branch and open a PR"
  echo "  --tag      after that PR merges, tag main and push to trigger the release"
  exit 1
}

MODE="bump"
case "${1:-}" in
  --tag) MODE="tag" ;;
  "")    MODE="bump" ;;
  *)     usage ;;
esac

if [[ -n $(git status --porcelain) ]]; then
  echo "Error: Working directory is not clean. Please commit or stash changes first."
  exit 1
fi

echo "Fetching latest changes..."
git fetch origin --tags --quiet

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: releases must be cut from 'main' (currently on '$BRANCH')."
  echo "       Tagging from another branch produces a tag that is not an ancestor of main."
  exit 1
fi

if [[ -n $(git rev-list HEAD...origin/main) ]]; then
  echo "Error: local main is not in sync with origin/main. Please pull latest changes."
  exit 1
fi

# ---------------------------------------------------------------- step 2: tag
if [[ "$MODE" == "tag" ]]; then
  VERSION=$(node -p "require('./package.json').version")
  TAG="v$VERSION"

  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    echo "Error: tag $TAG already exists locally. Delete it first if it is stale:"
    echo "         git tag -d $TAG && git push origin :refs/tags/$TAG"
    exit 1
  fi
  if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
    echo "Error: tag $TAG already exists on origin. Delete it first if it is stale:"
    echo "         git push origin :refs/tags/$TAG"
    exit 1
  fi

  echo "Tagging $(git rev-parse --short HEAD) on main as $TAG"
  git tag -a "$TAG" -m "$VERSION"
  git push origin "$TAG"

  echo ""
  echo "Release workflow triggered for $TAG."
  echo "Monitor: https://github.com/grafana/backstage-plugin-grafana-catalog/actions"
  echo ""
  echo "IMPORTANT: a green workflow does NOT mean the release shipped. The package"
  echo "is staged on npm and must be approved with 2FA:"
  echo "  npm stage list @grafana/catalog-backend-module-grafana-servicemodel"
  echo "  npm stage approve <stage-id>"
  exit 0
fi

# --------------------------------------------------------------- step 1: bump
echo "Select version type:"
echo "1) patch (bug fixes)"
echo "2) minor (new features)"
echo "3) major (breaking changes)"
read -r -p "Enter choice (1-3): " VERSION_TYPE

case $VERSION_TYPE in
  1) VERSION_ARG="patch" ;;
  2) VERSION_ARG="minor" ;;
  3) VERSION_ARG="major" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

# --no-git-tag-version: the tag is created in step 2, against the merged commit
# on main, not against this branch.
NEW_VERSION=$(npm version "$VERSION_ARG" --no-git-tag-version)
NEW_VERSION=${NEW_VERSION#v}
RELEASE_BRANCH="release/v$NEW_VERSION"

echo "Preparing $RELEASE_BRANCH ..."
git checkout -b "$RELEASE_BRANCH"
git add package.json
git commit -m "chore(release): v$NEW_VERSION"
git push -u origin "$RELEASE_BRANCH"

if command -v gh >/dev/null 2>&1; then
  gh pr create \
    --base main \
    --head "$RELEASE_BRANCH" \
    --title "chore(release): v$NEW_VERSION" \
    --body "Version bump to \`v$NEW_VERSION\`.

After merging, run:

\`\`\`bash
git checkout main && git pull
./scripts/release.sh --tag
\`\`\`

That tags the merged commit and triggers the Release workflow, which **stages**
the package on npm. It is not public until approved with 2FA."
else
  echo "gh CLI not found - open a PR for $RELEASE_BRANCH manually."
fi

echo ""
echo "Next steps:"
echo "  1. Get the PR reviewed and merged."
echo "  2. git checkout main && git pull"
echo "  3. ./scripts/release.sh --tag"

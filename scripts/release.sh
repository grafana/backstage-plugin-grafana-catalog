#!/bin/bash
set -e

# Ensure we're in a clean state
if [[ -n $(git status --porcelain) ]]; then
  echo "Error: Working directory is not clean. Please commit or stash changes first."
  exit 1
fi

# Ensure we have the latest changes
echo "Fetching latest changes..."
git fetch origin

# Get the current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Ensure we're up to date with origin
if [[ -n $(git rev-list HEAD...origin/$BRANCH) ]]; then
  echo "Error: Local branch is not up to date with origin. Please pull latest changes."
  exit 1
fi

# Prompt for version type
echo "Select version type:"
echo "1) patch (bug fixes)"
echo "2) minor (new features)"
echo "3) major (breaking changes)"
read -p "Enter choice (1-3): " VERSION_TYPE

case $VERSION_TYPE in
  1)
    VERSION_ARG="patch"
    ;;
  2)
    VERSION_ARG="minor"
    ;;
  3)
    VERSION_ARG="major"
    ;;
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac

# Update version
echo "Updating version..."
NEW_VERSION=$(npm version $VERSION_ARG)

# Push changes and tags
echo "Pushing changes and tags..."
git push origin $BRANCH
git push origin $NEW_VERSION

echo "Release process initiated!"
echo "New version: $NEW_VERSION"
echo "GitHub Actions will now:"
echo "1. Run lint checks"
echo "2. Run unit tests"
echo "3. Run integration tests"
echo "4. Publish to NPM"
echo "5. Create a GitHub release"
echo ""
echo "Monitor the progress at: https://github.com/grafana/backstage-plugin-grafana-catalog/actions"

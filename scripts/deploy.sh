#!/usr/bin/env bash
set -euo pipefail

# Deploy the built output to the deploy branch while preserving the source tree on the original branch.
# The script enforces a clean state, rebuilds artifacts from main, publishes them to deploy,
# and restores the original branch when finished.

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to run this script" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run this script" >&2
  exit 1
fi

# Ensure subsequent filesystem operations target the repository root regardless of invocation location.
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

# Bail out if the checkout is dirty so we do not lose local work during resets or branch switches.
if [[ -n $(git status --porcelain) ]]; then
  echo "Working tree has uncommitted changes. Please commit or stash before deploying." >&2
  exit 1
fi

# Move onto the deploy branch and align it with main as the starting point.
git fetch pages
git checkout deploy 2>/dev/null || git checkout -b deploy
git reset --hard main

# Produce a fresh build so the deploy branch contains exactly what Vite outputs.
npx vite build

# Confirm the build succeeded.
if [[ ! -d docs ]]; then
  echo "docs directory not found after build" >&2
  exit 1
fi

# Remove docs/ from the gitignore so the docs directory is committed on the deploy branch.
if [[ -f .gitignore ]] && git check-ignore -q docs/; then
  temp_ignore=$(mktemp)
  # Strip only the docs/ rule so we continue honouring the rest of the ignore list.
  grep -vE '^docs/?$' .gitignore > "$temp_ignore"
  mv "$temp_ignore" .gitignore
fi

# Commit and update the remote deploy branch.
git add -A
git commit -m "Deploy $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
git push --force-with-lease -u pages deploy
git checkout main

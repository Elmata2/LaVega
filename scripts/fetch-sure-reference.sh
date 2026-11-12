#!/usr/bin/env bash
# Fetch the pinned Sure reference tree for read-only study.
#
# Shallow by construction: `git init` + `git fetch --depth 1 origin <pinned SHA>`
# leaves one commit in the clone, so the tree cannot silently follow Sure's
# development branch and a study session pays for one tree, not its history.
# The tree is never imported by the build or tests, and it lands outside tracked
# source (default `.lavega/`, which is gitignored) unless a caller passes another
# directory.
set -euo pipefail

PIN="562fe096d149cb4d1fb1e6d3446527572c1ec7f6"
UPSTREAM="https://github.com/we-promise/sure.git"
DEST="${1:-.lavega/reference/sure}"

mkdir -p "$(dirname "$DEST")"

if [ ! -d "$DEST/.git" ]; then
  echo "fetching Sure at $PIN (shallow) into $DEST"
  git init -q "$DEST"
  git -C "$DEST" remote add origin "$UPSTREAM"
fi

if ! git -C "$DEST" cat-file -e "$PIN^{commit}" 2>/dev/null; then
  # GitHub serves a reachable commit by SHA. Fall back to a full fetch rather
  # than silently checking out the wrong tree; the pin check below still wins.
  if ! git -C "$DEST" fetch --depth 1 origin "$PIN" 2>/dev/null; then
    echo "shallow fetch of $PIN failed; fetching full history instead" >&2
    git -C "$DEST" fetch --tags origin
  fi
fi

git -C "$DEST" checkout --detach "$PIN"

ACTUAL="$(git -C "$DEST" rev-parse HEAD)"
if [ "$ACTUAL" != "$PIN" ]; then
  echo "ERROR: checked out $ACTUAL, expected $PIN" >&2
  exit 1
fi

printf 'Sure reference ready at %s (%s, shallow=%s)\n' \
  "$DEST" "$ACTUAL" "$(git -C "$DEST" rev-parse --is-shallow-repository)"

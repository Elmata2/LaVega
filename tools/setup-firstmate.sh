#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FM="$REPO_ROOT/tools/firstmate"

if [[ ! -f "$FM/AGENTS.md" ]]; then
  git -C "$REPO_ROOT" submodule update --init --depth 1 tools/firstmate
fi

mkdir -p "$FM/projects"
ln -sfn "$REPO_ROOT" "$FM/projects/lavega"

echo "firstmate ready at $FM"
echo "LaVega linked at $FM/projects/lavega"

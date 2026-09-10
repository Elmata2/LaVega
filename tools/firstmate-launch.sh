#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FM="$REPO_ROOT/tools/firstmate"

"$REPO_ROOT/tools/setup-firstmate.sh" >/dev/null

usage() {
  cat <<EOF
Launch firstmate from this repo (primary harness session).

Usage: $(basename "$0") <harness> [harness args...]

Harnesses:
  claude   Claude Code
  pi       Pi (or pi-signed when FM_PI_HARNESS=pi-signed)
  codex    OpenAI Codex CLI
  omp      Oh My Pi
  grok     Grok (--trust added if no args)

Examples:
  $(basename "$0") claude
  $(basename "$0") pi
  FM_PI_HARNESS=pi-signed $(basename "$0") pi-signed
  $(basename "$0") codex

Run from $FM after setup. Say ahoy and point firstmate at project lavega.
EOF
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 1
fi

HARNESS="$1"
shift

cd "$FM"

case "$HARNESS" in
  claude | pi | pi-signed | codex | omp)
    exec "$HARNESS" "$@"
    ;;
  grok)
    if [[ $# -eq 0 ]]; then
      exec grok --trust
    fi
    exec grok "$@"
    ;;
  -h | --help | help)
    usage
    ;;
  *)
    echo "unknown harness: $HARNESS" >&2
    usage >&2
    exit 1
    ;;
esac

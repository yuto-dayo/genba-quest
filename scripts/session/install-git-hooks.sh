#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

mkdir -p .githooks

if [[ ! -f .githooks/pre-commit ]]; then
  echo "Missing .githooks/pre-commit" >&2
  exit 1
fi

chmod +x .githooks/pre-commit
chmod +x scripts/session/*.sh

git config core.hooksPath .githooks

echo "Installed repo hooks."
echo "core.hooksPath=$(git config core.hooksPath)"
echo "Next:"
echo "  scripts/session/session-start.sh --agent codex"
echo "  scripts/session/session-start.sh --agent claude"

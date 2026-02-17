#!/usr/bin/env bash
set -euo pipefail

append_script=".claude/skills/incremental-handoff/scripts/append-handoff-update.sh"
session_file=".session/active_session"

if [[ ! -f "$session_file" ]]; then
  echo "No active session marker found: $session_file" >&2
  echo "Run: scripts/session/session-start.sh --agent <codex|claude>" >&2
  exit 1
fi

if [[ ! -x "$append_script" ]]; then
  echo "Incremental handoff script not executable: $append_script" >&2
  exit 1
fi

"$append_script" "$@"

echo "Session update recorded."

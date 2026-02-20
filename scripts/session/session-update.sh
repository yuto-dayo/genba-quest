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

handoff_file="$(
  awk -F= '
    /^HANDOFF_FILE=/ {
      sub(/^HANDOFF_FILE=/, "", $0);
      print $0;
      exit
    }
  ' "$session_file"
)"
handoff_file="${handoff_file:-HANDOFF.md}"

has_handoff_arg=false
for arg in "$@"; do
  if [[ "$arg" == "--handoff" ]]; then
    has_handoff_arg=true
    break
  fi
done

if [[ "$has_handoff_arg" == "true" ]]; then
  "$append_script" "$@"
else
  "$append_script" --handoff "$handoff_file" "$@"
fi

echo "Session update recorded."

#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/session/session-end.sh [--next "Next action"] [--allow-incomplete-handoff]
EOF
}

session_file=".session/active_session"
append_script=".claude/skills/incremental-handoff/scripts/append-handoff-update.sh"
next_override=""
allow_incomplete_handoff=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --next)
      next_override="${2:-}"
      shift 2
      ;;
    --allow-incomplete-handoff)
      allow_incomplete_handoff=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$session_file" ]]; then
  echo "No active session marker found: $session_file" >&2
  echo "Run: scripts/session/session-start.sh --agent <codex|claude>" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$session_file"

handoff_file="${HANDOFF_FILE:-HANDOFF.md}"
agent="${AGENT:-unknown}"

if [[ ! -f "$handoff_file" ]]; then
  echo "Handoff file not found: $handoff_file" >&2
  exit 1
fi

extract_first_remaining() {
  awk '
    /^## 4\. Remaining/ { in_section=1; next }
    /^## [0-9]+\./      { if (in_section) exit }
    in_section && /^- \[ \]/ {
      sub(/^- \[ \] /, "", $0)
      print
      exit
    }
  ' "$1"
}

extract_quick_next_cmd() {
  awk '
    /^## 0\. Quick Resume \(AI\)/ { in_section=1; next }
    /^## [0-9]+\./               { if (in_section) exit }
    in_section && /NEXT_CMD:/ {
      line=$0
      sub(/^.*NEXT_CMD:[[:space:]]*/, "", line)
      gsub(/`/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      print line
      exit
    }
  ' "$1"
}

validate_handoff_quality() {
  local file="$1"
  local issues=0
  local summary_snapshot
  summary_snapshot="$(mktemp)"

  # 履歴ログ(Incremental Updates)ではなく、現在の要約セクションのみ検証する。
  awk '
    /^## 11\. Incremental Updates/ { exit }
    { print }
  ' "$file" > "$summary_snapshot"

  if rg -q '\[semantic description required\]' "$summary_snapshot"; then
    echo "Handoff quality check failed: unresolved placeholder '[semantic description required]' found." >&2
    issues=1
  fi

  if rg -q '^- NEXT_CMD:[[:space:]]*`scripts/session/session-start\.sh --agent (codex|claude)`$' "$summary_snapshot"; then
    echo "Handoff quality check failed: NEXT_CMD still points to session-start, not the next real task." >&2
    issues=1
  fi

  if rg -q '^\- \[ \] まだ未着手$' "$summary_snapshot"; then
    echo "Handoff quality check failed: Completed section still says 'まだ未着手'." >&2
    issues=1
  fi

  rm -f "$summary_snapshot"

  if [[ "$issues" -ne 0 ]]; then
    return 1
  fi
  return 0
}

next_step="$next_override"
if [[ -z "$next_step" ]]; then
  next_step="$(extract_quick_next_cmd "$handoff_file")"
fi
if [[ -z "$next_step" ]]; then
  next_step="$(extract_first_remaining "$handoff_file")"
fi
if [[ -z "$next_step" ]]; then
  next_step="Remaining を確認して次アクションを決定"
fi

if [[ "$allow_incomplete_handoff" -ne 1 ]]; then
  if ! validate_handoff_quality "$handoff_file"; then
    echo "Fix HANDOFF.md (or run with --allow-incomplete-handoff when intentional)." >&2
    exit 1
  fi
fi

run_check() {
  local label="$1"
  local cmd="$2"
  if bash -lc "$cmd" >/tmp/genba_session_check.log 2>&1; then
    echo "${label}: PASS"
  else
    echo "${label}: FAIL"
  fi
}

validation_lines=()
validation_lines+=("$(run_check 'server typecheck' 'cd server && npx tsc --noEmit')")
validation_lines+=("$(run_check 'frontend typecheck' 'cd frontend && npx tsc --noEmit')")
validation_lines+=("$(run_check 'frontend lint' 'cd frontend && npx eslint src/')")
validation_lines+=("tests: SKIP (test suite not standardized)")

if [[ ! -x "$append_script" ]]; then
  echo "Incremental handoff script not executable: $append_script" >&2
  exit 1
fi

cmd_args=(
  --handoff "$handoff_file"
  --done "Session ended (${agent}) - quality gate recorded"
  --next "$next_step"
  --file "HANDOFF.md - session-end quality gate result recorded by ${agent}"
  --note "session-end handshake completed"
)

for line in "${validation_lines[@]}"; do
  cmd_args+=(--validation "$line")
done

"$append_script" "${cmd_args[@]}"

mkdir -p .session
archive_path=".session/last_session_$(date '+%Y%m%d_%H%M%S').log"
mv "$session_file" "$archive_path"

echo "=== Session End (${agent}) ==="
printf '%s\n' "${validation_lines[@]}" | sed 's/^/  - /'
echo "Archived session marker: ${archive_path}"

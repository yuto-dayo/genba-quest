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
session_domain="${DOMAIN:-}"

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
    /^## /                       { if (in_section) exit }
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
    /^## 1[13]\. Incremental Updates/ { exit }
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
    echo "Fix ${handoff_file} (or run with --allow-incomplete-handoff when intentional)." >&2
    exit 1
  fi
fi

run_check() {
  local label="$1"
  local cmd="$2"
  local log_file="/tmp/genba_session_check_$$.log"
  if bash -lc "$cmd" >"$log_file" 2>&1; then
    echo "PASS"
  else
    echo "FAIL"
  fi
  rm -f "$log_file"
}

has_server_test_script() {
  rg -q '"test"[[:space:]]*:' server/package.json 2>/dev/null
}

# Run quality gates and capture key=result for the Quality Gate table.
declare -a quality_gate_args=()
declare -a display_lines=()

server_tc="$(run_check 'server typecheck' 'cd server && npx tsc --noEmit')"
quality_gate_args+=(--quality-gate "server typecheck=${server_tc}|run by session-end ($(date '+%Y-%m-%d %H:%M'))")
display_lines+=("server typecheck: ${server_tc}")

frontend_tc="$(run_check 'frontend typecheck' 'cd frontend && npx tsc --noEmit')"
quality_gate_args+=(--quality-gate "frontend typecheck=${frontend_tc}|run by session-end ($(date '+%Y-%m-%d %H:%M'))")
display_lines+=("frontend typecheck: ${frontend_tc}")

lint_result="$(run_check 'frontend lint' 'cd frontend && npx eslint src/')"
quality_gate_args+=(--quality-gate "lint=${lint_result}|frontend eslint src/ at $(date '+%Y-%m-%d %H:%M')")
display_lines+=("lint: ${lint_result}")

if [[ "${SESSION_END_SKIP_TESTS:-0}" == "1" ]]; then
  quality_gate_args+=(--quality-gate "test=SKIP|skipped via SESSION_END_SKIP_TESTS")
  display_lines+=("test: SKIP (SESSION_END_SKIP_TESTS)")
elif has_server_test_script; then
  test_result="$(run_check 'server test' 'cd server && CI=1 npm test -- --runInBand')"
  quality_gate_args+=(--quality-gate "test=${test_result}|server npm test -- --runInBand at $(date '+%Y-%m-%d %H:%M')")
  display_lines+=("test: ${test_result}")
else
  quality_gate_args+=(--quality-gate "test=SKIP|no server test script configured")
  display_lines+=("test: SKIP (no server test script)")
fi

if [[ ! -x "$append_script" ]]; then
  echo "Incremental handoff script not executable: $append_script" >&2
  exit 1
fi

# Record session end as an audit-log event (NOT a fake Completed work entry).
# Quality gate results go to the Quality Gate table via --quality-gate, not L1/L2/L3.
"$append_script" \
  --handoff "$handoff_file" \
  --session-event "ended by ${agent}" \
  "${quality_gate_args[@]}"

mkdir -p .session
archive_path=".session/last_session_$(date '+%Y%m%d_%H%M%S').log"
mv "$session_file" "$archive_path"

# Sync root HANDOFF.md domain index when using --domain
if [[ -n "$session_domain" ]]; then
  # Extract status summary from domain handoff L0
  domain_status="$(awk '
    /^## 0\. Quick Resume/ { in_l0=1; next }
    /^## / { if (in_l0) exit }
    in_l0 && /NEXT_CMD:/ {
      line=$0
      sub(/^.*NEXT_CMD:[[:space:]]*/, "", line)
      gsub(/`/, "", line)
      if (length(line) > 60) line = substr(line, 1, 57) "..."
      print line
      exit
    }
  ' "$handoff_file")"
  domain_status="${domain_status:-session ended}"
  today="$(date '+%Y-%m-%d')"
  root_index="HANDOFF.md"
  if [[ -f "$root_index" ]] && grep -q '## Active Domains' "$root_index"; then
    tmp_index="$(mktemp)"
    LC_ALL=C awk -v dn="$session_domain" -v df="\`${handoff_file}\`" -v dt="$today" -v st="$domain_status" '
      /^# Project Handoff Index/ { print "# Project Handoff Index - " dt; next }
      /^\|[[:space:]]*--/ { print; separator_seen = 1; next }
      separator_seen && /^\|/ {
        split($0, cols, "|")
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", cols[2])
        if (cols[2] == dn) {
          printf "| %s | %s | %s | %s |\n", dn, df, dt, st
          replaced = 1
          next
        }
      }
      { print }
    ' "$root_index" > "$tmp_index"
    mv "$tmp_index" "$root_index"
    echo "Domain index synced: HANDOFF.md (domain=${session_domain})"
  fi
fi

echo "=== Session End (${agent}) ==="
printf '%s\n' "${display_lines[@]}" | sed 's/^/  - /'
echo "Archived session marker: ${archive_path}"

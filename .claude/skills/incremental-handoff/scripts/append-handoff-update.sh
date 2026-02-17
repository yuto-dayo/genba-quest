#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  append-handoff-update.sh [options]

Options:
  --handoff <path>       HANDOFF file path (default: HANDOFF.md)
  --done <text>          Completed work summary (semantic)
  --next <text>          Next priority action
  --note <text>          Handoff note
  --validation <text>    Validation result line (repeatable)
  --file <text>          Changed file line (repeatable, "path - semantic description")
  --context <text>       Working context / pattern (repeatable)
  --landmine <text>      Landmine / gotcha (repeatable)
  -h, --help             Show this help

Examples:
  append-handoff-update.sh \
    --done "approve()にatomic RPC優先パスを追加" \
    --next "P0: SQL関数をSupabaseにデプロイ" \
    --validation "cd server && npm test => 88/88 pass, 6 skip" \
    --file "server/src/services/ProposalService.ts - approve()にatomic RPC優先パスを追加" \
    --context "RPC-first+fallbackパターン: DB関数があれば原子実行、なければ従来パス" \
    --landmine "013_execute_proposal_atomic.sql は未デプロイ。コード上はfallbackで動作中"
EOF
}

handoff_file="HANDOFF.md"
done_text="作業ステップ完了"
next_text="次のP0を実行"
note_text=""

declare -a validation_lines=()
declare -a file_lines=()
declare -a context_lines=()
declare -a landmine_lines=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --handoff)
      handoff_file="${2:-}"
      shift 2
      ;;
    --done)
      done_text="${2:-}"
      shift 2
      ;;
    --next)
      next_text="${2:-}"
      shift 2
      ;;
    --note)
      note_text="${2:-}"
      shift 2
      ;;
    --validation)
      validation_lines+=("${2:-}")
      shift 2
      ;;
    --file)
      file_lines+=("${2:-}")
      shift 2
      ;;
    --context)
      context_lines+=("${2:-}")
      shift 2
      ;;
    --landmine)
      landmine_lines+=("${2:-}")
      shift 2
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

if [[ ! -f "$handoff_file" ]]; then
  echo "Handoff file not found: $handoff_file" >&2
  exit 1
fi

sync_handoff_summary() {
  local file="$1"
  local done="$2"
  local next="$3"
  local tmp
  tmp="$(mktemp)"

  awk -v done_text="$done" -v next_text="$next" '
    BEGIN {
      in_quick = 0
      in_completed = 0
      in_remaining = 0
      completed_written = 0
      p0_written = 0
    }
    /^## 0\. Quick Resume \(AI\)/ { in_quick = 1 }
    /^## 3\. Completed/ { in_completed = 1; completed_written = 0 }
    /^## 4\. Remaining/ { in_remaining = 1; p0_written = 0 }
    /^## [0-9]+\./ {
      if ($0 !~ /^## 0\. Quick Resume \(AI\)/) in_quick = 0
      if ($0 !~ /^## 3\. Completed/) in_completed = 0
      if ($0 !~ /^## 4\. Remaining/) in_remaining = 0
    }
    in_quick && $0 ~ /^- NEXT_CMD:/ {
      print "- NEXT_CMD: `" next_text "`"
      next
    }
    in_completed && $0 ~ /^- \[ \] まだ未着手$/ && completed_written == 0 {
      print "- [x] " done_text
      completed_written = 1
      next
    }
    in_remaining && $0 ~ /^- \[ \] \*\*P0\*\*:/ && p0_written == 0 {
      print "- [ ] **P0**: " next_text
      p0_written = 1
      next
    }
    { print }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

sync_handoff_summary "$handoff_file" "$done_text" "$next_text"

# Auto-collect is opt-in to avoid noisy, unrelated file lists in dirty worktrees.
if [[ ${#file_lines[@]} -eq 0 && "${APPEND_HANDOFF_AUTO_FILES:-0}" == "1" ]]; then
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    file_lines+=("$file - [semantic description required]")
  done < <(git diff --name-only 2>/dev/null || true)
fi

if [[ ${#file_lines[@]} -eq 0 ]]; then
  file_lines+=("No file list provided (use --file \"path - semantic description\")")
fi

# Normalize file lines: ensure backtick wrapping
declare -a normalized_file_lines=()
for raw in "${file_lines[@]}"; do
  if [[ "$raw" == "No file changes detected" || "$raw" == "No file list provided (use --file \"path - semantic description\")" ]]; then
    normalized_file_lines+=("$raw")
    continue
  fi

  if [[ "$raw" == *" - "* ]]; then
    file_path="${raw%% - *}"
    file_desc="${raw#* - }"
  else
    file_path="$raw"
    file_desc="[semantic description required]"
  fi

  if [[ "$file_path" == \`*\` ]]; then
    normalized_file_lines+=("${file_path} - ${file_desc}")
  else
    normalized_file_lines+=("\`${file_path}\` - ${file_desc}")
  fi
done

file_lines=("${normalized_file_lines[@]}")

if [[ ${#validation_lines[@]} -eq 0 ]]; then
  validation_lines+=("Not executed in this step => SKIP")
fi

# Ensure Incremental Updates section exists (check both old §11 and new §13)
if ! rg -q '^## 1[13]\. Incremental Updates' "$handoff_file" 2>/dev/null; then
  {
    echo
    echo "---"
    echo
    echo "## 13. Incremental Updates"
  } >> "$handoff_file"
fi

timestamp="$(date '+%Y-%m-%d %H:%M:%S %z')"

{
  echo
  echo "### ${timestamp}"
  echo
  echo "- Completed:"
  echo "  - [x] ${done_text}"
  echo "- Remaining:"
  echo "  - [ ] ${next_text}"
  echo "- Changed Files:"
  for line in "${file_lines[@]}"; do
    echo "  - ${line}"
  done

  # Working Context (optional)
  if [[ ${#context_lines[@]} -gt 0 ]]; then
    echo "- Working Context:"
    for line in "${context_lines[@]}"; do
      echo "  - ${line}"
    done
  fi

  echo "- Validation:"
  for line in "${validation_lines[@]}"; do
    echo "  - \`${line}\`"
  done

  # Landmines (optional)
  if [[ ${#landmine_lines[@]} -gt 0 ]]; then
    echo "- Landmines:"
    for line in "${landmine_lines[@]}"; do
      echo "  - ${line}"
    done
  fi

  # Note (optional, only if non-empty)
  if [[ -n "$note_text" ]]; then
    echo "- Note:"
    echo "  - ${note_text}"
  fi
} >> "$handoff_file"

echo "Appended incremental handoff entry to ${handoff_file}"

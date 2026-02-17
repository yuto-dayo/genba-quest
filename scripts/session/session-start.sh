#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/session/session-start.sh --agent <codex|claude> [--handoff HANDOFF.md] [--keep-handoff] [--force-restart]

Examples:
  scripts/session/session-start.sh --agent codex
  scripts/session/session-start.sh --agent claude --handoff HANDOFF.md
  scripts/session/session-start.sh --agent codex --keep-handoff
  scripts/session/session-start.sh --agent codex --force-restart
EOF
}

agent=""
handoff_file="HANDOFF.md"
fresh_handoff=1
force_restart=0
session_file=".session/active_session"
archive_dir="${HANDOFF_ARCHIVE_DIR:-.session/handoff_archive}"
archive_keep_count="${HANDOFF_ARCHIVE_KEEP_COUNT:-30}"
archive_keep_days="${HANDOFF_ARCHIVE_KEEP_DAYS:-14}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)
      agent="${2:-}"
      shift 2
      ;;
    --handoff)
      handoff_file="${2:-}"
      shift 2
      ;;
    --keep-handoff)
      fresh_handoff=0
      shift
      ;;
    --force-restart)
      force_restart=1
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

if [[ -z "$agent" ]]; then
  echo "--agent is required (codex|claude)" >&2
  exit 1
fi

mkdir -p .session
if [[ -f "$session_file" ]]; then
  if [[ "$force_restart" -eq 1 ]]; then
    stale_session=".session/stale_session_$(date '+%Y%m%d_%H%M%S').log"
    mv "$session_file" "$stale_session"
    echo "Archived stale active session: ${stale_session}"
  else
    echo "Active session marker already exists: ${session_file}" >&2
    echo "Run: scripts/session/session-end.sh (or use --force-restart)." >&2
    exit 1
  fi
fi

if [[ ! "$archive_keep_count" =~ ^[0-9]+$ ]]; then
  echo "HANDOFF_ARCHIVE_KEEP_COUNT must be a non-negative integer: ${archive_keep_count}" >&2
  exit 1
fi

if [[ ! "$archive_keep_days" =~ ^[0-9]+$ ]]; then
  echo "HANDOFF_ARCHIVE_KEEP_DAYS must be a non-negative integer: ${archive_keep_days}" >&2
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

extract_risks() {
  awk '
    /^## 9\. Risks \/ Blockers/ { in_section=1; next }
    /^## [0-9]+\./              { if (in_section) exit }
    in_section && /^- / {
      sub(/^- /, "", $0)
      print
    }
  ' "$1"
}

cleanup_handoff_archive() {
  local dir="$1"
  local keep_count="$2"
  local keep_days="$3"
  local removed_by_age=0
  local removed_by_count=0

  [[ -d "$dir" ]] || return 0

  if (( keep_days > 0 )); then
    while IFS= read -r old_file; do
      [[ -z "$old_file" ]] && continue
      rm -f "$old_file"
      removed_by_age=$((removed_by_age + 1))
    done < <(find "$dir" -type f -name 'HANDOFF_*.md' -mtime +"$keep_days" -print)
  fi

  if (( keep_count > 0 )); then
    local -a archives=()
    while IFS= read -r archive_file; do
      [[ -z "$archive_file" ]] && continue
      archives+=("$archive_file")
    done < <(find "$dir" -type f -name 'HANDOFF_*.md' -print | sort -r)

    if (( ${#archives[@]} > keep_count )); then
      local idx
      for ((idx = keep_count; idx < ${#archives[@]}; idx += 1)); do
        rm -f "${archives[$idx]}"
        removed_by_count=$((removed_by_count + 1))
      done
    fi
  fi

  if (( removed_by_age > 0 || removed_by_count > 0 )); then
    echo "Pruned handoff archive: age=${removed_by_age}, count=${removed_by_count}"
  fi
}

create_fresh_handoff() {
  local target_file="$1"
  local next_hint="$2"
  local today branch hotset_handoff_path quick_next_cmd
  today="$(date '+%Y-%m-%d')"
  branch="$(git branch --show-current 2>/dev/null || echo "master")"
  if [[ "$target_file" = /* ]]; then
    hotset_handoff_path="$target_file"
  else
    hotset_handoff_path="${PWD}/${target_file}"
  fi

  if [[ -z "$next_hint" ]]; then
    next_hint="P0: 現セッションの最優先タスクを記載"
  fi
  quick_next_cmd="$next_hint"

  cat > "$target_file" <<EOF
# Session Handoff - ${today}

## 0. Quick Resume (AI)

- NEXT_CMD: \`${quick_next_cmd}\`
- SUCCESS_CRITERIA: \`Completed / Remaining / Quality Gate が現セッション内容で更新されている\`
- HOTSET:
  - \`${hotset_handoff_path}\`
  - \`${PWD}/docs/DESIGN_PHILOSOPHY.md\`
- DO_NOT_READ:
  - \`docs/DESIGN_PHILOSOPHY.md\` (full)
- VERIFY_FIRST:
  - \`sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md\`

---

## 1. Resume（次の1手）

\`\`\`text
Agent: 未定（Claude Code / Codex）
Branch: ${branch}
Phase: A-0/A-1
\`\`\`

1. \`docs/DESIGN_PHILOSOPHY.md\` の冒頭を確認
2. このファイルを更新しながら実装を進める

---

## 2. Goal（このセッションの目的）

**Ticket**: 未設定
現セッションでの目的を記載

---

## 3. Completed

- [ ] まだ未着手

---

## 4. Remaining（優先順位順）

- [ ] **P0**: ${next_hint}
- [ ] **P1**: 次の優先タスクを記載

---

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| \`(none)\` | - |

---

## 6. Locked Files（編集中 - 他エージェント触らない）

> なし

---

## 7. Quality Gate

\`\`\`bash
cd server && npx tsc --noEmit
cd frontend && npx tsc --noEmit
cd frontend && npx eslint src/
\`\`\`

| Check | Result | Notes |
| ----- | ------ | ----- |
| server typecheck | SKIP | not run yet |
| frontend typecheck | SKIP | not run yet |
| lint | SKIP | not run yet |
| test | SKIP | optional |

---

## 8. Key Decisions

| Decision | Rationale |
| -------- | --------- |
| \`docs/DESIGN_PHILOSOPHY.md\` を作業前に参照 | 設計逸脱を防ぐため |

---

## 9. Risks / Blockers

- \`docs/DESIGN_PHILOSOPHY.md\` 未参照で実装すると、Proposal中心設計から逸脱するリスクがある

---

## 10. References

- \`docs/DESIGN_PHILOSOPHY.md\` - 作業前に必ず参照
- \`docs/AGENT_OPS.md\` - セッション運用手順

---

## 11. Incremental Updates
EOF
}

previous_next_step=""
if [[ -f "$handoff_file" ]]; then
  previous_next_step="$(extract_quick_next_cmd "$handoff_file")"
  if [[ -z "$previous_next_step" ]]; then
    previous_next_step="$(extract_first_remaining "$handoff_file")"
  fi
fi

if [[ "$fresh_handoff" -eq 1 ]]; then
  mkdir -p "$archive_dir"
  if [[ -f "$handoff_file" ]]; then
    archive_path="${archive_dir}/HANDOFF_$(date '+%Y%m%d_%H%M%S').md"
    cp "$handoff_file" "$archive_path"
    echo "Archived previous handoff: ${archive_path}"
  fi
  create_fresh_handoff "$handoff_file" "$previous_next_step"
  echo "Regenerated handoff template: ${handoff_file}"
fi

cleanup_handoff_archive "$archive_dir" "$archive_keep_count" "$archive_keep_days"

if [[ ! -f "$handoff_file" ]]; then
  create_fresh_handoff "$handoff_file" "$previous_next_step"
fi

next_step="$(extract_quick_next_cmd "$handoff_file")"
if [[ -z "$next_step" ]]; then
  next_step="$(extract_first_remaining "$handoff_file")"
fi
if [[ -z "$next_step" ]]; then
  next_step="Remaining を確認して次アクションを決定"
fi

risk_preview="$(extract_risks "$handoff_file" | head -n 3 || true)"
started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

{
  echo "AGENT=${agent}"
  echo "STARTED_AT=${started_at}"
  echo "HANDOFF_FILE=${handoff_file}"
  printf "NEXT_STEP=%q\n" "$next_step"
} > "$session_file"

echo "=== Session Start (${agent}) ==="
echo "STARTED_AT: ${started_at}"
echo "NEXT_STEP: ${next_step}"
if [[ -n "$risk_preview" ]]; then
  echo "RISKS:"
  echo "$risk_preview" | sed 's/^/  - /'
fi

if ! sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md >/dev/null; then
  echo "Failed to read docs/DESIGN_PHILOSOPHY.md" >&2
  exit 1
fi

append_script=".claude/skills/incremental-handoff/scripts/append-handoff-update.sh"
if [[ -x "$append_script" ]]; then
  "$append_script" \
    --handoff "$handoff_file" \
    --done "Session started (${agent}) - HANDOFF.md reviewed" \
    --next "$next_step" \
    --validation "session-start: HANDOFF review => PASS" \
    --validation "session-start: docs/DESIGN_PHILOSOPHY.md reference => PASS" \
    --file "HANDOFF.md - session start review logged by ${agent}" \
    --note "session-start handshake completed (next step + top risks確認)"
fi

echo "Session marker created: ${session_file}"

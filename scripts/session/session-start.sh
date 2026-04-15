#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/session/session-start.sh --agent <codex|claude|gemini> [--domain <name>] [--handoff HANDOFF.md] [--keep-handoff] [--force-restart] [--baseline]

Options:
  --agent          Required. Identifies the AI agent (codex|claude|gemini|...).
  --domain         Use handoff/<domain>.md instead of HANDOFF.md.
  --handoff        Explicit handoff file path.
  --keep-handoff   Do not regenerate the template; keep the existing file as-is.
  --force-restart  Archive a stale active session marker and start fresh.
  --baseline       Run server+frontend typecheck at session start and write
                   the results to the Quality Gate table (slow but creates a
                   real baseline). Off by default.

Examples:
  scripts/session/session-start.sh --agent codex
  scripts/session/session-start.sh --agent claude --domain server
  scripts/session/session-start.sh --agent gemini --domain frontend/today
  scripts/session/session-start.sh --agent claude --baseline
  scripts/session/session-start.sh --agent codex --keep-handoff
  scripts/session/session-start.sh --agent codex --force-restart
EOF
}

agent=""
domain=""
handoff_file="HANDOFF.md"
fresh_handoff=1
force_restart=0
run_baseline=0
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
    --domain)
      domain="${2:-}"
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
    --baseline)
      run_baseline=1
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

if [[ -n "$domain" ]]; then
  domain="${domain%.md}"

  if [[ -z "$domain" ]]; then
    echo "--domain must not be empty." >&2
    exit 1
  fi

  if [[ "$domain" = /* || "$domain" == *".."* || "$domain" == *$'\n'* ]]; then
    echo "Invalid --domain: path traversal or absolute path is not allowed." >&2
    exit 1
  fi

  if [[ "$domain" == *"//"* || "$domain" == */ || "$domain" == /* ]]; then
    echo "Invalid --domain: use path segments like frontend/today or server/proposals." >&2
    exit 1
  fi

  if [[ ! "$domain" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    echo "Invalid --domain: allowed chars are [A-Za-z0-9._/-]." >&2
    exit 1
  fi
fi

# --domain sets handoff_file to handoff/<domain>.md (unless --handoff was explicit)
if [[ -n "$domain" && "$handoff_file" == "HANDOFF.md" ]]; then
  handoff_file="handoff/${domain}.md"
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

handoff_parent_dir="$(dirname "$handoff_file")"
if [[ "$handoff_parent_dir" != "." ]]; then
  mkdir -p "$handoff_parent_dir"
fi

if [[ ! "$archive_keep_count" =~ ^[0-9]+$ ]]; then
  echo "HANDOFF_ARCHIVE_KEEP_COUNT must be a non-negative integer: ${archive_keep_count}" >&2
  exit 1
fi

if [[ ! "$archive_keep_days" =~ ^[0-9]+$ ]]; then
  echo "HANDOFF_ARCHIVE_KEEP_DAYS must be a non-negative integer: ${archive_keep_days}" >&2
  exit 1
fi

update_domain_index() {
  local domain_name="$1"
  local domain_file="$2"
  local status="${3:-active}"
  local root_index="HANDOFF.md"
  local today
  today="$(date '+%Y-%m-%d')"

  if [[ ! -f "$root_index" ]] || ! grep -q '## Active Domains' "$root_index"; then
    cat > "$root_index" <<EOF
# Project Handoff Index - ${today}

## Active Domains

| Domain | File | Last Updated | Status |
| ------ | ---- | ------------ | ------ |
| ${domain_name} | \`${domain_file}\` | ${today} | ${status} |

## Domain Selection Guide

- Server work (API, DB, SQL, services): \`handoff/server.md\`
- Frontend shared work (routing/design system): \`handoff/frontend.md\`
- Frontend page scope: \`--domain frontend/today\` -> \`handoff/frontend/today.md\`
- Server feature scope: \`--domain server/proposals\` -> \`handoff/server/proposals.md\`
- Integration scope: \`--domain integration/gmail\` -> \`handoff/integration/gmail.md\`
- Full-stack: 両方のL0を読む。\`--domain\` 省略で従来通り単一HANDOFF.md運用も可
EOF
    return
  fi

  local tmp_index
  tmp_index="$(mktemp)"
  LC_ALL=C awk -v dn="$domain_name" -v df="\`${domain_file}\`" -v dt="$today" -v st="$status" '
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
    /^$/ && separator_seen && !replaced && !appended {
      printf "| %s | %s | %s | %s |\n", dn, df, dt, st
      appended = 1
    }
    { print }
    END {
      if (separator_seen && !replaced && !appended) {
        printf "| %s | %s | %s | %s |\n", dn, df, dt, st
      }
    }
  ' "$root_index" > "$tmp_index"
  mv "$tmp_index" "$root_index"
}

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
  local today branch hotset_handoff_path quick_next_cmd uncommitted_count latest_migration
  today="$(date '+%Y-%m-%d')"
  branch="$(git branch --show-current 2>/dev/null || echo "master")"
  uncommitted_count="$(git status --short 2>/dev/null | wc -l | tr -d ' ')"
  latest_migration="$(find server/sql -maxdepth 1 -type f -name '*.sql' 2>/dev/null | sort | tail -n 1)"
  latest_migration="${latest_migration#server/sql/}"
  latest_migration="${latest_migration:-none found}"
  mkdir -p "$(dirname "$target_file")"
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
- STATE:
  - Branch: \`${branch}\`
  - Uncommitted: \`${uncommitted_count} files\`
  - DB migrations: \`latest local: ${latest_migration}\`
  - Tests: \`not run yet\`
  - Lint: \`not run yet\`

<!-- L0_END: セッション開始時はここまで読めばOK。L1以降は必要時のみ。 -->

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [pending] No completed chunk recorded yet. Source: N/A
- [pending] Use scripts/session/session-update.sh after each meaningful chunk. Source: N/A
- [pending] NEXT_CMD in Quick Resume is the current executable action. Source: N/A
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [pending] No decision context recorded yet. Source: N/A
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [none] No landmines recorded. Source: N/A
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [pending] No unresolved thread recorded yet. Source: N/A
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: \`20\`
- keep_recent: \`12\`
- last_compacted_at: \`never\`
- archived_entries: \`0\`
<!-- HANDOFF_L2_STATE_END -->

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

collect_dirty_files() {
  # Emit "path - [dirty: <code>]" lines for everything in the working tree.
  # Returns nothing if not in a git repo or working tree is clean.
  git status --porcelain 2>/dev/null | while IFS= read -r raw; do
    [[ -z "$raw" ]] && continue
    local code="${raw:0:2}"
    local rest="${raw:3}"
    if [[ "$rest" == *" -> "* ]]; then
      rest="${rest##* -> }"
    fi
    [[ -z "$rest" ]] && continue
    rest="${rest%\"}"
    rest="${rest#\"}"
    local trimmed_code="${code// /}"
    [[ -z "$trimmed_code" ]] && trimmed_code="?"
    printf '%s - [dirty: %s]\n' "$rest" "$trimmed_code"
  done
}

inject_dirty_state_into_template() {
  local file="$1"
  local dirty_lines_file="$2"
  local count
  count="$(wc -l < "$dirty_lines_file" | tr -d ' ')"
  [[ "$count" == "0" ]] && return 0

  local tmp
  tmp="$(mktemp)"

  # Replace the "(none)" Changed Files row with the dirty file rows.
  awk -v dirty_file="$dirty_lines_file" '
    BEGIN {
      in_changed = 0
      replaced = 0
      while ((getline line < dirty_file) > 0) {
        dirty[++n] = line
      }
      close(dirty_file)
    }
    {
      if ($0 ~ /^## 5\. Changed Files/) {
        in_changed = 1
        print
        next
      }
      if (in_changed && $0 ~ /^## [0-9]+\./) {
        in_changed = 0
      }
      if (in_changed && $0 ~ /^\| `\(none\)` \| - \|/) {
        for (i = 1; i <= n; i++) {
          # Each dirty line is "path - [dirty: code]"
          split(dirty[i], parts, " - ")
          path = parts[1]
          desc = ""
          for (j = 2; j <= length(parts); j++) {
            desc = (desc == "" ? parts[j] : desc " - " parts[j])
          }
          printf "| `%s` | %s |\n", path, desc
        }
        replaced = 1
        next
      }
      print
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

inject_carryover_warning_into_template() {
  local file="$1"
  local note="$2"

  local tmp
  tmp="$(mktemp)"

  # Insert a blockquote warning right after the Resume code block in section 1.
  awk -v note="$note" '
    BEGIN { in_resume = 0; injected = 0; in_code = 0 }
    {
      if ($0 ~ /^## 1\. Resume/) {
        in_resume = 1
      } else if ($0 ~ /^## / && in_resume) {
        in_resume = 0
      }
      if (in_resume && $0 ~ /^```/) {
        in_code = !in_code
        print
        if (!in_code && !injected) {
          print ""
          print "> [carryover] " note
          injected = 1
        }
        next
      }
      print
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

run_baseline_quality_gates() {
  # Echoes one line per gate: "key=result|notes" for --quality-gate consumption.
  local timestamp
  timestamp="$(date '+%Y-%m-%d %H:%M')"
  local log_file="/tmp/genba_baseline_$$.log"

  if (cd server && npx tsc --noEmit) >"$log_file" 2>&1; then
    echo "server typecheck=PASS|baseline at session start (${timestamp})"
  else
    echo "server typecheck=FAIL|baseline at session start (${timestamp})"
  fi

  if (cd frontend && npx tsc --noEmit) >"$log_file" 2>&1; then
    echo "frontend typecheck=PASS|baseline at session start (${timestamp})"
  else
    echo "frontend typecheck=FAIL|baseline at session start (${timestamp})"
  fi

  rm -f "$log_file"
}

previous_next_step=""
if [[ -f "$handoff_file" ]]; then
  previous_next_step="$(extract_quick_next_cmd "$handoff_file")"
  if [[ -z "$previous_next_step" ]]; then
    previous_next_step="$(extract_first_remaining "$handoff_file")"
  fi
fi

dirty_lines_file=""
working_tree_dirty=0

if [[ "$fresh_handoff" -eq 1 ]]; then
  mkdir -p "$archive_dir"
  if [[ -f "$handoff_file" ]]; then
    archive_path="${archive_dir}/HANDOFF_$(date '+%Y%m%d_%H%M%S').md"
    cp "$handoff_file" "$archive_path"
    echo "Archived previous handoff: ${archive_path}"
  fi
  create_fresh_handoff "$handoff_file" "$previous_next_step"
  echo "Regenerated handoff template: ${handoff_file}"

  # Capture working tree state and inject into the fresh template so the
  # session starts with an honest picture of what is already in flight.
  dirty_lines_file="$(mktemp)"
  collect_dirty_files > "$dirty_lines_file"
  if [[ -s "$dirty_lines_file" ]]; then
    working_tree_dirty=1
    inject_dirty_state_into_template "$handoff_file" "$dirty_lines_file"
    dirty_count="$(wc -l < "$dirty_lines_file" | tr -d ' ')"
    inject_carryover_warning_into_template \
      "$handoff_file" \
      "Working tree was dirty at session start (${dirty_count} files). Prior session may have unfinished work — verify NEXT_CMD before executing."
    echo "Working tree dirty (${dirty_count} files): captured into Changed Files + carryover warning."
  fi
  rm -f "$dirty_lines_file"
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
  echo "DOMAIN=${domain}"
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
  declare -a baseline_args=()
  if [[ "$run_baseline" -eq 1 ]]; then
    echo "Running baseline quality gates (server+frontend tsc)..."
    while IFS= read -r gate_line; do
      [[ -z "$gate_line" ]] && continue
      baseline_args+=(--quality-gate "$gate_line")
    done < <(run_baseline_quality_gates)
  fi

  # Record session start as an audit-log event (NOT a fake Completed work entry).
  if (( ${#baseline_args[@]} > 0 )); then
    "$append_script" \
      --handoff "$handoff_file" \
      --session-event "started by ${agent}" \
      "${baseline_args[@]}"
  else
    "$append_script" \
      --handoff "$handoff_file" \
      --session-event "started by ${agent}"
  fi
fi

# Update root HANDOFF.md domain index when using --domain
if [[ -n "$domain" ]]; then
  update_domain_index "$domain" "$handoff_file" "active"
  echo "Domain index updated: HANDOFF.md (domain=${domain})"
fi

echo "Session marker created: ${session_file}"

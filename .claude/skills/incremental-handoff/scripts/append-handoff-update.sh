#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  append-handoff-update.sh [options]

Work-entry options (default mode — appends an Incremental Update entry):
  --handoff <path>       HANDOFF file path (default: HANDOFF.md)
  --done <text>          Completed work summary (semantic)
  --next <text>          Next priority action
  --note <text>          Handoff note
  --validation <text>    Validation result line (repeatable)
  --file <text>          Changed file line (repeatable, "path - semantic description")
  --locked-file <text>   Locked file line (repeatable, "path - reason")
  --context <text>       Working context / pattern (repeatable)
  --landmine <text>      Landmine / gotcha (repeatable)
  --from-git-status      Auto-collect modified+untracked files from git status
                         and append them to --file lines
  --quality-gate <k=r|n> Update Quality Gate table row "k" to result "r" with
                         optional notes "n" (repeatable). Works in both modes.

Session-event mode (records to audit log only — no Completed/L1/L2/L3 churn):
  --session-event <label>
                         Append a timestamped event line to the
                         "## Session Events (audit log)" block. Skips all
                         work-entry processing. --quality-gate is still honored
                         so session-end can record gate results.
  -h, --help             Show this help

Compaction env vars:
  HANDOFF_COMPACTION_THRESHOLD   L3 compaction trigger count (default: 20)
  HANDOFF_COMPACTION_KEEP_RECENT Entries to keep in HANDOFF after compaction (default: 12)

Examples:
  # Record real work
  append-handoff-update.sh \
    --done "approve()にatomic RPC優先パスを追加" \
    --next "P0: SQL関数をSupabaseにデプロイ" \
    --validation "cd server && npm test => 88/88 pass, 6 skip" \
    --file "server/src/services/ProposalService.ts - approve()にatomic RPC優先パスを追加" \
    --context "RPC-first+fallbackパターン: DB関数があれば原子実行、なければ従来パス" \
    --landmine "013_execute_proposal_atomic.sql は未デプロイ。コード上はfallbackで動作中"

  # Record session event without polluting work log
  append-handoff-update.sh --session-event "claude started session"

  # Record quality gate results to the table
  append-handoff-update.sh --session-event "claude ended session" \
    --quality-gate "server typecheck=PASS|0 errors" \
    --quality-gate "frontend typecheck=FAIL|3 errors in Today.tsx"
USAGE
}

handoff_file="HANDOFF.md"
done_text="作業ステップ完了"
next_text="次のP0を実行"
note_text=""
session_event_label=""
collect_git_status=0

compaction_threshold="${HANDOFF_COMPACTION_THRESHOLD:-20}"
compaction_keep_recent="${HANDOFF_COMPACTION_KEEP_RECENT:-12}"

declare -a validation_lines=()
declare -a file_lines=()
declare -a locked_file_lines=()
declare -a context_lines=()
declare -a landmine_lines=()
declare -a quality_gate_lines=()

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
    --locked-file)
      locked_file_lines+=("${2:-}")
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
    --session-event)
      session_event_label="${2:-}"
      shift 2
      ;;
    --from-git-status)
      collect_git_status=1
      shift
      ;;
    --quality-gate)
      quality_gate_lines+=("${2:-}")
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

if [[ ! "$compaction_threshold" =~ ^[0-9]+$ ]] || (( compaction_threshold < 1 )); then
  echo "HANDOFF_COMPACTION_THRESHOLD must be a positive integer: ${compaction_threshold}" >&2
  exit 1
fi

if [[ ! "$compaction_keep_recent" =~ ^[0-9]+$ ]] || (( compaction_keep_recent < 1 )); then
  echo "HANDOFF_COMPACTION_KEEP_RECENT must be a positive integer: ${compaction_keep_recent}" >&2
  exit 1
fi

if (( compaction_keep_recent >= compaction_threshold )); then
  compaction_keep_recent=$((compaction_threshold - 1))
  if (( compaction_keep_recent < 1 )); then
    compaction_keep_recent=1
  fi
fi

L1_START='<!-- HANDOFF_L1_START -->'
L1_END='<!-- HANDOFF_L1_END -->'
L2_DECISIONS_START='<!-- HANDOFF_L2_DECISIONS_START -->'
L2_DECISIONS_END='<!-- HANDOFF_L2_DECISIONS_END -->'
L2_LANDMINES_START='<!-- HANDOFF_L2_LANDMINES_START -->'
L2_LANDMINES_END='<!-- HANDOFF_L2_LANDMINES_END -->'
L2_THREADS_START='<!-- HANDOFF_L2_THREADS_START -->'
L2_THREADS_END='<!-- HANDOFF_L2_THREADS_END -->'
L2_STATE_START='<!-- HANDOFF_L2_STATE_START -->'
L2_STATE_END='<!-- HANDOFF_L2_STATE_END -->'
SESSION_EVENTS_START='<!-- HANDOFF_SESSION_EVENTS_START -->'
SESSION_EVENTS_END='<!-- HANDOFF_SESSION_EVENTS_END -->'
SESSION_EVENTS_PLACEHOLDER='- (no events recorded yet)'
SESSION_EVENTS_KEEP_RECENT="${HANDOFF_SESSION_EVENTS_KEEP_RECENT:-30}"

# --------------------------------------------------------------------
# Per-file advisory lock (mkdir-based, portable).
# Prevents concurrent invocations on the same handoff file from corrupting
# L1/L2/L3 marker blocks or interleaving Incremental Update entries.
# Different handoff files (handoff/server.md vs handoff/frontend.md) get
# independent locks, so cross-domain parallel work still runs in parallel.
#
# Tunables:
#   HANDOFF_LOCK_TIMEOUT         seconds to wait before giving up (default 30)
#   HANDOFF_LOCK_STALE_SECONDS   seconds after which a held lock is considered
#                                orphaned from a crashed run (default 120)
# --------------------------------------------------------------------
HANDOFF_LOCK_DIR=""

acquire_handoff_lock() {
  local file="$1"
  local lock_dir="${file}.lock.d"
  local owner_file="${lock_dir}/owner"
  local max_wait="${HANDOFF_LOCK_TIMEOUT:-30}"
  local stale_after="${HANDOFF_LOCK_STALE_SECONDS:-120}"
  local waited=0

  while true; do
    if mkdir "$lock_dir" 2>/dev/null; then
      printf '%s %s %s\n' "$$" "$(date '+%s')" "${USER:-unknown}@${HOSTNAME:-unknown}" > "$owner_file" 2>/dev/null || true
      HANDOFF_LOCK_DIR="$lock_dir"
      trap 'release_handoff_lock' EXIT INT TERM
      return 0
    fi

    # Lock held — check whether it's stale (a crashed prior run)
    if [[ -f "$owner_file" ]]; then
      local lock_ts now_ts age
      lock_ts="$(awk 'NR==1 {print $2}' "$owner_file" 2>/dev/null || echo 0)"
      now_ts="$(date '+%s')"
      age=$((now_ts - lock_ts))
      if (( age > stale_after )); then
        echo "WARN: breaking stale handoff lock at ${lock_dir} (age ${age}s > ${stale_after}s)" >&2
        rm -rf "$lock_dir"
        continue
      fi
    fi

    if (( waited >= max_wait )); then
      echo "ERROR: could not acquire lock on ${file} within ${max_wait}s" >&2
      echo "  Another agent is updating this handoff. Lock dir: ${lock_dir}" >&2
      if [[ -f "$owner_file" ]]; then
        echo "  Lock owner: $(cat "$owner_file" 2>/dev/null)" >&2
      fi
      echo "  If you are sure no process is running, remove the lock dir manually." >&2
      exit 2
    fi

    sleep 1
    waited=$((waited + 1))
  done
}

release_handoff_lock() {
  if [[ -n "${HANDOFF_LOCK_DIR:-}" ]] && [[ -d "$HANDOFF_LOCK_DIR" ]]; then
    rm -rf "$HANDOFF_LOCK_DIR"
    HANDOFF_LOCK_DIR=""
  fi
}

ensure_session_events_section() {
  local file="$1"
  if rg -q --fixed-strings "$SESSION_EVENTS_START" "$file"; then
    return 0
  fi

  local tmp
  tmp="$(mktemp)"

  awk \
    -v start="$SESSION_EVENTS_START" \
    -v end="$SESSION_EVENTS_END" \
    -v placeholder="$SESSION_EVENTS_PLACEHOLDER" '
    BEGIN { inserted = 0 }
    {
      print
      if (!inserted && /<!-- L0_END:/) {
        print ""
        print "## Session Events (audit log)"
        print ""
        print start
        print placeholder
        print end
        inserted = 1
      }
    }
    END {
      if (!inserted) {
        print ""
        print "## Session Events (audit log)"
        print ""
        print start
        print placeholder
        print end
      }
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

append_session_event() {
  local file="$1"
  local label="$2"
  local timestamp
  timestamp="$(date '+%Y-%m-%d %H:%M:%S %z')"
  local new_line="- ${timestamp} — ${label}"

  ensure_session_events_section "$file"

  local tmp
  tmp="$(mktemp)"

  awk \
    -v start="$SESSION_EVENTS_START" \
    -v end="$SESSION_EVENTS_END" \
    -v placeholder="$SESSION_EVENTS_PLACEHOLDER" \
    -v new_line="$new_line" \
    -v keep_recent="$SESSION_EVENTS_KEEP_RECENT" '
    BEGIN { in_block = 0; appended = 0 }
    {
      if ($0 == start) {
        print
        in_block = 1
        next
      }
      if (in_block && $0 == end) {
        # Drop placeholder if present (will be the only buffered line in that case)
        kept_count = 0
        for (i = 1; i <= buf_count; i++) {
          if (buf[i] == placeholder) continue
          kept[++kept_count] = buf[i]
        }
        # Append the new event
        kept[++kept_count] = new_line

        # Trim to keep_recent (drop oldest)
        start_idx = 1
        if (keep_recent > 0 && kept_count > keep_recent) {
          start_idx = kept_count - keep_recent + 1
        }
        for (i = start_idx; i <= kept_count; i++) {
          print kept[i]
        }
        print
        in_block = 0
        appended = 1
        buf_count = 0
        next
      }
      if (in_block) {
        buf[++buf_count] = $0
        next
      }
      print
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

# Returns lines like: "path - [from git status: M]" or "path - [from git status: ??]"
collect_git_status_lines() {
  git status --porcelain 2>/dev/null | while IFS= read -r raw; do
    [[ -z "$raw" ]] && continue
    local code="${raw:0:2}"
    local rest="${raw:3}"
    # Handle renames "R  old -> new" by keeping the new path
    if [[ "$rest" == *" -> "* ]]; then
      rest="${rest##* -> }"
    fi
    [[ -z "$rest" ]] && continue
    # Trim surrounding quotes that git adds for paths with spaces
    rest="${rest%\"}"
    rest="${rest#\"}"
    local trimmed_code="${code// /}"
    [[ -z "$trimmed_code" ]] && trimmed_code="?"
    printf '%s - [from git status: %s]\n' "$rest" "$trimmed_code"
  done
}

update_quality_gate_row() {
  local file="$1"
  local key="$2"
  local result="$3"
  local notes="$4"

  if [[ -z "$notes" ]]; then
    notes="updated $(date '+%Y-%m-%d %H:%M')"
  fi

  local tmp
  tmp="$(mktemp)"

  awk \
    -v key="$key" \
    -v result="$result" \
    -v notes="$notes" '
    BEGIN { in_qg = 0; updated = 0 }
    {
      if ($0 ~ /^## 7\. Quality Gate/) {
        in_qg = 1
        print
        next
      }
      if (in_qg && $0 ~ /^## [0-9]+\./) {
        in_qg = 0
      }
      if (in_qg && $0 ~ /^\| / && $0 !~ /^\| Check / && $0 !~ /^\| -/) {
        n = split($0, cols, "|")
        if (n >= 4) {
          name = cols[2]
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
          if (name == key) {
            printf "| %s | %s | %s |\n", key, result, notes
            updated = 1
            next
          }
        }
      }
      print
    }
    END {
      if (!updated) {
        # Caller should have ensured the row existed; emit nothing extra here.
      }
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

apply_quality_gate_updates() {
  local file="$1"
  local entry
  for entry in "${quality_gate_lines[@]}"; do
    local key="${entry%%=*}"
    local rest="${entry#*=}"
    local result="${rest%%|*}"
    local notes=""
    if [[ "$rest" == *"|"* ]]; then
      notes="${rest#*|}"
    fi
    if [[ -z "$key" || -z "$result" ]]; then
      echo "WARN: --quality-gate expects 'key=result|notes' (got: ${entry})" >&2
      continue
    fi
    update_quality_gate_row "$file" "$key" "$result" "$notes"
  done
}

sync_handoff_summary() {
  local file="$1"
  local next="$2"
  local tmp
  tmp="$(mktemp)"

  awk -v next_text="$next" '
    BEGIN {
      in_quick = 0
    }
    {
      if ($0 ~ /^## 0\. Quick Resume \(AI\)/) {
        in_quick = 1
      } else if ($0 ~ /^## / && in_quick) {
        in_quick = 0
      }

      if (in_quick && $0 ~ /^- NEXT_CMD:/) {
        print "- NEXT_CMD: `" next_text "`"
        next
      }

      print
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

ensure_incremental_section() {
  local file="$1"
  if rg -q '^## 1[13]\. Incremental Updates' "$file" 2>/dev/null; then
    return 0
  fi

  {
    echo
    echo "---"
    echo
    echo "## 11. Incremental Updates"
  } >> "$file"
}

ensure_memory_sections() {
  local file="$1"
  local threshold="$2"
  local keep_recent="$3"

  if rg -q --fixed-strings "$L1_START" "$file"; then
    return 0
  fi

  local tmp
  tmp="$(mktemp)"

  awk -v threshold="$threshold" -v keep_recent="$keep_recent" '
    BEGIN { inserted = 0 }
    !inserted && (/^## 1\./ || /^## 1[13]\. Incremental Updates/) {
      print "## L1. Session Summary (Compacted)"
      print ""
      print "<!-- HANDOFF_L1_START -->"
      print "- [pending] No completed chunk recorded yet. Source: N/A"
      print "- [pending] Use scripts/session/session-update.sh after each meaningful chunk. Source: N/A"
      print "- [pending] NEXT_CMD in Quick Resume is the current executable action. Source: N/A"
      print "<!-- HANDOFF_L1_END -->"
      print ""
      print "## L2. Project Continuity (Compacted)"
      print ""
      print "### Decisions"
      print "<!-- HANDOFF_L2_DECISIONS_START -->"
      print "- [pending] No decision context recorded yet. Source: N/A"
      print "<!-- HANDOFF_L2_DECISIONS_END -->"
      print ""
      print "### Landmines"
      print "<!-- HANDOFF_L2_LANDMINES_START -->"
      print "- [none] No landmines recorded. Source: N/A"
      print "<!-- HANDOFF_L2_LANDMINES_END -->"
      print ""
      print "### Open Threads"
      print "<!-- HANDOFF_L2_THREADS_START -->"
      print "- [pending] No unresolved thread recorded yet. Source: N/A"
      print "<!-- HANDOFF_L2_THREADS_END -->"
      print ""
      print "### Compaction State"
      print "<!-- HANDOFF_L2_STATE_START -->"
      print "- threshold: `" threshold "`"
      print "- keep_recent: `" keep_recent "`"
      print "- last_compacted_at: `never`"
      print "- archived_entries: `0`"
      print "<!-- HANDOFF_L2_STATE_END -->"
      print ""
      print "---"
      print ""
      inserted = 1
    }
    { print }
    END {
      if (!inserted) {
        print ""
        print "## L1. Session Summary (Compacted)"
        print ""
        print "<!-- HANDOFF_L1_START -->"
        print "- [pending] No completed chunk recorded yet. Source: N/A"
        print "- [pending] Use scripts/session/session-update.sh after each meaningful chunk. Source: N/A"
        print "- [pending] NEXT_CMD in Quick Resume is the current executable action. Source: N/A"
        print "<!-- HANDOFF_L1_END -->"
        print ""
        print "## L2. Project Continuity (Compacted)"
        print ""
        print "### Decisions"
        print "<!-- HANDOFF_L2_DECISIONS_START -->"
        print "- [pending] No decision context recorded yet. Source: N/A"
        print "<!-- HANDOFF_L2_DECISIONS_END -->"
        print ""
        print "### Landmines"
        print "<!-- HANDOFF_L2_LANDMINES_START -->"
        print "- [none] No landmines recorded. Source: N/A"
        print "<!-- HANDOFF_L2_LANDMINES_END -->"
        print ""
        print "### Open Threads"
        print "<!-- HANDOFF_L2_THREADS_START -->"
        print "- [pending] No unresolved thread recorded yet. Source: N/A"
        print "<!-- HANDOFF_L2_THREADS_END -->"
        print ""
        print "### Compaction State"
        print "<!-- HANDOFF_L2_STATE_START -->"
        print "- threshold: `" threshold "`"
        print "- keep_recent: `" keep_recent "`"
        print "- last_compacted_at: `never`"
        print "- archived_entries: `0`"
        print "<!-- HANDOFF_L2_STATE_END -->"
      }
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

replace_marker_block() {
  local file="$1"
  local start_marker="$2"
  local end_marker="$3"
  local replacement_file="$4"
  local tmp
  tmp="$(mktemp)"

  awk -v start_marker="$start_marker" -v end_marker="$end_marker" -v replacement_file="$replacement_file" '
    BEGIN {
      replaced = 0
      in_block = 0
      n = 0
      while ((getline line < replacement_file) > 0) {
        replacement[++n] = line
      }
      close(replacement_file)
    }
    {
      if ($0 == start_marker) {
        print $0
        for (i = 1; i <= n; i++) {
          print replacement[i]
        }
        in_block = 1
        replaced = 1
        next
      }
      if (in_block && $0 == end_marker) {
        print $0
        in_block = 0
        next
      }
      if (!in_block) {
        print $0
      }
    }
    END {
      if (!replaced) {
        print start_marker
        for (i = 1; i <= n; i++) {
          print replacement[i]
        }
        print end_marker
      }
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

extract_state_archived_entries() {
  local file="$1"
  awk '
    $0 == "<!-- HANDOFF_L2_STATE_START -->" { in_state = 1; next }
    $0 == "<!-- HANDOFF_L2_STATE_END -->" { in_state = 0 }
    in_state && /^- archived_entries: `/ {
      line = $0
      sub(/^- archived_entries: `/, "", line)
      sub(/`$/, "", line)
      print line
      exit
    }
  ' "$file"
}

extract_state_last_compacted_at() {
  local file="$1"
  awk '
    $0 == "<!-- HANDOFF_L2_STATE_START -->" { in_state = 1; next }
    $0 == "<!-- HANDOFF_L2_STATE_END -->" { in_state = 0 }
    in_state && /^- last_compacted_at: `/ {
      line = $0
      sub(/^- last_compacted_at: `/, "", line)
      sub(/`$/, "", line)
      print line
      exit
    }
  ' "$file"
}

compute_next_entry_id() {
  local file="$1"
  awk '
    /^- Entry-ID: `H[0-9][0-9][0-9][0-9]`/ {
      line = $0
      sub(/^- Entry-ID: `H/, "", line)
      sub(/`$/, "", line)
      id = line + 0
      if (id > max_id) {
        max_id = id
      }
    }
    END {
      printf "H%04d", max_id + 1
    }
  ' "$file"
}

count_incremental_entries() {
  local file="$1"
  awk '
    /^## 1[13]\. Incremental Updates/ { in_inc = 1; next }
    /^## [0-9]+\./ { if (in_inc) exit }
    in_inc && /^### / { count++ }
    END { print count + 0 }
  ' "$file"
}

compact_incremental_entries() {
  local file="$1"
  local threshold="$2"
  local keep_recent="$3"

  local inc_start
  inc_start="$(awk '/^## 1[13]\. Incremental Updates/ { print NR; exit }' "$file")"
  if [[ -z "$inc_start" ]]; then
    echo "0||"
    return 0
  fi

  local -a entry_lines=()
  while IFS= read -r line_no; do
    [[ -z "$line_no" ]] && continue
    entry_lines+=("$line_no")
  done < <(awk -v start_line="$inc_start" '
    NR <= start_line { next }
    /^## [0-9]+\./ { exit }
    /^### / { print NR }
  ' "$file")

  local entry_count="${#entry_lines[@]}"
  if (( entry_count <= threshold )); then
    echo "0||"
    return 0
  fi

  local to_archive=$((entry_count - keep_recent))
  if (( to_archive <= 0 )); then
    echo "0||"
    return 0
  fi

  local archive_from="${entry_lines[0]}"
  local keep_start_index="$to_archive"
  local archive_to=$((entry_lines[keep_start_index] - 1))
  local compacted_at
  compacted_at="$(date '+%Y-%m-%d %H:%M:%S %z')"

  local archive_dir=".session/handoff_archive"
  mkdir -p "$archive_dir"

  local archive_path="${archive_dir}/L3_compacted_$(date '+%Y%m%d_%H%M%S').md"
  {
    echo "# L3 Compaction Archive"
    echo
    echo "- source_handoff: \`${file}\`"
    echo "- compacted_at: \`${compacted_at}\`"
    echo "- archived_entries: \`${to_archive}\`"
    echo
    sed -n "${archive_from},${archive_to}p" "$file"
  } > "$archive_path"

  local tmp
  tmp="$(mktemp)"
  awk -v start_line="$archive_from" -v end_line="$archive_to" '
    NR < start_line || NR > end_line { print }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"

  local note_text
  note_text="> L3 compaction: archived ${to_archive} entries to \`${archive_path}\` at ${compacted_at}."

  tmp="$(mktemp)"
  awk -v note_text="$note_text" '
    BEGIN { inserted = 0 }
    {
      print
      if (!inserted && $0 ~ /^## 1[13]\. Incremental Updates/) {
        print ""
        print note_text
        print ""
        inserted = 1
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"

  echo "${to_archive}|${archive_path}|${compacted_at}"
}

build_memory_facts() {
  local file="$1"
  local output_dir="$2"

  : > "${output_dir}/completed.tsv"
  : > "${output_dir}/remaining.tsv"
  : > "${output_dir}/files.tsv"
  : > "${output_dir}/locked.tsv"
  : > "${output_dir}/context.tsv"
  : > "${output_dir}/landmine.tsv"

  awk \
    -v completed_file="${output_dir}/completed.tsv" \
    -v remaining_file="${output_dir}/remaining.tsv" \
    -v files_file="${output_dir}/files.tsv" \
    -v locked_file="${output_dir}/locked.tsv" \
    -v context_file="${output_dir}/context.tsv" \
    -v landmine_file="${output_dir}/landmine.tsv" '
    BEGIN {
      in_inc = 0
      section = ""
      entry_index = 0
      entry_id = ""
    }
    /^## 1[13]\. Incremental Updates/ {
      in_inc = 1
      next
    }
    /^## [0-9]+\./ {
      if (in_inc) exit
    }
    !in_inc {
      next
    }
    /^### / {
      entry_index++
      entry_id = sprintf("LEGACY-%04d", entry_index)
      section = ""
      next
    }
    /^- Entry-ID: `/ {
      line = $0
      sub(/^- Entry-ID: `/, "", line)
      sub(/`$/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line != "") {
        entry_id = line
      }
      next
    }
    /^- [^ ].*:$/ {
      if ($0 == "- Completed:") {
        section = "completed"
      } else if ($0 == "- Remaining:") {
        section = "remaining"
      } else if ($0 == "- Changed Files:") {
        section = "files"
      } else if ($0 == "- Locked Files:") {
        section = "locked"
      } else if ($0 == "- Working Context:") {
        section = "context"
      } else if ($0 == "- Landmines:") {
        section = "landmine"
      } else {
        section = ""
      }
      next
    }
    /^  - / {
      text = $0
      sub(/^  - /, "", text)

      if (section == "completed") {
        sub(/^\[[xX ]\][[:space:]]*/, "", text)
        printf "%s\t%s\n", entry_id, text >> completed_file
      } else if (section == "remaining") {
        sub(/^\[[xX ]\][[:space:]]*/, "", text)
        printf "%s\t%s\n", entry_id, text >> remaining_file
      } else if (section == "files") {
        printf "%s\t%s\n", entry_id, text >> files_file
      } else if (section == "locked") {
        printf "%s\t%s\n", entry_id, text >> locked_file
      } else if (section == "context") {
        printf "%s\t%s\n", entry_id, text >> context_file
      } else if (section == "landmine") {
        printf "%s\t%s\n", entry_id, text >> landmine_file
      }
    }
  ' "$file"
}

build_l1_lines() {
  local facts_dir="$1"
  local next_cmd="$2"
  local out_file="$3"

  awk -F '\t' -v next_cmd="$next_cmd" '
    BEGIN {
      print "- [focus] NEXT_CMD: `" next_cmd "`. Source: realtime"
    }
    FNR == NR {
      completed_id[++completed_count] = $1
      completed_text[completed_count] = $2
      next
    }
    {
      remaining_id[++remaining_count] = $1
      remaining_text[remaining_count] = $2
    }
    END {
      if (completed_count > 0) {
        print "- [" completed_id[completed_count] "] Completed: " completed_text[completed_count]
      } else {
        print "- [pending] Completed entries not yet recorded. Source: N/A"
      }

      if (remaining_count > 0) {
        print "- [" remaining_id[remaining_count] "] Remaining: " remaining_text[remaining_count]
      } else {
        print "- [pending] Remaining entries not yet recorded. Source: N/A"
      }

      if (completed_count > 1) {
        print "- [" completed_id[completed_count - 1] "] Completed: " completed_text[completed_count - 1]
      }

      if (remaining_count > 1) {
        print "- [" remaining_id[remaining_count - 1] "] Remaining: " remaining_text[remaining_count - 1]
      }
    }
  ' "${facts_dir}/completed.tsv" "${facts_dir}/remaining.tsv" > "$out_file"
}

build_latest_unique_lines() {
  local input_file="$1"
  local empty_line="$2"
  local out_file="$3"

  awk -F '\t' -v empty_line="$empty_line" '
    {
      if ($2 == "") next
      key = $2
      id_by_key[key] = $1
      ordered[++n] = key
    }
    END {
      printed = 0
      for (i = n; i >= 1 && printed < 5; i--) {
        key = ordered[i]
        if (emitted[key]) continue
        emitted[key] = 1
        print "- [" id_by_key[key] "] " key
        printed++
      }

      if (printed == 0) {
        print empty_line
      }
    }
  ' "$input_file" > "$out_file"
}

build_completed_section_lines() {
  local input_file="$1"
  local out_file="$2"

  awk -F '\t' '
    {
      if ($2 == "") next
      ordered[++n] = $2
    }
    END {
      printed = 0
      for (i = n; i >= 1 && printed < 10; i--) {
        if (emitted[ordered[i]]) continue
        emitted[ordered[i]] = 1
        print "- [x] " ordered[i]
        printed++
      }
      if (printed == 0) {
        print "- [ ] まだ未着手"
      }
    }
  ' "$input_file" > "$out_file"
}

build_remaining_section_lines() {
  local input_file="$1"
  local out_file="$2"

  awk -F '\t' '
    function render_remaining(text, default_priority, trimmed, priority) {
      trimmed = text
      priority = default_priority
      if (trimmed ~ /^\*\*P[0-9]+\*\*:[[:space:]]*/) {
        priority = trimmed
        sub(/^\*\*/, "", priority)
        sub(/\*\*:.*/, "", priority)
        sub(/^\*\*P[0-9]+\*\*:[[:space:]]*/, "", trimmed)
      } else if (trimmed ~ /^P[0-9]+:[[:space:]]*/) {
        priority = trimmed
        sub(/:.*/, "", priority)
        sub(/^P[0-9]+:[[:space:]]*/, "", trimmed)
      }
      return "- [ ] **" priority "**: " trimmed
    }
    {
      if ($2 == "") next
      ordered[++n] = $2
    }
    END {
      printed = 0
      for (i = n; i >= 1 && printed < 5; i--) {
        if (emitted[ordered[i]]) continue
        emitted[ordered[i]] = 1
        default_priority = (printed == 0 ? "P0" : "P1")
        print render_remaining(ordered[i], default_priority)
        printed++
      }
      if (printed == 0) {
        print "- [ ] **P0**: 次の優先タスクを記載"
      }
    }
  ' "$input_file" > "$out_file"
}

build_changed_files_section_lines() {
  local input_file="$1"
  local out_file="$2"

  awk -F '\t' '
    function render_row(text, idx, file_path, file_desc) {
      if (text == "No file list provided (use --file \"path - semantic description\")") {
        return "| `(not recorded)` | " text " |"
      }
      if (text == "No file changes detected") {
        return "| `(none)` | No file changes detected |"
      }
      idx = index(text, " - ")
      if (idx > 0) {
        file_path = substr(text, 1, idx - 1)
        file_desc = substr(text, idx + 3)
      } else {
        file_path = text
        file_desc = "[semantic description required]"
      }
      if (file_path !~ /^`/) {
        file_path = "`" file_path "`"
      }
      return "| " file_path " | " file_desc " |"
    }
    BEGIN {
      print "| File | What Changed |"
      print "| ---- | ------------ |"
    }
    {
      if ($2 == "") next
      ordered[++n] = $2
    }
    END {
      printed = 0
      for (i = n; i >= 1 && printed < 20; i--) {
        if (emitted[ordered[i]]) continue
        emitted[ordered[i]] = 1
        print render_row(ordered[i])
        printed++
      }
      if (printed == 0) {
        print "| `(none)` | - |"
      }
    }
  ' "$input_file" > "$out_file"
}

build_locked_files_section_lines() {
  local input_file="$1"
  local out_file="$2"

  awk -F '\t' '
    function render_line(text, idx, file_path, reason) {
      idx = index(text, " - ")
      if (idx > 0) {
        file_path = substr(text, 1, idx - 1)
        reason = substr(text, idx + 3)
      } else {
        file_path = text
        reason = "[lock reason required]"
      }
      if (file_path !~ /^`/) {
        file_path = "`" file_path "`"
      }
      return "- " file_path " - " reason
    }
    {
      if ($2 == "") next
      ordered[++n] = $2
    }
    END {
      printed = 0
      for (i = n; i >= 1 && printed < 10; i--) {
        if (emitted[ordered[i]]) continue
        emitted[ordered[i]] = 1
        print render_line(ordered[i])
        printed++
      }
      if (printed == 0) {
        print "> なし"
      }
    }
  ' "$input_file" > "$out_file"
}

build_risk_section_lines() {
  local input_file="$1"
  local out_file="$2"

  awk -F '\t' '
    {
      if ($2 == "") next
      if ($2 == "No new landmines reported in this chunk.") next
      ordered[++n] = $2
    }
    END {
      printed = 0
      for (i = n; i >= 1 && printed < 5; i--) {
        if (emitted[ordered[i]]) continue
        emitted[ordered[i]] = 1
        print "- " ordered[i]
        printed++
      }
      if (printed == 0) {
        print "- 新規の blocker は未記録"
      }
    }
  ' "$input_file" > "$out_file"
}

replace_section_body() {
  local file="$1"
  local start_regex="$2"
  local replacement_file="$3"
  local tmp
  tmp="$(mktemp)"

  awk -v start_regex="$start_regex" -v replacement_file="$replacement_file" '
    BEGIN {
      replaced = 0
      in_section = 0
      while ((getline line < replacement_file) > 0) {
        replacement[++n] = line
      }
      close(replacement_file)
    }
    {
      if (!in_section && $0 ~ start_regex) {
        print
        print ""
        for (i = 1; i <= n; i++) {
          print replacement[i]
        }
        in_section = 1
        replaced = 1
        next
      }
      if (in_section && ($0 ~ /^---$/ || $0 ~ /^## /)) {
        print
        in_section = 0
        next
      }
      if (in_section) {
        next
      }
      print
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

sync_memory_layers() {
  local file="$1"
  local threshold="$2"
  local keep_recent="$3"
  local next_cmd="$4"
  local archived_now="$5"
  local compacted_at="$6"

  local facts_dir
  facts_dir="$(mktemp -d)"

  build_memory_facts "$file" "$facts_dir"

  local l1_tmp
  local l2_decisions_tmp
  local l2_landmines_tmp
  local l2_threads_tmp
  local l2_state_tmp
  local completed_section_tmp
  local remaining_section_tmp
  local changed_files_section_tmp
  local locked_files_section_tmp
  local risks_section_tmp

  l1_tmp="$(mktemp)"
  l2_decisions_tmp="$(mktemp)"
  l2_landmines_tmp="$(mktemp)"
  l2_threads_tmp="$(mktemp)"
  l2_state_tmp="$(mktemp)"
  completed_section_tmp="$(mktemp)"
  remaining_section_tmp="$(mktemp)"
  changed_files_section_tmp="$(mktemp)"
  locked_files_section_tmp="$(mktemp)"
  risks_section_tmp="$(mktemp)"

  build_l1_lines "$facts_dir" "$next_cmd" "$l1_tmp"
  build_latest_unique_lines "${facts_dir}/context.tsv" "- [pending] No decision context recorded yet. Source: N/A" "$l2_decisions_tmp"
  build_latest_unique_lines "${facts_dir}/landmine.tsv" "- [none] No landmines recorded. Source: N/A" "$l2_landmines_tmp"
  build_latest_unique_lines "${facts_dir}/remaining.tsv" "- [pending] No unresolved thread recorded yet. Source: N/A" "$l2_threads_tmp"
  build_completed_section_lines "${facts_dir}/completed.tsv" "$completed_section_tmp"
  build_remaining_section_lines "${facts_dir}/remaining.tsv" "$remaining_section_tmp"
  build_changed_files_section_lines "${facts_dir}/files.tsv" "$changed_files_section_tmp"
  build_locked_files_section_lines "${facts_dir}/locked.tsv" "$locked_files_section_tmp"
  build_risk_section_lines "${facts_dir}/landmine.tsv" "$risks_section_tmp"

  local existing_archived
  existing_archived="$(extract_state_archived_entries "$file" || true)"
  if [[ -z "$existing_archived" || ! "$existing_archived" =~ ^[0-9]+$ ]]; then
    existing_archived=0
  fi

  local total_archived=$((existing_archived + archived_now))

  local state_last_compacted
  state_last_compacted="$(extract_state_last_compacted_at "$file" || true)"
  if [[ -n "$compacted_at" ]]; then
    state_last_compacted="$compacted_at"
  fi
  if [[ -z "$state_last_compacted" ]]; then
    state_last_compacted="never"
  fi

  local current_entries
  current_entries="$(count_incremental_entries "$file")"

  {
    echo "- threshold: \`${threshold}\`"
    echo "- keep_recent: \`${keep_recent}\`"
    echo "- current_l3_entries: \`${current_entries}\`"
    echo "- last_compacted_at: \`${state_last_compacted}\`"
    echo "- archived_entries: \`${total_archived}\`"
  } > "$l2_state_tmp"

  replace_marker_block "$file" "$L1_START" "$L1_END" "$l1_tmp"
  replace_marker_block "$file" "$L2_DECISIONS_START" "$L2_DECISIONS_END" "$l2_decisions_tmp"
  replace_marker_block "$file" "$L2_LANDMINES_START" "$L2_LANDMINES_END" "$l2_landmines_tmp"
  replace_marker_block "$file" "$L2_THREADS_START" "$L2_THREADS_END" "$l2_threads_tmp"
  replace_marker_block "$file" "$L2_STATE_START" "$L2_STATE_END" "$l2_state_tmp"
  replace_section_body "$file" "^## 3\\. Completed$" "$completed_section_tmp"
  replace_section_body "$file" "^## 4\\. Remaining" "$remaining_section_tmp"
  replace_section_body "$file" "^## 5\\. Changed Files$" "$changed_files_section_tmp"
  replace_section_body "$file" "^## 6\\. Locked Files" "$locked_files_section_tmp"
  replace_section_body "$file" "^## 9\\. Risks / Blockers$" "$risks_section_tmp"

  rm -f "$l1_tmp" "$l2_decisions_tmp" "$l2_landmines_tmp" "$l2_threads_tmp" "$l2_state_tmp"
  rm -f "$completed_section_tmp" "$remaining_section_tmp" "$changed_files_section_tmp" "$locked_files_section_tmp" "$risks_section_tmp"
  rm -rf "$facts_dir"
}

# --------------------------------------------------------------------
# Acquire exclusive lock on the target handoff file before any writes.
# Skipped if HANDOFF_LOCK_DISABLE=1 is set (escape hatch for debugging).
# --------------------------------------------------------------------
if [[ "${HANDOFF_LOCK_DISABLE:-0}" != "1" ]]; then
  acquire_handoff_lock "$handoff_file"
fi

# --------------------------------------------------------------------
# Session-event mode: skip work-entry processing entirely.
# This is what session-start.sh / session-end.sh use to record start/end
# timestamps WITHOUT polluting Completed / L1 / L2 / L3 with fake "work".
# --------------------------------------------------------------------
if [[ -n "$session_event_label" ]]; then
  append_session_event "$handoff_file" "$session_event_label"
  if [[ ${#quality_gate_lines[@]} -gt 0 ]]; then
    apply_quality_gate_updates "$handoff_file"
  fi
  echo "Recorded session event to ${handoff_file}: ${session_event_label}"
  exit 0
fi

ensure_incremental_section "$handoff_file"
ensure_memory_sections "$handoff_file" "$compaction_threshold" "$compaction_keep_recent"
ensure_session_events_section "$handoff_file"

# Auto-collect modified+untracked files from git status when requested.
# Backwards-compatible env var APPEND_HANDOFF_AUTO_FILES=1 still works.
if [[ "$collect_git_status" -eq 1 || "${APPEND_HANDOFF_AUTO_FILES:-0}" == "1" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    file_lines+=("$line")
  done < <(collect_git_status_lines)
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

# Normalize locked file lines: ensure backtick wrapping
declare -a normalized_locked_lines=()
for raw in "${locked_file_lines[@]-}"; do
  [[ -z "$raw" ]] && continue
  if [[ "$raw" == *" - "* ]]; then
    file_path="${raw%% - *}"
    file_desc="${raw#* - }"
  else
    file_path="$raw"
    file_desc="[lock reason required]"
  fi

  if [[ "$file_path" == \`*\` ]]; then
    normalized_locked_lines+=("${file_path} - ${file_desc}")
  else
    normalized_locked_lines+=("\`${file_path}\` - ${file_desc}")
  fi
done

if [[ ${#normalized_locked_lines[@]} -eq 0 ]]; then
  locked_file_lines=()
else
  locked_file_lines=("${normalized_locked_lines[@]}")
fi

if [[ ${#validation_lines[@]} -eq 0 ]]; then
  validation_lines+=("Not executed in this step => SKIP")
fi

# Auto-capture minimal context/landmine when not explicitly provided.
# This keeps L2 (Decisions/Landmines) from falling back to placeholders.
if [[ ${#context_lines[@]} -eq 0 ]]; then
  auto_context="$done_text"
  if (( ${#auto_context} > 180 )); then
    auto_context="${auto_context:0:177}..."
  fi
  context_lines+=("Auto-captured decision: ${auto_context}")
fi

if [[ ${#landmine_lines[@]} -eq 0 ]]; then
  first_failed_validation=""
  for line in "${validation_lines[@]}"; do
    if [[ "$line" == *"FAIL"* ]]; then
      first_failed_validation="$line"
      break
    fi
  done

  if [[ -n "$first_failed_validation" ]]; then
    landmine_lines+=("Validation failure to follow up: ${first_failed_validation}")
  else
    landmine_lines+=("No new landmines reported in this chunk.")
  fi
fi

entry_id="$(compute_next_entry_id "$handoff_file")"
timestamp="$(date '+%Y-%m-%d %H:%M:%S %z')"

{
  echo
  echo "### ${timestamp}"
  echo
  echo "- Entry-ID: \`${entry_id}\`"
  echo "- Completed:"
  echo "  - [x] ${done_text}"
  echo "- Remaining:"
  echo "  - [ ] ${next_text}"
  echo "- Changed Files:"
  for line in "${file_lines[@]}"; do
    echo "  - ${line}"
  done

  if [[ ${#locked_file_lines[@]} -gt 0 ]]; then
    echo "- Locked Files:"
    for line in "${locked_file_lines[@]}"; do
      echo "  - ${line}"
    done
  fi

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

compaction_result="$(compact_incremental_entries "$handoff_file" "$compaction_threshold" "$compaction_keep_recent")"
archived_now="${compaction_result%%|*}"
rest="${compaction_result#*|}"
archive_path="${rest%%|*}"
compacted_at="${rest#*|}"

if [[ -z "$archived_now" || ! "$archived_now" =~ ^[0-9]+$ ]]; then
  archived_now=0
fi

if [[ "$compaction_result" == "0||" ]]; then
  archive_path=""
  compacted_at=""
fi

sync_handoff_summary "$handoff_file" "$next_text"
sync_memory_layers "$handoff_file" "$compaction_threshold" "$compaction_keep_recent" "$next_text" "$archived_now" "$compacted_at"

if [[ ${#quality_gate_lines[@]} -gt 0 ]]; then
  apply_quality_gate_updates "$handoff_file"
fi

if (( archived_now > 0 )); then
  echo "Appended incremental handoff entry to ${handoff_file} (entry=${entry_id}, compacted=${archived_now}, archive=${archive_path})"
else
  echo "Appended incremental handoff entry to ${handoff_file} (entry=${entry_id})"
fi

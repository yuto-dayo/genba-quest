#!/usr/bin/env bash
set -euo pipefail

# validate-handoff.sh — Structural invariant checker for HANDOFF.md files.
# Checks L0 required fields, Entry-ID monotonicity, marker integrity,
# and domain index consistency.
#
# Usage:
#   validate-handoff.sh [file ...]
#   validate-handoff.sh                       # defaults to HANDOFF.md
#   validate-handoff.sh HANDOFF.md handoff/server.md
#   validate-handoff.sh --all                 # HANDOFF.md + handoff/**/*.md
#
# Exit codes:
#   0  all checks pass
#   1  one or more checks failed
#   2  usage error / file not found

usage() {
  cat <<'USAGE'
Usage: validate-handoff.sh [--all] [file ...]

Options:
  --all       Validate HANDOFF.md and all handoff/**/*.md files
  -h, --help  Show this help
  --quiet     Suppress per-check detail, only show summary
USAGE
}

# -- Globals ------------------------------------------------------------------
declare -a files=()
quiet=0
errors=0
warnings=0
checks=0

# -- Arg parsing --------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      files+=("HANDOFF.md")
      while IFS= read -r f; do
        files+=("$f")
      done < <(find handoff -name '*.md' -type f 2>/dev/null | sort)
      shift
      ;;
    --quiet)
      quiet=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      files+=("$1")
      shift
      ;;
  esac
done

if [[ ${#files[@]} -eq 0 ]]; then
  files=("HANDOFF.md")
fi

# -- Helpers -------------------------------------------------------------------
pass() {
  checks=$((checks + 1))
  if [[ $quiet -eq 0 ]]; then
    echo "  PASS  $1"
  fi
}

fail() {
  checks=$((checks + 1))
  errors=$((errors + 1))
  echo "  FAIL  $1"
}

warn() {
  warnings=$((warnings + 1))
  if [[ $quiet -eq 0 ]]; then
    echo "  WARN  $1"
  fi
}

# -- Check: L0 required fields ------------------------------------------------
check_l0_fields() {
  local file="$1"
  local has_quick_resume=0
  local has_next_cmd=0
  local has_branch=0
  local has_head=0
  local has_updated=0
  local has_state=0

  while IFS= read -r line; do
    case "$line" in
      "## 0. Quick Resume"*) has_quick_resume=1 ;;
      "- NEXT_CMD:"*)        has_next_cmd=1 ;;
      "- STATE:"*)           has_state=1 ;;
    esac
    # STATE sub-fields (indented)
    if [[ $has_state -eq 1 ]]; then
      case "$line" in
        *"Branch:"*)  has_branch=1 ;;
        *"HEAD:"*)    has_head=1 ;;
        *"Updated:"*) has_updated=1 ;;
      esac
    fi
  done < "$file"

  if [[ $has_quick_resume -eq 1 ]]; then
    pass "L0: Quick Resume section exists"
  else
    fail "L0: Missing '## 0. Quick Resume (AI)' section"
  fi

  if [[ $has_next_cmd -eq 1 ]]; then
    pass "L0: NEXT_CMD field exists"
  else
    fail "L0: Missing NEXT_CMD field"
  fi

  if [[ $has_state -eq 1 ]]; then
    pass "L0: STATE block exists"
  else
    fail "L0: Missing STATE block"
  fi

  if [[ $has_branch -eq 1 ]]; then
    pass "L0: STATE.Branch exists"
  else
    fail "L0: Missing STATE.Branch"
  fi

  if [[ $has_head -eq 1 ]]; then
    pass "L0: STATE.HEAD exists"
  else
    fail "L0: Missing STATE.HEAD (run sync or add manually)"
  fi

  if [[ $has_updated -eq 1 ]]; then
    pass "L0: STATE.Updated exists"
  else
    fail "L0: Missing STATE.Updated (run sync or add manually)"
  fi
}

# -- Check: Marker integrity --------------------------------------------------
check_markers() {
  local file="$1"

  local -a marker_pairs=(
    "HANDOFF_L1_START:HANDOFF_L1_END"
    "HANDOFF_L2_DECISIONS_START:HANDOFF_L2_DECISIONS_END"
    "HANDOFF_L2_LANDMINES_START:HANDOFF_L2_LANDMINES_END"
    "HANDOFF_L2_THREADS_START:HANDOFF_L2_THREADS_END"
    "HANDOFF_L2_STATE_START:HANDOFF_L2_STATE_END"
    "HANDOFF_SESSION_EVENTS_START:HANDOFF_SESSION_EVENTS_END"
  )

  for pair in "${marker_pairs[@]}"; do
    local start_marker="${pair%%:*}"
    local end_marker="${pair##*:}"

    local start_count
    start_count=$(grep -c "<!-- ${start_marker} -->" "$file" 2>/dev/null || true)
    start_count="${start_count:-0}"
    local end_count
    end_count=$(grep -c "<!-- ${end_marker} -->" "$file" 2>/dev/null || true)
    end_count="${end_count:-0}"

    if [[ $start_count -eq 0 && $end_count -eq 0 ]]; then
      # Marker pair absent entirely — OK for files without L1/L2
      continue
    fi

    if [[ $start_count -eq 1 && $end_count -eq 1 ]]; then
      # Check ordering: START must come before END
      local start_line end_line
      start_line=$(grep -n "<!-- ${start_marker} -->" "$file" | head -1 | cut -d: -f1)
      end_line=$(grep -n "<!-- ${end_marker} -->" "$file" | head -1 | cut -d: -f1)
      if [[ $start_line -lt $end_line ]]; then
        pass "Marker: ${start_marker} / ${end_marker} paired and ordered"
      else
        fail "Marker: ${start_marker} (line ${start_line}) appears AFTER ${end_marker} (line ${end_line})"
      fi
    else
      if [[ $start_count -ne 1 ]]; then
        fail "Marker: ${start_marker} count=${start_count} (expected 1)"
      fi
      if [[ $end_count -ne 1 ]]; then
        fail "Marker: ${end_marker} count=${end_count} (expected 1)"
      fi
    fi
  done
}

# -- Check: Entry-ID monotonic increase ---------------------------------------
check_entry_ids() {
  local file="$1"

  local -a ids=()
  while IFS= read -r line; do
    if [[ "$line" =~ Entry-ID:\ \`(H[0-9]+)\` ]]; then
      ids+=("${BASH_REMATCH[1]}")
    fi
  done < "$file"

  if [[ ${#ids[@]} -eq 0 ]]; then
    # No entries yet — skip
    return
  fi

  if [[ ${#ids[@]} -eq 1 ]]; then
    pass "Entry-ID: single entry ${ids[0]} (trivially monotonic)"
    return
  fi

  local prev_num=0
  local monotonic=1
  local first_violation=""

  for id in "${ids[@]}"; do
    local num
    num=$(echo "$id" | sed 's/^H0*//' | sed 's/^$/0/')
    if [[ -z "$num" ]]; then num=0; fi
    if (( num <= prev_num )); then
      monotonic=0
      first_violation="$id (${num}) <= previous (${prev_num})"
      break
    fi
    prev_num=$num
  done

  if [[ $monotonic -eq 1 ]]; then
    local last_idx=$(( ${#ids[@]} - 1 ))
    pass "Entry-ID: ${#ids[@]} entries, monotonically increasing (${ids[0]}..${ids[$last_idx]})"
  else
    fail "Entry-ID: monotonicity violation at ${first_violation}"
  fi
}

# -- Check: L0_END marker present ---------------------------------------------
check_l0_end() {
  local file="$1"
  if grep -q '<!-- L0_END:' "$file" 2>/dev/null; then
    pass "L0: L0_END marker present"
  else
    warn "L0: Missing L0_END marker (progressive loading boundary)"
  fi
}

# -- Check: HEAD matches current git ------------------------------------------
check_head_freshness() {
  local file="$1"
  local file_head
  file_head=$(grep -oP 'HEAD: `\K[^`]+' "$file" 2>/dev/null || true)

  if [[ -z "$file_head" ]]; then
    return  # Already reported as missing field
  fi

  local current_head
  current_head=$(git rev-parse --short HEAD 2>/dev/null || true)

  if [[ -z "$current_head" ]]; then
    return  # Not a git repo
  fi

  if [[ "$file_head" == "$current_head" ]]; then
    pass "L0: HEAD matches current git (${current_head})"
  else
    warn "L0: HEAD is stale (file: ${file_head}, git: ${current_head})"
  fi
}

# -- Detect: is this a domain index file? -------------------------------------
is_index_file() {
  local file="$1"
  # Index files have "## Active Domains" or "## Domain Selection Guide" but no L0
  if grep -q '## Active Domains\|## Domain Selection Guide' "$file" 2>/dev/null &&
     ! grep -q '## 0\. Quick Resume' "$file" 2>/dev/null; then
    return 0
  fi
  return 1
}

# -- Check: Domain index references -------------------------------------------
check_domain_index() {
  local file="$1"
  local dir
  dir="$(dirname "$file")"

  pass "Index: detected as domain index file"

  # Extract referenced file paths from backtick-wrapped table cells
  local -a refs=()
  while IFS= read -r ref; do
    [[ -z "$ref" ]] && continue
    refs+=("$ref")
  done < <(grep -oP '`\K(handoff/[^`]+\.md)' "$file" 2>/dev/null || true)

  if [[ ${#refs[@]} -eq 0 ]]; then
    warn "Index: no domain file references found in table"
    return
  fi

  for ref in "${refs[@]}"; do
    local target="${dir}/${ref}"
    # If file is at project root, ref is already relative to root
    if [[ "$dir" == "." || "$dir" == "" ]]; then
      target="$ref"
    fi
    if [[ -f "$target" ]]; then
      pass "Index: referenced file exists: ${ref}"
    else
      fail "Index: referenced file missing: ${ref}"
    fi
  done
}

# ==============================================================================
# Main
# ==============================================================================

for file in "${files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: File not found: $file"
    errors=$((errors + 1))
    continue
  fi

  echo "--- Validating: $file ---"

  if is_index_file "$file"; then
    check_domain_index "$file"
  else
    check_l0_fields "$file"
    check_l0_end "$file"
    check_markers "$file"
    check_entry_ids "$file"
    check_head_freshness "$file"
  fi

  echo ""
done

# -- Summary -------------------------------------------------------------------
echo "=== Summary ==="
echo "Files:    ${#files[@]}"
echo "Checks:  ${checks}"
echo "Passed:  $((checks - errors))"
echo "Failed:  ${errors}"
echo "Warnings: ${warnings}"

if [[ $errors -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL"
  exit 1
else
  echo ""
  echo "RESULT: PASS"
  exit 0
fi

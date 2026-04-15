#!/usr/bin/env bash
# Shared helpers for incremental-handoff test harness.
# Sourced by run.sh; not executed directly.

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${TESTS_DIR}/.." && pwd)"
SCRIPT="${SKILL_DIR}/scripts/append-handoff-update.sh"
FIXTURE="${TESTS_DIR}/fixtures/minimal-handoff.md"

TESTS_RUN=0
TESTS_FAIL=0
CURRENT_TEST=""
CURRENT_WORKDIR=""

color_green='\033[32m'
color_red='\033[31m'
color_yellow='\033[33m'
color_dim='\033[2m'
color_reset='\033[0m'

# setup_workdir: create an isolated temp dir with a fresh handoff fixture.
# Echoes the absolute path to the handoff file the test should pass as --handoff.
setup_workdir() {
  local tmp
  tmp="$(mktemp -d -t handoff-test.XXXXXX)"
  CURRENT_WORKDIR="$tmp"
  cp "$FIXTURE" "${tmp}/HANDOFF.md"
  echo "${tmp}/HANDOFF.md"
}

teardown_workdir() {
  if [[ -n "${CURRENT_WORKDIR:-}" ]] && [[ -d "$CURRENT_WORKDIR" ]]; then
    rm -rf "$CURRENT_WORKDIR"
  fi
  CURRENT_WORKDIR=""
}

# run_script <handoff_file> [args...] — invokes the script with required --handoff
run_script() {
  local handoff="$1"; shift
  "$SCRIPT" --handoff "$handoff" "$@"
}

# assert_eq <expected> <actual> <label>
assert_eq() {
  local expected="$1" actual="$2" label="$3"
  if [[ "$expected" != "$actual" ]]; then
    printf "    ${color_red}FAIL${color_reset} %s: expected=%q actual=%q\n" "$label" "$expected" "$actual"
    return 1
  fi
}

# assert_contains <file> <pattern> <label>
assert_contains() {
  local file="$1" pattern="$2" label="$3"
  if ! grep -qE "$pattern" "$file" 2>/dev/null; then
    printf "    ${color_red}FAIL${color_reset} %s: pattern %q not found in %s\n" "$label" "$pattern" "$file"
    return 1
  fi
}

# assert_not_contains <file> <pattern> <label>
assert_not_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    printf "    ${color_red}FAIL${color_reset} %s: pattern %q unexpectedly found in %s\n" "$label" "$pattern" "$file"
    return 1
  fi
}

# assert_marker_pair <file> <start_marker> <end_marker>
# Verifies exactly 1 start and 1 end line for a HANDOFF marker block.
assert_marker_pair() {
  local file="$1" start="$2" end="$3"
  local s e
  s="$(grep -cF "$start" "$file" 2>/dev/null || echo 0)"
  e="$(grep -cF "$end"   "$file" 2>/dev/null || echo 0)"
  if [[ "$s" != "1" ]] || [[ "$e" != "1" ]]; then
    printf "    ${color_red}FAIL${color_reset} marker integrity: %s start=%s end=%s (expected 1/1)\n" "$start" "$s" "$e"
    return 1
  fi
}

# count_entry_ids <file> — echo number of Entry-ID lines in Incremental Updates
# (grep -c prints "0" and exits 1 when there are no matches; `|| true`
# swallows the non-zero exit without appending a second "0".)
count_entry_ids() {
  local file="$1"
  grep -cE '^- Entry-ID: `H[0-9]{4}`' "$file" 2>/dev/null || true
}

# extract_entry_ids <file> — echo each entry id on its own line
extract_entry_ids() {
  local file="$1"
  grep -oE 'H[0-9]{4}' "$file" 2>/dev/null | sort -u
}

# begin_test <name>
begin_test() {
  CURRENT_TEST="$1"
  TESTS_RUN=$((TESTS_RUN + 1))
  printf "  ${color_dim}==>${color_reset} %s\n" "$CURRENT_TEST"
}

# pass_test
pass_test() {
  printf "    ${color_green}PASS${color_reset} %s\n" "$CURRENT_TEST"
  teardown_workdir
}

# fail_test <reason>
fail_test() {
  local reason="${1:-}"
  TESTS_FAIL=$((TESTS_FAIL + 1))
  printf "    ${color_red}FAIL${color_reset} %s %s\n" "$CURRENT_TEST" "$reason"
  teardown_workdir
}

# print_summary
print_summary() {
  printf "\n"
  if (( TESTS_FAIL == 0 )); then
    printf "${color_green}All %d tests passed.${color_reset}\n" "$TESTS_RUN"
  else
    printf "${color_red}%d/%d tests failed.${color_reset}\n" "$TESTS_FAIL" "$TESTS_RUN"
  fi
}

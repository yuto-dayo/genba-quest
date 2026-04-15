#!/usr/bin/env bash
# Test harness for .claude/skills/incremental-handoff/scripts/append-handoff-update.sh
#
# Usage:
#   .claude/skills/incremental-handoff/tests/run.sh            # run all
#   .claude/skills/incremental-handoff/tests/run.sh <test_name> # run one
#
# Exit code: 0 if all pass, 1 otherwise.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${HERE}/helpers.bash"

# --------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------

test_basic_work_entry() {
  local f; f="$(setup_workdir)"
  run_script "$f" \
    --done "テスト完了アイテム1" \
    --next "P0: 次のアクション" >/dev/null || { fail_test "script exited non-zero"; return; }
  assert_contains "$f" '^- Entry-ID: `H0001`' "entry id H0001" || { fail_test; return; }
  assert_contains "$f" 'テスト完了アイテム1' "done text in file" || { fail_test; return; }
  assert_marker_pair "$f" '<!-- HANDOFF_L1_START -->' '<!-- HANDOFF_L1_END -->' || { fail_test; return; }
  assert_marker_pair "$f" '<!-- HANDOFF_L2_DECISIONS_START -->' '<!-- HANDOFF_L2_DECISIONS_END -->' || { fail_test; return; }
  pass_test
}

test_entry_id_sequence() {
  local f; f="$(setup_workdir)"
  for i in 1 2 3; do
    run_script "$f" --done "chunk $i" --next "P0 $i" >/dev/null || { fail_test "iter $i failed"; return; }
  done
  local count; count="$(count_entry_ids "$f")"
  assert_eq "3" "$count" "entry count" || { fail_test; return; }
  # all three IDs should be present
  for id in H0001 H0002 H0003; do
    assert_contains "$f" "^- Entry-ID: \`${id}\`" "entry $id present" || { fail_test; return; }
  done
  pass_test
}

test_session_event_isolation() {
  local f; f="$(setup_workdir)"
  # first do one real work entry so L1 has content to compare
  run_script "$f" --done "baseline work" --next "P0 baseline" >/dev/null || { fail_test "baseline failed"; return; }
  local l1_before; l1_before="$(awk '/HANDOFF_L1_START/,/HANDOFF_L1_END/' "$f")"
  local entry_count_before; entry_count_before="$(count_entry_ids "$f")"

  # session-event should NOT add to L1/L2/L3
  run_script "$f" --session-event "test event" >/dev/null || { fail_test "session-event failed"; return; }

  local l1_after; l1_after="$(awk '/HANDOFF_L1_START/,/HANDOFF_L1_END/' "$f")"
  local entry_count_after; entry_count_after="$(count_entry_ids "$f")"

  assert_eq "$entry_count_before" "$entry_count_after" "entry count unchanged" || { fail_test; return; }
  if [[ "$l1_before" != "$l1_after" ]]; then
    printf "    ${color_red}FAIL${color_reset} L1 block changed by session-event\n"
    fail_test; return
  fi
  assert_contains "$f" 'test event' "session event label recorded" || { fail_test; return; }
  pass_test
}

test_lock_concurrent_serializes() {
  local f; f="$(setup_workdir)"
  # Kick off 2 concurrent invocations. Both should succeed; Entry-IDs must differ.
  run_script "$f" --done "parallel A" --next "P0 A" >/dev/null &
  local pid_a=$!
  run_script "$f" --done "parallel B" --next "P0 B" >/dev/null &
  local pid_b=$!

  local fail=0
  wait "$pid_a" || fail=1
  wait "$pid_b" || fail=1
  if (( fail != 0 )); then
    fail_test "one of the parallel invocations exited non-zero"; return
  fi

  # Both entries present, distinct IDs
  local count; count="$(count_entry_ids "$f")"
  assert_eq "2" "$count" "entry count after 2 parallel writes" || { fail_test; return; }

  # Marker integrity preserved (no duplicated blocks from interleaved writes)
  assert_marker_pair "$f" '<!-- HANDOFF_L1_START -->' '<!-- HANDOFF_L1_END -->' || { fail_test; return; }
  assert_marker_pair "$f" '<!-- HANDOFF_L2_DECISIONS_START -->' '<!-- HANDOFF_L2_DECISIONS_END -->' || { fail_test; return; }
  assert_marker_pair "$f" '<!-- HANDOFF_L2_LANDMINES_START -->' '<!-- HANDOFF_L2_LANDMINES_END -->' || { fail_test; return; }
  assert_marker_pair "$f" '<!-- HANDOFF_L2_THREADS_START -->' '<!-- HANDOFF_L2_THREADS_END -->' || { fail_test; return; }
  assert_marker_pair "$f" '<!-- HANDOFF_L2_STATE_START -->' '<!-- HANDOFF_L2_STATE_END -->' || { fail_test; return; }
  assert_marker_pair "$f" '<!-- HANDOFF_SESSION_EVENTS_START -->' '<!-- HANDOFF_SESSION_EVENTS_END -->' || { fail_test; return; }

  # Both payloads present
  assert_contains "$f" 'parallel A' "payload A present" || { fail_test; return; }
  assert_contains "$f" 'parallel B' "payload B present" || { fail_test; return; }

  # Lock dir cleaned up
  if [[ -d "${f}.lock.d" ]]; then
    printf "    ${color_red}FAIL${color_reset} lock dir leaked after concurrent run\n"
    fail_test; return
  fi
  pass_test
}

test_lock_stale_autobreak() {
  local f; f="$(setup_workdir)"
  # Pre-create a stale lock (300 seconds old) — default stale threshold is 120s
  local lock_dir="${f}.lock.d"
  mkdir "$lock_dir"
  local old_ts=$(( $(date '+%s') - 300 ))
  printf '%s %s %s\n' "99999" "$old_ts" "ghost@stale-host" > "${lock_dir}/owner"

  # Script should detect stale lock, warn, break it, proceed
  run_script "$f" --done "after stale break" --next "P0 next" >/dev/null 2>&1 || { fail_test "script failed despite stale lock"; return; }

  assert_contains "$f" '^- Entry-ID: `H0001`' "entry created after stale break" || { fail_test; return; }
  if [[ -d "$lock_dir" ]]; then
    printf "    ${color_red}FAIL${color_reset} lock dir still present after clean exit\n"
    fail_test; return
  fi
  pass_test
}

test_lock_active_timeout() {
  local f; f="$(setup_workdir)"
  # Pre-create an ACTIVE lock (current timestamp → not stale)
  local lock_dir="${f}.lock.d"
  mkdir "$lock_dir"
  printf '%s %s %s\n' "99999" "$(date '+%s')" "me@host" > "${lock_dir}/owner"

  # With short timeout, script should exit 2
  local rc=0
  HANDOFF_LOCK_TIMEOUT=2 run_script "$f" --done "should fail" --next "P0" >/dev/null 2>&1 || rc=$?

  # clean up lock dir so teardown is quiet
  rm -rf "$lock_dir"

  assert_eq "2" "$rc" "expected exit code 2 on lock timeout" || { fail_test; return; }

  # File should be unchanged (no new entry)
  local count; count="$(count_entry_ids "$f")"
  assert_eq "0" "$count" "no entries added when lock timeout" || { fail_test; return; }
  pass_test
}

test_lock_disable_env() {
  local f; f="$(setup_workdir)"
  # Pre-create an active lock; normally this would block, but with disable=1 it should be bypassed.
  local lock_dir="${f}.lock.d"
  mkdir "$lock_dir"
  printf '%s %s %s\n' "99999" "$(date '+%s')" "me@host" > "${lock_dir}/owner"

  HANDOFF_LOCK_DISABLE=1 run_script "$f" --done "lock disabled" --next "P0" >/dev/null || { fail_test "script failed with lock disabled"; rm -rf "$lock_dir"; return; }

  # Lock dir we pre-created still exists (we never took the lock, so we never released it)
  rm -rf "$lock_dir"

  assert_contains "$f" 'lock disabled' "payload written despite pre-existing lock dir" || { fail_test; return; }
  pass_test
}

# --------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------

ALL_TESTS=(
  test_basic_work_entry
  test_entry_id_sequence
  test_session_event_isolation
  test_lock_concurrent_serializes
  test_lock_stale_autobreak
  test_lock_active_timeout
  test_lock_disable_env
)

if [[ ! -x "$SCRIPT" ]]; then
  echo "Script not executable: $SCRIPT" >&2
  exit 1
fi

selected=("$@")
if (( ${#selected[@]} == 0 )); then
  selected=("${ALL_TESTS[@]}")
fi

printf "Running %d test(s) against:\n  %s\n\n" "${#selected[@]}" "$SCRIPT"

for t in "${selected[@]}"; do
  begin_test "$t"
  # Call test; helpers track pass/fail counters
  "$t" || true
done

print_summary

(( TESTS_FAIL == 0 ))

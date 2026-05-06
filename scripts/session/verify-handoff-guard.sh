#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PASS_COUNT=0
FAIL_COUNT=0

ACTIVE_SESSION_FILE=".session/active_session"
ACTIVE_SESSION_BACKUP=""
declare -a TEMP_FILES=()
declare -a TEMP_DIRS=()

cleanup() {
  local exit_code=$?

  for file in "${TEMP_FILES[@]-}"; do
    [[ -f "$file" ]] && rm -f "$file"
  done

  for dir in "${TEMP_DIRS[@]-}"; do
    [[ -d "$dir" ]] && rm -rf "$dir"
  done

  if [[ -n "$ACTIVE_SESSION_BACKUP" && -f "$ACTIVE_SESSION_BACKUP" ]]; then
    mv "$ACTIVE_SESSION_BACKUP" "$ACTIVE_SESSION_FILE"
  elif [[ -f "$ACTIVE_SESSION_FILE" ]]; then
    rm -f "$ACTIVE_SESSION_FILE"
  fi

  if [[ "$exit_code" -ne 0 ]]; then
    echo "verify-handoff-guard: FAILED"
  fi
}
trap cleanup EXIT

record_pass() {
  local name="$1"
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "[PASS] $name"
}

record_fail() {
  local name="$1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "[FAIL] $name"
}

assert_contains() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  if rg -q --fixed-strings -- "$pattern" "$file"; then
    record_pass "$name"
  else
    record_fail "$name"
  fi
}

make_temp_file() {
  local tmp
  tmp="$(mktemp /tmp/verify-handoff-guard.XXXXXX)"
  TEMP_FILES+=("$tmp")
  echo "$tmp"
}

make_temp_dir() {
  local tmp
  tmp="$(mktemp -d /tmp/verify-handoff-guard.XXXXXX)"
  TEMP_DIRS+=("$tmp")
  echo "$tmp"
}

write_active_session() {
  local handoff_file="$1"
  mkdir -p .session
  cat > "$ACTIVE_SESSION_FILE" <<EOF
AGENT=codex
STARTED_AT=2026-02-17T00:00:00Z
HANDOFF_FILE=$handoff_file
NEXT_STEP=test
EOF
}

create_handoff_template() {
  local target="$1"
  local next_cmd="$2"
  local completed_line="$3"
  local p0_line="$4"

  cat > "$target" <<EOF
# Session Handoff - 2026-02-17

## 0. Quick Resume (AI)

- NEXT_CMD: \`$next_cmd\`

## 3. Completed

$completed_line

## 4. Remaining（優先順位順）

$p0_line
- [ ] **P1**: 次の優先タスクを記載

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| \`(none)\` | - |

## 6. Locked Files（編集中 - 他エージェント触らない）

> なし

## 9. Risks / Blockers

- none

## 11. Incremental Updates
EOF
}

mkdir -p .session
if [[ -f "$ACTIVE_SESSION_FILE" ]]; then
  ACTIVE_SESSION_BACKUP="$(mktemp /tmp/verify-handoff-active-session.XXXXXX)"
  mv "$ACTIVE_SESSION_FILE" "$ACTIVE_SESSION_BACKUP"
fi

# 1) Syntax check
if bash -n scripts/session/session-start.sh \
  && bash -n scripts/session/session-update.sh \
  && bash -n scripts/session/session-end.sh \
  && bash -n scripts/session/verify-handoff-guard.sh \
  && bash -n .githooks/pre-commit \
  && bash -n .claude/skills/incremental-handoff/scripts/append-handoff-update.sh; then
  record_pass "shell syntax checks"
else
  record_fail "shell syntax checks"
fi

# 1b) pre-commit handoff guard accepts nested handoff markdown and keeps bypass rules explicit
precommit_repo="$(make_temp_dir)"
mkdir -p "$precommit_repo/.githooks" "$precommit_repo/.session"
cp .githooks/pre-commit "$precommit_repo/.githooks/pre-commit"
(
  cd "$precommit_repo"
  git init -q
  git config user.email "verify@example.invalid"
  git config user.name "Verify Handoff Guard"
  mkdir -p src handoff/frontend
  printf 'initial\n' > README.md
  git add README.md
  git commit -q -m "initial"
)

(
  cd "$precommit_repo"
  printf 'change\n' > src/app.ts
  git add src/app.ts
  mkdir -p .session
  printf 'AGENT=codex\nHANDOFF_FILE=handoff/frontend/today.md\n' > .session/active_session
)

precommit_missing_log="$(make_temp_file)"
if (cd "$precommit_repo" && .githooks/pre-commit >"$precommit_missing_log" 2>&1); then
  record_fail "pre-commit blocks missing handoff markdown"
else
  if rg -q --fixed-strings -- "HANDOFF.md or handoff/**/*.md" "$precommit_missing_log"; then
    record_pass "pre-commit blocks missing handoff markdown"
  else
    record_fail "pre-commit blocks missing handoff markdown"
  fi
fi

(
  cd "$precommit_repo"
  printf 'nested handoff\n' > handoff/frontend/today.md
  git add handoff/frontend/today.md
)

if (cd "$precommit_repo" && .githooks/pre-commit >/dev/null 2>&1); then
  record_pass "pre-commit accepts nested staged handoff markdown"
else
  record_fail "pre-commit accepts nested staged handoff markdown"
fi

precommit_skip_missing_reason_log="$(make_temp_file)"
if (cd "$precommit_repo" && SKIP_HANDOFF_GUARD=1 .githooks/pre-commit >"$precommit_skip_missing_reason_log" 2>&1); then
  record_fail "pre-commit skip guard requires reason"
else
  if rg -q --fixed-strings -- "SKIP_HANDOFF_GUARD=1 requires SKIP_HANDOFF_REASON." "$precommit_skip_missing_reason_log"; then
    record_pass "pre-commit skip guard requires reason"
  else
    record_fail "pre-commit skip guard requires reason"
  fi
fi

if (cd "$precommit_repo" && SKIP_HANDOFF_GUARD=1 SKIP_HANDOFF_REASON="verified bypass" .githooks/pre-commit >/dev/null 2>&1); then
  record_pass "pre-commit skip guard accepts explicit reason"
else
  record_fail "pre-commit skip guard accepts explicit reason"
fi

# 1c) session profile parsing and profile handoff routing
profile_conflict_log="$(make_temp_file)"
if scripts/session/session-start.sh --agent codex --profile local --domain local >"$profile_conflict_log" 2>&1; then
  record_fail "session-start rejects profile/domain conflict"
else
  if rg -q --fixed-strings -- "Error: --profile and --domain are mutually exclusive." "$profile_conflict_log" \
    && rg -q --fixed-strings -- "Use either --profile local|production or --domain <name>." "$profile_conflict_log"; then
    record_pass "session-start rejects profile/domain conflict"
  else
    record_fail "session-start rejects profile/domain conflict"
  fi
fi

profile_invalid_log="$(make_temp_file)"
if scripts/session/session-start.sh --agent codex --profile staging >"$profile_invalid_log" 2>&1; then
  record_fail "session-start rejects invalid profile"
else
  if rg -q --fixed-strings -- "Allowed profiles: local, production" "$profile_invalid_log"; then
    record_pass "session-start rejects invalid profile"
  else
    record_fail "session-start rejects invalid profile"
  fi
fi

profile_sandbox="$(make_temp_dir)"
mkdir -p \
  "$profile_sandbox/scripts" \
  "$profile_sandbox/.claude/skills/incremental-handoff" \
  "$profile_sandbox/docs" \
  "$profile_sandbox/server/sql" \
  "$profile_sandbox/frontend" \
  "$profile_sandbox/server"
cp -R scripts/session "$profile_sandbox/scripts/"
cp -R .claude/skills/incremental-handoff/scripts "$profile_sandbox/.claude/skills/incremental-handoff/"
cp docs/DESIGN_PHILOSOPHY.md "$profile_sandbox/docs/DESIGN_PHILOSOPHY.md"
(
  cd "$profile_sandbox"
  git init -q
  git config user.email "verify@example.invalid"
  git config user.name "Verify Handoff Profiles"
)

profile_production_log="$(make_temp_file)"
if (cd "$profile_sandbox" && scripts/session/session-start.sh --agent codex --profile production >"$profile_production_log" 2>&1); then
  if [[ -f "$profile_sandbox/handoff/deploy/production.md" ]]; then
    record_pass "profile production creates nested handoff"
  else
    record_fail "profile production creates nested handoff"
  fi
  if rg -q --fixed-strings -- "PROFILE=production" "$profile_sandbox/.session/active_session" \
    && rg -q --fixed-strings -- "DOMAIN=deploy/production" "$profile_sandbox/.session/active_session" \
    && rg -q --fixed-strings -- "HANDOFF_FILE=handoff/deploy/production.md" "$profile_sandbox/.session/active_session"; then
    record_pass "profile production active_session fields"
  else
    record_fail "profile production active_session fields"
  fi
else
  record_fail "profile production creates nested handoff"
  record_fail "profile production active_session fields"
fi

if (cd "$profile_sandbox" && scripts/session/session-update.sh \
    --done "profile smoke" \
    --next "production smoke next" \
    --validation "manual => PASS" >/dev/null 2>&1); then
  if rg -q --fixed-strings -- "profile smoke" "$profile_sandbox/handoff/deploy/production.md"; then
    record_pass "profile session-update uses active HANDOFF_FILE"
  else
    record_fail "profile session-update uses active HANDOFF_FILE"
  fi
else
  record_fail "profile session-update uses active HANDOFF_FILE"
fi

if (cd "$profile_sandbox" && SESSION_END_SKIP_TESTS=1 scripts/session/session-end.sh --allow-incomplete-handoff >/dev/null 2>&1); then
  if rg -q --fixed-strings -- "ended by codex" "$profile_sandbox/handoff/deploy/production.md"; then
    record_pass "profile session-end uses active HANDOFF_FILE"
  else
    record_fail "profile session-end uses active HANDOFF_FILE"
  fi
  if rg -q --fixed-strings -- "# Project Handoff Profile / Domain Index" "$profile_sandbox/HANDOFF.md" \
    && ! rg -q --fixed-strings -- "## 3. Completed" "$profile_sandbox/HANDOFF.md" \
    && ! rg -q --fixed-strings -- "profile smoke" "$profile_sandbox/HANDOFF.md"; then
    record_pass "profile keeps root HANDOFF as index"
  else
    record_fail "profile keeps root HANDOFF as index"
  fi
else
  record_fail "profile session-end uses active HANDOFF_FILE"
  record_fail "profile keeps root HANDOFF as index"
fi

profile_local_log="$(make_temp_file)"
if (cd "$profile_sandbox" && scripts/session/session-start.sh --agent codex --profile local >"$profile_local_log" 2>&1); then
  if [[ -f "$profile_sandbox/handoff/local.md" ]] \
    && rg -q --fixed-strings -- "PROFILE=local" "$profile_sandbox/.session/active_session" \
    && rg -q --fixed-strings -- "DOMAIN=local" "$profile_sandbox/.session/active_session" \
    && rg -q --fixed-strings -- "HANDOFF_FILE=handoff/local.md" "$profile_sandbox/.session/active_session"; then
    record_pass "profile local creates local handoff"
  else
    record_fail "profile local creates local handoff"
  fi
else
  record_fail "profile local creates local handoff"
fi
rm -f "$profile_sandbox/.session/active_session"

# 2) append-handoff-update summary sync
handoff_sync="$(make_temp_file)"
create_handoff_template \
  "$handoff_sync" \
  "scripts/session/session-start.sh --agent codex" \
  "- [ ] まだ未着手" \
  "- [ ] **P0**: scripts/session/session-start.sh --agent codex"

.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff "$handoff_sync" \
  --done "summary sync test" \
  --next "cd server && npm run test:integration" \
  --validation "summary sync => PASS" >/dev/null

assert_contains "sync NEXT_CMD" "$handoff_sync" "- NEXT_CMD: \`cd server && npm run test:integration\`"
assert_contains "sync Completed" "$handoff_sync" "- [x] summary sync test"
assert_contains "sync Remaining P0" "$handoff_sync" "- [ ] **P0**: cd server && npm run test:integration"
assert_contains "default file sentinel" "$handoff_sync" "No file list provided (use --file \"path - semantic description\")"
assert_contains "entry id assigned" "$handoff_sync" "- Entry-ID: \`H0001\`"
assert_contains "L1 summary synced" "$handoff_sync" "- [H0001] Completed: summary sync test"
assert_contains "L2 open thread synced" "$handoff_sync" "- [H0001] cd server && npm run test:integration"
assert_contains "top Changed Files synced" "$handoff_sync" "| \`(not recorded)\` | No file list provided (use --file \"path - semantic description\") |"

# 2b) top-level sections stay aligned with repeated updates
handoff_sections="$(make_temp_file)"
create_handoff_template \
  "$handoff_sections" \
  "P0: first task" \
  "- [ ] まだ未着手" \
  "- [ ] **P0**: P0: first task"

.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff "$handoff_sections" \
  --done "first chunk" \
  --next "P0: first follow-up" \
  --file "server/a.ts - first semantic change" \
  --validation "first chunk => PASS" >/dev/null

.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff "$handoff_sections" \
  --done "second chunk" \
  --next "P0: second follow-up" \
  --file "server/b.ts - second semantic change" \
  --locked-file "server/b.ts - migration in progress" \
  --landmine "avoid editing server/b.ts concurrently" \
  --validation "second chunk => PASS" >/dev/null

assert_contains "repeated sync keeps latest Completed" "$handoff_sections" "- [x] second chunk"
assert_contains "repeated sync retains earlier Completed" "$handoff_sections" "- [x] first chunk"
assert_contains "repeated sync updates Changed Files table" "$handoff_sections" "| \`server/b.ts\` | second semantic change |"
assert_contains "repeated sync updates Locked Files" "$handoff_sections" "- \`server/b.ts\` - migration in progress"
assert_contains "repeated sync updates Risks" "$handoff_sections" "- avoid editing server/b.ts concurrently"

# 3) session-end guard blocks incomplete handoff
handoff_incomplete="$(make_temp_file)"
create_handoff_template \
  "$handoff_incomplete" \
  "scripts/session/session-start.sh --agent codex" \
  "- [ ] まだ未着手" \
  "- [ ] **P0**: scripts/session/session-start.sh --agent codex"

write_active_session "$handoff_incomplete"
incomplete_log="$(make_temp_file)"
if SESSION_END_SKIP_TESTS=1 scripts/session/session-end.sh >"$incomplete_log" 2>&1; then
  record_fail "guard blocks incomplete handoff"
else
  if rg -q "Handoff quality check failed" "$incomplete_log"; then
    record_pass "guard blocks incomplete handoff"
  else
    record_fail "guard blocks incomplete handoff"
  fi
fi

# 4) override allows intentional completion
write_active_session "$handoff_incomplete"
override_log="$(make_temp_file)"
if SESSION_END_SKIP_TESTS=1 scripts/session/session-end.sh --allow-incomplete-handoff >"$override_log" 2>&1; then
  record_pass "override allows incomplete handoff"
else
  record_fail "override allows incomplete handoff"
fi

# 5) guard ignores historical placeholders in Incremental Updates
handoff_history="$(make_temp_file)"
create_handoff_template \
  "$handoff_history" \
  "cd server && npm test" \
  "- [x] already done" \
  "- [ ] **P0**: cd server && npm run test:integration"
cat >> "$handoff_history" <<'EOF'
### 2026-02-17 00:00:00 +0900
- Changed Files:
  - `foo.ts` - [semantic description required]
EOF

write_active_session "$handoff_history"
history_log="$(make_temp_file)"
if SESSION_END_SKIP_TESTS=1 scripts/session/session-end.sh >"$history_log" 2>&1; then
  record_pass "history placeholders are ignored"
else
  record_fail "history placeholders are ignored"
fi

# 6) L3 compaction archives old entries and keeps recent ones
handoff_compact="$(make_temp_file)"
create_handoff_template \
  "$handoff_compact" \
  "P0: first" \
  "- [x] already done" \
  "- [ ] **P0**: P0: first"

for idx in 1 2 3; do
  HANDOFF_COMPACTION_THRESHOLD=2 \
  HANDOFF_COMPACTION_KEEP_RECENT=1 \
  .claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
    --handoff "$handoff_compact" \
    --done "compaction test ${idx}" \
    --next "P0: compaction-next-${idx}" \
    --validation "compaction test ${idx} => PASS" >/dev/null
done

compaction_entries="$(awk '
  /^## 1[13]\. Incremental Updates/ { in_inc = 1; next }
  /^## [0-9]+\./ { if (in_inc) exit }
  in_inc && /^### / { count++ }
  END { print count + 0 }
' "$handoff_compact")"

if [[ "$compaction_entries" == "1" ]]; then
  record_pass "compaction keeps only recent entries"
else
  record_fail "compaction keeps only recent entries"
fi

assert_contains "compaction state updated" "$handoff_compact" "- archived_entries: \`2\`"

archive_file="$(awk '
  /^> L3 compaction: archived/ {
    count = split($0, parts, "`")
    if (count >= 3) {
      print parts[2]
    }
    exit
  }
' "$handoff_compact")"

if [[ -n "$archive_file" && -f "$archive_file" ]]; then
  record_pass "compaction archive file exists"
else
  record_fail "compaction archive file exists"
fi

# 7) session-start inherits previous NEXT_CMD into fresh handoff
handoff_start="$(make_temp_file)"
cat > "$handoff_start" <<'EOF'
# Session Handoff - 2026-02-17

## 0. Quick Resume (AI)
- NEXT_CMD: `cd server && npm run test:integration`

## 4. Remaining（優先順位順）
- [ ] **P0**: cd server && npm run test:integration
EOF

start_log="$(make_temp_file)"
if scripts/session/session-start.sh --agent codex --handoff "$handoff_start" >"$start_log" 2>&1; then
  if rg -q --fixed-strings -- "- NEXT_CMD: \`cd server && npm run test:integration\`" "$handoff_start"; then
    record_pass "session-start carries forward next command"
  else
    record_fail "session-start carries forward next command"
  fi
  if rg -q --fixed-strings -- "- STATE:" "$handoff_start" \
    && rg -q --fixed-strings -- "- Uncommitted: \`" "$handoff_start" \
    && rg -q --fixed-strings -- "- DB migrations: \`latest local:" "$handoff_start"; then
    record_pass "session-start injects L0 state"
  else
    record_fail "session-start injects L0 state"
  fi
else
  record_fail "session-start carries forward next command"
fi

if [[ -f "$ACTIVE_SESSION_FILE" ]]; then
  rm -f "$ACTIVE_SESSION_FILE"
fi

# 8) session-start can create nested handoff paths
nested_root="$(mktemp -d /tmp/verify-handoff-nested.XXXXXX)"
nested_handoff="${nested_root}/handoff/frontend/today.md"
nested_log="$(make_temp_file)"
if scripts/session/session-start.sh --agent codex --handoff "$nested_handoff" >"$nested_log" 2>&1; then
  if [[ -f "$nested_handoff" ]]; then
    record_pass "session-start creates nested handoff directories"
  else
    record_fail "session-start creates nested handoff directories"
  fi
else
  record_fail "session-start creates nested handoff directories"
fi
rm -rf "$nested_root"

if [[ -f "$ACTIVE_SESSION_FILE" ]]; then
  rm -f "$ACTIVE_SESSION_FILE"
fi

# 9) session-start rejects unsafe domain values
invalid_handoff="$(make_temp_file)"
invalid_log="$(make_temp_file)"
if scripts/session/session-start.sh --agent codex --domain "../bad" --handoff "$invalid_handoff" >"$invalid_log" 2>&1; then
  record_fail "session-start rejects unsafe domains"
else
  if rg -q "Invalid --domain" "$invalid_log"; then
    record_pass "session-start rejects unsafe domains"
  else
    record_fail "session-start rejects unsafe domains"
  fi
fi

# 10) --session-event mode creates Session Events section and appends an event
handoff_event="$(make_temp_file)"
create_handoff_template \
  "$handoff_event" \
  "P0: keep next" \
  "- [x] real work done" \
  "- [ ] **P0**: P0: keep next"
# Add the L0_END marker so ensure_session_events_section can place the block correctly
sed -i.bak '/^## 0\. Quick Resume/a\
\
- NEXT_CMD: `P0: keep next`\
\
<!-- L0_END: test marker -->
' "$handoff_event"
rm -f "${handoff_event}.bak"

.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff "$handoff_event" \
  --session-event "claude started session" >/dev/null

assert_contains "session-event creates Session Events section" "$handoff_event" "## Session Events (audit log)"
assert_contains "session-event appends event line" "$handoff_event" "— claude started session"

# 11) --session-event mode does NOT pollute Completed / L1 / L2 / L3
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff "$handoff_event" \
  --session-event "claude ended session" >/dev/null

# Should still have the original Completed line and NOT have a Session ended Completed entry
if rg -q --fixed-strings -- "- [x] real work done" "$handoff_event" \
  && ! rg -q --fixed-strings -- "- [x] claude ended session" "$handoff_event" \
  && ! rg -q --fixed-strings -- "- [x] Session ended" "$handoff_event"; then
  record_pass "session-event does not pollute Completed"
else
  record_fail "session-event does not pollute Completed"
fi

# Should NOT have created an Incremental Updates entry for the session events
inc_count_after_events="$(awk '
  /^## 1[13]\. Incremental Updates/ { in_inc = 1; next }
  /^## [0-9]+\./ { if (in_inc) exit }
  in_inc && /^### / { count++ }
  END { print count + 0 }
' "$handoff_event")"
if [[ "$inc_count_after_events" == "0" ]]; then
  record_pass "session-event does not append Incremental Update entry"
else
  record_fail "session-event does not append Incremental Update entry"
fi

# 12) --quality-gate updates the Quality Gate table row
handoff_qg="$(make_temp_file)"
cat > "$handoff_qg" <<'EOF'
# Session Handoff - 2026-04-08

## 0. Quick Resume (AI)
- NEXT_CMD: `P0: test`

<!-- L0_END: test marker -->

## 7. Quality Gate

| Check | Result | Notes |
| ----- | ------ | ----- |
| server typecheck | SKIP | not run yet |
| frontend typecheck | SKIP | not run yet |
| lint | SKIP | not run yet |
| test | SKIP | optional |
EOF

.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff "$handoff_qg" \
  --session-event "test gate update" \
  --quality-gate "server typecheck=PASS|baseline at 12:00" \
  --quality-gate "frontend typecheck=FAIL|3 errors in Today.tsx" >/dev/null

assert_contains "quality-gate row updated (server PASS)" "$handoff_qg" "| server typecheck | PASS | baseline at 12:00 |"
assert_contains "quality-gate row updated (frontend FAIL)" "$handoff_qg" "| frontend typecheck | FAIL | 3 errors in Today.tsx |"
assert_contains "quality-gate untouched row preserved" "$handoff_qg" "| lint | SKIP | not run yet |"

# 13) --from-git-status auto-collects files when run from a git repo
handoff_git="$(make_temp_file)"
create_handoff_template \
  "$handoff_git" \
  "P0: from git" \
  "- [ ] まだ未着手" \
  "- [ ] **P0**: P0: from git"

.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff "$handoff_git" \
  --done "exercise --from-git-status" \
  --next "P0: next" \
  --from-git-status \
  --validation "from-git-status test => PASS" >/dev/null

# Should mention "from git status" in Changed Files section since this repo has dirty files
if rg -q "\[from git status:" "$handoff_git"; then
  record_pass "--from-git-status auto-collects files"
else
  record_fail "--from-git-status auto-collects files"
fi

# 14) session-start dirty-state injection: working tree dirty produces carryover warning
# (This test only meaningful when the parent repo working tree is dirty.
#  In a clean repo, the test passes vacuously.)
handoff_dirty="$(make_temp_file)"
dirty_log="$(make_temp_file)"
if scripts/session/session-start.sh --agent codex --handoff "$handoff_dirty" >"$dirty_log" 2>&1; then
  if git status --porcelain 2>/dev/null | grep -q .; then
    if rg -q --fixed-strings -- "> [carryover]" "$handoff_dirty"; then
      record_pass "session-start injects carryover warning when dirty"
    else
      record_fail "session-start injects carryover warning when dirty"
    fi
    if rg -q "\[dirty:" "$handoff_dirty"; then
      record_pass "session-start populates Changed Files with dirty entries"
    else
      record_fail "session-start populates Changed Files with dirty entries"
    fi
  else
    record_pass "session-start dirty injection (vacuous: clean tree)"
    record_pass "session-start dirty injection (vacuous: clean tree)"
  fi
else
  record_fail "session-start runs successfully on dirty/clean tree"
fi
if [[ -f "$ACTIVE_SESSION_FILE" ]]; then
  rm -f "$ACTIVE_SESSION_FILE"
fi

# 15) session-start uses --session-event (no fake Completed pollution)
handoff_clean_start="$(make_temp_file)"
clean_start_log="$(make_temp_file)"
if scripts/session/session-start.sh --agent claude --handoff "$handoff_clean_start" >"$clean_start_log" 2>&1; then
  # Should NOT contain a "Session started" Completed entry
  if rg -q --fixed-strings -- "- [x] Session started" "$handoff_clean_start"; then
    record_fail "session-start no longer pollutes Completed"
  else
    record_pass "session-start no longer pollutes Completed"
  fi
  # Should contain a Session Events block with the start event
  if rg -q --fixed-strings -- "started by claude" "$handoff_clean_start"; then
    record_pass "session-start records audit event"
  else
    record_fail "session-start records audit event"
  fi
else
  record_fail "session-start runs without polluting"
fi
if [[ -f "$ACTIVE_SESSION_FILE" ]]; then
  rm -f "$ACTIVE_SESSION_FILE"
fi

echo
echo "verify-handoff-guard: PASS=${PASS_COUNT}, FAIL=${FAIL_COUNT}"
if [[ "$FAIL_COUNT" -ne 0 ]]; then
  exit 1
fi

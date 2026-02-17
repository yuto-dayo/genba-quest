#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PASS_COUNT=0
FAIL_COUNT=0

ACTIVE_SESSION_FILE=".session/active_session"
ACTIVE_SESSION_BACKUP=""
declare -a TEMP_FILES=()

cleanup() {
  local exit_code=$?

  for file in "${TEMP_FILES[@]-}"; do
    [[ -f "$file" ]] && rm -f "$file"
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
  && bash -n .claude/skills/incremental-handoff/scripts/append-handoff-update.sh; then
  record_pass "shell syntax checks"
else
  record_fail "shell syntax checks"
fi

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

# 3) session-end guard blocks incomplete handoff
handoff_incomplete="$(make_temp_file)"
create_handoff_template \
  "$handoff_incomplete" \
  "scripts/session/session-start.sh --agent codex" \
  "- [ ] まだ未着手" \
  "- [ ] **P0**: scripts/session/session-start.sh --agent codex"

write_active_session "$handoff_incomplete"
incomplete_log="$(make_temp_file)"
if scripts/session/session-end.sh >"$incomplete_log" 2>&1; then
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
if scripts/session/session-end.sh --allow-incomplete-handoff >"$override_log" 2>&1; then
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
if scripts/session/session-end.sh >"$history_log" 2>&1; then
  record_pass "history placeholders are ignored"
else
  record_fail "history placeholders are ignored"
fi

# 6) session-start inherits previous NEXT_CMD into fresh handoff
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
else
  record_fail "session-start carries forward next command"
fi

if [[ -f "$ACTIVE_SESSION_FILE" ]]; then
  rm -f "$ACTIVE_SESSION_FILE"
fi

echo
echo "verify-handoff-guard: PASS=${PASS_COUNT}, FAIL=${FAIL_COUNT}"
if [[ "$FAIL_COUNT" -ne 0 ]]; then
  exit 1
fi

#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  check-migration-guards.sh [server/sql/NNN_name.sql ...]

Checks target Supabase/Postgres migrations for the most common GENBA QUEST
RLS hazards:
  - RLS predicates using auth.jwt() -> user_metadata
  - legacy org authorization using profiles.role
  - public views missing WITH (security_invoker = true)
  - new public tables missing RLS/policies in the same migration or next one

If no file is provided, all server/sql/*.sql migrations are checked.

Exit codes:
  0  no issues found
  1  one or more issues found
  2  invalid usage or missing files
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
SQL_DIR="${REPO_ROOT}/server/sql"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "$SQL_DIR" ]]; then
  echo "ERROR: server/sql directory not found: $SQL_DIR" >&2
  exit 2
fi

declare -a ALL_SQL=()
while IFS= read -r line; do
  ALL_SQL+=("$line")
done < <(find "$SQL_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ ${#ALL_SQL[@]} -eq 0 ]]; then
  echo "ERROR: no SQL files found in $SQL_DIR" >&2
  exit 2
fi

resolve_file() {
  local input="$1"

  if [[ -f "$input" ]]; then
    (
      cd "$(dirname "$input")" && pwd
    ) | awk -v base="$(basename "$input")" '{print $0 "/" base}'
    return 0
  fi

  if [[ -f "$REPO_ROOT/$input" ]]; then
    printf '%s\n' "$REPO_ROOT/$input"
    return 0
  fi

  if [[ -f "$SQL_DIR/$input" ]]; then
    printf '%s\n' "$SQL_DIR/$input"
    return 0
  fi

  return 1
}

declare -a TARGETS=()
if [[ $# -eq 0 ]]; then
  TARGETS=("${ALL_SQL[@]}")
else
  for arg in "$@"; do
    if ! resolved="$(resolve_file "$arg")"; then
      echo "ERROR: migration not found: $arg" >&2
      exit 2
    fi
    TARGETS+=("$resolved")
  done
fi

find_next_migration() {
  local current="$1"
  local i

  for i in "${!ALL_SQL[@]}"; do
    if [[ "${ALL_SQL[$i]}" == "$current" ]]; then
      if (( i + 1 < ${#ALL_SQL[@]} )); then
        printf '%s\n' "${ALL_SQL[$((i + 1))]}"
      fi
      return 0
    fi
  done

  return 1
}

declare -i ISSUE_COUNT=0
declare -a CHECKED_TABLES=()

report_issue() {
  local message="$1"
  ISSUE_COUNT+=1
  printf 'FAIL: %s\n' "$message"
}

report_pass() {
  local message="$1"
  printf 'PASS: %s\n' "$message"
}

check_non_comment_pattern() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  local matches=""

  matches="$(rg -nP "^(?!\\s*--).*${pattern}" "$file" || true)"
  if [[ -n "$matches" ]]; then
    report_issue "$label in ${file#$REPO_ROOT/}"
    printf '%s\n' "$matches"
  fi
}

contains_non_comment_pattern() {
  local file="$1"
  local pattern="$2"
  rg -qP "^(?!\\s*--).*${pattern}" "$file"
}

array_contains() {
  local needle="$1"
  local item

  for item in "${CHECKED_TABLES[@]:-}"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done

  return 1
}

list_created_public_tables() {
  local file="$1"
  rg -oP "^(?!\\s*--)\\s*CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\.\\K[a-zA-Z0-9_]+" "$file" || true
}

has_policy_for_table() {
  local file="$1"
  local table="$2"
  perl -0ne "exit 0 if /CREATE\\s+POLICY\\b.*?ON\\s+public\\.${table}\\b/is; exit 1;" "$file"
}

check_file_level_patterns() {
  local file="$1"
  local rel="${file#$REPO_ROOT/}"

  check_non_comment_pattern "$file" "auth\\.jwt\\(\\).*user_metadata|NULLIF\\(auth\\.jwt\\(\\)\\s*->\\s*'user_metadata'" \
    "user_metadata appears in executable SQL"

  check_non_comment_pattern "$file" "profiles\\.role\\b" \
    "legacy profiles.role authorization appears in executable SQL"

  if contains_non_comment_pattern "$file" "CREATE(\\s+OR\\s+REPLACE)?\\s+VIEW\\s+public\\."; then
    if ! contains_non_comment_pattern "$file" "WITH\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)"; then
      report_issue "public view without security_invoker in $rel"
    else
      report_pass "public view uses security_invoker in $rel"
    fi
  fi
}

check_public_table_rls() {
  local file="$1"
  local next_file="$2"
  local table
  local window=("$file")
  local rel="${file#$REPO_ROOT/}"

  if [[ -n "$next_file" ]]; then
    window+=("$next_file")
  fi

  while IFS= read -r table; do
    [[ -z "$table" ]] && continue

    local dedupe_key="${file}:${table}"
    if array_contains "$dedupe_key"; then
      continue
    fi
    CHECKED_TABLES+=("$dedupe_key")

    local has_rls=0
    local has_policy=0
    local candidate

    for candidate in "${window[@]}"; do
      if contains_non_comment_pattern "$candidate" "ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\b"; then
        has_rls=1
      fi
      if has_policy_for_table "$candidate" "$table"; then
        has_policy=1
      fi
    done

    if (( has_rls == 0 )); then
      if [[ -n "$next_file" ]]; then
        report_issue "public.${table} created in $rel is missing ENABLE ROW LEVEL SECURITY in the same or next migration"
      else
        report_issue "public.${table} created in $rel is missing ENABLE ROW LEVEL SECURITY"
      fi
    else
      report_pass "public.${table} has RLS enablement in the allowed migration window"
    fi

    if (( has_policy == 0 )); then
      if [[ -n "$next_file" ]]; then
        report_issue "public.${table} created in $rel is missing CREATE POLICY in the same or next migration"
      else
        report_issue "public.${table} created in $rel is missing CREATE POLICY"
      fi
    else
      report_pass "public.${table} has policy coverage in the allowed migration window"
    fi
  done < <(list_created_public_tables "$file")
}

for target in "${TARGETS[@]}"; do
  if [[ ! -f "$target" ]]; then
    echo "ERROR: target file disappeared: $target" >&2
    exit 2
  fi

  next_file="$(find_next_migration "$target" || true)"
  printf '== Checking %s ==\n' "${target#$REPO_ROOT/}"
  check_file_level_patterns "$target"
  check_public_table_rls "$target" "$next_file"
done

if (( ISSUE_COUNT > 0 )); then
  printf 'RESULT: FAIL (%d issue%s)\n' "$ISSUE_COUNT" "$([[ $ISSUE_COUNT -eq 1 ]] && echo "" || echo "s")"
  exit 1
fi

echo "RESULT: PASS"

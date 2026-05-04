#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

failed=0

if find server/sql -maxdepth 1 -type f -name '*.sql' | grep -q .; then
  echo "Found executable-looking SQL under server/sql:" >&2
  find server/sql -maxdepth 1 -type f -name '*.sql' | sort >&2
  failed=1
fi

if find archive/server-sql -maxdepth 1 -type f -name '*.sql' | grep -q .; then
  echo "Found .sql files in archive/server-sql; use .sql.legacy suffix:" >&2
  find archive/server-sql -maxdepth 1 -type f -name '*.sql' | sort >&2
  failed=1
fi

if rg -n "auth\\.jwt\\(\\).*user_metadata|NULLIF\\(auth\\.jwt\\(\\) -> 'user_metadata'" supabase/migrations; then
  echo "Found user_metadata-based RLS predicate in canonical migrations." >&2
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "SQL boundaries OK: canonical SQL is limited to supabase/migrations and supabase/seed.sql."

# DB Baseline Adoption Handoff

## Status

Baseline adoption is complete as of 2026-05-04 and this file is retained as a compact audit note, not as an active implementation plan.

## Completed

- Remote baseline migration `20260501130150_remote_baseline_20260430.sql` was adopted with `supabase migration repair 20260501130150 --status applied --linked`.
- Follow-up migrations `20260504000000`, `20260504054000`, `20260504070358`, and `20260504071238` were pushed through Supabase CLI.
- Local canonical migration history now lives under `supabase/migrations/` with 5 SQL files.
- `docs/DB_BASELINE_REVIEW.md` records the execution history and remaining verification gap.
- `docs/SQL_INVENTORY.md` records the canonical migration count and explicitly separates baseline adoption from later RLS hardening.

## Quality Gate Evidence

Historical evidence from the adoption session:

- `npm run db:reset`: PASS with all 5 migrations.
- `npm run db:lint`: PASS locally with public/private lint checks.
- `npm run db:push:remote:dry`: PASS; remote database reported up to date.
- Remote migration-history probe: PASS; 5 versions present.
- Remote insecure SECURITY DEFINER probe: PASS; remaining insecure count was 0.

Current Codex shell limitation:

- `SUPABASE_DB_PASSWORD` is unset, so direct linked checks that require the pooler password must be rerun from a password-backed shell.

## Remaining

- P0 verification: rerun `supabase migration list` and `supabase db lint --linked --schema public,private --fail-on error` from a shell with `SUPABASE_DB_PASSWORD` set, then append the exact results to `docs/DB_BASELINE_REVIEW.md`.
- P1 hardening: classify and replace broad `USING (true)` / `WITH CHECK (true)` policies, prioritizing Proposal, Ledger, and Accounting.

## Do Not Mix

- Frontend changes, skill changes, and unrelated handoff changes are outside this baseline adoption commit.
- RLS hardening is a separate follow-up migration series; do not fold it into the baseline adoption commit.

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
- Post-commit session-end gates on 2026-05-04: server typecheck PASS, frontend typecheck PASS, frontend lint PASS, server test FAIL in `server/src/__tests__/unit/communicationContactReadModel.test.ts` (`days_since_latest_activity` expected 1, received 12). The failure is in existing server read-model behavior, not in the DB baseline files committed here.

## Remaining

- P0 verification: rerun `supabase migration list` and `supabase db lint --linked --schema public,private --fail-on error` from a shell with `SUPABASE_DB_PASSWORD` set, then append the exact results to `docs/DB_BASELINE_REVIEW.md`.
- P1 hardening: classify and replace broad `USING (true)` / `WITH CHECK (true)` policies, prioritizing Proposal, Ledger, and Accounting.

## Do Not Mix

- Frontend changes, skill changes, and unrelated handoff changes are outside this baseline adoption commit.
- RLS hardening is a separate follow-up migration series; do not fold it into the baseline adoption commit.

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `Run linked final DB checks from a shell with SUPABASE_DB_PASSWORD and supabase link state, then start separate RLS hardening migration design`. Source: realtime
- [H0001] Completed: P0 baseline adoption commit split out as d082259 without frontend/skills/unrelated handoff changes
- [H0001] Remaining: Run linked final DB checks from a shell with SUPABASE_DB_PASSWORD and supabase link state, then start separate RLS hardening migration design
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0001] Auto-captured decision: P0 baseline adoption commit split out as d082259 without frontend/skills/unrelated handoff changes
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0001] No new landmines reported in this chunk.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0001] Run linked final DB checks from a shell with SUPABASE_DB_PASSWORD and supabase link state, then start separate RLS hardening migration design
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `1`
- last_compacted_at: `never`
- archived_entries: `0`
<!-- HANDOFF_L2_STATE_END -->

---

## 11. Incremental Updates

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- 2026-05-04 16:31:32 +0900 — ended by codex
<!-- HANDOFF_SESSION_EVENTS_END -->

### 2026-05-04 16:31:15 +0900

- Entry-ID: `H0001`
- Completed:
  - [x] P0 baseline adoption commit split out as d082259 without frontend/skills/unrelated handoff changes
- Remaining:
  - [ ] Run linked final DB checks from a shell with SUPABASE_DB_PASSWORD and supabase link state, then start separate RLS hardening migration design
- Changed Files:
  - `docs/DB_BASELINE_REVIEW.md` - baseline adoption evidence and blocked final linked check
  - `docs/SQL_INVENTORY.md` - canonical 5 migration inventory
  - `supabase/migrations` - 5 canonical migration files retained
  - `handoff/db/baseline-adoption.md` - compact audit note
- Working Context:
  - Auto-captured decision: P0 baseline adoption commit split out as d082259 without frontend/skills/unrelated handoff changes
- Validation:
  - `git diff --cached --check => PASS before commit; supabase migration list => BLOCKED no project ref/password; supabase db lint --linked --schema public,private --fail-on error => BLOCKED no project ref/password; broad RLS scan => 146 USING(true)/WITH CHECK(true) occurrences in supabase baseline`
- Landmines:
  - No new landmines reported in this chunk.

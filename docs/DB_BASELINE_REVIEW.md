# DB Baseline Review

Date: 2026-05-04
Owner: DB expert reviewer
Target project ref: `ggnxplgngmcelkdqhgfx`
Current status: baseline adoption complete; RLS hardening in progress

## Current State

The remote baseline was pulled from the live Supabase project and adopted into repo history as the canonical local migration baseline. Remote migration history was normalized on 2026-05-04.

Canonical local migrations:

1. `supabase/migrations/20260501130150_remote_baseline_20260430.sql`
2. `supabase/migrations/20260504000000_fix_baseline_function_lint.sql`
3. `supabase/migrations/20260504054000_add_reward_runs_canonical_output_columns.sql`
4. `supabase/migrations/20260504070358_fix_security_definer_search_path_after_baseline_adoption.sql`
5. `supabase/migrations/20260504071238_harden_remaining_security_definer_search_path.sql`
6. `supabase/migrations/20260504075200_harden_proposal_ledger_accounting_rls.sql`
7. `supabase/migrations/20260504082000_harden_org_scoped_broad_rls.sql`
8. `supabase/migrations/20260504083000_harden_remaining_broad_rls.sql`

Remote adoption state:

| Item | Status | Evidence |
| --- | --- | --- |
| Baseline history adoption | Complete | `supabase migration repair 20260501130150 --status applied --linked` passed during adoption session |
| Follow-up migrations through search-path hardening | Complete | `20260504000000`, `20260504054000`, `20260504070358`, `20260504071238` pushed during adoption session |
| RLS hardening migrations `20260504075200` / `20260504082000` / `20260504083000` | Local only | `supabase db reset` and local lint passed; remote push not attempted in this session |
| Final linked verification | Partial | `supabase migration list` passed after relinking; linked lint failed because this shell has no valid `SUPABASE_DB_PASSWORD` and Supabase pooler entered temporary auth circuit breaker |

## Verification Log

Historical baseline adoption verification:

| Check | Result | Notes |
| --- | --- | --- |
| `npm run db:reset` | PASS | all 5 baseline-adoption migrations |
| `npm run db:lint` | PASS | local public/private lint checks |
| `npm run db:push:remote:dry` | PASS | remote reported up to date after `20260504071238` |
| remote migration-history probe | PASS | `supabase_migrations.schema_migrations` contained all 5 adoption versions |
| remote SECURITY DEFINER probe | PASS | insecure count was 0 after search-path hardening |

2026-05-04 repo fixation verification:

| Check | Result | Notes |
| --- | --- | --- |
| `supabase --version` | PASS | `2.95.4` |
| `find supabase/migrations -maxdepth 1 -type f -name '*.sql'` | PASS | 6 local migrations after RLS hardening |
| `supabase migration list` | BLOCKED | current shell has no project link state |
| `supabase db lint --linked --schema public,private --fail-on error` | BLOCKED | current shell has no project link state and no inherited `SUPABASE_DB_PASSWORD` |

2026-05-04 linked verification retry:

| Check | Result | Notes |
| --- | --- | --- |
| `supabase link --project-ref ggnxplgngmcelkdqhgfx` | PASS | link state restored from repo root |
| `supabase migration list` | PASS | remote contains adoption versions through `20260504071238`; local `20260504075200` has no remote version |
| `supabase db lint --linked --schema public,private --fail-on error` | FAIL | `SUPABASE_DB_PASSWORD` was unset in this shell; temp role authentication failed and pooler returned `ECIRCUITBREAKER` after repeated failures |

2026-05-04 RLS hardening verification:

| Check | Result | Notes |
| --- | --- | --- |
| `supabase db reset` | PASS | all 6 local migrations applied |
| `supabase db lint --local --schema public,private --fail-on error` | PASS | no schema errors |
| target broad policy query | PASS | Proposal / Ledger / Accounting priority tables have 0 `qual = true` / `with_check = true` policies |
| targeted server tests | PASS | `webhooksRoute`, `accountingRoute`, `sitesRoute`: 53/53 |

2026-05-04 org-scoped RLS follow-up verification:

| Check | Result | Notes |
| --- | --- | --- |
| migration guard | PASS | `check-migration-guards.sh supabase/migrations/20260504082000_harden_org_scoped_broad_rls.sql` |
| `supabase db reset` | PASS | all 7 local migrations applied |
| `supabase db lint --local --schema public,private --fail-on error` | PASS | no schema errors |
| broad policy count | PASS | remaining broad policies reduced from 125 to 25 |
| target org-scoped broad query | PASS | 38 direct `org_id` tables hardened; target set has 0 broad policies |
| targeted server tests | PASS | Path / LUQO / Sites tests: 51/51 |

2026-05-04 final broad RLS cleanup verification:

| Check | Result | Notes |
| --- | --- | --- |
| migration guard | PASS | `check-migration-guards.sh supabase/migrations/20260504083000_harden_remaining_broad_rls.sql` |
| `supabase db reset` | PASS | all 8 local migrations applied |
| `supabase db lint --local --schema public,private --fail-on error` | PASS | no schema errors |
| broad policy count | PASS | remaining broad policies reduced from 25 to 0 |
| targeted server tests | PASS | Principles / Org / PolicyEngine / Communications Contacts tests: 50/50 |

## Findings

| ID | Status | Finding | Resolution / next action |
| --- | --- | --- | --- |
| `DB-BL-001` | Resolved | Baseline had `SECURITY DEFINER` functions without fixed `search_path`. | Resolved by `20260504070358` and `20260504071238`; do not edit the baseline dump. |
| `DB-BL-002` | Resolved locally | Baseline had broad `USING (true)` / `WITH CHECK (true)` policies. | Proposal / Ledger / Accounting priority policies hardened by `20260504075200`; direct `org_id` Path / LUQO / Site / evaluation tables hardened by `20260504082000`; remaining Badge / Perk / Profiles / parent-derived / shared-read / service-only policies hardened by `20260504083000`. Local broad policy count is 0. |
| `DB-BL-003` | Tracked risk | Existing RPCs contain proposal/ledger direct mutation as part of current remote behavior. | Treat as current canonical behavior; future changes must use safe forward migrations and preserve Proposal/Ledger invariants. |
| `DB-BL-004` | Resolved | Initial local lint failed on plpgsql warnings. | Resolved by `20260504000000_fix_baseline_function_lint.sql`. |
| `DB-BL-005` | Resolved | Remote migration history was empty while local baseline files existed. | Resolved by repair + follow-up pushes through `20260504071238`. |

## Remaining Work

P0 final linked DB confirmation:

```bash
supabase link --project-ref ggnxplgngmcelkdqhgfx
SUPABASE_DB_PASSWORD=... supabase migration list
SUPABASE_DB_PASSWORD=... supabase db lint --linked --schema public,private --fail-on error
```

Run the linked lint again only from a shell with the correct `SUPABASE_DB_PASSWORD`, and wait for the Supabase pooler auth circuit breaker to clear before retrying. Do not paste the password into docs, shell history, or chat.

P1 RLS hardening follow-up:

- Local broad `USING (true)` / `WITH CHECK (true)` cleanup is complete.
- Remote still needs password-backed linked lint and an explicit push decision for local-only RLS migrations.
- Keep future write policies server/RPC-only unless a browser-direct Supabase path is explicitly required.

P2 documentation cleanup:

- Keep `server/sql` as legacy reference/quarantine material until a separate cleanup decision.
- Keep new canonical migrations under `supabase/migrations`.
- Keep this document as execution evidence, not as a runbook template.

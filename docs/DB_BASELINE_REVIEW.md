# DB Baseline Review

Date: 2026-05-04
Owner: DB expert reviewer
Target project ref: `ggnxplgngmcelkdqhgfx`
Current status: baseline adoption complete; RLS hardening pushed remotely

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
| RLS hardening migrations `20260504075200` / `20260504082000` / `20260504083000` | Complete | `supabase db push` applied all 3 migrations remotely on 2026-05-04 |
| Final linked verification | Partial | remote query probes pass; exact `supabase migration list` and `supabase db lint --linked` commands still require a valid `SUPABASE_DB_PASSWORD` in this shell |

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

2026-05-04 remote RLS push verification:

| Check | Result | Notes |
| --- | --- | --- |
| `supabase db push --dry-run` | PASS | pending migrations were exactly `20260504075200`, `20260504082000`, `20260504083000` |
| `supabase db push` | PASS | applied the 3 local-only RLS hardening migrations remotely |
| remote migration-history query | PASS | `supabase_migrations.schema_migrations` contains all 8 canonical local versions through `20260504083000` |
| remote broad policy query | PASS | `pg_policies` returned 0 rows with `qual = true` or `with_check = true` |
| remote SECURITY DEFINER probe | PASS | insecure public/private SECURITY DEFINER count is 0 |
| `supabase migration list` | FAIL | exact command now requires `SUPABASE_DB_PASSWORD`; remote history was verified by direct linked SQL query |
| `supabase db lint --linked --schema public,private --fail-on error` | FAIL | exact command requires `SUPABASE_DB_PASSWORD`; local lint and targeted remote probes pass |

2026-05-05 beta MVP Money approval E2E:

| Check | Result | Notes |
| --- | --- | --- |
| `PROPOSAL_RPC_FALLBACK_MODE=disabled npm --prefix server run verify:beta-mvp` | FAIL | strict mode, local migration order, and link state passed; `SUPABASE_DB_PASSWORD` was unset, so linked migration/lint gates remain blocked |
| `npm --prefix server run seed:money-e2e -- --apply` | PASS | inserted disposable pending `expense.create` Proposal `3ebba0fd-0473-4c11-9d2b-7d33f88eb364` for org `1920a92b-d091-46a9-90c9-9d3a6bcab6a0` |
| Money browser smoke | PASS | `/money?proposal=3ebba0fd-0473-4c11-9d2b-7d33f88eb364` opened the detail modal, showed amount/actor/required approvals/ledger impact/risk, and approve completed execution |
| Today browser smoke | PASS | `/?proposal=3ebba0fd-0473-4c11-9d2b-7d33f88eb364` opened the same detail modal from Today; approval copy now matches Money when auto-executed |
| `npm --prefix server run seed:money-e2e -- --status` | PASS | final state: `proposal_status=executed`, `event_count=1`, `transaction_count=1`, `entry_count=2` |
| `npm --prefix frontend test -- --run Today.test.tsx Money.test.tsx` | PASS | 8 tests passed |
| `npm --prefix server test -- --runInBand src/__tests__/unit/PolicyEngine.test.ts src/__tests__/unit/ProposalService.test.ts` | PASS | 90 tests passed |
| `npm --prefix server run test:integration:proposal-core` | PASS | 17 tests passed |
| `npm --prefix server run build` | PASS | TypeScript build passed |
| `npm --prefix frontend run build` | PASS | TypeScript + Vite build passed; existing chunk-size warning only |

2026-05-06 beta MVP linked DB gate:

| Check | Result | Notes |
| --- | --- | --- |
| `PROPOSAL_RPC_FALLBACK_MODE=disabled SUPABASE_DB_PASSWORD=... npm --prefix server run verify:beta-mvp` | PASS | strict RPC mode, local migration ordering, linked project state, `supabase migration list`, and linked `supabase db lint --linked --schema public,private --fail-on error` all passed |
| `supabase migration list` | PASS | invoked by `verify:beta-mvp`; output connected to the remote database successfully |
| `supabase db lint --linked --schema public,private --fail-on error` | PASS | invoked by `verify:beta-mvp`; output reported `No schema errors found` |

2026-05-06 beta MVP Sherpa/Gmail entrance E2E:

| Check | Result | Notes |
| --- | --- | --- |
| Sherpa proposal creation | PASS | `/api/v1/sherpa/proposals` created pending AI actor proposals `324d888e-addd-4900-bd9e-247e25e8a04b` and `f479b7a3-b074-4886-bd37-ce8f176765c7` |
| Gmail integration proposal creation | PASS | `/api/v1/proposals/integration` with `source=gmail` created pending integration actor proposals `2376e871-3e02-4c9d-be9a-6af9dc9c60cd` and `cd834c3e-dfea-4ef7-9fc1-8d890fd855b7` |
| Today pending queue browser smoke | PASS | all 4 Sherpa/Gmail proposals appeared in Today pending queue and opened the shared Proposal detail modal with amount, actor, approval count, ledger impact, and risk |
| Sherpa approve path | PASS | `324d888e-addd-4900-bd9e-247e25e8a04b` approved from Today and ended as `executed` |
| Sherpa reject path | PASS | `f479b7a3-b074-4886-bd37-ce8f176765c7` rejected from Today with reason `Sherpa入口E2Eの却下確認` |
| Gmail approve path | PASS | `2376e871-3e02-4c9d-be9a-6af9dc9c60cd` approved from Today and ended as `executed` |
| Gmail reject path | PASS | `cd834c3e-dfea-4ef7-9fc1-8d890fd855b7` rejected from Today with reason `Gmail入口E2Eの却下確認` |
| `npm --prefix server run verify:gmail-manual-e2e -- --org-id 1920a92b-d091-46a9-90c9-9d3a6bcab6a0 --approve-id 2376e871-3e02-4c9d-be9a-6af9dc9c60cd --reject-id cd834c3e-dfea-4ef7-9fc1-8d890fd855b7` | PASS | `approve_origin`, `reject_origin`, `approve_status`, `reject_status`, and `reject_reason` all passed |
| `RUN_DB_INTEGRATION_TESTS=1 npm --prefix server test -- --runInBand --runTestsByPath src/__tests__/integration/sherpaProposalApprovalPath.integration.test.ts src/__tests__/integration/webhookIntegrationProposalPath.integration.test.ts` | PASS | 5 tests passed; covers Sherpa AI self-approval block, human approve/reject, Gmail dedupe, integration actor approval prohibition, and human approve/reject |
| DB ledger verification | PASS | approved Sherpa/Gmail proposals produced `events=2`, `transactions=2`, `entries=4`; rejected proposals produced no ledger event |

## Findings

| ID | Status | Finding | Resolution / next action |
| --- | --- | --- | --- |
| `DB-BL-001` | Resolved | Baseline had `SECURITY DEFINER` functions without fixed `search_path`. | Resolved by `20260504070358` and `20260504071238`; do not edit the baseline dump. |
| `DB-BL-002` | Resolved locally | Baseline had broad `USING (true)` / `WITH CHECK (true)` policies. | Proposal / Ledger / Accounting priority policies hardened by `20260504075200`; direct `org_id` Path / LUQO / Site / evaluation tables hardened by `20260504082000`; remaining Badge / Perk / Profiles / parent-derived / shared-read / service-only policies hardened by `20260504083000`. Local broad policy count is 0. |
| `DB-BL-003` | Tracked risk | Existing RPCs contain proposal/ledger direct mutation as part of current remote behavior. | Treat as current canonical behavior; future changes must use safe forward migrations and preserve Proposal/Ledger invariants. |
| `DB-BL-004` | Resolved | Initial local lint failed on plpgsql warnings. | Resolved by `20260504000000_fix_baseline_function_lint.sql`. |
| `DB-BL-005` | Resolved | Remote migration history was empty while local baseline files existed. | Resolved by repair + follow-up pushes through `20260504071238`. |

## Remaining Work

P0 beta MVP linked DB confirmation is complete as of 2026-05-06. Re-run this gate before release cut, after new migrations, or after Supabase CLI upgrades:

```bash
PROPOSAL_RPC_FALLBACK_MODE=disabled SUPABASE_DB_PASSWORD=... npm --prefix server run verify:beta-mvp
```

`20260504084000_seed_accounting_master_data.sql` が later migration より前に pending と表示された場合は、`--include-all` ではなく remote migration history を確認したうえで `supabase migration repair` による意図的な履歴修正を優先する。

Remote migration history, targeted RLS/security probes, and exact linked lint are complete. Do not paste DB passwords into docs, shell history, or chat.

P1 RLS hardening follow-up:

- Local broad `USING (true)` / `WITH CHECK (true)` cleanup is complete.
- Remote push and exact linked lint are complete.
- Keep future write policies server/RPC-only unless a browser-direct Supabase path is explicitly required.

P2 documentation cleanup:

- Keep `server/sql` as legacy reference/quarantine material until a separate cleanup decision.
- Keep new canonical migrations under `supabase/migrations`.
- Keep this document as execution evidence, not as a runbook template.

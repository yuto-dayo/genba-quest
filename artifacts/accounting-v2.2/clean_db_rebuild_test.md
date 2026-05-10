# Accounting v2.2: Clean Local DB Rebuild

Generated: 2026-05-10 JST. Local DB only. Remote DB / push not executed.

## Goal

Prove that `supabase db reset --local` produces a working DB from a fully clean state by applying all 34 migrations in order, with no manual intervention, and that all v2.2 evidence scripts still pass against the freshly built DB. This closes the `pre-remote checklist` line "supabase migration up --local passes from a clean local DB" in `pr_review_package.md`.

## Command

```bash
supabase db reset --local
```

Full log: `/tmp/v22_db_reset.log` (local-only; not committed). Re-run produces an equivalent log.

## Result

- Migrations applied: **34 / 34**
- Hard errors: **0**
- Notice / skip lines: present and expected (CREATE OR REPLACE / DROP IF EXISTS produce idempotency notices when nothing exists yet)
- Storage workaround: `20260506043949_add_private_site_drawings.sql` skips Storage bucket / object policy when `storage.buckets` is unavailable in local config; this is the existing v2.2 [H0023] guard, not a regression

### Migration order applied

```
20260501130150  remote_baseline_20260430
20260504000000  fix_baseline_function_lint
20260504054000  add_reward_runs_canonical_output_columns
20260504070358  fix_security_definer_search_path_after_baseline_adoption
20260504071238  harden_remaining_security_definer_search_path
20260504075200  harden_proposal_ledger_accounting_rls
20260504082000  harden_org_scoped_broad_rls
20260504083000  harden_remaining_broad_rls
20260504084000  seed_accounting_master_data
20260504085000  add_reward_snapshot_tables
20260504090000  add_site_complete_with_close_attempts
20260505010500  add_path_v32_simple_reward
20260506043949  add_private_site_drawings
20260506093000  add_accept_org_invite_rpc
20260506094251  restrict_accept_org_invite_execute
20260506094325  revoke_public_accept_org_invite_execute
20260508133147  p0_accounting_integrity_guards               <-- v2.2 begins
20260508135115  p05_accounting_canonical_revenue_basis
20260508141045  enforce_invoice_allocation_capacity
20260508141832  atomic_invoice_creation
20260509100057  harden_accounting_rpc_membership
20260509101543  accounting_v22_projection_metadata
20260509102522  accounting_payment_event_rpc
20260509110041  accounting_existing_payment_allocation
20260509112149  canonical_sales_posting_rpc
20260509113639  canonical_sales_reversal_rpc
20260509131814  canonical_expense_posting_rpc
20260509133923  canonical_payment_receipt_posting_rpc
20260509134828  canonical_payment_allocation_posting_rpc
20260509135652  canonical_invoice_transfer_posting_rpc
20260509153529  harden_private_accounting_helpers
20260509153840  harden_legacy_accounting_base_rpcs
20260510020000  add_party_org_boundary_helpers              <-- this PR's helpers
20260510020100  wire_party_org_boundary_to_canonical_rpcs   <-- this PR's wiring
```

The 18 v2.2 migrations (from `20260508133147` onward) are not yet on remote; remote currently sits at `20260506094325`.

## Post-Reset Evidence Replay

Each script re-creates its own fixtures, so a fresh DB is the cleanest place to re-verify them.

| Script | Result |
| --- | --- |
| `node artifacts/accounting-v2.2/local_party_org_boundary_test.mjs` | PASS (13 / 13) |
| `node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs` | PASS |
| `node artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs` | PASS |
| `node artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs` | PASS |
| `node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs` | PASS |
| `node artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs` | PASS |
| `cd server && npm test -- accountingRoute.test.ts --runInBand` | PASS (56 / 56) |

No fixture leaks across scripts: each script generates its own org / membership / client / site UUIDs and asserts row counts after. Running them in any order on a freshly reset DB is equivalent.

## Why This Matters For Remote Go-Readiness

A clean rebuild from migration files is the strongest local proxy for `supabase db push` against a fresh staging branch. It catches:

- migrations that depend on side effects from earlier sessions
- functions referenced before declaration (ordering bugs)
- privileges or grants that were silently held by an old DB
- search_path / SECURITY DEFINER tightening that breaks an internal caller

None of these were observed.

The `pr_review_package.md` checklist item `supabase migration up --local passes from a clean local DB` is now satisfied; pair this with the staging rollback / repair plan to close the remaining pre-remote checklist items.

## Out of Scope

- Remote DB / push not executed.
- The `add_private_site_drawings` Storage skip is intentional for local; remote Supabase has Storage enabled and applies the full migration.
- Performance and RLS advisor pass against remote is a separate step (will be done with `mcp__supabase__get_advisors` once v2.2 lands on staging).

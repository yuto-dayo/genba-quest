# Accounting v2.2 Staging Rollback / Repair Runbook

Owner: whoever runs `supabase db push` for the v2.2 migrations.
Status: pre-flight document. v2.2 has not been applied to remote yet.

## Scope

This runbook covers the 20 v2.2 migrations from `20260508133147_p0_accounting_integrity_guards.sql` through `20260510020300_wire_idempotency_lookup_to_canonical_rpcs.sql`. They are visible in this branch but not on remote (`ggnxplgngmcelkdqhgfx`); remote is currently at `20260506094325`.

The runbook is staging-first: apply on staging, validate, then promote. Any production action lives outside this document.

## Pre-Flight Checklist

Run on staging only. Stop immediately if any check fails.

1. **Backup is fresh.** Confirm a Supabase point-in-time-recovery anchor or a `pg_dump` taken within the last hour. If neither exists, take a `pg_dump` first.
2. **Read-only MCP is connected.** Use `mcp__supabase__list_migrations` to confirm staging is at `20260506094325`. If staging is ahead of expected, stop and reconcile before pushing.
3. **No active writers.** Check for in-flight idempotency rows: `select count(*) from public.proposal_executions where status = 'in_progress' and created_at > now() - interval '1 hour';` Should be 0. If non-zero, wait for them to drain.
4. **Local rebuild evidence is current.** Confirm `clean_db_rebuild_test.md` has been re-run within 24 hours and all evidence scripts pass.
5. **Branch state.** PR is reviewed and approved; no uncommitted changes on `codex/money-fix`.

## Application Order

`supabase db push` applies in filename order. The sequence is grouped here to make checkpoint queries easier; do not interleave manual SQL between groups.

### Group A — schema and constraints (4 migrations)

```
20260508133147 p0_accounting_integrity_guards
20260508135115 p05_accounting_canonical_revenue_basis
20260508141045 enforce_invoice_allocation_capacity
20260508141832 atomic_invoice_creation
```

Checkpoint after Group A:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='accounting_journal_lines'
  and column_name in ('customer_id','vendor_id','revenue_basis_id');
-- expect 3 rows
```

### Group B — projection metadata and RPC membership hardening (3 migrations)

```
20260509100057 harden_accounting_rpc_membership
20260509101543 accounting_v22_projection_metadata
20260509102522 accounting_payment_event_rpc
```

Checkpoint:
```sql
select count(*) from pg_proc where proname = 'assert_rpc_active_membership';
-- expect 1
```

### Group C — backfill and canonical RPCs (8 migrations)

```
20260509110041 accounting_existing_payment_allocation
20260509112149 canonical_sales_posting_rpc
20260509113639 canonical_sales_reversal_rpc
20260509131814 canonical_expense_posting_rpc
20260509133923 canonical_payment_receipt_posting_rpc
20260509134828 canonical_payment_allocation_posting_rpc
20260509135652 canonical_invoice_transfer_posting_rpc
20260509153529 harden_private_accounting_helpers
```

Checkpoint:
```sql
select proname from pg_proc
where proname in (
  'rpc_post_accounting_sale_canonical',
  'rpc_reverse_accounting_sale_canonical',
  'rpc_post_accounting_expense_canonical',
  'rpc_record_accounting_payment_event_canonical',
  'rpc_allocate_accounting_payment_canonical',
  'rpc_create_accounting_invoice_canonical'
)
order by proname;
-- expect 6 rows
```

### Group D — boundary tightening (5 migrations)

```
20260509153840 harden_legacy_accounting_base_rpcs
20260510020000 add_party_org_boundary_helpers
20260510020100 wire_party_org_boundary_to_canonical_rpcs
20260510020200 add_idempotency_lookup_helper
20260510020300 wire_idempotency_lookup_to_canonical_rpcs
```

Checkpoint:
```sql
select proname from pg_proc
where pronamespace = 'private'::regnamespace
  and proname in (
    'assert_customer_belongs_to_org',
    'assert_member_belongs_to_org',
    'find_idempotent_execution'
  );
-- expect 3 rows
```

## Post-Apply Smoke Tests

Run these in order against staging, not production. Each is read-only or self-cleaning.

1. **Advisor lint.** `mcp__supabase__get_advisors --type=security` and `--type=performance`. Compare output against the snapshot in `pr_review_package.md`. New high-severity items abort the rollout.
2. **Function privileges.** Re-run `local_rpc_hardening_negative_test.mjs` mental equivalent: confirm `anon` and `authenticated` cannot EXECUTE the canonical RPCs (use `has_function_privilege`).
3. **Read-path smoke.** Hit `/pl?source=compare&month=<recent>` from the staging API and verify diff is 0 for an existing reference month.
4. **Idempotency replay.** Pick a recent successful proposal_execution row from staging, copy its idempotency_key, send a no-op replay through the API, expect the original response and zero new rows.
5. **Boundary smoke.** Send an expense write with a `claimant_member_id` that points to a different org's membership — expect HTTP 4xx with `MEMBER_NOT_IN_ORG` surfaced from the RPC.

If any smoke fails, go to "Rollback Procedure" before any traffic is routed.

## Rollback Procedure

The 20 migrations split into two reversibility classes.

### Class 1 — function-only changes (safely reversible)

These migrations only `CREATE OR REPLACE` functions or change grants / search_path:

```
20260509100057 harden_accounting_rpc_membership
20260509110041 accounting_existing_payment_allocation
20260509112149 canonical_sales_posting_rpc
20260509113639 canonical_sales_reversal_rpc
20260509131814 canonical_expense_posting_rpc
20260509133923 canonical_payment_receipt_posting_rpc
20260509134828 canonical_payment_allocation_posting_rpc
20260509135652 canonical_invoice_transfer_posting_rpc
20260509153529 harden_private_accounting_helpers
20260509153840 harden_legacy_accounting_base_rpcs
20260510020000 add_party_org_boundary_helpers
20260510020100 wire_party_org_boundary_to_canonical_rpcs
20260510020200 add_idempotency_lookup_helper
20260510020300 wire_idempotency_lookup_to_canonical_rpcs
```

To roll back a Class 1 migration: re-apply the previous definition by checking out the parent commit of that migration on staging and running its definition statements through `supabase db push --include-all` against a recovery branch. Functions revert atomically; no data is lost.

Fast path for the helpers and wiring added in this PR:
```sql
-- Drop the new helpers; do NOT drop or revoke find_idempotent_execution while
-- canonical RPCs still call it. Drop ordering must be wiring-first, then
-- helpers, to avoid leaving canonical RPCs in a broken state.

-- 1) Re-run the prior CREATE OR REPLACE for each canonical RPC body using the
--    parent migration files (20260509112149, 20260509113639, 20260509131814,
--    20260509133923, 20260509134828, 20260509135652). This removes both the
--    party/org assert and the idempotency helper call from the bodies.
-- 2) Then drop the helpers:
DROP FUNCTION IF EXISTS private.find_idempotent_execution(uuid, text, text);
DROP FUNCTION IF EXISTS private.assert_customer_belongs_to_org(uuid, uuid);
DROP FUNCTION IF EXISTS private.assert_member_belongs_to_org(uuid, uuid);
```

### Class 2 — schema changes (reversible only with a forward-fix migration)

These migrations alter tables, add columns, or add triggers:

```
20260508133147 p0_accounting_integrity_guards
20260508135115 p05_accounting_canonical_revenue_basis
20260508141045 enforce_invoice_allocation_capacity
20260508141832 atomic_invoice_creation
20260509101543 accounting_v22_projection_metadata
20260509102522 accounting_payment_event_rpc
```

For Class 2 there is no automatic down-migration. Roll back by writing a forward-fix migration that drops the new columns / constraints / triggers, in reverse order. Posted journal rows are immutable, so any data already persisted via the new columns must stay — the forward-fix should only touch shape, not posted data.

If staging is corrupt enough that a forward-fix is too risky, restore from the pre-flight backup and re-create the staging DB from baseline.

## Migration History Repair

If `supabase migration list --linked` shows a discrepancy between local files and remote `supabase_migrations.schema_migrations`:

1. **Diagnose first.** Run on remote:
   ```sql
   select version, name, statements is null as missing_body
   from supabase_migrations.schema_migrations
   order by version desc limit 25;
   ```
   Identify versions present on remote but not on local, and vice versa.

2. **Never `--include-all` blindly.** That flag re-orders application and can re-run already-applied migrations.

3. **Repair workflow.** For each mismatched version:
   ```bash
   supabase migration repair --status applied <version>
   # or
   supabase migration repair --status reverted <version>
   ```
   Use `applied` when remote already ran the SQL but the row is missing. Use `reverted` when the row exists but the SQL was rolled back.

4. **Re-verify.** After repair, `supabase migration list --linked` should show identical sequences. Then re-run the post-apply smoke tests above.

The recurring trap (per `docs/DB_BASELINE_REVIEW.md:159`): `20260504084000_seed_accounting_master_data.sql` may appear as pending if `--include-all` is run; do not let `db push` re-execute it. Always verify via `migration list --linked` first.

## Decision Matrix

| Symptom on staging | Action |
| --- | --- |
| One smoke test fails, others pass, no data written | Roll back the specific migration that caused it (Class 1) and investigate. |
| Multiple smoke tests fail | Full rollback (Class 1 first, then Class 2 forward-fix), restore from backup if needed. |
| `migration list --linked` shows desync after push | Run `migration repair` per version, then re-run smoke. |
| Advisor surfaces new high-severity items | Roll back the specific migration; do not promote to production. |
| Posted journal rows already exist | Do not delete them. Roll back functions only; data is immutable by design. |

## When To Promote

Promote staging → production only when:

- All smoke tests pass.
- Advisor diff vs. pre-apply snapshot is empty or all new items are low-severity and acknowledged.
- Read-only observation period of at least 24 hours with no anomaly in:
  - `select projection_source, count(*) from accounting_transactions where created_at > now() - interval '1 day' group by 1;` — `legacy_direct_write` should trend to zero.
  - `select count(*) from accounting_journal_entries where balanced is false;` — must be 0.
- A second reviewer (human) has signed off in the PR.

## Out of Scope

- Production push procedure (separate runbook).
- Disaster recovery from corrupt baseline (`supabase db restore`).
- The non-accounting legacy SECURITY DEFINER hardening that PR #9 explicitly defers.

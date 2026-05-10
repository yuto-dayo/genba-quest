# Accounting v2.2: Supabase Branch Validation

Generated: 2026-05-10 JST. Validated against a Supabase Branching preview branch (`v22-staging`) of production project `genba-quest` (`ggnxplgngmcelkdqhgfx`). Production was not modified.

## Branch Setup

- Parent project: `ggnxplgngmcelkdqhgfx` (genba-quest)
- Preview branch project_ref: `meuhcmruuhfwpxuwigjk`
- Branch name: `v22-staging`
- `with_data: false` (schema-only clone of parent at `20260506094325`)
- Status: `ACTIVE_HEALTHY`

## Apply

All 20 v2.2 migration SQL bodies were applied to the branch via Management API (`POST /v1/projects/<ref>/database/query`) in filename order. CLI `supabase db push` was not used because the branch's `supabase_migrations.schema_migrations` already had the recurring `accept_org_invite` timestamp drift documented in `DB_BASELINE_REVIEW.md:159` (`20260506094218` / `20260506094252` on remote vs `20260506093000` / `20260506094251` locally), which would have triggered an unwanted `migration repair` flow on the branch. Direct SQL apply sidesteps the CLI's history check while still proving the migration bodies execute cleanly against a production-equivalent schema.

| # | migration | result |
| --- | --- | --- |
| 1 | 20260508133147 p0_accounting_integrity_guards | OK |
| 2 | 20260508135115 p05_accounting_canonical_revenue_basis | OK |
| 3 | 20260508141045 enforce_invoice_allocation_capacity | OK |
| 4 | 20260508141832 atomic_invoice_creation | OK |
| 5 | 20260509100057 harden_accounting_rpc_membership | OK |
| 6 | 20260509101543 accounting_v22_projection_metadata | OK |
| 7 | 20260509102522 accounting_payment_event_rpc | OK |
| 8 | 20260509110041 accounting_existing_payment_allocation | OK |
| 9 | 20260509112149 canonical_sales_posting_rpc | OK |
| 10 | 20260509113639 canonical_sales_reversal_rpc | OK |
| 11 | 20260509131814 canonical_expense_posting_rpc | OK |
| 12 | 20260509133923 canonical_payment_receipt_posting_rpc | OK |
| 13 | 20260509134828 canonical_payment_allocation_posting_rpc | OK |
| 14 | 20260509135652 canonical_invoice_transfer_posting_rpc | OK |
| 15 | 20260509153529 harden_private_accounting_helpers | OK |
| 16 | 20260509153840 harden_legacy_accounting_base_rpcs | OK |
| 17 | 20260510020000 add_party_org_boundary_helpers | OK |
| 18 | 20260510020100 wire_party_org_boundary_to_canonical_rpcs | OK |
| 19 | 20260510020200 add_idempotency_lookup_helper | OK |
| 20 | 20260510020300 wire_idempotency_lookup_to_canonical_rpcs | OK |

20 / 20 applied cleanly. Zero hard errors. Total wall time: under one minute.

## Group Checkpoints (per `docs/runbooks/accounting-v22-staging-rollback.md`)

| Group | Query | Result |
| --- | --- | --- |
| A | `accounting_journal_lines.{customer_id, vendor_id, revenue_basis_id}` columns exist | 3 / 3 ✓ |
| B | `pg_proc.proname = 'assert_rpc_active_membership'` | 1 row ✓ |
| C | 6 canonical posting RPCs (sale / reversal / expense / payment_event / payment_allocation / invoice_transfer) | 6 / 6 ✓ |
| D | `private.{assert_customer_belongs_to_org, assert_member_belongs_to_org, find_idempotent_execution}` | 3 / 3 ✓ |

## Function Privilege Contract

All six canonical posting RPCs on the branch:

| RPC | anon | authenticated | service_role |
| --- | --- | --- | --- |
| `rpc_post_accounting_sale_canonical` | false | false | true |
| `rpc_reverse_accounting_sale_canonical` | false | false | true |
| `rpc_post_accounting_expense_canonical` | false | false | true |
| `rpc_record_accounting_payment_event_canonical` | false | false | true |
| `rpc_allocate_accounting_payment_canonical` | false | false | true |
| `rpc_create_accounting_invoice_canonical` | false | false | true |

`anon` / `authenticated` direct EXECUTE is revoked; only `service_role` can call these RPCs directly. This matches the `local_rpc_hardening_negative_test.mjs` contract on local.

## Advisor Diff: production main vs branch v22-staging

### Security advisor

| Severity | production main | branch v22-staging | delta |
| --- | --- | --- | --- |
| WARN | 43 | 38 | **-5** |
| INFO | 2 | 3 | +1 |
| total | 45 | 41 | -4 |

**Removed by v2.2 (5 WARN fixed):**

- `anon_security_definer_function_executable` × 2 (on `complete_site_rpc`, `reverse_site_completion_rpc`)
- `authenticated_security_definer_function_executable` × 2 (same RPCs)
- `auth_leaked_password_protection` (Auth-level setting, may be unrelated to v2.2)

**Added by v2.2 (1 INFO):**

- `rls_enabled_no_policy` on `public.accounting_write_idempotency_keys` (INFO, not WARN). The table is intentionally service_role-only; no app-role accesses it directly. A future "deny-all" policy could be added to make the intent explicit, but it is not a blocker.

### Performance advisor

| Severity | production main | branch v22-staging | delta |
| --- | --- | --- | --- |
| WARN | 53 | 53 | 0 |
| INFO | 188 | 320 | +132 |
| total | 241 | 373 | +132 |

WARN count is unchanged. INFO grows because v2.2 adds new tables / columns that have not yet seen index usage telemetry; this is normal and expected.

## Conclusions

- v2.2 applies cleanly to a production-equivalent schema.
- v2.2 reduces the security advisor WARN count and does not introduce new performance WARNs.
- The single new INFO entry is documented and intentional.
- The branch is now ready to be either merged into main or torn down and replaced by a direct production apply path. Either route requires explicit user approval and a fresh production backup before execution.

## Out of Scope

- This branch run did not include data-driven smoke (PL compare, idempotency replay, party-org boundary HTTP) because `with_data: false` makes the branch DB schema-only. Those contracts are already covered by `local_pl_compare_invariants_test.mjs` / `local_idempotency_concurrency_test.mjs` / `local_party_org_boundary_test.mjs` and re-run cleanly on a freshly reset local DB.
- The branch's `supabase_migrations.schema_migrations` does not contain the 20 new versions because the SQL was applied via the Management API (not via `supabase db push`). Merging this branch to main as-is would not propagate the new migration history; treat the branch as a validation environment, not a deployment vehicle.
- Production DB has not been modified.

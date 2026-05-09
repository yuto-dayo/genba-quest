# v2.2 Private Accounting Helper Hardening Local Evidence

Generated: 2026-05-10 JST

Remote DB status: not used. Migration was applied only to local Supabase.

## Migration

```text
supabase/migrations/20260509153529_harden_private_accounting_helpers.sql
```

Scope was intentionally narrow:

- `private.assert_accounting_journal_entry_balanced(uuid)`
- `private.assert_invoice_revenue_allocation_capacity()`
- `private.prevent_posted_accounting_journal_mutation()`

Each function now has:

- `search_path=pg_catalog`
- direct `PUBLIC`, `anon`, and `authenticated` execute revoked
- `service_role` execute granted

## Commands

```bash
supabase migration up --local
node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs
node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs
cd server && npx tsc --noEmit
cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand
scripts/db/check-sql-boundaries.sh
git diff --check
```

## Local Privilege Snapshot

| Function | search_path | public | anon | authenticated | service_role |
| --- | --- | ---: | ---: | ---: | ---: |
| `private.assert_accounting_journal_entry_balanced(uuid)` | `pg_catalog` | false | false | false | true |
| `private.assert_invoice_revenue_allocation_capacity()` | `pg_catalog` | false | false | false | true |
| `private.prevent_posted_accounting_journal_mutation()` | `pg_catalog` | false | false | false | true |

## Regression Evidence

| Check | Result |
| --- | --- |
| local migration apply | pass |
| accounting RPC hardening negative script | pass |
| PL compare / reversal / posted journal immutability script | pass |
| server TypeScript | pass |
| accounting route unit tests | pass, 56/56 |
| SQL boundary guard | pass |
| whitespace diff check | pass |

## Notes

The PL compare evidence still verifies:

- `legacy` and `journal_gross_compat` diff is zero after sale, expense, invoice/payment, and reversal.
- invoice/payment posting groups do not create PL revenue lines.
- sale reversal keeps the original posted row and adds a separate reversal row.
- posted journal entry/line update/delete fail with `POSTED_JOURNAL_IMMUTABLE`.

The remaining search-path residue is not this private helper set. It is now limited to older legacy base RPCs and non-accounting legacy/site/proposal functions that need separate reachability decisions.

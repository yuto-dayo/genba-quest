# v2.2 Legacy Accounting Base RPC Hardening Local Evidence

Generated: 2026-05-10 JST

Remote DB status: not used. Migration was applied only to local Supabase.

## Migration

```text
supabase/migrations/20260509153840_harden_legacy_accounting_base_rpcs.sql
```

Scope was intentionally narrow:

- `public.rpc_create_accounting_invoice(..., p_created_by uuid)`
- `public.rpc_record_accounting_payment_allocation(... old create+allocate form ...)`

These are legacy base RPCs. The migration fixes `search_path` and keeps the already-hardened privilege shape:

- `search_path=pg_catalog`
- `PUBLIC`, `anon`, and `authenticated` execute revoked
- `service_role` execute retained for compatibility

## Local Privilege Snapshot

| Function | search_path | public | anon | authenticated | service_role |
| --- | --- | ---: | ---: | ---: | ---: |
| `public.rpc_create_accounting_invoice(..., p_created_by uuid)` | `pg_catalog` | false | false | false | true |
| `public.rpc_record_accounting_payment_allocation(... old create+allocate form ...)` | `pg_catalog` | false | false | false | true |

## Verification Commands

```bash
supabase migration up --local
node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs
node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs
cd server && npx tsc --noEmit
cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand
scripts/db/check-sql-boundaries.sh
git diff --check
```

## Results

| Check | Result |
| --- | --- |
| local migration apply | pass |
| legacy base RPC privilege/search_path query | pass |
| accounting RPC hardening negative script | pass |
| PL compare / reversal / posted journal immutability script | pass |
| server TypeScript | pass |
| accounting route unit tests | pass, 56/56 |
| SQL boundary guard | pass |
| whitespace diff check | pass |

## Compatibility Decision

`service_role` execute remains granted on both legacy base RPCs. This is deliberate:

- `rpc_create_accounting_invoice(..., p_created_by uuid)` is still called internally by the membership-aware invoice wrapper and canonical invoice RPC after membership verification.
- `rpc_record_accounting_payment_allocation(... old create+allocate form ...)` is deprecated/no-new-route usage, but service-role compatibility is preserved until a later sunset decision.

No remote migration, push, or migration repair was executed.

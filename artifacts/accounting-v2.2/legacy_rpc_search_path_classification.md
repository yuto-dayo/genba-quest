# v2.2 Legacy RPC Search Path Reachability Classification

Generated: 2026-05-10 JST

Remote DB status: not used. This inventory was taken from local Supabase only.

## Purpose

Classify the remaining `SECURITY DEFINER` search path residue after the v2.2 accounting hardening work.

The goal is not to force a broad `ALTER FUNCTION ... SET search_path = pg_catalog` sweep. The safer rule is:

- classify whether the function is still reachable from server routes or internal wrappers,
- fix reachable functions with schema-qualified bodies and local evidence,
- document legacy exceptions instead of silently accepting them.

## Commands

```sql
select n.nspname,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef,
       coalesce(array_to_string(p.proconfig, ','), '') as proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef = true
  and n.nspname in ('public','private')
order by n.nspname, p.proname, args;
```

```bash
rg -n "\\.rpc\\(\"|\\.rpc\\('|rpc_[a-zA-Z0-9_]+" server/src supabase/migrations artifacts/accounting-v2.2 -S
```

## Summary

### Already acceptable for v2.2 P0

These route-reachable accounting RPCs are membership-aware, direct `anon/authenticated` execution is revoked, and `search_path=pg_catalog` is already fixed:

| Function | Server reachability | Classification |
| --- | --- | --- |
| `rpc_post_accounting_sale_canonical(...)` | Route/service reachable | OK |
| `rpc_reverse_accounting_sale_canonical(...)` | Route/service reachable | OK |
| `rpc_post_accounting_expense_canonical(...)` | Route/service reachable | OK |
| `rpc_create_accounting_invoice_canonical(...)` | Route/service reachable | OK |
| `rpc_record_accounting_payment_event_canonical(...)` | Route/service reachable | OK |
| `rpc_allocate_accounting_payment_canonical(...)` | Route/service reachable | OK |
| `rpc_record_accounting_payment_event(...)` | fallback reachable | OK |
| `rpc_allocate_accounting_payment(...)` | fallback reachable | OK |
| `rpc_create_accounting_invoice(..., p_membership_id uuid)` | fallback reachable | OK |

### Residue requiring explicit handling

| Function | Current local state | Reachability | Classification | Recommendation |
| --- | --- | --- | --- | --- |
| `public.rpc_create_accounting_invoice(..., p_created_by uuid)` | `SECURITY DEFINER`, `search_path=public, private`, `service_role` executable, `anon/authenticated` revoked | Not called directly by server routes; called internally by membership wrapper and canonical invoice RPC after membership verification | B: internal legacy base | Keep short-term for compatibility, then add a focused migration to schema-qualify/fix `search_path=pg_catalog`. Consider revoking direct `service_role` execute after proving wrapper/canonical internal calls still work. |
| `public.rpc_record_accounting_payment_allocation(..., p_invoice_id uuid, ...)` | `SECURITY DEFINER`, `search_path=public, private`, `service_role` executable, `anon/authenticated` revoked | Not called by current server route; replaced by `/payments` + `/payments/allocations` and `rpc_allocate_accounting_payment(...)` | C: legacy exception / deprecated | Mark as no-new-route usage. Later migration should either remove service-role execute or harden to `pg_catalog` before any continued use. |
| `private.assert_accounting_journal_entry_balanced(uuid)` | `SECURITY DEFINER`, `search_path=public, pg_temp`, function EXECUTE still broadly granted by default; private schema `USAGE` exists for `authenticated` locally | Internal helper used by canonical posting RPCs | B: internal helper | Add migration to `ALTER FUNCTION ... SET search_path TO 'pg_catalog'` and revoke direct `public/anon/authenticated` execute. Grant only `service_role` if direct operational calls remain useful. |
| `private.assert_invoice_revenue_allocation_capacity()` | `SECURITY DEFINER`, `search_path=public, private`, function EXECUTE still broadly granted by default; trigger function | Trigger-only invoice allocation cap guard | B: trigger helper | Add migration to `ALTER FUNCTION ... SET search_path TO 'pg_catalog'` and revoke direct `public/anon/authenticated` execute. Trigger execution should not require app-role direct execute. |
| `private.prevent_posted_accounting_journal_mutation()` | `SECURITY DEFINER`, `search_path=public, pg_temp`, function EXECUTE still broadly granted by default; trigger function | Trigger-only posted journal immutability guard | B: trigger helper | Add migration to `ALTER FUNCTION ... SET search_path TO 'pg_catalog'` and revoke direct `public/anon/authenticated` execute. Verify posted journal immutability evidence after migration. |

## Privilege Snapshot

Local privilege checks for the highest-priority residue:

| Function | public | anon | authenticated | service_role |
| --- | ---: | ---: | ---: | ---: |
| `public.rpc_create_accounting_invoice(..., p_created_by uuid)` | false | false | false | true |
| `public.rpc_record_accounting_payment_allocation(... old create+allocate form ...)` | false | false | false | true |
| `private.assert_accounting_journal_entry_balanced(uuid)` | true | true | true | true |
| `private.assert_invoice_revenue_allocation_capacity()` | true | true | true | true |
| `private.prevent_posted_accounting_journal_mutation()` | true | true | true | true |

Schema usage snapshot:

| Schema | public | anon | authenticated | service_role |
| --- | ---: | ---: | ---: | ---: |
| `private` | false | false | true | true |
| `public` | true | true | true | true |

Because `authenticated` has local `USAGE` on `private`, the private helper/trigger function EXECUTE defaults should be tightened even though these helpers are not HTTP route endpoints.

## Server Reachability Notes

- Current invoice route prefers `rpc_create_accounting_invoice_canonical(...)`.
- If canonical invoice RPC is missing, the server falls back to the membership-aware `rpc_create_accounting_invoice(..., p_membership_id uuid)`.
- The old no-membership `rpc_create_accounting_invoice(..., p_created_by uuid)` is not called directly by server code, but it is called internally by the membership wrapper and canonical invoice RPC.
- Current payment allocation route prefers `rpc_allocate_accounting_payment_canonical(...)`.
- If canonical allocation RPC is missing, the server falls back to `rpc_allocate_accounting_payment(...)`, not the older create-and-allocate `rpc_record_accounting_payment_allocation(...)`.
- The old `rpc_record_accounting_payment_allocation(... old create+allocate form ...)` remains service-role executable for legacy compatibility but should be treated as no-new-route usage.

## Recommended Next Migration

Do this in a narrow migration, not as a broad sweep:

1. Harden private helpers/triggers:
   - `ALTER FUNCTION private.assert_accounting_journal_entry_balanced(uuid) SET search_path TO 'pg_catalog';`
   - `ALTER FUNCTION private.assert_invoice_revenue_allocation_capacity() SET search_path TO 'pg_catalog';`
   - `ALTER FUNCTION private.prevent_posted_accounting_journal_mutation() SET search_path TO 'pg_catalog';`
   - `REVOKE ALL ... FROM PUBLIC, anon, authenticated;`
   - `GRANT EXECUTE ... TO service_role;`
2. Harden old internal base RPCs only after local replay:
   - `public.rpc_create_accounting_invoice(..., p_created_by uuid)`
   - `public.rpc_record_accounting_payment_allocation(... old create+allocate form ...)`
3. Re-run:
   - `node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs`
   - `node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs`
   - `supabase migration up --local`
   - `cd server && npx tsc --noEmit`
   - `cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand`
   - `scripts/db/check-sql-boundaries.sh`
   - `git diff --check`

## Decision

Do not treat the residue as acceptable forever.

For PR review, classify it as:

- private helper/trigger functions: next safe hardening target,
- old invoice base RPC: internal legacy base behind verified wrappers,
- old payment allocation RPC: legacy exception / deprecated, no new route usage.

Remote DB migration remains blocked until explicit approval.

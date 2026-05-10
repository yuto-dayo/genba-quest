# Accounting v2.2: Idempotency Lookup Helper

Generated: 2026-05-10 JST. Local DB only. Remote DB / push not executed.

## Problem

Each canonical posting RPC inlined the same `SELECT ... FOR UPDATE` against `public.proposal_executions` keyed by `'<endpoint>:' || p_idempotency_key`. The pattern was correct but copy-pasted across six RPCs:

| RPC | Endpoint prefix |
| --- | --- |
| `rpc_post_accounting_sale_canonical` | `accounting.sales.adjust` |
| `rpc_reverse_accounting_sale_canonical` | `accounting.void.create` |
| `rpc_post_accounting_expense_canonical` | `accounting.expenses.create` |
| `rpc_record_accounting_payment_event_canonical` | `accounting.payments.create` |
| `rpc_allocate_accounting_payment_canonical` | `accounting.payments.allocate` |
| `rpc_create_accounting_invoice_canonical` | `accounting.invoices.create` |

Future changes (`FOR UPDATE` semantics, key format, retention policy) had to be made in six places, easy to drift.

## Fix

### Migrations

| Migration | Purpose |
| --- | --- |
| `20260510020200_add_idempotency_lookup_helper.sql` | Adds `private.find_idempotent_execution(uuid, text, text)` returning `SETOF public.proposal_executions`. Validates inputs, runs the lookup with `FOR UPDATE`, service_role-only EXECUTE, `search_path=pg_catalog`. |
| `20260510020300_wire_idempotency_lookup_to_canonical_rpcs.sql` | `CREATE OR REPLACE` for all six canonical RPCs. Replaces the inline `SELECT ... FOR UPDATE` with `SELECT * INTO v_existing_execution FROM private.find_idempotent_execution(p_org_id, '<endpoint>', p_idempotency_key);`. The subsequent `IF FOUND THEN` is preserved because the helper returns SETOF. |

### Helper signature

```sql
CREATE OR REPLACE FUNCTION private.find_idempotent_execution(
  p_org_id uuid,
  p_endpoint text,
  p_idempotency_key text
) RETURNS SETOF public.proposal_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  -- argument validation, then:
  RETURN QUERY
  SELECT *
  FROM public.proposal_executions
  WHERE org_id = p_org_id
    AND idempotency_key = p_endpoint || ':' || p_idempotency_key
  FOR UPDATE;
END;
$$;
```

### Failure modes

| Input | Error code | SQLSTATE |
| --- | --- | --- |
| `p_org_id IS NULL` | `ORG_ID_REQUIRED` | `23514` |
| `p_endpoint` blank or NULL | `IDEMPOTENCY_ENDPOINT_REQUIRED` | `23514` |
| `p_idempotency_key` blank or NULL | `IDEMPOTENCY_KEY_REQUIRED` | `23514` |
| no match | (returns 0 rows; caller handles via `IF FOUND`) | — |

## Why SETOF

The straightforward `RETURNS public.proposal_executions` would always return one row (NULL fields when no match), which breaks `FOUND` semantics on the caller side because PostgreSQL sets `FOUND = TRUE` whenever a function returned. `RETURNS SETOF` returns 0 or 1 rows, which sets `FOUND` correctly when paired with `SELECT INTO`. Callers therefore do not need any new conditional logic.

## Local Evidence

### Final clean rebuild

```bash
supabase db reset --local
# 36 migrations applied, 0 hard errors
```

Migration order ends with the helper (`...020200`) and the wiring (`...020300`); both party-org boundary asserts and the idempotency helper are present in every canonical RPC.

### Function body proof

```text
rpc_allocate_accounting_payment_canonical     | helper
rpc_create_accounting_invoice_canonical       | helper
rpc_post_accounting_expense_canonical         | helper
rpc_post_accounting_sale_canonical            | helper
rpc_record_accounting_payment_event_canonical | helper
rpc_reverse_accounting_sale_canonical         | helper
```

### Regression replay on fresh DB

| Script | Result |
| --- | --- |
| `local_party_org_boundary_test.mjs` | PASS (13 / 13) |
| `local_pl_compare_invariants_test.mjs` | PASS |
| `local_idempotency_concurrency_test.mjs` | PASS — true-concurrent replay still returns one chain |
| `local_org_boundary_negative_test.mjs` | PASS |
| `local_rpc_hardening_negative_test.mjs` | PASS |
| `local_document_boundary_negative_test.mjs` | PASS |
| `cd server && npm test -- accountingRoute.test.ts` | PASS (56 / 56) |
| `cd server && npx tsc --noEmit` | PASS |
| `scripts/db/check-sql-boundaries.sh` | PASS |

The idempotency concurrency test is the strictest evidence: it sends two concurrent identical POSTs and verifies that exactly one proposal_execution / one accounting_transaction / one journal_entry is created. The helper preserves the `FOR UPDATE` lock on the read path that makes this work.

## Out of Scope

- Remote DB / push not executed.
- Helper API is internal (`private` schema, service_role-only). It is deliberately not part of the route response envelope.
- A single canonical RPC body can call the helper more than once if it ever needs to check multiple endpoints in one transaction; current call sites use it once per RPC.

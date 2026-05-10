# Accounting v2.2 Idempotency Contract Evidence

Date: 2026-05-09

## Scope

- Target org_id: local_unit_test_org
- Remote DB migration: not executed
- Remote DB push: not executed
- Migration repair: not executed

## Local HTTP Concurrency Evidence

Date: 2026-05-09

Command:

```bash
cd /Users/yutoyoshino/Documents/genba-quest
node artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs
```

The script starts a local Express server against local Supabase on an isolated port, creates a fresh local fixture org/membership, sends two concurrent `POST /api/v1/accounting/expenses` requests with the same `idempotency_key`, then sends a third replay request after the write completes.

Target IDs:

```json
{
  "org_id": "30d58c06-fdf0-4e11-9269-0febf70bfb6d",
  "actor_user_id": "e93f3438-ae73-4c55-b2ab-a370d096bde0",
  "membership_id": "c04d1059-aee7-437d-9293-7fe0cdfd6263",
  "idempotency_key": "v22-concurrent-expense-30d58c06fdf04e1192690febf70bfb6d"
}
```

Response summary:

```json
{
  "first": {
    "status": 201,
    "id": "6bea9c98-7f9b-407d-bb13-23d169f8e656",
    "proposal_id": "25e6c983-806c-4285-8f25-f9bec8254252",
    "projection_id": "6bea9c98-7f9b-407d-bb13-23d169f8e656",
    "posting_mode": "canonical_expense_posting"
  },
  "second": {
    "status": 409,
    "error": "IDEMPOTENCY_IN_PROGRESS"
  },
  "replay": {
    "status": 201,
    "id": "6bea9c98-7f9b-407d-bb13-23d169f8e656",
    "proposal_id": "25e6c983-806c-4285-8f25-f9bec8254252",
    "projection_id": "6bea9c98-7f9b-407d-bb13-23d169f8e656",
    "posting_mode": "canonical_expense_posting"
  },
  "concurrent_in_progress_count": 1
}
```

Row counts:

```json
{
  "idempotency_rows": 1,
  "idempotency_succeeded_rows": 1,
  "proposals": 1,
  "proposal_executions": 1,
  "posting_groups": 1,
  "transactions": 1,
  "journal_entries": 1,
  "journal_lines": 3,
  "unbalanced_entries": 0
}
```

Assertions:

- same key + concurrent same payload produced only one idempotency row.
- lineage/projection/posting row chain did not multiply.
- one concurrent request observed `IDEMPOTENCY_IN_PROGRESS`.
- post-completion replay returned the same transaction/proposal/projection IDs.
- posted journal remained balanced.

## Scenarios

### Same Key + Same Payload

Endpoint covered:

- `POST /api/v1/accounting/payments/allocations`

Expected:

- Additional write path is not executed.
- RPC is not called.
- Transition lineage insert is not called.
- Previous response snapshot is returned unchanged.
- `proposal_id`, `legacy_payment_id`, `legacy_payment_allocation_id`, and `legacy_invoice_id` remain exactly the same as the stored response.

Result:

- Pass via `accountingRoute.test.ts`.

### Same Key + Different Payload

Endpoint covered:

- `POST /api/v1/accounting/expenses`

Expected:

- Request hash mismatch returns `409 IDEMPOTENCY_CONFLICT`.
- No accounting transaction insert occurs.

Result:

- Pass via `accountingRoute.test.ts`.

### Parallel Duplicate / In Progress

Endpoint covered:

- `POST /api/v1/accounting/payments`

Expected:

- Existing `in_progress` idempotency row returns `409 IDEMPOTENCY_IN_PROGRESS`.
- No payment RPC call occurs.
- No transition lineage row is inserted.

Result:

- Pass via `accountingRoute.test.ts`.

## Commands

```bash
cd server && npx tsc --noEmit
cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand
git diff --check -- server/src/routes/accounting.ts server/src/__tests__/unit/accountingRoute.test.ts
```

## Row Counts / Checksums

- Row counts: collected for local HTTP concurrency evidence above
- Before checksum: not_applicable_unit_test
- After checksum: one canonical expense row chain only

## Notes

- This is local unit-test evidence for the idempotency contract.
- The local HTTP concurrency script exercises true concurrent duplicate requests against a real local Supabase/Postgres stack.
- Payment/payment-allocation specific concurrency remains a future extension; this slice covers the shared route idempotency guard and canonical expense posting row chain.

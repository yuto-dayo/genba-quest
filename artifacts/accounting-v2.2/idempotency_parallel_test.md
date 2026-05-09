# Accounting v2.2 Idempotency Contract Evidence

Date: 2026-05-09

## Scope

- Target org_id: local_unit_test_org
- Remote DB migration: not executed
- Remote DB push: not executed
- Migration repair: not executed

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

- Row counts: not_applicable_unit_test
- Before checksum: not_applicable_unit_test
- After checksum: not_applicable_unit_test

## Notes

- This is local unit-test evidence for the idempotency contract.
- A future DB integration test should exercise true concurrent duplicate requests against a real local Supabase/Postgres stack and store row counts for `proposals`, `accounting_payments`, `payment_allocations`, and relevant projections.

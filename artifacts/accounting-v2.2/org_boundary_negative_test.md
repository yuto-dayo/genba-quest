# Accounting v2.2 Org Boundary Negative Test

Date: 2026-05-09

## Scope

- Target org_id: local multi-org fixture
- Remote DB migration: not executed
- Remote DB push: not executed
- Migration repair: not executed
- Local API server: started by `artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs` on port 4019

## Scenario

This verifies the v2.2 P0 org-boundary contract for a user who belongs to both org A and org B.

The test creates a fresh local fixture:

- same actor user has active memberships in org A and org B
- active org header is org A
- request payload/path contains org B ids
- org B owns the target transaction, invoice, payment, and document

Expected result: active-org-A requests must not be able to see or act on org-B ids. External ids from another org are hidden as `404`; no accounting/document rows are created in org A.

## Command

```bash
node artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs
```

The script injects local Supabase settings explicitly because `server/.env` may point at a remote project:

- `SUPABASE_URL=http://127.0.0.1:54321`
- `SUPABASE_SERVICE_ROLE_KEY` parsed from `supabase status`
- `NODE_ENV=development`
- `DEV_SKIP_AUTH=true`
- `DEFAULT_ORG_ID=<active org A>`

## Executed API Scenarios

| Scenario | Active org | Foreign id type | Expected | Actual | Error |
| --- | --- | --- | --- | --- | --- |
| `POST /api/v1/accounting/invoice-eligibility` | org A | org B transaction | 404 | 404 | `One or more transactions were not found` |
| `POST /api/v1/accounting/invoices` | org A | org B transaction | 404 | 404 | `One or more transactions were not found` |
| `POST /api/v1/accounting/payments/allocations` | org A | org B payment/invoice | 404 | 404 | `INVOICE_NOT_FOUND` |
| `POST /api/v1/accounting/ocr/analyze` | org A | org B document | 404 | 404 | `Document not found` |
| `GET /api/v1/accounting/invoices/:id/download` | org A | org B invoice | 404 | 404 | `Invoice not found` |

Positive control:

| Scenario | Active org | Target id type | Expected | Actual |
| --- | --- | --- | --- | --- |
| `POST /api/v1/accounting/invoice-eligibility` | org B | org B transaction | not 404 | 200 |

## Local Result Snapshot

```json
{
  "fixture": {
    "active_org_id": "814b7b3f-ca19-4269-a6c5-3eceff371d90",
    "foreign_org_id": "200d6340-d15e-47f8-84b8-7b354f17089c",
    "actor_user_id": "e93f3438-ae73-4c55-b2ab-a370d096bde0",
    "active_membership_id": "0fbde734-65f8-4333-a578-6de2b39bdc4c",
    "foreign_membership_id": "654783a7-5534-4f75-ba86-b9c8a1da7d7d",
    "foreign_transaction_id": "84c313cd-d3d0-453c-be7c-0a83d74f8bab",
    "foreign_invoice_id": "b5b72bd3-baed-4e7f-8762-b9507dc3db0e",
    "foreign_payment_id": "ee44009b-c5f9-4dff-88c5-c955f787891c",
    "foreign_document_id": "a8db204f-8c91-4930-8489-d8c197fa4652"
  },
  "row_counts": {
    "org_a_transactions": 0,
    "org_a_invoices": 0,
    "org_a_payments": 0,
    "org_a_documents": 0,
    "org_b_transactions": 1,
    "org_b_invoices": 1,
    "org_b_payments": 1,
    "org_b_documents": 1,
    "org_a_failed_idempotency_rows": 1
  },
  "assertions": {
    "active_org_foreign_ids_hidden_as_404": true,
    "positive_control_can_see_foreign_org_when_active": true,
    "no_active_org_write_from_foreign_ids": true
  }
}
```

## Notes

- `org_a_failed_idempotency_rows=1` is expected for the payment-allocation route: the route records a failed idempotency attempt before returning `INVOICE_NOT_FOUND`.
- The failed idempotency row is not an accounting write. The test asserts that org A still has zero transactions, invoices, payments, and documents.
- This is local-only evidence. Remote DB migration, push, repair, and production writes were not executed.

# Accounting v2.2: Party / Org Boundary Helpers

Generated: 2026-05-10 JST. Local DB only. Remote DB / push not executed.

## Problem

Canonical posting RPCs accepted party identifiers (`p_customer_id`,
`p_client_id`, `p_claimant_member_id`) but did not verify that the referenced
row belonged to `p_org_id`. Because canonical RPCs run as `SECURITY DEFINER`
with `service_role`, RLS did not act as a backstop. A foreign id passed
through the RPC was happily stored on `accounting_journal_lines` and
projection metadata.

## Fix

### Migrations

| Migration | Purpose |
| --- | --- |
| `20260510020000_add_party_org_boundary_helpers.sql` | Adds `private.assert_customer_belongs_to_org(uuid, uuid)` and `private.assert_member_belongs_to_org(uuid, uuid)`. Both are `SECURITY DEFINER`, `search_path=pg_catalog`, `service_role`-only EXECUTE. NULL party id is a no-op. |
| `20260510020100_wire_party_org_boundary_to_canonical_rpcs.sql` | `CREATE OR REPLACE` for the three affected canonical RPCs. Adds `PERFORM private.assert_*_belongs_to_org(...)` immediately after `assert_rpc_active_membership(...)` so the check runs before the idempotency lookup and any write. Function signatures unchanged. |

### Affected canonical RPCs

| Function | New guard |
| --- | --- |
| `public.rpc_post_accounting_expense_canonical` | `assert_member_belongs_to_org(p_claimant_member_id, p_org_id)` |
| `public.rpc_post_accounting_sale_canonical` | `assert_customer_belongs_to_org(p_client_id, p_org_id)` |
| `public.rpc_record_accounting_payment_event_canonical` | `assert_customer_belongs_to_org(p_customer_id, p_org_id)` |

`rpc_allocate_accounting_payment_canonical` and `rpc_create_accounting_invoice_canonical` do not accept a party id directly; their customer linkage is derived from existing transactions / invoices already org-checked via `org_id` joins.

### Failure modes

| Input | Error code | SQLSTATE |
| --- | --- | --- |
| Foreign / non-existent customer id | `CUSTOMER_NOT_IN_ORG` | `02000` |
| Foreign / non-existent member id, or member with `status<>'active'` / `suspended_at IS NOT NULL` | `MEMBER_NOT_IN_ORG` | `02000` |
| Non-null party id with `p_org_id IS NULL` | `ORG_ID_REQUIRED` | `23514` |
| Soft-deleted customer (`clients.deleted_at IS NOT NULL`) | `CUSTOMER_NOT_IN_ORG` | `02000` |

## Local Evidence

`node artifacts/accounting-v2.2/local_party_org_boundary_test.mjs` → 13 / 13 PASS.

Coverage:

- helper foreign-id rejection (`CUSTOMER_NOT_IN_ORG`, `MEMBER_NOT_IN_ORG`)
- helper NULL no-op
- canonical RPC body grep proves `PERFORM private.assert_*` was injected
- `anon` / `authenticated` cannot EXECUTE the helpers
- `service_role` can EXECUTE the helpers

## Regression

Re-ran existing v2.2 evidence scripts after the migration and unrelated tests:

| Script | Result |
| --- | --- |
| `local_pl_compare_invariants_test.mjs` | PASS (after fixture fix below) |
| `local_idempotency_concurrency_test.mjs` | PASS (after fixture fix below) |
| `local_org_boundary_negative_test.mjs` | PASS |
| `local_rpc_hardening_negative_test.mjs` | PASS |
| `cd server && npm test -- accountingRoute.test.ts` | PASS (56 / 56) |
| `cd server && npx tsc --noEmit` | PASS |
| `scripts/db/check-sql-boundaries.sh` | PASS |

## Latent Fixture Bug Caught By the New Assert

The new `assert_member_belongs_to_org` exposed two pre-existing fixture bugs where tests passed a `user_id` where the RPC expects an `org_memberships.id`:

| File | Line | Was | Now |
| --- | --- | --- | --- |
| `local_pl_compare_invariants_test.mjs` | 364 | `claimantUserId` passed to `p_claimant_member_id` | `claimantMembershipId` |
| `local_idempotency_concurrency_test.mjs` | 42 | `actorUserId` passed to `p_claimant_member_id` | `membershipId` |

Before the helper, these silently stored user ids in `accounting_journal_lines.claimant_member_id`, breaking joins to `org_memberships`. The wiring migration now blocks this at write time.

## Out of Scope

- Remote DB migration / push not executed.
- Allocation / invoice canonical RPCs were not modified; they do not take a party id directly.
- Route-layer pre-check was not added; DB-level guard is sufficient because every write path goes through the canonical RPC.

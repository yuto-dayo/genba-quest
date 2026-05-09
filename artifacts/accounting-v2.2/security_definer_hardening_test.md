# Accounting v2.2 SECURITY DEFINER Hardening Test

Date: 2026-05-09

## Scope

- Target org_id: local multi-org fixture
- Remote DB migration: not executed
- Remote DB push: not executed
- Migration repair: not executed

## Scenario

This verifies the v2.2 P0 SECURITY DEFINER hardening contract for accounting and site-completion RPCs.

The local script creates a fresh fixture:

- same actor user has active memberships in org A and org B
- RPC calls use org A as `p_org_id`
- mismatch calls pass org B membership as `p_membership_id`

Expected results:

- direct `anon` / `authenticated` execution of protected RPCs fails with permission denied
- `service_role` has execute privilege but still fails when `p_org_id`, `p_actor_user_id`, and `p_membership_id` do not match an active membership
- membership-aware and canonical RPCs have fixed `search_path=pg_catalog`

## Command

```bash
node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs
```

## Local Result Snapshot

```json
{
  "fixture": {
    "active_org_id": "2946ecf9-0151-4981-949c-068bf903d5f9",
    "foreign_org_id": "449f28b4-67bf-46ef-90b8-549db5c5a073",
    "actor_user_id": "e93f3438-ae73-4c55-b2ab-a370d096bde0",
    "active_membership_id": "652e4fb8-da66-4e98-972d-e3db5de91582",
    "foreign_membership_id": "40a91ebf-c8d6-40bf-b4a4-c935818a4529"
  },
  "privilege_summary": {
    "checked_functions": 16,
    "public_execute_false": 16,
    "anon_execute_false": 16,
    "authenticated_execute_false": 16,
    "service_role_execute_true": 16
  },
  "search_path_summary": {
    "fixed_membership_aware_or_canonical_functions": 12,
    "pg_catalog_fixed": 12
  },
  "assertions": {
    "public_anon_authenticated_execute_revoked": true,
    "service_role_execute_granted": true,
    "membership_aware_search_path_fixed": true,
    "direct_rpc_calls_fail_for_anon_authenticated": true,
    "service_role_calls_fail_on_membership_mismatch": true
  }
}
```

## Direct RPC Negative Results

| Scenario | Role | Expected | Evidence |
| --- | --- | --- | --- |
| `anon_canonical_sale_direct_execute` | `anon` | permission denied | `ERROR: permission denied for function rpc_post_accounting_sale_canonical` |
| `authenticated_canonical_invoice_direct_execute` | `authenticated` | permission denied | `ERROR: permission denied for function rpc_create_accounting_invoice_canonical` |
| `anon_legacy_invoice_direct_execute` | `anon` | permission denied | `ERROR: permission denied for function rpc_create_accounting_invoice` |
| `authenticated_membership_wrapper_direct_execute` | `authenticated` | permission denied | `ERROR: permission denied for function rpc_record_accounting_payment_event` |

## Service Role Membership-Mismatch Results

| Scenario | Role | Expected | Evidence |
| --- | --- | --- | --- |
| `service_role_complete_site_wrong_membership` | `service_role` | `RPC_MEMBERSHIP_REQUIRED` | `ERROR: RPC_MEMBERSHIP_REQUIRED` |
| `service_role_canonical_sale_wrong_membership` | `service_role` | `RPC_MEMBERSHIP_REQUIRED` | `ERROR: RPC_MEMBERSHIP_REQUIRED` |
| `service_role_canonical_expense_wrong_membership` | `service_role` | `RPC_MEMBERSHIP_REQUIRED` | `ERROR: RPC_MEMBERSHIP_REQUIRED` |
| `service_role_payment_event_wrong_membership` | `service_role` | `RPC_MEMBERSHIP_REQUIRED` | `ERROR: RPC_MEMBERSHIP_REQUIRED` |
| `service_role_payment_allocation_wrong_membership` | `service_role` | `RPC_MEMBERSHIP_REQUIRED` | `ERROR: RPC_MEMBERSHIP_REQUIRED` |
| `service_role_invoice_wrong_membership` | `service_role` | `RPC_MEMBERSHIP_REQUIRED` | `ERROR: RPC_MEMBERSHIP_REQUIRED` |

## Function Coverage

The script checks execute privileges for 16 protected public RPC signatures:

- legacy compatibility site completion RPCs
- membership-aware site completion RPCs
- legacy compatibility accounting invoice/payment allocation RPCs
- membership-aware accounting invoice/payment event/allocation RPCs
- canonical sale/reversal/expense/invoice/payment RPCs

It checks fixed `search_path=pg_catalog` for 12 membership-aware or canonical RPC signatures. The four legacy compatibility implementation functions remain present for service-role fallback compatibility, but direct `public` / `anon` / `authenticated` execution is revoked.

## Notes

- This is local-only evidence. Remote DB migration, push, repair, and production writes were not executed.
- The test intentionally uses `SET LOCAL ROLE anon`, `SET LOCAL ROLE authenticated`, and `SET LOCAL ROLE service_role` inside local Postgres to verify database-enforced behavior, not just application-side checks.

# Accounting v2.2 Local Posting Chain Integration Result

Date: 2026-05-09

Scope: local Supabase/Postgres only. No remote migration, remote write, push, or migration repair was executed.

## Command

```bash
cd /Users/yutoyoshino/Documents/genba-quest
docker exec -i supabase_db_genba-quest psql -U postgres -d postgres -v ON_ERROR_STOP=1 < artifacts/accounting-v2.2/local_v22_posting_scenario.sql
```

`supabase db query -f` was not used for this scenario because Supabase CLI `2.95.4` rejected multi-statement SQL files with `cannot insert multiple commands into a prepared statement`.

## Scenario

The scenario creates a fresh local fixture org on each run so posted journals are never deleted or mutated.

Flow:

1. Create local-only org, actor, claimant member, client, and site.
2. Post canonical sale.
3. Replay the same sale idempotency key and assert the same transaction ID is returned.
4. Create `revenue_basis` with `receivable_account_type=contract_asset`.
5. Issue canonical invoice and assert invoice posting mode is `invoice_issue_no_pl_revenue`.
6. Record payment event and assert payment posting mode is `payment_received_no_pl_revenue`.
7. Allocate existing payment to invoice and assert allocation mode is `payment_allocation_no_pl_revenue`.
8. Post member-paid overhead expense and assert reimbursement metadata is carried into accounting projection/journal dimensions.
9. Assert posted journal entries are balanced.
10. Assert invoice/payment postings add no revenue/output-tax journal lines.
11. Compare legacy projection PL and journal PL.

## Target IDs

```json
{
  "org_id": "9460e939-65d4-4f2c-bb60-8dd36bf0198e",
  "actor_user_id": "25a5eb9d-9843-481a-85f4-c069a7424373",
  "membership_id": "9b815c7f-3fc1-4639-9457-5ada7de58510",
  "client_id": "f9124e11-df98-4e2f-ac54-a00c64588bb1",
  "site_id": "900c3909-87c0-45fb-8e3a-e48eccc3e183",
  "revenue_basis_id": "3b77c57f-dace-4bad-aaa4-3e6b818b40f5",
  "sale_transaction_id": "ab0cc3ed-2a77-475d-ac08-b35185f1aa78",
  "invoice_id": "22c936c9-7245-4ca2-a088-c62e095ec16f",
  "payment_id": "f1c60792-57f6-47e7-afb8-c746849ac7ee"
}
```

## Row Counts

```json
{
  "proposals": 5,
  "proposal_executions": 5,
  "posting_groups": 5,
  "journal_entries": 5,
  "journal_lines": 12,
  "transactions": 2,
  "invoices": 1,
  "payments": 1,
  "payment_allocations": 1,
  "invoice_revenue_allocations": 1
}
```

## Invariants

```json
{
  "posted_journal_unbalanced_count": 0,
  "non_transition_proposal_count": 0,
  "invoice_payment_revenue_line_count": 0,
  "payment_unapplied_amount": 0,
  "invoice_allocated_amount": 110000
}
```

## Posting Modes

```json
{
  "sale_posting": {
    "mode": "canonical_sales_posting",
    "status": "posted",
    "affects_pl": true,
    "affects_revenue": true,
    "affects_ar": true
  },
  "invoice_posting": {
    "mode": "invoice_issue_no_pl_revenue",
    "status": "posted",
    "affects_pl": false,
    "affects_revenue": false,
    "affects_ar": true,
    "transfer_amount": 110000
  },
  "payment_posting": {
    "mode": "payment_received_no_pl_revenue",
    "status": "posted",
    "affects_pl": false,
    "affects_revenue": false,
    "affects_ar": true
  },
  "allocation_posting": {
    "mode": "payment_allocation_no_pl_revenue",
    "status": "posted",
    "affects_pl": false,
    "affects_revenue": false,
    "affects_ar": true
  },
  "expense_posting": {
    "mode": "canonical_expense_posting",
    "status": "posted",
    "affects_pl": true,
    "affects_revenue": false,
    "affects_ar": false
  },
  "sale_replay_same_transaction": true
}
```

## PL Compare

```json
{
  "legacy": {
    "revenue": 100000,
    "expenses": 30000,
    "profit": 70000
  },
  "journal": {
    "revenue": 100000,
    "expenses": 30000,
    "profit": 70000
  },
  "diff": {
    "revenue": 0,
    "expenses": 0,
    "profit": 0
  }
}
```

## Notes

- A first draft attempted to clean the fixed fixture by deleting posted journal lines. Local Postgres rejected it with `POSTED_JOURNAL_IMMUTABLE`, which confirms the immutability trigger is active. The scenario now creates a fresh fixture org for each run.
- The scenario verifies RPC membership gates indirectly by passing `p_org_id`, `p_actor_user_id`, and `p_membership_id` through all canonical RPCs.
- This is local integration evidence only. It does not prove remote DB migration state.

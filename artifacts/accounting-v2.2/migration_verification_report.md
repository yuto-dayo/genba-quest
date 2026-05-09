# Accounting v2.2 Local Migration Verification

Date: 2026-05-09

## Scope

- Target org_id: not_applicable_local_dry_run
- Remote DB migration: not executed
- Remote DB push: not executed
- Migration repair: not executed

## Scenario

Implemented and locally verified the first v2.2 slice:

- SECURITY DEFINER RPC hardening for accounting/site-completion RPC entrypoints
- Active membership propagation from HTTP routes into service-role RPC calls
- Transition lineage semantics for Money expense and sales writes
- Sales transition proposal lineage response envelope
- Transition lineage for invoice issue, payment allocation, and transaction reversal
- `no_pl_journal` response wording replaced with `no_pl_revenue` for invoice/payment posting modes
- Accounting transaction projection metadata columns for v2.2 source mode and expense reimbursement dimensions
- `/expenses` payload acceptance for `expense_scope`, `paid_by`, claimant, settlement, payment account, reimbursement status, and recurring template references
- `POST /payments` payment event route for unapplied cash receipts, separated from invoice allocation
- `rpc_record_accounting_payment_event` service-role RPC with active membership verification and no-PL-revenue posting metadata
- `POST /payments/allocations` now allocates an existing payment to an invoice instead of creating the payment event
- `rpc_allocate_accounting_payment` enforces both invoice open balance and payment unapplied balance under row locks
- Idempotency contract tests for same-payload replay, different-payload conflict, and in-progress duplicate blocking
- `rpc_post_accounting_sale_canonical` creates transition proposal lineage, proposal execution, posting group, balanced journal, and `accounting_transactions` projection for manual sales writes
- `/sales` uses canonical sales posting when the RPC is available and falls back to the legacy write path when the local/remote schema has not applied the new RPC yet
- `GET /api/v1/accounting/pl` accepts `source=legacy|journal|compare`; default/legacy remains `accounting_transactions`, journal source returns net-accounting posted journal totals, and compare returns both net journal and gross-compatible journal diff data
- `rpc_reverse_accounting_sale_canonical` creates transition `income.reverse` lineage, proposal execution, posting group, balanced reversal journal, and `accounting_transactions` projection for posted sales reversals
- `/void/:id` uses canonical sales reversal when the RPC is available and falls back to legacy reversal for unsupported kinds such as expenses
- `rpc_post_accounting_expense_canonical` creates transition `expense.create` lineage, proposal execution, posting group, balanced expense journal, and `accounting_transactions` projection for immediately posted low-risk expenses
- `/expenses` uses canonical expense posting when the RPC is available, preserves the legacy top-level Money response, and keeps high-risk review-pending expenses on the transition legacy path
- Invoice/payment no-PL-revenue contract tests now cover fallback invoice allocation metadata, payment allocation unpaid-balance caps, and `/pl?source=compare` exclusion for `invoice_transfer`, `payment_receipt`, and `payment_allocation` posting groups

## Commands

```bash
docker run --name genba-v22-sqlcheck -e POSTGRES_PASSWORD=postgres -v /Users/yutoyoshino/Documents/genba-quest:/repo:ro -d postgres:16
psql -v ON_ERROR_STOP=1 -h localhost -p 55432 -U postgres -d postgres -f /repo/supabase/migrations/20260509100057_harden_accounting_rpc_membership.sql
cd server && npx tsc --noEmit
cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand
cd frontend && npx tsc -b --pretty false
scripts/db/check-sql-boundaries.sh
git diff --check
supabase status
supabase migration up
```

## Expected Failure Contracts Covered By This Slice

- `RPC_MEMBERSHIP_REQUIRED`: service-role RPC wrapper should fail when `p_membership_id` is missing or does not match active org/user membership.
- Direct RPC execution by `public`, `anon`, and `authenticated` is revoked in migration for hardened accounting/site completion RPC signatures.
- Money transition lineage responses must identify `lineage_mode=transition`, `lifecycle_engine=money_transition`, and `full_proposal_lifecycle=false`.
- Invoice/payment posting responses must identify `affects_pl=false`, `affects_revenue=false`, and AR impact separately.
- Member-paid expenses must reject requests without `claimant_member_id`.
- Payment events must create unapplied payments without writing PL revenue or invoice allocations.
- Payment allocations must require `payment_id` and reject allocations that exceed either invoice open balance or payment unapplied balance.
- Idempotency replay must return the stored response snapshot without invoking RPCs or inserting transition lineage again.
- Idempotency payload mismatch must return `IDEMPOTENCY_CONFLICT`.
- In-progress duplicates must return `IDEMPOTENCY_IN_PROGRESS`.
- Canonical sales posting must return `projection_source=canonical_posting_projection`, `proposal_execution_id`, `posting_group_id`, and `journal_entry_id` while preserving the Money legacy top-level response.
- Canonical sales posting must call the service-role RPC with `p_org_id`, `p_actor_user_id`, and `p_membership_id`.
- `/pl?source=journal` must exclude tax balance-sheet accounts from canonical P/L and return `basis=net_accounting`.
- `/pl?source=compare` must include `journal_gross_compat` and compute `diff` from legacy gross totals vs journal gross-compatible totals while keeping `journal` as net accounting.
- Invoice/payment posting groups and `transaction.kind=invoice` journal entries must be excluded from journal P/L revenue.
- Canonical sales reversal must keep the original posted transaction in place and add only a reversal transaction/journal.
- Canonical sales reversal must return `projection_source=canonical_posting_projection`, `proposal_execution_id`, `posting_group_id`, and `journal_entry_id`.
- Canonical sales reversal must use DB-valid transition proposal type `income.reverse` rather than the legacy response-only `transaction.reverse` label.
- Canonical sales posting/reversal must normalize net sales journal amount when `amount_subtotal` looks like a gross total, so `revenue + output_tax = accounts_receivable` remains balanced.
- Canonical expense posting must return `projection_source=canonical_posting_projection`, `proposal_execution_id`, `posting_group_id`, and `journal_entry_id` while preserving the Money legacy top-level response.
- Canonical expense posting must call the service-role RPC with `p_org_id`, `p_actor_user_id`, and `p_membership_id`.
- Canonical expense posting must carry `expense_scope`, `paid_by`, claimant, settlement, payment account, and reimbursement metadata into the projection/journal dimensions.
- Invoice fallback allocation metadata must use `invoice_issue_no_pl_revenue`, not legacy `no_pl_journal`.
- Payment allocation must reject both invoice over-collection and payment unapplied-balance over-allocation.
- PL compare mode must exclude invoice/payment no-PL-revenue posting groups even if bad revenue-looking journal lines exist.

## Result

- Migration syntax dry-run: pass
- TypeScript: pass
- Targeted unit tests: pass, 45 tests
- Accounting route unit tests after invoice/payment/void lineage: pass, 39 tests
- Accounting route unit tests after expense reimbursement payload: pass, 40 tests
- Projection metadata migration syntax dry-run: pass
- Payment event RPC migration syntax dry-run: pass
- Accounting route unit tests after payment event route: pass, 42 tests
- Existing-payment allocation RPC migration syntax dry-run: pass
- Accounting route unit tests after existing-payment allocation: pass, 43 tests
- Accounting route unit tests after idempotency contract hardening: pass, 46 tests
- Accounting route unit tests after canonical sales route integration: pass, 47 tests
- Accounting route + SiteCompletion targeted regression after canonical sales route integration: pass, 53 tests
- Accounting route + SiteCompletion targeted regression after PL compare mode: pass, 55 tests
- Accounting route + SiteCompletion targeted regression after canonical sales reversal: pass, 56 tests
- Accounting route + SiteCompletion targeted regression after review fix for gross-looking subtotal journal balance: pass, 56 tests
- Accounting route unit tests after canonical expense route integration: pass, 51 tests
- Accounting route + SiteCompletion targeted regression after canonical expense route integration: pass, 57 tests
- Accounting route unit tests after invoice/payment no-PL contract hardening: pass, 52 tests
- Accounting route + SiteCompletion targeted regression after invoice/payment no-PL contract hardening: pass, 58 tests
- TypeScript after canonical sales route integration: pass
- TypeScript after canonical expense route integration: pass
- TypeScript after invoice/payment no-PL contract hardening: pass
- Frontend TypeScript after PL source typing: pass
- SQL boundary check: pass
- Whitespace check: pass
- Local `supabase migration up`: blocked before the new canonical sales migration by pre-existing pending migration `20260506043949_add_private_site_drawings.sql` because the current local DB lacks `storage.buckets`. Remote migration was not executed.

## Row Counts / Checksums

- Row counts: not_applicable_local_dry_run
- Before checksum: not_applicable_local_dry_run
- After checksum: not_applicable_local_dry_run

## Notes

- This artifact is local evidence only. DB integration evidence against a real Supabase database still needs explicit approval before remote execution.
- Existing legacy service-role RPC signatures remain available for compatibility but are also revoked from `public`, `anon`, and `authenticated`.

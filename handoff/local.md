# Session Handoff - 2026-05-08

## 0. Quick Resume (AI)

- NEXT_CMD: `Continue v2.2 by changing /payments/allocations toward existing-payment allocation semantics, then add idempotency parallel duplicate integration evidence.`
- SUCCESS_CRITERIA: `Completed / Remaining / Quality Gate が現セッション内容で更新されている`
- HOTSET:
  - `/Users/yutoyoshino/Documents/genba-quest/handoff/local.md`
  - `/Users/yutoyoshino/Documents/genba-quest/docs/DESIGN_PHILOSOPHY.md`
- DO_NOT_READ:
  - `docs/DESIGN_PHILOSOPHY.md` (full)
- VERIFY_FIRST:
  - `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`
- STATE:
  - Branch: `codex/money-fix`
  - Uncommitted: `5 files`
  - DB migrations: `latest local: none found`
  - Tests: `not run yet`
  - Lint: `not run yet`

  - HEAD: `8374bb9`
  - Updated: `2026-05-09T19:29:30+0900`
<!-- L0_END: セッション開始時はここまで読めばOK。L1以降は必要時のみ。 -->

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- 2026-05-08 23:14:34 +0900 — started by codex
<!-- HANDOFF_SESSION_EVENTS_END -->

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `Continue v2.2 by changing /payments/allocations toward existing-payment allocation semantics, then add idempotency parallel duplicate integration evidence.`. Source: realtime
- [H0011] Completed: P1 v2.2 slice: added POST /payments payment event route plus rpc_record_accounting_payment_event for unapplied cash receipts with transition lineage and no-PL-revenue posting metadata.
- [H0011] Remaining: Continue v2.2 by changing /payments/allocations toward existing-payment allocation semantics, then add idempotency parallel duplicate integration evidence.
- [H0010] Completed: P1 v2.2 slice: added accounting_transactions projection metadata columns and /expenses support for expense_scope, paid_by, claimant_member_id, settlement_type, payment_account, reimbursement_status, and recurring_template_id.
- [H0010] Remaining: Continue v2.2 with POST /payments event separation and broader idempotency replay/conflict/parallel duplicate coverage.
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0011] Payment allocation still supports the legacy creates-payment-and-allocates RPC path; existing-payment allocation semantics are the next cut.
- [H0010] Expense UI is not redesigned yet; this only adds payload/storage compatibility for member reimbursement and overhead separation.
- [H0009] ProposalService.createAndSubmit remains intentionally disconnected from Money writes.
- [H0008] Do not connect ProposalService.createAndSubmit to Money yet; transition lineage remains money_transition/full_proposal_lifecycle=false.
- [H0007] Subagent Chandrasekhar confirmed createAndSubmit would create ledger_events/ledger_entries while Money route already writes accounting_transactions/accounting_journal_*; parent kept critical Proposal/ledger decision local.
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0011] Unrelated dirty files existed before commit selection: AGENTS.md, dao-impl-checker skill, and accounting governance docs; do not stage them with this slice.
- [H0010] Remote Supabase migration remains unexecuted; local route compatibility strips v2.2 columns if the DB schema has not applied the migration yet.
- [H0009] POST /payments event creation is still not implemented; /payments/allocations still creates/allocates through the legacy RPC path for now.
- [H0008] Migration is local only; remote Supabase migration/push remains unexecuted. complete-with-close now passes membership id, but old service-role signatures remain for compatibility.
- [H0007] This is transition lineage only: ProposalService execution is still not used for Money expense writes, and remote DB migration/push remains unexecuted.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0011] Continue v2.2 by changing /payments/allocations toward existing-payment allocation semantics, then add idempotency parallel duplicate integration evidence.
- [H0010] Continue v2.2 with POST /payments event separation and broader idempotency replay/conflict/parallel duplicate coverage.
- [H0009] Continue v2.2 with POST /payments event separation, expense_scope/paid_by payload support, and idempotency breadth/parallel duplicate tests.
- [H0008] Continue v2.2 with invoice/payment/void transition lineage and idempotency breadth tests before canonical sales posting RPC.
- [H0007] Continue P1 by applying the same proposal lineage pattern to sales/invoice/payment only after confirming each route cannot double-post ledger artifacts.
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `11`
- last_compacted_at: `never`
- archived_entries: `0`
<!-- HANDOFF_L2_STATE_END -->

---

## 1. Resume（次の1手）

```text
Agent: 未定（Claude Code / Codex）
Branch: codex/money-fix
Phase: A-0/A-1
```

> [carryover] Working tree was dirty at session start (5 files). Prior session may have unfinished work — verify NEXT_CMD before executing.

1. `docs/DESIGN_PHILOSOPHY.md` の冒頭を確認
2. このファイルを更新しながら実装を進める

---

## 2. Goal（このセッションの目的）

**Ticket**: 未設定
現セッションでの目的を記載

---

## 3. Completed

- [x] P1 v2.2 slice: added POST /payments payment event route plus rpc_record_accounting_payment_event for unapplied cash receipts with transition lineage and no-PL-revenue posting metadata.
- [x] P1 v2.2 slice: added accounting_transactions projection metadata columns and /expenses support for expense_scope, paid_by, claimant_member_id, settlement_type, payment_account, reimbursement_status, and recurring_template_id.
- [x] P1 v2.2 slice: added transition proposal lineage to invoice issue, payment allocation, and void/reversal responses; renamed invoice/payment posting modes to no_pl_revenue and exposed posting impact flags.
- [x] P0/P1 v2.2 slice: hardened SECURITY DEFINER RPC boundary with membership-aware wrappers and propagated active membership IDs; added transition lineage semantics and sales proposal lineage.
- [x] P1 response: connected POST /expenses to transition Proposal lineage without calling ProposalService.createAndSubmit, so legacy Money transaction/journal writes remain stable while responses can return a real proposal row.
- [x] P1 response prep: added a backward-compatible accounting command envelope to expense, sale, and invoice create responses. Legacy top-level fields remain, while proposal/approval/execution/posting/projection fields now expose the future response shape with projection legacy ids.
- [x] P1 prep: moved standard invoice creation write orchestration into AccountingCommandService.createAccountingInvoice, including allocation preflight, atomic RPC preference, legacy fallback insert/source links/revenue allocations, and source transaction kind updates.
- [x] P1 prep: moved payment allocation RPC and void reversal command bodies into AccountingCommandService while keeping route-level validation, idempotency, and HTTP error mapping.
- [x] P1 prep: extracted the legacy accounting transaction/journal write helpers for expenses and sales into server/src/services/AccountingCommandService.ts, leaving accounting routes as HTTP/org/idempotency adapters while preserving existing behavior.
- [x] P0.5 invoice creation now prefers atomic DB RPC: invoice numbering, invoice insert, source links, revenue allocations, and legacy transaction kind updates are one transaction, with legacy fallback only when the RPC is unavailable.
---

## 4. Remaining（優先順位順）

- [ ] **P0**: Continue v2.2 by changing /payments/allocations toward existing-payment allocation semantics, then add idempotency parallel duplicate integration evidence.
- [ ] **P1**: Continue v2.2 with POST /payments event separation and broader idempotency replay/conflict/parallel duplicate coverage.
- [ ] **P1**: Continue v2.2 with POST /payments event separation, expense_scope/paid_by payload support, and idempotency breadth/parallel duplicate tests.
- [ ] **P1**: Continue v2.2 with invoice/payment/void transition lineage and idempotency breadth tests before canonical sales posting RPC.
- [ ] **P1**: Continue P1 by applying the same proposal lineage pattern to sales/invoice/payment only after confirming each route cannot double-post ledger artifacts.
---

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| `artifacts/accounting-v2.2/migration_verification_report.md` | updated local evidence for payment event slice |
| `server/src/__tests__/unit/accountingRoute.test.ts` | payment event success/validation coverage |
| `server/src/services/AccountingCommandService.ts` | recordPaymentEvent RPC wrapper |
| `server/src/routes/accounting.ts` | POST /payments route and transition lineage response |
| `supabase/migrations/20260509102522_accounting_payment_event_rpc.sql` | idempotency endpoint plus payment event RPC |
| `artifacts/accounting-v2.2/migration_verification_report.md` | updated local evidence for reimbursement slice |
| `server/src/__tests__/unit/accountingRoute.test.ts` | member reimbursement validation and insert assertions |
| `server/src/services/AccountingCommandService.ts` | expense insert payload and schema compatibility retry |
| `server/src/routes/accounting.ts` | expense payload validation and transition metadata persistence |
| `supabase/migrations/20260509101543_accounting_v22_projection_metadata.sql` | projection source and reimbursement dimension columns |
| `artifacts/accounting-v2.2/migration_verification_report.md` | updated local evidence for lineage slice |
| `server/src/__tests__/unit/accountingRoute.test.ts` | invoice/payment/void lineage regression coverage |
| `server/src/services/AccountingCommandService.ts` | transition proposal type coverage for payment.allocate and transaction.reverse |
| `server/src/routes/accounting.ts` | invoice/payment/void transition lineage and no_pl_revenue posting metadata |
| `artifacts/accounting-v2.2/migration_verification_report.md` | local verification evidence for the v2.2 slice |
| `server/src/services/SiteCompletionService.ts` | membership-aware site completion RPC args |
| `server/src/services/AccountingCommandService.ts` | transition lineage semantics and membership-aware RPC args |
| `server/src/routes/accounting.ts` | accounting RPC membership + sales transition lineage |
| `server/src/lib/orgAccess.ts` | membership id selected and propagated |
| `supabase/migrations/20260509100057_harden_accounting_rpc_membership.sql` | membership-aware RPC wrappers and grant hardening |
---

## 6. Locked Files（編集中 - 他エージェント触らない）

> なし
---

## 7. Quality Gate

```bash
cd server && npx tsc --noEmit
cd frontend && npx tsc --noEmit
cd frontend && npx eslint src/
```

| Check | Result | Notes |
| ----- | ------ | ----- |
| server typecheck | PASS | `cd server && npx tsc --noEmit` |
| frontend typecheck | SKIP | not run yet |
| lint | SKIP | not run yet |
| test | PASS | `cd server && npm test -- accountingRoute.test.ts --runInBand` (38 tests) |

---

## 8. Key Decisions

| Decision | Rationale |
| -------- | --------- |
| `docs/DESIGN_PHILOSOPHY.md` を作業前に参照 | 設計逸脱を防ぐため |

---

## 9. Risks / Blockers

- Unrelated dirty files existed before commit selection: AGENTS.md, dao-impl-checker skill, and accounting governance docs; do not stage them with this slice.
- Remote Supabase migration remains unexecuted; local route compatibility strips v2.2 columns if the DB schema has not applied the migration yet.
- POST /payments event creation is still not implemented; /payments/allocations still creates/allocates through the legacy RPC path for now.
- Migration is local only; remote Supabase migration/push remains unexecuted. complete-with-close now passes membership id, but old service-role signatures remain for compatibility.
- This is transition lineage only: ProposalService execution is still not used for Money expense writes, and remote DB migration/push remains unexecuted.
---

## 10. References

- `docs/DESIGN_PHILOSOPHY.md` - 作業前に必ず参照
- `docs/AGENT_OPS.md` - セッション運用手順

---

## 11. Incremental Updates

### 2026-05-08 23:15:10 +0900

- Entry-ID: `H0001`
- Completed:
  - [x] Committed P0.5 invoice/payment allocation hardening: invoice allocation preflight rejects over-allocation before numbering, DB trigger serializes invoice allocation cap per revenue_basis, and payment allocation route uses atomic RPC without PL journal writes.
- Remaining:
  - [ ] Next slice: make invoice creation itself atomic via RPC, or begin P1 by extracting direct accounting write helpers for Proposal execution reuse.
- Changed Files:
  - `server/src/routes/accounting.ts` - invoice allocation preflight guard and payment allocation RPC route
  - `server/src/__tests__/unit/accountingRoute.test.ts` - invoice over-allocation and payment allocation tests
  - `supabase/migrations/20260508141045_enforce_invoice_allocation_capacity.sql` - DB trigger for invoice allocation cap and atomic payment allocation RPC
- Working Context:
  - Subagents investigated P0.5/P1 next slices. Parent kept accounting/org/ledger implementation local. Remote DB migration/push still unexecuted.
- Validation:
  - `commit=pass|feat: harden invoice and payment allocations; server accountingRoute.test.ts=pass|38 tests; server tsc=pass|npx tsc --noEmit; migration dry-run=pass|docker psql BEGIN + P0/P0.5/new migration + ROLLBACK; sql-boundaries=pass; git diff --check=pass`
- Landmines:
  - Local supabase migration up --local remains blocked by pre-existing storage.buckets issue before these migrations; remote Supabase writes still require explicit approval.

### 2026-05-08 23:25:04 +0900

- Entry-ID: `H0002`
- Completed:
  - [x] P0.5 invoice creation now prefers atomic DB RPC: invoice numbering, invoice insert, source links, revenue allocations, and legacy transaction kind updates are one transaction, with legacy fallback only when the RPC is unavailable.
- Remaining:
  - [ ] Commit this atomic invoice slice; next choose either P1 helper extraction for Proposal-backed Money writes or DB integration tests for rpc_create_accounting_invoice.
- Changed Files:
  - `server/src/routes/accounting.ts` - atomic invoice RPC preference with missing-function legacy fallback
  - `server/src/__tests__/unit/accountingRoute.test.ts` - atomic invoice RPC and missing-RPC fallback coverage
  - `supabase/migrations/20260508141832_atomic_invoice_creation.sql` - rpc_create_accounting_invoice atomic write boundary
- Working Context:
  - Subagents investigated invoice atomic RPC and P1 helper extraction. Parent implemented invoice RPC boundary; remote DB migration/push still unexecuted.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; migration dry-run=pass|docker psql BEGIN + P0/P0.5/payment/allocation + atomic invoice migration + ROLLBACK; sql-boundaries=pass; git diff --check=pass`
- Landmines:
  - Remote Supabase migration remains unexecuted; supabase migration up --local remains blocked by pre-existing storage.buckets issue.

### 2026-05-08 23:29:53 +0900

- Entry-ID: `H0003`
- Completed:
  - [x] P1 prep: extracted the legacy accounting transaction/journal write helpers for expenses and sales into server/src/services/AccountingCommandService.ts, leaving accounting routes as HTTP/org/idempotency adapters while preserving existing behavior.
- Remaining:
  - [ ] Continue P1 by moving invoice/payment/void command bodies behind the same service boundary, then introduce Proposal-return shapes once the write commands are isolated.
- Changed Files:
  - `server/src/services/AccountingCommandService.ts` - extracted expense/sale write helpers and journal creation
  - `server/src/routes/accounting.ts` - now imports accounting command helpers and keeps route-level validation/idempotency
- Working Context:
  - Subagent Hume confirmed the safest P1 route/service seam is to isolate idempotent Money write commands first; parent kept Proposal/ledger/RLS/auth decisions in route-owned scope for now.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; git diff --check=pass`
- Landmines:
  - This is behavior-preserving extraction only; invoice/payment/void command bodies are still route-local and Proposal-backed Money response shape is not implemented yet.

### 2026-05-08 23:33:52 +0900

- Entry-ID: `H0004`
- Completed:
  - [x] P1 prep: moved payment allocation RPC and void reversal command bodies into AccountingCommandService while keeping route-level validation, idempotency, and HTTP error mapping.
- Remaining:
  - [ ] Continue P1 by moving invoice creation command orchestration into AccountingCommandService, then layer Proposal-shaped responses over the isolated command service.
- Changed Files:
  - `server/src/services/AccountingCommandService.ts` - payment allocation and void reversal command bodies
  - `server/src/routes/accounting.ts` - route delegates payment/void writes to command service
- Working Context:
  - This continues Hume's recommended P1 command-service seam. Proposal/ledger/RLS/auth policy remains parent-owned and unchanged.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; git diff --check=pass`
- Landmines:
  - Invoice creation orchestration is still route-local; command service is not yet returning the final proposal/execution/posting/projection response shape.

### 2026-05-09 07:32:37 +0900

- Entry-ID: `H0005`
- Completed:
  - [x] P1 prep: moved standard invoice creation write orchestration into AccountingCommandService.createAccountingInvoice, including allocation preflight, atomic RPC preference, legacy fallback insert/source links/revenue allocations, and source transaction kind updates.
- Remaining:
  - [ ] Begin Proposal-shaped Money responses: wrap existing command results into proposal/approval/execution/posting/projection envelopes while keeping legacy projection ids stable.
- Changed Files:
  - `server/src/services/AccountingCommandService.ts` - createAccountingInvoice and invoice helper ownership
  - `server/src/routes/accounting.ts` - POST /invoices delegates write orchestration to command service
- Working Context:
  - Ramanujan confirmed route test ordering risks. Parent kept transaction fetch/eligibility/idempotency in the route and moved only the write command body to preserve behavior.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; git diff --check=pass`
- Landmines:
  - Proposal-backed response envelope is still not implemented; getOrgInvoiceSettings and invoice transaction reads remain route-local for now.

### 2026-05-09 07:36:07 +0900

- Entry-ID: `H0006`
- Completed:
  - [x] P1 response prep: added a backward-compatible accounting command envelope to expense, sale, and invoice create responses. Legacy top-level fields remain, while proposal/approval/execution/posting/projection fields now expose the future response shape with projection legacy ids.
- Remaining:
  - [ ] Replace legacy_direct envelope internals with real Proposal/execution records once Money write commands are routed through the Proposal pipeline.
- Changed Files:
  - `server/src/routes/accounting.ts` - backward-compatible accounting command envelope
  - `frontend/src/lib/api.ts` - optional envelope typing and broader idempotency helper typing
- Working Context:
  - Kept frontend compatibility by preserving AccountingTransaction/AccountingInvoice top-level fields. The envelope is explicit about legacy_direct, so it does not pretend a real proposal exists yet.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; frontend build=pass|npm run build; git diff --check=pass`
- Landmines:
  - proposal remains null in these create responses; this is only a typed transition envelope, not full Proposal-backed execution.

### 2026-05-09 18:44:49 +0900

- Entry-ID: `H0007`
- Completed:
  - [x] P1 response: connected POST /expenses to transition Proposal lineage without calling ProposalService.createAndSubmit, so legacy Money transaction/journal writes remain stable while responses can return a real proposal row.
- Remaining:
  - [ ] Continue P1 by applying the same proposal lineage pattern to sales/invoice/payment only after confirming each route cannot double-post ledger artifacts.
- Changed Files:
  - `server/src/services/AccountingCommandService.ts` - createAccountingCommandProposalLineage helper
  - `server/src/routes/accounting.ts` - expense create returns proposal-backed transition envelope
  - `server/src/__tests__/unit/accountingRoute.test.ts` - proposal lineage coverage for expense create
- Working Context:
  - Subagent Chandrasekhar confirmed createAndSubmit would create ledger_events/ledger_entries while Money route already writes accounting_transactions/accounting_journal_*; parent kept critical Proposal/ledger decision local.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; git diff --check=pass`
- Landmines:
  - This is transition lineage only: ProposalService execution is still not used for Money expense writes, and remote DB migration/push remains unexecuted.

### 2026-05-09 19:11:27 +0900

- Entry-ID: `H0008`
- Completed:
  - [x] P0/P1 v2.2 slice: hardened SECURITY DEFINER RPC boundary with membership-aware wrappers and propagated active membership IDs; added transition lineage semantics and sales proposal lineage.
- Remaining:
  - [ ] Continue v2.2 with invoice/payment/void transition lineage and idempotency breadth tests before canonical sales posting RPC.
- Changed Files:
  - `supabase/migrations/20260509100057_harden_accounting_rpc_membership.sql` - membership-aware RPC wrappers and grant hardening
  - `server/src/lib/orgAccess.ts` - membership id selected and propagated
  - `server/src/routes/accounting.ts` - accounting RPC membership + sales transition lineage
  - `server/src/services/AccountingCommandService.ts` - transition lineage semantics and membership-aware RPC args
  - `server/src/services/SiteCompletionService.ts` - membership-aware site completion RPC args
  - `artifacts/accounting-v2.2/migration_verification_report.md` - local verification evidence for the v2.2 slice
- Working Context:
  - Do not connect ProposalService.createAndSubmit to Money yet; transition lineage remains money_transition/full_proposal_lifecycle=false.
- Validation:
  - `server targeted tests=pass|accountingRoute + SiteCompletionService 45 tests; server tsc=pass|npx tsc --noEmit; sql-boundaries=pass; migration syntax=pass|docker postgres stubbed RPC dry-run; git diff --check=pass`
- Landmines:
  - Migration is local only; remote Supabase migration/push remains unexecuted. complete-with-close now passes membership id, but old service-role signatures remain for compatibility.

### 2026-05-09 19:15:07 +0900

- Entry-ID: `H0009`
- Completed:
  - [x] P1 v2.2 slice: added transition proposal lineage to invoice issue, payment allocation, and void/reversal responses; renamed invoice/payment posting modes to no_pl_revenue and exposed posting impact flags.
- Remaining:
  - [ ] Continue v2.2 with POST /payments event separation, expense_scope/paid_by payload support, and idempotency breadth/parallel duplicate tests.
- Changed Files:
  - `server/src/routes/accounting.ts` - invoice/payment/void transition lineage and no_pl_revenue posting metadata
  - `server/src/services/AccountingCommandService.ts` - transition proposal type coverage for payment.allocate and transaction.reverse
  - `server/src/__tests__/unit/accountingRoute.test.ts` - invoice/payment/void lineage regression coverage
  - `artifacts/accounting-v2.2/migration_verification_report.md` - updated local evidence for lineage slice
- Working Context:
  - ProposalService.createAndSubmit remains intentionally disconnected from Money writes.
- Validation:
  - `server accounting route tests=pass|39 tests after invoice/payment/void lineage; server tsc=pass|npx tsc --noEmit; sql-boundaries=pass; git diff --check=pass`
- Landmines:
  - POST /payments event creation is still not implemented; /payments/allocations still creates/allocates through the legacy RPC path for now.

### 2026-05-09 19:18:30 +0900

- Entry-ID: `H0010`
- Completed:
  - [x] P1 v2.2 slice: added accounting_transactions projection metadata columns and /expenses support for expense_scope, paid_by, claimant_member_id, settlement_type, payment_account, reimbursement_status, and recurring_template_id.
- Remaining:
  - [ ] Continue v2.2 with POST /payments event separation and broader idempotency replay/conflict/parallel duplicate coverage.
- Changed Files:
  - `supabase/migrations/20260509101543_accounting_v22_projection_metadata.sql` - projection source and reimbursement dimension columns
  - `server/src/routes/accounting.ts` - expense payload validation and transition metadata persistence
  - `server/src/services/AccountingCommandService.ts` - expense insert payload and schema compatibility retry
  - `server/src/__tests__/unit/accountingRoute.test.ts` - member reimbursement validation and insert assertions
  - `artifacts/accounting-v2.2/migration_verification_report.md` - updated local evidence for reimbursement slice
- Working Context:
  - Expense UI is not redesigned yet; this only adds payload/storage compatibility for member reimbursement and overhead separation.
- Validation:
  - `server accounting route tests=pass|40 tests after reimbursement payload; server tsc=pass|npx tsc --noEmit; sql-boundaries=pass; migration syntax=pass|docker postgres projection metadata dry-run; git diff --check=pass`
- Landmines:
  - Remote Supabase migration remains unexecuted; local route compatibility strips v2.2 columns if the DB schema has not applied the migration yet.

### 2026-05-09 19:29:30 +0900

- Entry-ID: `H0011`
- Completed:
  - [x] P1 v2.2 slice: added POST /payments payment event route plus rpc_record_accounting_payment_event for unapplied cash receipts with transition lineage and no-PL-revenue posting metadata.
- Remaining:
  - [ ] Continue v2.2 by changing /payments/allocations toward existing-payment allocation semantics, then add idempotency parallel duplicate integration evidence.
- Changed Files:
  - `supabase/migrations/20260509102522_accounting_payment_event_rpc.sql` - idempotency endpoint plus payment event RPC
  - `server/src/routes/accounting.ts` - POST /payments route and transition lineage response
  - `server/src/services/AccountingCommandService.ts` - recordPaymentEvent RPC wrapper
  - `server/src/__tests__/unit/accountingRoute.test.ts` - payment event success/validation coverage
  - `artifacts/accounting-v2.2/migration_verification_report.md` - updated local evidence for payment event slice
- Working Context:
  - Payment allocation still supports the legacy creates-payment-and-allocates RPC path; existing-payment allocation semantics are the next cut.
- Validation:
  - `server accounting route tests=pass|42 tests after payment event route; server tsc=pass|npx tsc --noEmit; sql-boundaries=pass; migration syntax=pass|docker postgres payment event RPC dry-run; git diff --check=pass`
- Landmines:
  - Unrelated dirty files existed before commit selection: AGENTS.md, dao-impl-checker skill, and accounting governance docs; do not stage them with this slice.

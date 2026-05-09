# Session Handoff - 2026-05-08

## 0. Quick Resume (AI)

- NEXT_CMD: `Commit/split v2.2 local changes before starting expense canonical posting RPC, or continue with expense canonical only after this review checkpoint is accepted`
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

  - HEAD: `9af47f8`
  - Updated: `2026-05-09T20:52:25+0900`
<!-- L0_END: セッション開始時はここまで読めばOK。L1以降は必要時のみ。 -->

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- 2026-05-08 23:14:34 +0900 — started by codex
<!-- HANDOFF_SESSION_EVENTS_END -->

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `Commit/split v2.2 local changes before starting expense canonical posting RPC, or continue with expense canonical only after this review checkpoint is accepted`. Source: realtime
- [H0017] Completed: Accounting v2.2 review: fixed canonical sales/reversal SQL net sales amount normalization when subtotal looks gross
- [H0017] Remaining: Commit/split v2.2 local changes before starting expense canonical posting RPC, or continue with expense canonical only after this review checkpoint is accepted
- [H0016] Completed: Accounting v2.2: canonical sales reversal RPC and /void RPC-first fallback integration added
- [H0016] Remaining: Next v2.2 slice: expense canonical posting RPC, then invoice/payment no-PL-revenue canonical posting contract tests against journal source
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0017] Review found one real balance risk: GREATEST(subtotal,total-tax) could overstate revenue when subtotal was gross. SQL now derives net when subtotal equals/exceeds total or subtotal+tax exceeds total.
- [H0016] Original posted transaction remains in totals; sales reversal adds a separate negative projection/journal. Legacy expense void remains available until expense canonical posting RPC exists.
- [H0015] Default /pl remains legacy-compatible for Money/Today; source=journal returns net_accounting, source=compare returns legacy gross, journal net, journal_gross_compat, and diff based on gross-compatible totals
- [H0014] Remote DB migration/push/migration repair still not executed; local Supabase migration up is blocked by pre-existing storage migration before reaching canonical sales migration
- [H0013] This is local unit-test evidence; true concurrent DB integration evidence still needs a local/remote DB execution pass with explicit approval for any remote target.
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0017] Local supabase migration up remains blocked before these migrations by existing 20260506043949_add_private_site_drawings.sql missing local storage.buckets; remote DB still untouched.
- [H0016] proposals.type currently allows income.reverse but not transaction.reverse in migrations; canonical sales reversal intentionally uses income.reverse for DB compatibility.
- [H0015] Do not switch /pl default to journal until remote/local DB parity evidence shows diff=0 over recent sales/expense/reverse and invoice/payment no-PL cases
- [H0014] Do not use income_post for manual sales yet: revenue_basis.origin_completion_event_id remains NOT NULL, so first canonical manual sales slice uses posting_groups.group_type=manual_adjustment
- [H0013] Unrelated dirty files remain outside this slice: AGENTS.md, dao-impl-checker skill, and accounting governance docs.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0017] Commit/split v2.2 local changes before starting expense canonical posting RPC, or continue with expense canonical only after this review checkpoint is accepted
- [H0016] Next v2.2 slice: expense canonical posting RPC, then invoice/payment no-PL-revenue canonical posting contract tests against journal source
- [H0015] Next v2.2 slice: sales reversal canonical posting RPC or expense canonical posting RPC; keep /pl default legacy until real DB parity evidence is collected
- [H0014] Implement PL compare mode source=legacy|journal|compare, with gross-compatible journal totals and no-PL-revenue invoice/payment exclusion
- [H0013] Continue v2.2 with canonical sales posting RPC now that transition lineage and idempotency contract are covered.
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `17`
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

- [x] Accounting v2.2 review: fixed canonical sales/reversal SQL net sales amount normalization when subtotal looks gross
- [x] Accounting v2.2: canonical sales reversal RPC and /void RPC-first fallback integration added
- [x] Accounting v2.2: PL compare mode source=legacy|journal|compare implemented; journal source is net-accounting and compare includes gross-compatible diff
- [x] Accounting v2.2: canonical sales posting RPC migration and /sales RPC-first fallback integration added
- [x] P0 v2.2 slice: hardened Money write idempotency contract with IDEMPOTENCY_CONFLICT, same-response replay coverage, and in-progress duplicate blocking before RPC/lineage execution.
- [x] P1 v2.2 slice: changed /payments/allocations to require existing payment_id and added rpc_allocate_accounting_payment to lock invoice/payment rows and enforce both invoice open balance and payment unapplied balance.
- [x] P1 v2.2 slice: added POST /payments payment event route plus rpc_record_accounting_payment_event for unapplied cash receipts with transition lineage and no-PL-revenue posting metadata.
- [x] P1 v2.2 slice: added accounting_transactions projection metadata columns and /expenses support for expense_scope, paid_by, claimant_member_id, settlement_type, payment_account, reimbursement_status, and recurring_template_id.
- [x] P1 v2.2 slice: added transition proposal lineage to invoice issue, payment allocation, and void/reversal responses; renamed invoice/payment posting modes to no_pl_revenue and exposed posting impact flags.
- [x] P0/P1 v2.2 slice: hardened SECURITY DEFINER RPC boundary with membership-aware wrappers and propagated active membership IDs; added transition lineage semantics and sales proposal lineage.
---

## 4. Remaining（優先順位順）

- [ ] **P0**: Commit/split v2.2 local changes before starting expense canonical posting RPC, or continue with expense canonical only after this review checkpoint is accepted
- [ ] **P1**: Next v2.2 slice: expense canonical posting RPC, then invoice/payment no-PL-revenue canonical posting contract tests against journal source
- [ ] **P1**: Next v2.2 slice: sales reversal canonical posting RPC or expense canonical posting RPC; keep /pl default legacy until real DB parity evidence is collected
- [ ] **P1**: Implement PL compare mode source=legacy|journal|compare, with gross-compatible journal totals and no-PL-revenue invoice/payment exclusion
- [ ] **P1**: Continue v2.2 with canonical sales posting RPC now that transition lineage and idempotency contract are covered.
---

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| `artifacts/accounting-v2.2/migration_verification_report.md` | records review fix evidence |
| `supabase/migrations/20260509113639_canonical_sales_reversal_rpc.sql` | normalized reversal v_sales_amount like existing TS journal helper |
| `supabase/migrations/20260509112149_canonical_sales_posting_rpc.sql` | normalized v_sales_amount like existing TS journal helper |
| `artifacts/accounting-v2.2/migration_verification_report.md` | records canonical sales reversal evidence |
| `server/src/__tests__/unit/accountingRoute.test.ts` | covers canonical sales reversal and expense fallback |
| `server/src/routes/accounting.ts` | /void uses canonical sales reversal when available |
| `server/src/services/AccountingCommandService.ts` | adds reverseCanonicalSale RPC wrapper and unsupported-kind fallback |
| `supabase/migrations/20260509113639_canonical_sales_reversal_rpc.sql` | adds service-role canonical sales reversal RPC |
| `artifacts/accounting-v2.2/migration_verification_report.md` | records PL compare evidence |
| `frontend/src/lib/api.ts` | adds typed PL source overloads and compare response types |
| `server/src/__tests__/unit/accountingRoute.test.ts` | covers journal PL and compare mode with invoice/payment no-PL exclusion |
| `server/src/routes/accounting.ts` | adds PL source parsing, legacy/journal/compare summaries, net journal and gross-compatible diff |
| `artifacts/accounting-v2.2/migration_verification_report.md` | records canonical sales evidence and local migration blocker |
| `server/src/__tests__/unit/accountingRoute.test.ts` | covers canonical sales route envelope |
| `server/src/routes/accounting.ts` | uses canonical sales RPC when available while preserving legacy response/fallback |
| `server/src/services/AccountingCommandService.ts` | adds postCanonicalSale RPC wrapper with missing-function fallback |
| `supabase/migrations/20260509112149_canonical_sales_posting_rpc.sql` | adds service-role canonical sales posting RPC |
| `artifacts/accounting-v2.2/migration_verification_report.md` | updated v2.2 evidence index |
| `artifacts/accounting-v2.2/idempotency_parallel_test.md` | local idempotency evidence |
| `server/src/__tests__/unit/accountingRoute.test.ts` | replay/conflict/in-progress duplicate coverage |
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

- Local supabase migration up remains blocked before these migrations by existing 20260506043949_add_private_site_drawings.sql missing local storage.buckets; remote DB still untouched.
- proposals.type currently allows income.reverse but not transaction.reverse in migrations; canonical sales reversal intentionally uses income.reverse for DB compatibility.
- Do not switch /pl default to journal until remote/local DB parity evidence shows diff=0 over recent sales/expense/reverse and invoice/payment no-PL cases
- Do not use income_post for manual sales yet: revenue_basis.origin_completion_event_id remains NOT NULL, so first canonical manual sales slice uses posting_groups.group_type=manual_adjustment
- Unrelated dirty files remain outside this slice: AGENTS.md, dao-impl-checker skill, and accounting governance docs.
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

### 2026-05-09 20:04:01 +0900

- Entry-ID: `H0012`
- Completed:
  - [x] P1 v2.2 slice: changed /payments/allocations to require existing payment_id and added rpc_allocate_accounting_payment to lock invoice/payment rows and enforce both invoice open balance and payment unapplied balance.
- Remaining:
  - [ ] Continue v2.2 with idempotency breadth/parallel duplicate integration evidence, then canonical sales posting RPC.
- Changed Files:
  - `supabase/migrations/20260509110041_accounting_existing_payment_allocation.sql` - existing-payment allocation RPC
  - `server/src/routes/accounting.ts` - payment_id required for /payments/allocations
  - `server/src/services/AccountingCommandService.ts` - rpc_allocate_accounting_payment wrapper
  - `server/src/__tests__/unit/accountingRoute.test.ts` - payment_id allocation tests
  - `artifacts/accounting-v2.2/migration_verification_report.md` - updated local evidence for allocation separation
- Working Context:
  - Payment event and payment allocation are now separated in API shape; legacy rpc_record_accounting_payment_allocation remains in migrations for compatibility but the route no longer calls it.
- Validation:
  - `server accounting route tests=pass|43 tests after existing-payment allocation; server tsc=pass|npx tsc --noEmit; sql-boundaries=pass; migration syntax=pass|docker postgres existing-payment allocation RPC dry-run; git diff --check=pass`
- Landmines:
  - Unrelated dirty files remain outside this slice: AGENTS.md, dao-impl-checker skill, and accounting governance docs.

### 2026-05-09 20:11:24 +0900

- Entry-ID: `H0013`
- Completed:
  - [x] P0 v2.2 slice: hardened Money write idempotency contract with IDEMPOTENCY_CONFLICT, same-response replay coverage, and in-progress duplicate blocking before RPC/lineage execution.
- Remaining:
  - [ ] Continue v2.2 with canonical sales posting RPC now that transition lineage and idempotency contract are covered.
- Changed Files:
  - `server/src/routes/accounting.ts` - idempotency conflict code standardized
  - `server/src/__tests__/unit/accountingRoute.test.ts` - replay/conflict/in-progress duplicate coverage
  - `artifacts/accounting-v2.2/idempotency_parallel_test.md` - local idempotency evidence
  - `artifacts/accounting-v2.2/migration_verification_report.md` - updated v2.2 evidence index
- Working Context:
  - This is local unit-test evidence; true concurrent DB integration evidence still needs a local/remote DB execution pass with explicit approval for any remote target.
- Validation:
  - `server accounting route tests=pass|46 tests after idempotency contract; server tsc=pass|npx tsc --noEmit; git diff --check=pass; idempotency evidence=pass|artifacts/accounting-v2.2/idempotency_parallel_test.md`
- Landmines:
  - Unrelated dirty files remain outside this slice: AGENTS.md, dao-impl-checker skill, and accounting governance docs.

### 2026-05-09 20:27:48 +0900

- Entry-ID: `H0014`
- Completed:
  - [x] Accounting v2.2: canonical sales posting RPC migration and /sales RPC-first fallback integration added
- Remaining:
  - [ ] Implement PL compare mode source=legacy|journal|compare, with gross-compatible journal totals and no-PL-revenue invoice/payment exclusion
- Changed Files:
  - `supabase/migrations/20260509112149_canonical_sales_posting_rpc.sql` - adds service-role canonical sales posting RPC
  - `server/src/services/AccountingCommandService.ts` - adds postCanonicalSale RPC wrapper with missing-function fallback
  - `server/src/routes/accounting.ts` - uses canonical sales RPC when available while preserving legacy response/fallback
  - `server/src/__tests__/unit/accountingRoute.test.ts` - covers canonical sales route envelope
  - `artifacts/accounting-v2.2/migration_verification_report.md` - records canonical sales evidence and local migration blocker
- Working Context:
  - Remote DB migration/push/migration repair still not executed; local Supabase migration up is blocked by pre-existing storage migration before reaching canonical sales migration
- Validation:
  - `cd server && npx tsc --noEmit => PASS; npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand => PASS 53/53; scripts/db/check-sql-boundaries.sh => PASS; git diff --check => PASS; supabase migration up => BLOCKED before new migration by existing 20260506043949_add_private_site_drawings.sql missing local storage.buckets`
- Landmines:
  - Do not use income_post for manual sales yet: revenue_basis.origin_completion_event_id remains NOT NULL, so first canonical manual sales slice uses posting_groups.group_type=manual_adjustment

### 2026-05-09 20:34:51 +0900

- Entry-ID: `H0015`
- Completed:
  - [x] Accounting v2.2: PL compare mode source=legacy|journal|compare implemented; journal source is net-accounting and compare includes gross-compatible diff
- Remaining:
  - [ ] Next v2.2 slice: sales reversal canonical posting RPC or expense canonical posting RPC; keep /pl default legacy until real DB parity evidence is collected
- Changed Files:
  - `server/src/routes/accounting.ts` - adds PL source parsing, legacy/journal/compare summaries, net journal and gross-compatible diff
  - `server/src/__tests__/unit/accountingRoute.test.ts` - covers journal PL and compare mode with invoice/payment no-PL exclusion
  - `frontend/src/lib/api.ts` - adds typed PL source overloads and compare response types
  - `artifacts/accounting-v2.2/migration_verification_report.md` - records PL compare evidence
- Working Context:
  - Default /pl remains legacy-compatible for Money/Today; source=journal returns net_accounting, source=compare returns legacy gross, journal net, journal_gross_compat, and diff based on gross-compatible totals
- Validation:
  - `cd server && npx tsc --noEmit => PASS; npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand => PASS 55/55; cd frontend && npx tsc -b --pretty false => PASS; scripts/db/check-sql-boundaries.sh => PASS; git diff --check => PASS`
- Landmines:
  - Do not switch /pl default to journal until remote/local DB parity evidence shows diff=0 over recent sales/expense/reverse and invoice/payment no-PL cases

### 2026-05-09 20:40:42 +0900

- Entry-ID: `H0016`
- Completed:
  - [x] Accounting v2.2: canonical sales reversal RPC and /void RPC-first fallback integration added
- Remaining:
  - [ ] Next v2.2 slice: expense canonical posting RPC, then invoice/payment no-PL-revenue canonical posting contract tests against journal source
- Changed Files:
  - `supabase/migrations/20260509113639_canonical_sales_reversal_rpc.sql` - adds service-role canonical sales reversal RPC
  - `server/src/services/AccountingCommandService.ts` - adds reverseCanonicalSale RPC wrapper and unsupported-kind fallback
  - `server/src/routes/accounting.ts` - /void uses canonical sales reversal when available
  - `server/src/__tests__/unit/accountingRoute.test.ts` - covers canonical sales reversal and expense fallback
  - `artifacts/accounting-v2.2/migration_verification_report.md` - records canonical sales reversal evidence
- Working Context:
  - Original posted transaction remains in totals; sales reversal adds a separate negative projection/journal. Legacy expense void remains available until expense canonical posting RPC exists.
- Validation:
  - `cd server && npx tsc --noEmit => PASS; npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand => PASS 56/56; cd frontend && npx tsc -b --pretty false => PASS; scripts/db/check-sql-boundaries.sh => PASS; git diff --check => PASS`
- Landmines:
  - proposals.type currently allows income.reverse but not transaction.reverse in migrations; canonical sales reversal intentionally uses income.reverse for DB compatibility.

### 2026-05-09 20:52:25 +0900

- Entry-ID: `H0017`
- Completed:
  - [x] Accounting v2.2 review: fixed canonical sales/reversal SQL net sales amount normalization when subtotal looks gross
- Remaining:
  - [ ] Commit/split v2.2 local changes before starting expense canonical posting RPC, or continue with expense canonical only after this review checkpoint is accepted
- Changed Files:
  - `supabase/migrations/20260509112149_canonical_sales_posting_rpc.sql` - normalized v_sales_amount like existing TS journal helper
  - `supabase/migrations/20260509113639_canonical_sales_reversal_rpc.sql` - normalized reversal v_sales_amount like existing TS journal helper
  - `artifacts/accounting-v2.2/migration_verification_report.md` - records review fix evidence
- Working Context:
  - Review found one real balance risk: GREATEST(subtotal,total-tax) could overstate revenue when subtotal was gross. SQL now derives net when subtotal equals/exceeds total or subtotal+tax exceeds total.
- Validation:
  - `cd server && npx tsc --noEmit => PASS; npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand => PASS 56/56; cd frontend && npx tsc -b --pretty false => PASS; scripts/db/check-sql-boundaries.sh => PASS; git diff --check => PASS`
- Landmines:
  - Local supabase migration up remains blocked before these migrations by existing 20260506043949_add_private_site_drawings.sql missing local storage.buckets; remote DB still untouched.

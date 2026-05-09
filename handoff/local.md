# Session Handoff - 2026-05-08

## 0. Quick Resume (AI)

- NEXT_CMD: `v2.2残: legacy compatibility SECURITY DEFINER search_path完全固定判断、またはPL compare/posted journal invariantsの実データ証跡拡充。remote DB/pushは明示承認まで未実行`
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

  - HEAD: `5052f48`
  - Updated: `2026-05-10T00:07:43+0900`
<!-- L0_END: セッション開始時はここまで読めばOK。L1以降は必要時のみ。 -->

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- 2026-05-08 23:14:34 +0900 — started by codex
<!-- HANDOFF_SESSION_EVENTS_END -->

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `v2.2残: legacy compatibility SECURITY DEFINER search_path完全固定判断、またはPL compare/posted journal invariantsの実データ証跡拡充。remote DB/pushは明示承認まで未実行`. Source: realtime
- [H0028] Completed: v2.2 document/PDF/OCR/signed URL org boundaryを実装・証跡化。site documentsはdocuments.org_idで絞り、new storage_pathをorg_id/sites/site_id/documents配下に変更、unprefixed pathにはsigned_urlを出さず、accounting OCRはorg prefix外storage_pathをStorage download前に403で拒否。invoice PDF新規生成pathもorg prefix先頭に変更。local APIでforeign site documents/drawingsが404になることを確認
- [H0028] Remaining: v2.2残: legacy compatibility SECURITY DEFINER search_path完全固定判断、またはPL compare/posted journal invariantsの実データ証跡拡充。remote DB/pushは明示承認まで未実行
- [H0027] Completed: v2.2 SECURITY DEFINER hardening local DB evidenceを追加。16 protected RPC signatureでpublic/anon/authenticated EXECUTE=false、service_role EXECUTE=trueを確認し、membership-aware/canonical 12本はsearch_path=pg_catalog、anon/auth直RPCはpermission denied、service_roleでもorg/user/membership不一致はRPC_MEMBERSHIP_REQUIREDで失敗することを確認
- [H0027] Remaining: P0残: document signed URL/PDF/OCR storage path org prefixの追加検証、またはlegacy compatibility SECURITY DEFINER search_pathを完全固定するかどうかの設計判断
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0028] local Supabase Storage is disabled, so real signed URL/upload contracts are unit-tested with mocks; local API verifies foreign site document/drawing routes return 404 before signed URL issuance
- [H0027] local Postgres SET LOCAL ROLEでDB-enforced behaviorを確認。remote DB/push/migration repair未実行
- [H0026] same dev actor has active memberships in org A/B; active org header controls visibility; remote DB/push/migration repair未実行
- [H0025] script parses local Supabase service key from supabase status and starts a local Express server on isolated port; remote DB/push/migration repair未実行
- [H0024] remote DB/push/migration repair未実行。Supabase CLI db query -f はmulti-statementを弾くためdocker exec psqlでlocal DBへ実行
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0028] Existing legacy documents may have unprefixed storage_path; listing now returns signed_url=null for those until backfill/reupload, and OCR returns 403 for unprefixed active-org storage_path
- [H0027] legacy compatibility implementation RPCs remain service_role executable and have older search_path values for fallback compatibility; direct anon/auth is revoked and membership-aware/canonical paths are fixed to pg_catalog
- [H0026] server/.env points at remote, so script explicitly injects local SUPABASE_URL/SERVICE_ROLE_KEY; payment allocation failure creates a failed idempotency row in active org before returning 404 but no accounting rows
- [H0025] server/.env points at remote, so script explicitly injects local SUPABASE_URL/SERVICE_ROLE_KEY; do not run ad-hoc server tests without overriding env
- [H0024] posted journal immutabilityが有効なので固定fixture cleanupでDELETE再実行してはいけない。SQLはfresh org fixture方式
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0028] v2.2残: legacy compatibility SECURITY DEFINER search_path完全固定判断、またはPL compare/posted journal invariantsの実データ証跡拡充。remote DB/pushは明示承認まで未実行
- [H0027] P0残: document signed URL/PDF/OCR storage path org prefixの追加検証、またはlegacy compatibility SECURITY DEFINER search_pathを完全固定するかどうかの設計判断
- [H0026] P0残: service-role RPC membership mismatch/direct RPC negative evidence、またはdocument signed URL/PDF/OCR storage path org prefixの追加検証
- [H0025] P0残: multi-org org boundary negative testを実DB/APIで証跡化。active org外IDは404/403契約を確認
- [H0024] P0/P1残: true concurrent duplicate DB/API integration test、org boundary multi-org negative test、必要ならaccountingV22Canonical integration test化
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `19`
- last_compacted_at: `2026-05-09 22:52:16 +0900`
- archived_entries: `9`
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

- [x] v2.2 document/PDF/OCR/signed URL org boundaryを実装・証跡化。site documentsはdocuments.org_idで絞り、new storage_pathをorg_id/sites/site_id/documents配下に変更、unprefixed pathにはsigned_urlを出さず、accounting OCRはorg prefix外storage_pathをStorage download前に403で拒否。invoice PDF新規生成pathもorg prefix先頭に変更。local APIでforeign site documents/drawingsが404になることを確認
- [x] v2.2 SECURITY DEFINER hardening local DB evidenceを追加。16 protected RPC signatureでpublic/anon/authenticated EXECUTE=false、service_role EXECUTE=trueを確認し、membership-aware/canonical 12本はsearch_path=pg_catalog、anon/auth直RPCはpermission denied、service_roleでもorg/user/membership不一致はRPC_MEMBERSHIP_REQUIREDで失敗することを確認
- [x] v2.2 multi-org org boundary negative local API evidenceを追加。同一userがorg A/B両方所属、active org=Aでorg Bのtransaction/invoice/payment/document IDを渡すと対象APIが404を返し、org Aに会計/証憑rowが作られないことを確認
- [x] v2.2 idempotency true-concurrent local HTTP evidenceを追加。fresh org + local serverで同一idempotency_keyのPOST /expensesを2本同時送信し、1成功/1 in_progress/完了後replay同一ID、row chain 1セットを確認
- [x] v2.2 canonical posting chain local DB integration evidenceを追加。fresh org fixtureでsales/invoice transfer/payment receipt/payment allocation/member overhead expenseを実行し、balanced journals/no-PL-revenue/PL diff=0を確認
- [x] accounting v2.2: local Supabase migration blockerを解消し、20260509135652 invoice_transfer まで migration up --local を通過。Storage無効ローカルでは drawing storage bucket/policyだけ条件付きskipにした
- [x] accounting v2.2: invoice issueをcanonical no-PL-revenue transfer RPC優先に接続し、same-key replayをduplicate invoice checkより前に返すよう修正
- [x] Accounting v2.2: canonical payment allocation RPC and /payments/allocations RPC-first fallback integration added
- [x] Accounting v2.2: canonical payment receipt RPC and /payments RPC-first fallback integration added
- [x] Accounting v2.2: invoice/payment no-PL-revenue contract tests hardened
---

## 4. Remaining（優先順位順）

- [ ] **P0**: legacy compatibility SECURITY DEFINER search_pathを完全固定するかどうかの設計判断
- [ ] **P1**: PL compare / posted journal invariants の実データ証跡拡充。remote DB/pushは明示承認まで未実行
---

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| `artifacts/accounting-v2.2/document_boundary_test.md` | document boundary evidence |
| `artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs` | local API foreign site document/drawing boundary script |
| `server/src/__tests__/unit/accountingRoute.test.ts` | OCR prefix guard and invoice PDF path contract |
| `server/src/__tests__/unit/sitesRoute.test.ts` | site document signed URL/upload path contracts |
| `server/src/services/InvoicePdfService.ts` | org-prefixed invoice PDF path for new PDFs |
| `server/src/routes/accounting.ts` | OCR storage_path org-prefix gate |
| `server/src/routes/sites.ts` | site document org_id filter, org-prefixed upload path, signed URL prefix gate |
| `artifacts/accounting-v2.2/security_definer_hardening_test.md` | SECURITY DEFINER hardening evidence |
| `artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs` | local Postgres role/membership negative verification script |
| `artifacts/accounting-v2.2/org_boundary_negative_test.md` | local API org boundary negative evidence |
| `artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs` | local server multi-org foreign ID negative verification script |
| `artifacts/accounting-v2.2/idempotency_parallel_test.md` | DB/API concurrency row-count evidence added |
| `artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs` | local server true-concurrent idempotency verification script |
| `artifacts/accounting-v2.2/local_posting_chain_integration_result.md` | local DB row count/invariant/PL compare evidence |
| `artifacts/accounting-v2.2/local_v22_posting_scenario.sql` | local-only canonical posting chain integration SQL |
| `artifacts/accounting-v2.2/migration_verification_report.md` | local migration-up and SECURITY DEFINER/grant evidence updated |
| `supabase/migrations/20260506043949_add_private_site_drawings.sql` | guard Storage bucket/object policy setup when local Storage metadata tables are disabled |
| `artifacts/accounting-v2.2/invoice_transfer_canonical_test.md` | evidence summary |
| `server/src/__tests__/unit/accountingRoute.test.ts` | canonical invoice RPC and replay regression coverage |
| `server/src/routes/accounting.ts` | invoice idempotency replay moved before duplicate checks and canonical envelope returned |
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

- Existing legacy documents may have unprefixed storage_path; listing now returns signed_url=null for those until backfill/reupload, and OCR returns 403 for unprefixed active-org storage_path
- legacy compatibility implementation RPCs remain service_role executable and have older search_path values for fallback compatibility; direct anon/auth is revoked and membership-aware/canonical paths are fixed to pg_catalog
- server/.env points at remote, so script explicitly injects local SUPABASE_URL/SERVICE_ROLE_KEY; payment allocation failure creates a failed idempotency row in active org before returning 404 but no accounting rows
- server/.env points at remote, so script explicitly injects local SUPABASE_URL/SERVICE_ROLE_KEY; do not run ad-hoc server tests without overriding env
- posted journal immutabilityが有効なので固定fixture cleanupでDELETE再実行してはいけない。SQLはfresh org fixture方式
---

## 10. References

- `docs/DESIGN_PHILOSOPHY.md` - 作業前に必ず参照
- `docs/AGENT_OPS.md` - セッション運用手順

---

## 11. Incremental Updates

> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260509_225216.md` at 2026-05-09 22:52:16 +0900.


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

### 2026-05-09 22:24:51 +0900

- Entry-ID: `H0018`
- Completed:
  - [x] Accounting v2.2: canonical expense posting RPC and /expenses RPC-first fallback integration added
- Remaining:
  - [ ] Next v2.2 slice: invoice/payment no-PL-revenue canonical posting contract tests, then canonical invoice/payment RPCs
- Changed Files:
  - `supabase/migrations/20260509131814_canonical_expense_posting_rpc.sql` - adds service-role canonical low-risk expense posting RPC
  - `server/src/services/AccountingCommandService.ts` - adds postCanonicalExpense RPC wrapper with missing-function fallback
  - `server/src/routes/accounting.ts` - /expenses uses canonical expense RPC when available and journal PL includes seeded 5110-5140 expense accounts
  - `server/src/__tests__/unit/accountingRoute.test.ts` - covers canonical expense route envelope and RPC parameters
  - `artifacts/accounting-v2.2/migration_verification_report.md` - records canonical expense evidence
- Working Context:
  - Low-risk expenses now follow canonical posting projection when RPC is available; high-risk review flow remains legacy transition path
- Validation:
  - `cd server && npx tsc --noEmit => PASS; npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand => PASS 57/57; cd frontend && npx tsc -b --pretty false => PASS; scripts/db/check-sql-boundaries.sh => PASS; git diff --check => PASS`
- Landmines:
  - Local supabase migration up remains blocked before these migrations by existing 20260506043949_add_private_site_drawings.sql missing local storage.buckets; remote DB still untouched.

### 2026-05-09 22:36:17 +0900

- Entry-ID: `H0019`
- Completed:
  - [x] Accounting v2.2: invoice/payment no-PL-revenue contract tests hardened
- Remaining:
  - [ ] Next v2.2 slice: implement canonical invoice/payment RPCs for invoice_transfer, payment_receipt, and payment_allocation posting groups, keeping PL revenue unchanged
- Changed Files:
  - `server/src/services/AccountingCommandService.ts` - renames invoice fallback allocation posting metadata to invoice_issue_no_pl_revenue
  - `server/src/__tests__/unit/accountingRoute.test.ts` - adds payment unapplied-balance cap test and PL compare exclusions for payment_receipt/payment_allocation
  - `artifacts/accounting-v2.2/migration_verification_report.md` - records invoice/payment no-PL contract evidence
- Working Context:
  - No-PL-revenue contract is now fixed before adding invoice/payment canonical posting RPCs
- Validation:
  - `cd server && npx tsc --noEmit => PASS; npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand => PASS 58/58; cd frontend && npx tsc -b --pretty false => PASS; scripts/db/check-sql-boundaries.sh => PASS; git diff --check => PASS`
- Landmines:
  - Older historical migration bodies still contain no_pl_journal strings, but runtime fallback service metadata and route response contract now use no_pl_revenue wording; remote DB still untouched.

### 2026-05-09 22:43:04 +0900

- Entry-ID: `H0020`
- Completed:
  - [x] Accounting v2.2: canonical payment receipt RPC and /payments RPC-first fallback integration added
- Remaining:
  - [ ] Next v2.2 slice: implement canonical payment allocation posting group/journal or invoice_transfer posting, keeping PL revenue unchanged
- Changed Files:
  - `supabase/migrations/20260509133923_canonical_payment_receipt_posting_rpc.sql` - adds service-role canonical payment receipt no-PL-revenue posting RPC
  - `server/src/services/AccountingCommandService.ts` - recordPaymentEvent tries canonical payment receipt RPC before legacy fallback
  - `server/src/routes/accounting.ts` - /payments uses RPC-provided proposal/projection/posting envelope without duplicate route-side lineage
  - `server/src/__tests__/unit/accountingRoute.test.ts` - covers canonical payment receipt response and missing-function fallback
  - `artifacts/accounting-v2.2/migration_verification_report.md` - records canonical payment receipt evidence
- Working Context:
  - Payment receipt now has canonical BS posting: Dr cash/bank, Cr unapplied cash; invoice allocation remains separate
- Validation:
  - `cd server && npx tsc --noEmit => PASS; npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand => PASS 59/59; cd frontend && npx tsc -b --pretty false => PASS; scripts/db/check-sql-boundaries.sh => PASS; git diff --check => PASS`
- Landmines:
  - Remote DB still untouched; local supabase migration up remains blocked by the older storage.buckets local migration issue before these new migrations.

### 2026-05-09 22:52:16 +0900

- Entry-ID: `H0021`
- Completed:
  - [x] Accounting v2.2: canonical payment allocation RPC and /payments/allocations RPC-first fallback integration added
- Remaining:
  - [ ] Next v2.2 slice: implement invoice_transfer canonical posting for invoice issue, then re-run PL compare contract tests
- Changed Files:
  - `supabase/migrations/20260509134828_canonical_payment_allocation_posting_rpc.sql` - adds service-role canonical payment allocation no-PL-revenue posting RPC
  - `server/src/services/AccountingCommandService.ts` - recordPaymentAllocation tries canonical allocation RPC before legacy fallback
  - `server/src/routes/accounting.ts` - /payments/allocations uses RPC-provided proposal/projection/posting envelope without duplicate route-side lineage
  - `server/src/__tests__/unit/accountingRoute.test.ts` - covers canonical payment allocation response and missing-function fallback
  - `artifacts/accounting-v2.2/migration_verification_report.md` - records canonical payment allocation evidence
- Working Context:
  - Payment allocation now has canonical BS posting: Dr unapplied cash, Cr accounts receivable; PL revenue remains unchanged
- Validation:
  - `cd server && npx tsc --noEmit => PASS; npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand => PASS 60/60; cd frontend && npx tsc -b --pretty false => PASS; scripts/db/check-sql-boundaries.sh => PASS; git diff --check => PASS`
- Landmines:
  - Remote DB still untouched; local supabase migration up remains blocked by the older storage.buckets local migration issue before these new migrations.

### 2026-05-09 23:08:24 +0900

- Entry-ID: `H0022`
- Completed:
  - [x] accounting v2.2: invoice issueをcanonical no-PL-revenue transfer RPC優先に接続し、same-key replayをduplicate invoice checkより前に返すよう修正
- Remaining:
  - [ ] v2.2次候補: invoice_transfer SQLのローカルDB適用検証またはPL compareのDB integration evidence拡充。remote db pushは明示承認まで未実行
- Changed Files:
  - `supabase/migrations/20260509135652_canonical_invoice_transfer_posting_rpc.sql` - invoice_transfer canonical RPC migration, service_role-only grant, membership check, no-PL revenue journal
  - `server/src/services/AccountingCommandService.ts` - createAccountingInvoice uses canonical invoice RPC first and preserves envelope metadata
  - `server/src/routes/accounting.ts` - invoice idempotency replay moved before duplicate checks and canonical envelope returned
  - `server/src/__tests__/unit/accountingRoute.test.ts` - canonical invoice RPC and replay regression coverage
  - `artifacts/accounting-v2.2/invoice_transfer_canonical_test.md` - evidence summary
- Working Context:
  - P1 canonical invoice/payment step: invoice issue can now transfer contract_asset/unbilled_receivable to AR without PL revenue; ProposalService is still not called
- Validation:
  - `cd server && npx tsc --noEmit=PASS; cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand=PASS 55/55; scripts/db/check-sql-boundaries.sh=PASS; git diff --check=PASS`
- Landmines:
  - remote DB migration/push/migration repair未実行。migration fileはGit管理のみ。

### 2026-05-09 23:17:50 +0900

- Entry-ID: `H0023`
- Completed:
  - [x] accounting v2.2: local Supabase migration blockerを解消し、20260509135652 invoice_transfer まで migration up --local を通過。Storage無効ローカルでは drawing storage bucket/policyだけ条件付きskipにした
- Remaining:
  - [ ] v2.2次候補: ローカルDB上でPL compare/posted journal invariantsの実データシナリオ証跡を追加。remote db pushは明示承認まで未実行
- Changed Files:
  - `supabase/migrations/20260506043949_add_private_site_drawings.sql` - guard Storage bucket/object policy setup when local Storage metadata tables are disabled
  - `artifacts/accounting-v2.2/migration_verification_report.md` - local migration-up and SECURITY DEFINER/grant evidence updated
- Working Context:
  - Local config has [storage] enabled=false; migration now preserves real Supabase Storage behavior when storage.buckets/objects exist and skips only Storage-specific setup otherwise
- Validation:
  - `supabase migration up --local=PASS through 20260509135652; canonical RPC search_path/grants SQL check=PASS; missing membership expected failure=RPC_MEMBERSHIP_REQUIRED; remote DB untouched`
- Landmines:
  - remote DB migration/push/migration repair未実行。local-only evidence; remote Storage-enabled behavior still relies on actual Supabase Storage metadata tables.

### 2026-05-09 23:31:28 +0900

- Entry-ID: `H0024`
- Completed:
  - [x] v2.2 canonical posting chain local DB integration evidenceを追加。fresh org fixtureでsales/invoice transfer/payment receipt/payment allocation/member overhead expenseを実行し、balanced journals/no-PL-revenue/PL diff=0を確認
- Remaining:
  - [ ] P0/P1残: true concurrent duplicate DB/API integration test、org boundary multi-org negative test、必要ならaccountingV22Canonical integration test化
- Changed Files:
  - `artifacts/accounting-v2.2/local_v22_posting_scenario.sql` - local-only canonical posting chain integration SQL
  - `artifacts/accounting-v2.2/local_posting_chain_integration_result.md` - local DB row count/invariant/PL compare evidence
- Working Context:
  - remote DB/push/migration repair未実行。Supabase CLI db query -f はmulti-statementを弾くためdocker exec psqlでlocal DBへ実行
- Validation:
  - `PASS: docker exec psql local_v22_posting_scenario.sql; PASS: supabase migration up --local; PASS: cd server && npx tsc --noEmit; PASS: accountingRoute unit 55/55; PASS: scripts/db/check-sql-boundaries.sh; PASS: git diff --check`
- Landmines:
  - posted journal immutabilityが有効なので固定fixture cleanupでDELETE再実行してはいけない。SQLはfresh org fixture方式

### 2026-05-09 23:38:10 +0900

- Entry-ID: `H0025`
- Completed:
  - [x] v2.2 idempotency true-concurrent local HTTP evidenceを追加。fresh org + local serverで同一idempotency_keyのPOST /expensesを2本同時送信し、1成功/1 in_progress/完了後replay同一ID、row chain 1セットを確認
- Remaining:
  - [ ] P0残: multi-org org boundary negative testを実DB/APIで証跡化。active org外IDは404/403契約を確認
- Changed Files:
  - `artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs` - local server true-concurrent idempotency verification script
  - `artifacts/accounting-v2.2/idempotency_parallel_test.md` - DB/API concurrency row-count evidence added
- Working Context:
  - script parses local Supabase service key from supabase status and starts a local Express server on isolated port; remote DB/push/migration repair未実行
- Validation:
  - `PASS: node artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs; PASS: supabase migration up --local; PASS: cd server && npx tsc --noEmit; PASS: accountingRoute unit 55/55; PASS: scripts/db/check-sql-boundaries.sh; PASS: git diff --check`
- Landmines:
  - server/.env points at remote, so script explicitly injects local SUPABASE_URL/SERVICE_ROLE_KEY; do not run ad-hoc server tests without overriding env

### 2026-05-09 23:46:19 +0900

- Entry-ID: `H0026`
- Completed:
  - [x] v2.2 multi-org org boundary negative local API evidenceを追加。同一userがorg A/B両方所属、active org=Aでorg Bのtransaction/invoice/payment/document IDを渡すと対象APIが404を返し、org Aに会計/証憑rowが作られないことを確認
- Remaining:
  - [ ] P0残: service-role RPC membership mismatch/direct RPC negative evidence、またはdocument signed URL/PDF/OCR storage path org prefixの追加検証
- Changed Files:
  - `artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs` - local server multi-org foreign ID negative verification script
  - `artifacts/accounting-v2.2/org_boundary_negative_test.md` - local API org boundary negative evidence
- Working Context:
  - same dev actor has active memberships in org A/B; active org header controls visibility; remote DB/push/migration repair未実行
- Validation:
  - `PASS: node artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs; PASS: supabase migration up --local; PASS: cd server && npx tsc --noEmit; PASS: accountingRoute unit 55/55; PASS: scripts/db/check-sql-boundaries.sh; PASS: git diff --check`
- Landmines:
  - server/.env points at remote, so script explicitly injects local SUPABASE_URL/SERVICE_ROLE_KEY; payment allocation failure creates a failed idempotency row in active org before returning 404 but no accounting rows

### 2026-05-09 23:53:22 +0900

- Entry-ID: `H0027`
- Completed:
  - [x] v2.2 SECURITY DEFINER hardening local DB evidenceを追加。16 protected RPC signatureでpublic/anon/authenticated EXECUTE=false、service_role EXECUTE=trueを確認し、membership-aware/canonical 12本はsearch_path=pg_catalog、anon/auth直RPCはpermission denied、service_roleでもorg/user/membership不一致はRPC_MEMBERSHIP_REQUIREDで失敗することを確認
- Remaining:
  - [ ] P0残: document signed URL/PDF/OCR storage path org prefixの追加検証、またはlegacy compatibility SECURITY DEFINER search_pathを完全固定するかどうかの設計判断
- Changed Files:
  - `artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs` - local Postgres role/membership negative verification script
  - `artifacts/accounting-v2.2/security_definer_hardening_test.md` - SECURITY DEFINER hardening evidence
- Working Context:
  - local Postgres SET LOCAL ROLEでDB-enforced behaviorを確認。remote DB/push/migration repair未実行
- Validation:
  - `PASS: node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs; PASS: supabase migration up --local; PASS: cd server && npx tsc --noEmit; PASS: accountingRoute unit 55/55; PASS: scripts/db/check-sql-boundaries.sh; PASS: git diff --check`
- Landmines:
  - legacy compatibility implementation RPCs remain service_role executable and have older search_path values for fallback compatibility; direct anon/auth is revoked and membership-aware/canonical paths are fixed to pg_catalog

### 2026-05-10 00:07:43 +0900

- Entry-ID: `H0028`
- Completed:
  - [x] v2.2 document/PDF/OCR/signed URL org boundaryを実装・証跡化。site documentsはdocuments.org_idで絞り、new storage_pathをorg_id/sites/site_id/documents配下に変更、unprefixed pathにはsigned_urlを出さず、accounting OCRはorg prefix外storage_pathをStorage download前に403で拒否。invoice PDF新規生成pathもorg prefix先頭に変更。local APIでforeign site documents/drawingsが404になることを確認
- Remaining:
  - [ ] v2.2残: legacy compatibility SECURITY DEFINER search_path完全固定判断、またはPL compare/posted journal invariantsの実データ証跡拡充。remote DB/pushは明示承認まで未実行
- Changed Files:
  - `server/src/routes/sites.ts` - site document org_id filter, org-prefixed upload path, signed URL prefix gate
  - `server/src/routes/accounting.ts` - OCR storage_path org-prefix gate
  - `server/src/services/InvoicePdfService.ts` - org-prefixed invoice PDF path for new PDFs
  - `server/src/__tests__/unit/sitesRoute.test.ts` - site document signed URL/upload path contracts
  - `server/src/__tests__/unit/accountingRoute.test.ts` - OCR prefix guard and invoice PDF path contract
  - `artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs` - local API foreign site document/drawing boundary script
  - `artifacts/accounting-v2.2/document_boundary_test.md` - document boundary evidence
- Working Context:
  - local Supabase Storage is disabled, so real signed URL/upload contracts are unit-tested with mocks; local API verifies foreign site document/drawing routes return 404 before signed URL issuance
- Validation:
  - `PASS: node artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs; PASS: supabase migration up --local; PASS: cd server && npx tsc --noEmit; PASS: sitesRoute+accountingRoute unit 64/64; PASS: scripts/db/check-sql-boundaries.sh; PASS: git diff --check`
- Landmines:
  - Existing legacy documents may have unprefixed storage_path; listing now returns signed_url=null for those until backfill/reupload, and OCR returns 403 for unprefixed active-org storage_path

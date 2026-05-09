# Session Handoff - 2026-05-08

## 0. Quick Resume (AI)

- NEXT_CMD: `Next: review/commit this slice, then decide whether remaining non-accounting legacy site/proposal SECURITY DEFINER functions need separate classification, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.`
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

  - HEAD: `ad7b53b`
  - Updated: `2026-05-10T00:40:26+0900`
<!-- L0_END: セッション開始時はここまで読めばOK。L1以降は必要時のみ。 -->

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- 2026-05-08 23:14:34 +0900 — started by codex
<!-- HANDOFF_SESSION_EVENTS_END -->

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `Next: review/commit this slice, then decide whether remaining non-accounting legacy site/proposal SECURITY DEFINER functions need separate classification, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.`. Source: realtime
- [H0032] Completed: v2.2 legacy accounting base RPC search_path hardening added locally. Hardened public.rpc_create_accounting_invoice(no-membership base) and deprecated public.rpc_record_accounting_payment_allocation(old create+allocate) to search_path=pg_catalog while keeping service_role compatibility and app-role direct execute revoked. Updated classification and added evidence artifact.
- [H0032] Remaining: Next: review/commit this slice, then decide whether remaining non-accounting legacy site/proposal SECURITY DEFINER functions need separate classification, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.
- [H0031] Completed: v2.2 private accounting helper hardening migration added locally. Hardened private.assert_accounting_journal_entry_balanced, private.assert_invoice_revenue_allocation_capacity, and private.prevent_posted_accounting_journal_mutation to search_path=pg_catalog with public/anon/authenticated EXECUTE revoked and service_role retained. Updated search_path classification and added evidence artifact.
- [H0031] Remaining: Next: decide whether to harden old internal base RPCs rpc_create_accounting_invoice(no membership) and deprecated rpc_record_accounting_payment_allocation old create+allocate form, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0032] Auto-captured decision: v2.2 legacy accounting base RPC search_path hardening added locally. Hardened public.rpc_create_accounting_invoice(no-membership base) and deprecated public.rpc_record_accountin...
- [H0031] Auto-captured decision: v2.2 private accounting helper hardening migration added locally. Hardened private.assert_accounting_journal_entry_balanced, private.assert_invoice_revenue_allocation_capacity, ...
- [H0030] Auto-captured decision: v2.2 legacy RPC search_path reachability classification added. Local-only inventory classifies current accounting SECURITY DEFINER residue: canonical/member-aware RPCs OK with p...
- [H0029] Local-only evidence; remote DB/push/migration repair未実行。Existing local_v22_posting_scenario.sqlは未変更
- [H0028] local Supabase Storage is disabled, so real signed URL/upload contracts are unit-tested with mocks; local API verifies foreign site document/drawing routes return 404 before signed URL issuance
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0032] service_role execute intentionally retained for old base RPCs; do not revoke until wrapper/canonical internal calls and any deployment fallback paths are separately sunset.
- [H0031] Old internal base RPCs are still intentionally not changed; invoice base is called by wrapper/canonical internals, so harden it only with focused local replay.
- [H0030] Do not broad-sweep ALTER all SECURITY DEFINER functions; old invoice base RPC is still called internally by membership wrapper/canonical RPC, so harden/revoke only with focused local replay evidence.
- [H0029] `/pl` journal source must use explicit composite-FK relationship names after org_id FK additions, otherwise PostgREST returns ambiguous relationship PGRST201
- [H0028] Existing legacy documents may have unprefixed storage_path; listing now returns signed_url=null for those until backfill/reupload, and OCR returns 403 for unprefixed active-org storage_path
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0032] Next: review/commit this slice, then decide whether remaining non-accounting legacy site/proposal SECURITY DEFINER functions need separate classification, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.
- [H0031] Next: decide whether to harden old internal base RPCs rpc_create_accounting_invoice(no membership) and deprecated rpc_record_accounting_payment_allocation old create+allocate form, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.
- [H0030] Next: implement a narrow local migration for private helper/trigger search_path/grant hardening, then rerun PL invariants and RPC hardening evidence. Remote DB migration/push remains blocked until explicit approval.
- [H0029] Next: review/commit this evidence slice, then continue with old compatibility RPC search_path reachability classification. Remote DB migration/push remains unexecuted until explicit approval.
- [H0028] v2.2残: legacy compatibility SECURITY DEFINER search_path完全固定判断、またはPL compare/posted journal invariantsの実データ証跡拡充。remote DB/pushは明示承認まで未実行
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `14`
- last_compacted_at: `2026-05-10 00:35:04 +0900`
- archived_entries: `18`
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

- [x] v2.2 legacy accounting base RPC search_path hardening added locally. Hardened public.rpc_create_accounting_invoice(no-membership base) and deprecated public.rpc_record_accounting_payment_allocation(old create+allocate) to search_path=pg_catalog while keeping service_role compatibility and app-role direct execute revoked. Updated classification and added evidence artifact.
- [x] v2.2 private accounting helper hardening migration added locally. Hardened private.assert_accounting_journal_entry_balanced, private.assert_invoice_revenue_allocation_capacity, and private.prevent_posted_accounting_journal_mutation to search_path=pg_catalog with public/anon/authenticated EXECUTE revoked and service_role retained. Updated search_path classification and added evidence artifact.
- [x] v2.2 legacy RPC search_path reachability classification added. Local-only inventory classifies current accounting SECURITY DEFINER residue: canonical/member-aware RPCs OK with pg_catalog; old invoice base RPC is internal legacy base; old payment allocation create+allocate RPC is deprecated/no-new-route; private helper/trigger functions are next safe hardening target.
- [x] v2.2 PL compare/posted journal invariants evidence added: local_pl_compare_invariants_test.mjs creates fresh local org, runs canonical sale/expense/invoice/payment/allocation/reversal, calls real /pl legacy|journal|compare API, and verifies posted journal UPDATE/DELETE fail with POSTED_JOURNAL_IMMUTABLE. Fixed /pl journal relation embeds and invoice-kind skip so local HTTP compare returns diff=0 after invoice/payment/reversal.
- [x] v2.2 document/PDF/OCR/signed URL org boundaryを実装・証跡化。site documentsはdocuments.org_idで絞り、new storage_pathをorg_id/sites/site_id/documents配下に変更、unprefixed pathにはsigned_urlを出さず、accounting OCRはorg prefix外storage_pathをStorage download前に403で拒否。invoice PDF新規生成pathもorg prefix先頭に変更。local APIでforeign site documents/drawingsが404になることを確認
- [x] v2.2 SECURITY DEFINER hardening local DB evidenceを追加。16 protected RPC signatureでpublic/anon/authenticated EXECUTE=false、service_role EXECUTE=trueを確認し、membership-aware/canonical 12本はsearch_path=pg_catalog、anon/auth直RPCはpermission denied、service_roleでもorg/user/membership不一致はRPC_MEMBERSHIP_REQUIREDで失敗することを確認
- [x] v2.2 multi-org org boundary negative local API evidenceを追加。同一userがorg A/B両方所属、active org=Aでorg Bのtransaction/invoice/payment/document IDを渡すと対象APIが404を返し、org Aに会計/証憑rowが作られないことを確認
- [x] v2.2 idempotency true-concurrent local HTTP evidenceを追加。fresh org + local serverで同一idempotency_keyのPOST /expensesを2本同時送信し、1成功/1 in_progress/完了後replay同一ID、row chain 1セットを確認
- [x] v2.2 canonical posting chain local DB integration evidenceを追加。fresh org fixtureでsales/invoice transfer/payment receipt/payment allocation/member overhead expenseを実行し、balanced journals/no-PL-revenue/PL diff=0を確認
- [x] accounting v2.2: local Supabase migration blockerを解消し、20260509135652 invoice_transfer まで migration up --local を通過。Storage無効ローカルでは drawing storage bucket/policyだけ条件付きskipにした
---

## 4. Remaining（優先順位順）

- [ ] **P0**: Next: review/commit this slice, then decide whether remaining non-accounting legacy site/proposal SECURITY DEFINER functions need separate classification, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.
- [ ] **P1**: Next: decide whether to harden old internal base RPCs rpc_create_accounting_invoice(no membership) and deprecated rpc_record_accounting_payment_allocation old create+allocate form, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.
- [ ] **P1**: Next: implement a narrow local migration for private helper/trigger search_path/grant hardening, then rerun PL invariants and RPC hardening evidence. Remote DB migration/push remains blocked until explicit approval.
- [ ] **P1**: Next: review/commit this evidence slice, then continue with old compatibility RPC search_path reachability classification. Remote DB migration/push remains unexecuted until explicit approval.
- [ ] **P1**: v2.2残: legacy compatibility SECURITY DEFINER search_path完全固定判断、またはPL compare/posted journal invariantsの実データ証跡拡充。remote DB/pushは明示承認まで未実行
---

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| `artifacts/accounting-v2.2/legacy_rpc_search_path_classification.md` | updated after legacy base RPC hardening |
| `artifacts/accounting-v2.2/legacy_base_rpc_hardening_test.md` | local evidence for legacy base RPC hardening |
| `supabase/migrations/20260509153840_harden_legacy_accounting_base_rpcs.sql` | legacy accounting base RPC search_path hardening |
| `artifacts/accounting-v2.2/legacy_rpc_search_path_classification.md` | updated classification after private helper hardening |
| `artifacts/accounting-v2.2/private_helper_hardening_test.md` | local evidence for private helper hardening |
| `supabase/migrations/20260509153529_harden_private_accounting_helpers.sql` | narrow private accounting helper/trigger search_path and grant hardening |
| `artifacts/accounting-v2.2/legacy_rpc_search_path_classification.md` | local-only legacy RPC search_path reachability classification and next migration recommendation |
| `server/src/routes/accounting.ts` | disambiguate PL journal PostgREST embeds and count revenue journals by posting group rather than invoice projection kind |
| `artifacts/accounting-v2.2/pl_compare_posted_journal_invariants.md` | captured v2.2 local evidence summary |
| `artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs` | local API/DB PL compare, reversal, posted journal immutability evidence runner |
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

- service_role execute intentionally retained for old base RPCs; do not revoke until wrapper/canonical internal calls and any deployment fallback paths are separately sunset.
- Old internal base RPCs are still intentionally not changed; invoice base is called by wrapper/canonical internals, so harden it only with focused local replay.
- Do not broad-sweep ALTER all SECURITY DEFINER functions; old invoice base RPC is still called internally by membership wrapper/canonical RPC, so harden/revoke only with focused local replay evidence.
- `/pl` journal source must use explicit composite-FK relationship names after org_id FK additions, otherwise PostgREST returns ambiguous relationship PGRST201
- Existing legacy documents may have unprefixed storage_path; listing now returns signed_url=null for those until backfill/reupload, and OCR returns 403 for unprefixed active-org storage_path
---

## 10. References

- `docs/DESIGN_PHILOSOPHY.md` - 作業前に必ず参照
- `docs/AGENT_OPS.md` - セッション運用手順

---

## 11. Incremental Updates

> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260510_003504.md` at 2026-05-10 00:35:04 +0900.


> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260509_225216.md` at 2026-05-09 22:52:16 +0900.


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

### 2026-05-10 00:30:27 +0900

- Entry-ID: `H0029`
- Completed:
  - [x] v2.2 PL compare/posted journal invariants evidence added: local_pl_compare_invariants_test.mjs creates fresh local org, runs canonical sale/expense/invoice/payment/allocation/reversal, calls real /pl legacy|journal|compare API, and verifies posted journal UPDATE/DELETE fail with POSTED_JOURNAL_IMMUTABLE. Fixed /pl journal relation embeds and invoice-kind skip so local HTTP compare returns diff=0 after invoice/payment/reversal.
- Remaining:
  - [ ] Next: review/commit this evidence slice, then continue with old compatibility RPC search_path reachability classification. Remote DB migration/push remains unexecuted until explicit approval.
- Changed Files:
  - `artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs` - local API/DB PL compare, reversal, posted journal immutability evidence runner
  - `artifacts/accounting-v2.2/pl_compare_posted_journal_invariants.md` - captured v2.2 local evidence summary
  - `server/src/routes/accounting.ts` - disambiguate PL journal PostgREST embeds and count revenue journals by posting group rather than invoice projection kind
- Working Context:
  - Local-only evidence; remote DB/push/migration repair未実行。Existing local_v22_posting_scenario.sqlは未変更
- Validation:
  - `node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs=pass; supabase migration up --local=up to date; cd server && npx tsc --noEmit=pass; cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand=pass; scripts/db/check-sql-boundaries.sh=pass; git diff --check=pass`
- Landmines:
  - `/pl` journal source must use explicit composite-FK relationship names after org_id FK additions, otherwise PostgREST returns ambiguous relationship PGRST201

### 2026-05-10 00:35:04 +0900

- Entry-ID: `H0030`
- Completed:
  - [x] v2.2 legacy RPC search_path reachability classification added. Local-only inventory classifies current accounting SECURITY DEFINER residue: canonical/member-aware RPCs OK with pg_catalog; old invoice base RPC is internal legacy base; old payment allocation create+allocate RPC is deprecated/no-new-route; private helper/trigger functions are next safe hardening target.
- Remaining:
  - [ ] Next: implement a narrow local migration for private helper/trigger search_path/grant hardening, then rerun PL invariants and RPC hardening evidence. Remote DB migration/push remains blocked until explicit approval.
- Changed Files:
  - `artifacts/accounting-v2.2/legacy_rpc_search_path_classification.md` - local-only legacy RPC search_path reachability classification and next migration recommendation
- Working Context:
  - Auto-captured decision: v2.2 legacy RPC search_path reachability classification added. Local-only inventory classifies current accounting SECURITY DEFINER residue: canonical/member-aware RPCs OK with p...
- Validation:
  - `git diff --check=pass; local DB inventory only, remote DB not used`
- Landmines:
  - Do not broad-sweep ALTER all SECURITY DEFINER functions; old invoice base RPC is still called internally by membership wrapper/canonical RPC, so harden/revoke only with focused local replay evidence.

### 2026-05-10 00:37:18 +0900

- Entry-ID: `H0031`
- Completed:
  - [x] v2.2 private accounting helper hardening migration added locally. Hardened private.assert_accounting_journal_entry_balanced, private.assert_invoice_revenue_allocation_capacity, and private.prevent_posted_accounting_journal_mutation to search_path=pg_catalog with public/anon/authenticated EXECUTE revoked and service_role retained. Updated search_path classification and added evidence artifact.
- Remaining:
  - [ ] Next: decide whether to harden old internal base RPCs rpc_create_accounting_invoice(no membership) and deprecated rpc_record_accounting_payment_allocation old create+allocate form, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.
- Changed Files:
  - `supabase/migrations/20260509153529_harden_private_accounting_helpers.sql` - narrow private accounting helper/trigger search_path and grant hardening
  - `artifacts/accounting-v2.2/private_helper_hardening_test.md` - local evidence for private helper hardening
  - `artifacts/accounting-v2.2/legacy_rpc_search_path_classification.md` - updated classification after private helper hardening
- Working Context:
  - Auto-captured decision: v2.2 private accounting helper hardening migration added locally. Hardened private.assert_accounting_journal_entry_balanced, private.assert_invoice_revenue_allocation_capacity, ...
- Validation:
  - `supabase migration up --local=pass; private helper privilege query=public/anon/authenticated false, service_role true, search_path pg_catalog; node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs=pass; node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs=pass; cd server && npx tsc --noEmit=pass; accountingRoute unit 56/56=pass; scripts/db/check-sql-boundaries.sh=pass; git diff --check=pass`
- Landmines:
  - Old internal base RPCs are still intentionally not changed; invoice base is called by wrapper/canonical internals, so harden it only with focused local replay.

### 2026-05-10 00:40:26 +0900

- Entry-ID: `H0032`
- Completed:
  - [x] v2.2 legacy accounting base RPC search_path hardening added locally. Hardened public.rpc_create_accounting_invoice(no-membership base) and deprecated public.rpc_record_accounting_payment_allocation(old create+allocate) to search_path=pg_catalog while keeping service_role compatibility and app-role direct execute revoked. Updated classification and added evidence artifact.
- Remaining:
  - [ ] Next: review/commit this slice, then decide whether remaining non-accounting legacy site/proposal SECURITY DEFINER functions need separate classification, or pause for PR review. Remote DB migration/push remains blocked until explicit approval.
- Changed Files:
  - `supabase/migrations/20260509153840_harden_legacy_accounting_base_rpcs.sql` - legacy accounting base RPC search_path hardening
  - `artifacts/accounting-v2.2/legacy_base_rpc_hardening_test.md` - local evidence for legacy base RPC hardening
  - `artifacts/accounting-v2.2/legacy_rpc_search_path_classification.md` - updated after legacy base RPC hardening
- Working Context:
  - Auto-captured decision: v2.2 legacy accounting base RPC search_path hardening added locally. Hardened public.rpc_create_accounting_invoice(no-membership base) and deprecated public.rpc_record_accountin...
- Validation:
  - `supabase migration up --local=pass; legacy base RPC privilege query=public/anon/authenticated false, service_role true, search_path pg_catalog; node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs=pass; node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs=pass; cd server && npx tsc --noEmit=pass; accountingRoute unit 56/56=pass; scripts/db/check-sql-boundaries.sh=pass; git diff --check=pass`
- Landmines:
  - service_role execute intentionally retained for old base RPCs; do not revoke until wrapper/canonical internal calls and any deployment fallback paths are separately sunset.

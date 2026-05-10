# Session Handoff - 2026-05-08

## 0. Quick Resume (AI)

- NEXT_CMD: `Decision: production 適用方法を3択から選ぶ。(a) production 側で migration_history desync を repair 後 supabase db push (b) Management API で SQL 直接適用 (history 不揃い残る) (c) いったん延期し review/data backup 強化。どれを取るかは user explicit approval。Remote DB migration / push remain blocked until explicit approval.`
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

  - HEAD: `3f2ddfd`
  - Updated: `2026-05-10T16:13:53+0900`
<!-- L0_END: セッション開始時はここまで読めばOK。L1以降は必要時のみ。 -->

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- 2026-05-08 23:14:34 +0900 — started by codex
<!-- HANDOFF_SESSION_EVENTS_END -->

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `Decision: production 適用方法を3択から選ぶ。(a) production 側で migration_history desync を repair 後 supabase db push (b) Management API で SQL 直接適用 (history 不揃い残る) (c) いったん延期し review/data backup 強化。どれを取るかは user explicit approval。Remote DB migration / push remain blocked until explicit approval.`. Source: realtime
- [H0040] Completed: Supabase Branch (v22-staging) を作成して 20本の v2.2 migration を適用・検証完了。Production DB は未変更。supabase CLI db push が migration_history 時刻ドリフト (DB_BASELINE_REVIEW.md:159 の accept_org_invite トラップ) でブロックされたため Management API SQL endpoint で SQL 直接適用に切替。20/20 OK、4 group checkpoint PASS、6 canonical RPC 全てで anon/authenticated EXECUTE = false / service_role = true、Security advisor WARN -5 (complete_site_rpc / reverse_site_completion_rpc の anon+authenticated execute が v2.2 で revoke 済み)、Performance WARN ±0、新規 INFO 1件 (accounting_write_idempotency_keys の rls_enabled_no_policy、service_role-only なので intentional)。
- [H0040] Remaining: Decision: production 適用方法を3択から選ぶ。(a) production 側で migration_history desync を repair 後 supabase db push (b) Management API で SQL 直接適用 (history 不揃い残る) (c) いったん延期し review/data backup 強化。どれを取るかは user explicit approval。Remote DB migration / push remain blocked until explicit approval.
- [H0039] Completed: PR #9 pre-staging cleanup を完了。origin/master を codex/money-fix にマージし conflict (handoff/local.md) を解消。docs を 36 migrations / 20 v2.2 migrations 表記へ更新。runbook の Group D apply 順と Class 1 rollback list に 20260510020200/20260510020300 を追加。pr_review_package.md の stale Push 指示を削除し PR #9 既出表記に変更。invoice_transfer_canonical_test.md の trailing blank line を修正。supabase db reset --local で 36 migrations clean apply、v2.2 evidence script 6本 + accountingRoute 56/56 + tsc + sql guard + git diff --check 全部 PASS。
- [H0039] Remaining: PR #9 を Ready for Review に切り替え→レビュー受領→user explicit approval が出たタイミングで runbook 通りに staging adoption。Remote DB migration / push remain blocked until explicit approval.
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0040] Auto-captured decision: Supabase Branch (v22-staging) を作成して 20本の v2.2 migration を適用・検証完了。Production DB は未変更。supabase CLI db push が migration_history 時刻�...
- [H0039] Auto-captured decision: PR #9 pre-staging cleanup を完了。origin/master を codex/money-fix にマージし conflict (handoff/local.md) を解消。docs を 36 migrations / 20 v2.2 migrations 表�...
- [H0038] Auto-captured decision: v2.2 idempotency lookup helper を追加し canonical posting RPC 6本を再生成。private.find_idempotent_execution(uuid, text, text) returns SETOF public.proposal_executions...
- [H0037] Auto-captured decision: v2.2 clean local DB rebuild証跡追加 + staging rollback/repair runbook 起草。supabase db reset --local で 34 migrations が clean に適用、その後 v2.2 evidence scri...
- [H0036] Auto-captured decision: v2.2 party/org boundary asserts wired into 3 canonical RPCs and validated. Added private.assert_customer_belongs_to_org and assert_member_belongs_to_org helpers, re-created rpc_...
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0040] Production main has migration_history desync vs local files: remote 20260506094218/20260506094252 vs local 20260506093000/20260506094251 (same names, different timestamps). supabase db push 経由で本番適用するには migration repair が必要。
- [H0040] Branch's supabase_migrations.schema_migrations does NOT contain the 20 v2.2 versions (Management API は schema_migrations を更新しない). Branch を main に merge しても本番には反映されない。Branch は validation 環境であって deployment vehicle ではない。
- [H0039] Cleanup edits do not touch any SQL/RPC migration body. accounting v2.2 functional contract is unchanged from PR #9 commits 5f4e146/1ba7ab7/7dd194e.
- [H0038] RETURNS SETOF is intentional — RETURNS public.proposal_executions would always set FOUND=TRUE on caller and break IF FOUND idempotency check; do not change to scalar return type.
- [H0037] Migration history repair section warns against --include-all on supabase db push; it can re-execute already-applied migrations like 20260504084000_seed_accounting_master_data.sql.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0040] Decision: production 適用方法を3択から選ぶ。(a) production 側で migration_history desync を repair 後 supabase db push (b) Management API で SQL 直接適用 (history 不揃い残る) (c) いったん延期し review/data backup 強化。どれを取るかは user explicit approval。Remote DB migration / push remain blocked until explicit approval.
- [H0039] PR #9 を Ready for Review に切り替え→レビュー受領→user explicit approval が出たタイミングで runbook 通りに staging adoption。Remote DB migration / push remain blocked until explicit approval.
- [H0038] v2.2 ローカル作業はここで完結。残るは user explicitly approves remote DB migration のみ。Remote DB migration / push remain blocked until explicit approval.
- [H0037] Pick next remote-Go blocker: #2 idempotency共通化 (assert_idempotency_replay helper化, 1h) または ここで一旦区切ってPRレビュー待ち。Remote DB migration / push remain blocked until explicit approval.
- [H0036] Pick next remote-Go blocker: write rollback/repair plan for staging (#5) or capture clean local DB rebuild evidence (#4). Remote DB migration / push remain blocked until explicit approval.
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `13`
- last_compacted_at: `2026-05-10 15:50:39 +0900`
- archived_entries: `27`
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

- [x] Supabase Branch (v22-staging) を作成して 20本の v2.2 migration を適用・検証完了。Production DB は未変更。supabase CLI db push が migration_history 時刻ドリフト (DB_BASELINE_REVIEW.md:159 の accept_org_invite トラップ) でブロックされたため Management API SQL endpoint で SQL 直接適用に切替。20/20 OK、4 group checkpoint PASS、6 canonical RPC 全てで anon/authenticated EXECUTE = false / service_role = true、Security advisor WARN -5 (complete_site_rpc / reverse_site_completion_rpc の anon+authenticated execute が v2.2 で revoke 済み)、Performance WARN ±0、新規 INFO 1件 (accounting_write_idempotency_keys の rls_enabled_no_policy、service_role-only なので intentional)。
- [x] PR #9 pre-staging cleanup を完了。origin/master を codex/money-fix にマージし conflict (handoff/local.md) を解消。docs を 36 migrations / 20 v2.2 migrations 表記へ更新。runbook の Group D apply 順と Class 1 rollback list に 20260510020200/20260510020300 を追加。pr_review_package.md の stale Push 指示を削除し PR #9 既出表記に変更。invoice_transfer_canonical_test.md の trailing blank line を修正。supabase db reset --local で 36 migrations clean apply、v2.2 evidence script 6本 + accountingRoute 56/56 + tsc + sql guard + git diff --check 全部 PASS。
- [x] v2.2 idempotency lookup helper を追加し canonical posting RPC 6本を再生成。private.find_idempotent_execution(uuid, text, text) returns SETOF public.proposal_executions で SELECT INTO + IF FOUND セマンティクスを温存。6 RPC全部が helper 経由に切り替わったことを pg_proc grep で確認。db reset --local で 36 migrations が clean に適用、v2.2 evidence script 6本 + accountingRoute 56/56 が再現。
- [x] v2.2 clean local DB rebuild証跡追加 + staging rollback/repair runbook 起草。supabase db reset --local で 34 migrations が clean に適用、その後 v2.2 evidence script 6本 + accountingRoute 56/56 が fresh DB で再現することを確認。docs/runbooks/accounting-v22-staging-rollback.md に pre-flight、4グループapply順、smoke、Class1/Class2 rollback、migration history repair、decision matrix を整備。pr_review_package.md の checklist 7項目を [x] 化。
- [x] v2.2 party/org boundary asserts wired into 3 canonical RPCs and validated. Added private.assert_customer_belongs_to_org and assert_member_belongs_to_org helpers, re-created rpc_post_accounting_expense_canonical / rpc_post_accounting_sale_canonical / rpc_record_accounting_payment_event_canonical to call the matching helper right after assert_rpc_active_membership. Caught and fixed two latent fixture bugs that passed user_id where membership_id was expected.
- [x] Pushed codex/money-fix and opened draft PR #9 for accounting v2.2. PR body uses artifacts/accounting-v2.2/pr_body.md and explicitly states remote DB migration/push/migration repair were not executed.
- [x] Added clean PR body artifact for accounting v2.2 draft PR creation.
- [x] v2.2 PR review package drafted. Added artifacts/accounting-v2.2/pr_review_package.md with draft PR title/body, evidence index, pre-remote go/no-go checklist, and explicit note that remote DB migration/push/migration repair are not executed.
- [x] v2.2 legacy accounting base RPC search_path hardening added locally. Hardened public.rpc_create_accounting_invoice(no-membership base) and deprecated public.rpc_record_accounting_payment_allocation(old create+allocate) to search_path=pg_catalog while keeping service_role compatibility and app-role direct execute revoked. Updated classification and added evidence artifact.
- [x] v2.2 private accounting helper hardening migration added locally. Hardened private.assert_accounting_journal_entry_balanced, private.assert_invoice_revenue_allocation_capacity, and private.prevent_posted_accounting_journal_mutation to search_path=pg_catalog with public/anon/authenticated EXECUTE revoked and service_role retained. Updated search_path classification and added evidence artifact.
---

## 4. Remaining（優先順位順）

- [ ] **P0**: Decision: production 適用方法を3択から選ぶ。(a) production 側で migration_history desync を repair 後 supabase db push (b) Management API で SQL 直接適用 (history 不揃い残る) (c) いったん延期し review/data backup 強化。どれを取るかは user explicit approval。Remote DB migration / push remain blocked until explicit approval.
- [ ] **P1**: PR #9 を Ready for Review に切り替え→レビュー受領→user explicit approval が出たタイミングで runbook 通りに staging adoption。Remote DB migration / push remain blocked until explicit approval.
- [ ] **P1**: v2.2 ローカル作業はここで完結。残るは user explicitly approves remote DB migration のみ。Remote DB migration / push remain blocked until explicit approval.
- [ ] **P1**: Pick next remote-Go blocker: #2 idempotency共通化 (assert_idempotency_replay helper化, 1h) または ここで一旦区切ってPRレビュー待ち。Remote DB migration / push remain blocked until explicit approval.
- [ ] **P1**: Pick next remote-Go blocker: write rollback/repair plan for staging (#5) or capture clean local DB rebuild evidence (#4). Remote DB migration / push remain blocked until explicit approval.
---

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| `artifacts/accounting-v2.2/branch_validation_test.md` | branch apply + checkpoint + advisor diff evidence |
| `artifacts/accounting-v2.2/invoice_transfer_canonical_test.md` | trim trailing blank line |
| `docs/runbooks/accounting-v22-staging-rollback.md` | 18->20 migrations, expand Group D to 5 migrations with idempotency helper checkpoint, expand Class 1 list and rollback fast-path |
| `artifacts/accounting-v2.2/pr_review_package.md` | 34->36, replace Suggested Next Step with Status section pointing at PR #9 and runbook |
| `artifacts/accounting-v2.2/clean_db_rebuild_test.md` | 34->36 migrations and add 20260510020200/20260510020300 entries |
| `handoff/local.md` | resolved L0/L1/L2 merge conflicts; combined accounting v2.2 H0036-H0038 with master philosophy/skill H0003-H0007 |
| `artifacts/accounting-v2.2/pr_review_package.md` | record helper coverage and add new artifacts to evidence index |
| `artifacts/accounting-v2.2/idempotency_helper_test.md` | evidence artifact for #2 |
| `supabase/migrations/20260510020300_wire_idempotency_lookup_to_canonical_rpcs.sql` | swap inline lookup for helper call across 6 canonical RPCs |
| `supabase/migrations/20260510020200_add_idempotency_lookup_helper.sql` | new private.find_idempotent_execution helper |
| `artifacts/accounting-v2.2/pr_review_package.md` | checked off 7 satisfied pre-remote checklist items |
| `docs/runbooks/accounting-v22-staging-rollback.md` | new staging rollback/repair runbook (pre-flight, 4 apply groups, smoke, Class1/Class2 rollback, migration repair, decision matrix) |
| `artifacts/accounting-v2.2/clean_db_rebuild_test.md` | clean rebuild evidence with 34 migrations apply order and post-reset replay summary |
| `artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs` | fix latent claimant_member_id fixture bug |
| `artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs` | fix latent claimant_member_id fixture bug |
| `artifacts/accounting-v2.2/party_org_boundary_test.md` | evidence summary |
| `artifacts/accounting-v2.2/local_party_org_boundary_test.mjs` | SQL-level negative + wiring + grant evidence runner |
| `supabase/migrations/20260510020100_wire_party_org_boundary_to_canonical_rpcs.sql` | wires asserts into 3 canonical RPCs |
| `supabase/migrations/20260510020000_add_party_org_boundary_helpers.sql` | new helpers |
| `handoff/local.md` | PR creation handoff update |
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
| server typecheck | PASS | cd server && npx tsc --noEmit |
| frontend typecheck | SKIP | not run yet |
| lint | SKIP | not run yet |
| test | PASS | 13/13 party-org boundary + 56/56 accountingRoute + all v2.2 evidence scripts |

---

## 8. Key Decisions

| Decision | Rationale |
| -------- | --------- |
| `docs/DESIGN_PHILOSOPHY.md` を作業前に参照 | 設計逸脱を防ぐため |

---

## 9. Risks / Blockers

- Production main has migration_history desync vs local files: remote 20260506094218/20260506094252 vs local 20260506093000/20260506094251 (same names, different timestamps). supabase db push 経由で本番適用するには migration repair が必要。
- Branch's supabase_migrations.schema_migrations does NOT contain the 20 v2.2 versions (Management API は schema_migrations を更新しない). Branch を main に merge しても本番には反映されない。Branch は validation 環境であって deployment vehicle ではない。
- Cleanup edits do not touch any SQL/RPC migration body. accounting v2.2 functional contract is unchanged from PR #9 commits 5f4e146/1ba7ab7/7dd194e.
- RETURNS SETOF is intentional — RETURNS public.proposal_executions would always set FOUND=TRUE on caller and break IF FOUND idempotency check; do not change to scalar return type.
- Migration history repair section warns against --include-all on supabase db push; it can re-execute already-applied migrations like 20260504084000_seed_accounting_master_data.sql.
---

## 10. References

- `docs/DESIGN_PHILOSOPHY.md` - 作業前に必ず参照
- `docs/AGENT_OPS.md` - セッション運用手順

---

## 11. Incremental Updates

> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260510_155039.md` at 2026-05-10 15:50:39 +0900.


> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260510_003504.md` at 2026-05-10 00:35:04 +0900.


> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260509_225216.md` at 2026-05-09 22:52:16 +0900.


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

### 2026-05-10 00:44:06 +0900

- Entry-ID: `H0033`
- Completed:
  - [x] v2.2 PR review package drafted. Added artifacts/accounting-v2.2/pr_review_package.md with draft PR title/body, evidence index, pre-remote go/no-go checklist, and explicit note that remote DB migration/push/migration repair are not executed.
- Remaining:
  - [ ] Next: after user approval, push codex/money-fix and open a draft PR using the review package. Do not run remote DB migration or migration repair without explicit approval.
- Changed Files:
  - `artifacts/accounting-v2.2/pr_review_package.md` - draft PR body, evidence index, and pre-remote checklist
- Working Context:
  - Auto-captured decision: v2.2 PR review package drafted. Added artifacts/accounting-v2.2/pr_review_package.md with draft PR title/body, evidence index, pre-remote go/no-go checklist, and explicit note t...
- Validation:
  - `git diff --check=pass; git status before package had clean branch; remote DB/push/PR not executed`
- Landmines:
  - PR body should mention remote DB migration not executed; do not include raw review package wrapper if manually copying only the PR body block.

### 2026-05-10 00:45:28 +0900

- Entry-ID: `H0034`
- Completed:
  - [x] Added clean PR body artifact for accounting v2.2 draft PR creation.
- Remaining:
  - [ ] Push codex/money-fix and create draft PR using artifacts/accounting-v2.2/pr_body.md. Remote DB migration remains blocked until explicit approval.
- Changed Files:
  - `artifacts/accounting-v2.2/pr_body.md` - clean draft PR body for GitHub
- Working Context:
  - Auto-captured decision: Added clean PR body artifact for accounting v2.2 draft PR creation.
- Validation:
  - `git diff --check=pass; gh auth status=authenticated; remote DB not used`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 00:45:57 +0900

- Entry-ID: `H0035`
- Completed:
  - [x] Pushed codex/money-fix and opened draft PR #9 for accounting v2.2. PR body uses artifacts/accounting-v2.2/pr_body.md and explicitly states remote DB migration/push/migration repair were not executed.
- Remaining:
  - [ ] Next: review PR #9 and wait for explicit approval before any remote DB migration or migration repair.
- Changed Files:
  - `handoff/local.md` - PR creation handoff update
- Working Context:
  - Auto-captured decision: Pushed codex/money-fix and opened draft PR #9 for accounting v2.2. PR body uses artifacts/accounting-v2.2/pr_body.md and explicitly states remote DB migration/push/migration rep...
- Validation:
  - `git push -u origin codex/money-fix=pass; gh pr create --draft=pass https://github.com/yuto-dayo/genba-quest/pull/9`
- Landmines:
  - PR/push completed, but remote DB migration remains unexecuted and must not be run without explicit approval.

### 2026-05-10 11:30:18 +0900

- Entry-ID: `H0036`
- Completed:
  - [x] v2.2 party/org boundary asserts wired into 3 canonical RPCs and validated. Added private.assert_customer_belongs_to_org and assert_member_belongs_to_org helpers, re-created rpc_post_accounting_expense_canonical / rpc_post_accounting_sale_canonical / rpc_record_accounting_payment_event_canonical to call the matching helper right after assert_rpc_active_membership. Caught and fixed two latent fixture bugs that passed user_id where membership_id was expected.
- Remaining:
  - [ ] Pick next remote-Go blocker: write rollback/repair plan for staging (#5) or capture clean local DB rebuild evidence (#4). Remote DB migration / push remain blocked until explicit approval.
- Changed Files:
  - `supabase/migrations/20260510020000_add_party_org_boundary_helpers.sql` - new helpers
  - `supabase/migrations/20260510020100_wire_party_org_boundary_to_canonical_rpcs.sql` - wires asserts into 3 canonical RPCs
  - `artifacts/accounting-v2.2/local_party_org_boundary_test.mjs` - SQL-level negative + wiring + grant evidence runner
  - `artifacts/accounting-v2.2/party_org_boundary_test.md` - evidence summary
  - `artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs` - fix latent claimant_member_id fixture bug
  - `artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs` - fix latent claimant_member_id fixture bug
- Working Context:
  - Auto-captured decision: v2.2 party/org boundary asserts wired into 3 canonical RPCs and validated. Added private.assert_customer_belongs_to_org and assert_member_belongs_to_org helpers, re-created rpc_...
- Validation:
  - `node artifacts/accounting-v2.2/local_party_org_boundary_test.mjs => 13/13 PASS`
  - `node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs => PASS`
  - `node artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs => PASS`
  - `node artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs => PASS`
  - `node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs => PASS`
  - `cd server && npm test -- accountingRoute.test.ts --runInBand => 56/56 PASS`
  - `cd server && npx tsc --noEmit => PASS`
  - `scripts/db/check-sql-boundaries.sh => PASS`
- Landmines:
  - Canonical RPCs now hard-fail on foreign customer/member ids; any future test that mocks party ids must use real org_memberships.id and clients.id rows or pass NULL.

### 2026-05-10 11:36:12 +0900

- Entry-ID: `H0037`
- Completed:
  - [x] v2.2 clean local DB rebuild証跡追加 + staging rollback/repair runbook 起草。supabase db reset --local で 34 migrations が clean に適用、その後 v2.2 evidence script 6本 + accountingRoute 56/56 が fresh DB で再現することを確認。docs/runbooks/accounting-v22-staging-rollback.md に pre-flight、4グループapply順、smoke、Class1/Class2 rollback、migration history repair、decision matrix を整備。pr_review_package.md の checklist 7項目を [x] 化。
- Remaining:
  - [ ] Pick next remote-Go blocker: #2 idempotency共通化 (assert_idempotency_replay helper化, 1h) または ここで一旦区切ってPRレビュー待ち。Remote DB migration / push remain blocked until explicit approval.
- Changed Files:
  - `artifacts/accounting-v2.2/clean_db_rebuild_test.md` - clean rebuild evidence with 34 migrations apply order and post-reset replay summary
  - `docs/runbooks/accounting-v22-staging-rollback.md` - new staging rollback/repair runbook (pre-flight, 4 apply groups, smoke, Class1/Class2 rollback, migration repair, decision matrix)
  - `artifacts/accounting-v2.2/pr_review_package.md` - checked off 7 satisfied pre-remote checklist items
- Working Context:
  - Auto-captured decision: v2.2 clean local DB rebuild証跡追加 + staging rollback/repair runbook 起草。supabase db reset --local で 34 migrations が clean に適用、その後 v2.2 evidence scri...
- Validation:
  - `supabase db reset --local => 34 migrations applied, 0 hard errors`
  - `node artifacts/accounting-v2.2/local_party_org_boundary_test.mjs => 13/13 PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs => PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs => PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs => PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs => PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs => PASS on fresh DB`
  - `cd server && npm test -- accountingRoute.test.ts --runInBand => 56/56 PASS`
- Landmines:
  - Storage workaround in 20260506043949_add_private_site_drawings.sql intentionally skips bucket/policy creation when local Storage metadata is unavailable; remote Supabase has Storage enabled and applies the full migration.
  - Migration history repair section warns against --include-all on supabase db push; it can re-execute already-applied migrations like 20260504084000_seed_accounting_master_data.sql.

### 2026-05-10 11:47:25 +0900

- Entry-ID: `H0038`
- Completed:
  - [x] v2.2 idempotency lookup helper を追加し canonical posting RPC 6本を再生成。private.find_idempotent_execution(uuid, text, text) returns SETOF public.proposal_executions で SELECT INTO + IF FOUND セマンティクスを温存。6 RPC全部が helper 経由に切り替わったことを pg_proc grep で確認。db reset --local で 36 migrations が clean に適用、v2.2 evidence script 6本 + accountingRoute 56/56 が再現。
- Remaining:
  - [ ] v2.2 ローカル作業はここで完結。残るは user explicitly approves remote DB migration のみ。Remote DB migration / push remain blocked until explicit approval.
- Changed Files:
  - `supabase/migrations/20260510020200_add_idempotency_lookup_helper.sql` - new private.find_idempotent_execution helper
  - `supabase/migrations/20260510020300_wire_idempotency_lookup_to_canonical_rpcs.sql` - swap inline lookup for helper call across 6 canonical RPCs
  - `artifacts/accounting-v2.2/idempotency_helper_test.md` - evidence artifact for #2
  - `artifacts/accounting-v2.2/pr_review_package.md` - record helper coverage and add new artifacts to evidence index
- Working Context:
  - Auto-captured decision: v2.2 idempotency lookup helper を追加し canonical posting RPC 6本を再生成。private.find_idempotent_execution(uuid, text, text) returns SETOF public.proposal_executions...
- Validation:
  - `supabase db reset --local => 36 migrations applied, 0 hard errors`
  - `node artifacts/accounting-v2.2/local_party_org_boundary_test.mjs => 13/13 PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs => PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs => PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs => PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs => PASS on fresh DB`
  - `node artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs => PASS on fresh DB`
  - `cd server && npm test -- accountingRoute.test.ts --runInBand => 56/56 PASS`
- Landmines:
  - RETURNS SETOF is intentional — RETURNS public.proposal_executions would always set FOUND=TRUE on caller and break IF FOUND idempotency check; do not change to scalar return type.

### 2026-05-10 15:50:39 +0900

- Entry-ID: `H0039`
- Completed:
  - [x] PR #9 pre-staging cleanup を完了。origin/master を codex/money-fix にマージし conflict (handoff/local.md) を解消。docs を 36 migrations / 20 v2.2 migrations 表記へ更新。runbook の Group D apply 順と Class 1 rollback list に 20260510020200/20260510020300 を追加。pr_review_package.md の stale Push 指示を削除し PR #9 既出表記に変更。invoice_transfer_canonical_test.md の trailing blank line を修正。supabase db reset --local で 36 migrations clean apply、v2.2 evidence script 6本 + accountingRoute 56/56 + tsc + sql guard + git diff --check 全部 PASS。
- Remaining:
  - [ ] PR #9 を Ready for Review に切り替え→レビュー受領→user explicit approval が出たタイミングで runbook 通りに staging adoption。Remote DB migration / push remain blocked until explicit approval.
- Changed Files:
  - `handoff/local.md` - resolved L0/L1/L2 merge conflicts; combined accounting v2.2 H0036-H0038 with master philosophy/skill H0003-H0007
  - `artifacts/accounting-v2.2/clean_db_rebuild_test.md` - 34->36 migrations and add 20260510020200/20260510020300 entries
  - `artifacts/accounting-v2.2/pr_review_package.md` - 34->36, replace Suggested Next Step with Status section pointing at PR #9 and runbook
  - `docs/runbooks/accounting-v22-staging-rollback.md` - 18->20 migrations, expand Group D to 5 migrations with idempotency helper checkpoint, expand Class 1 list and rollback fast-path
  - `artifacts/accounting-v2.2/invoice_transfer_canonical_test.md` - trim trailing blank line
- Working Context:
  - Auto-captured decision: PR #9 pre-staging cleanup を完了。origin/master を codex/money-fix にマージし conflict (handoff/local.md) を解消。docs を 36 migrations / 20 v2.2 migrations 表�...
- Validation:
  - `git merge origin/master => conflict in handoff/local.md only, resolved`
  - `supabase db reset --local => 36 migrations applied, 0 hard errors`
  - `node artifacts/accounting-v2.2/local_party_org_boundary_test.mjs => 13/13 PASS`
  - `node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs => PASS`
  - `node artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs => PASS`
  - `node artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs => PASS`
  - `node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs => PASS`
  - `node artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs => PASS`
  - `cd server && npm test -- accountingRoute.test.ts --runInBand => 56/56 PASS`
  - `cd server && npx tsc --noEmit => PASS`
  - `scripts/db/check-sql-boundaries.sh => PASS`
  - `git diff --check => clean`
- Landmines:
  - Cleanup edits do not touch any SQL/RPC migration body. accounting v2.2 functional contract is unchanged from PR #9 commits 5f4e146/1ba7ab7/7dd194e.

### 2026-05-10 16:13:53 +0900

- Entry-ID: `H0040`
- Completed:
  - [x] Supabase Branch (v22-staging) を作成して 20本の v2.2 migration を適用・検証完了。Production DB は未変更。supabase CLI db push が migration_history 時刻ドリフト (DB_BASELINE_REVIEW.md:159 の accept_org_invite トラップ) でブロックされたため Management API SQL endpoint で SQL 直接適用に切替。20/20 OK、4 group checkpoint PASS、6 canonical RPC 全てで anon/authenticated EXECUTE = false / service_role = true、Security advisor WARN -5 (complete_site_rpc / reverse_site_completion_rpc の anon+authenticated execute が v2.2 で revoke 済み)、Performance WARN ±0、新規 INFO 1件 (accounting_write_idempotency_keys の rls_enabled_no_policy、service_role-only なので intentional)。
- Remaining:
  - [ ] Decision: production 適用方法を3択から選ぶ。(a) production 側で migration_history desync を repair 後 supabase db push (b) Management API で SQL 直接適用 (history 不揃い残る) (c) いったん延期し review/data backup 強化。どれを取るかは user explicit approval。Remote DB migration / push remain blocked until explicit approval.
- Changed Files:
  - `artifacts/accounting-v2.2/branch_validation_test.md` - branch apply + checkpoint + advisor diff evidence
- Working Context:
  - Auto-captured decision: Supabase Branch (v22-staging) を作成して 20本の v2.2 migration を適用・検証完了。Production DB は未変更。supabase CLI db push が migration_history 時刻�...
- Validation:
  - `20/20 v2.2 migrations applied to branch via Management API SQL endpoint => 0 hard errors`
  - `Group A/B/C/D checkpoints => 4/4 PASS`
  - `function_privilege check on 6 canonical RPCs => anon=false, auth=false, service_role=true`
  - `security advisor diff => -5 WARN, +1 INFO (intentional)`
  - `performance advisor diff => 0 WARN delta`
- Landmines:
  - Branch's supabase_migrations.schema_migrations does NOT contain the 20 v2.2 versions (Management API は schema_migrations を更新しない). Branch を main に merge しても本番には反映されない。Branch は validation 環境であって deployment vehicle ではない。
  - Production main has migration_history desync vs local files: remote 20260506094218/20260506094252 vs local 20260506093000/20260506094251 (same names, different timestamps). supabase db push 経由で本番適用するには migration repair が必要。

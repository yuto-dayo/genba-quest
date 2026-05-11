# Project Handoff Profile / Domain Index - 2026-05-11

## Active Domains

| Domain | File | Last Updated | Status |
| ------ | ---- | ------------ | ------ |
| deploy/production | `handoff/deploy/production.md` | 2026-05-07 | Open production /money in browser if visual smoke is needed |
| local | `handoff/local.md` | 2026-05-10 | User selected option (a): production migration repair + s... |
| server | `handoff/server.md` | 2026-05-11 | active |

## Domain Selection Guide

- Standard local profile: `--profile local` -> `handoff/local.md`
- Standard production profile: `--profile production` -> `handoff/deploy/production.md`
- Server work (API, DB, SQL, services): `handoff/server.md`
- Frontend shared work (routing/design system): `handoff/frontend.md`
- Frontend page scope: `--domain frontend/today` -> `handoff/frontend/today.md`
- Server feature scope: `--domain server/proposals` -> `handoff/server/proposals.md`
- Integration scope: `--domain integration/gmail` -> `handoff/integration/gmail.md`
- Active session details: see `.session/active_session`
- Legacy single-file mode: omit both `--profile` and `--domain` to write `HANDOFF.md`

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `PR #8 を GitHub PR 化、必要なら PR #6/#7 のレビュー反映`. Source: realtime
- [H0048] Completed: PR #8: 月次推移グラフ追加 (GET /accounting/pl/trend + MonthlyTrendChart 縦棒、黒字緑/赤字赤、零線とスケールヒント、タップで月切替)
- [H0048] Remaining: PR #8 を GitHub PR 化、必要なら PR #6/#7 のレビュー反映
- [H0047] Completed: VendorCard lint 修正再適用 (cherry-pick skip で失われた分)
- [H0047] Remaining: force-push + PR #25 merge
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0048] Auto-captured decision: PR #8: 月次推移グラフ追加 (GET /accounting/pl/trend + MonthlyTrendChart 縦棒、黒字緑/赤字赤、零線とスケールヒント、タップで月切替)
- [H0047] Auto-captured decision: VendorCard lint 修正再適用 (cherry-pick skip で失われた分)
- [H0046] Auto-captured decision: cherry-pick commit 3 (v3.3 mock 準拠) 適用中
- [H0045] Auto-captured decision: cherry-pick 進行: HANDOFF conflict 再 resolve
- [H0044] Auto-captured decision: PR #1-#3 rollup マージ完了 (PR #26)、PR #25 を master 起点でクリーンに再構築中
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0048] No new landmines reported in this chunk.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0048] PR #8 を GitHub PR 化、必要なら PR #6/#7 のレビュー反映
- [H0047] force-push + PR #25 merge
- [H0046] 残り commit 4 (lint fix)
- [H0045] 残コミット適用
- [H0044] PR #5 4 commit cherry-pick 続行 → push → merge
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `12`
- last_compacted_at: `2026-05-11 19:19:06 +0900`
- archived_entries: `36`
<!-- HANDOFF_L2_STATE_END -->

---

## 11. Incremental Updates

> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260511_191906.md` at 2026-05-11 19:19:06 +0900.


> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260511_152459.md` at 2026-05-11 15:24:59 +0900.


> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260511_074456.md` at 2026-05-11 07:44:56 +0900.


> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260511_055412.md` at 2026-05-11 05:54:12 +0900.


## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- (no events recorded yet)
<!-- HANDOFF_SESSION_EVENTS_END -->

### 2026-05-11 15:01:16 +0900

- Entry-ID: `H0037`
- Completed:
  - [x] PR #1 締め払い基盤: client_billing_rules + billing_periods + BillingPeriodService 純関数群
- Remaining:
  - [ ] PR #2 取引先設定UI (Settings配下、ルール変更フロー + 履歴表示)
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: PR #1 締め払い基盤: client_billing_rules + billing_periods + BillingPeriodService 純関数群
- Validation:
  - `BillingPeriodService 35テスト全パス、tsc --noEmit クリーン、回帰なし`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 15:14:32 +0900

- Entry-ID: `H0038`
- Completed:
  - [x] PR #2 取引先設定UI: BillingRulesService + 3 routes + BillingRuleEditor/Section in ClientSettingsModal
- Remaining:
  - [ ] PR #3 承認担当ランダム割当 + 全員承認モード (proposals+policy拡張)
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: PR #2 取引先設定UI: BillingRulesService + 3 routes + BillingRuleEditor/Section in ClientSettingsModal
- Validation:
  - `BillingRulesService validateRule 16テスト追加全パス、両側 tsc クリーン、回帰なし`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 15:24:59 +0900

- Entry-ID: `H0039`
- Completed:
  - [x] PR #3 承認担当ランダム割当 + 全員承認DB基盤 + assigned-to-me API + reassign API + submit時自動割当
- Remaining:
  - [ ] PR #4 Money ヒーロー再設計 + ベルドロワー (フロント)
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: PR #3 承認担当ランダム割当 + 全員承認DB基盤 + assigned-to-me API + reassign API + submit時自動割当
- Validation:
  - `ProposalAssignmentService 10テスト全パス、tsc クリーン、submit hook は失敗しても落ちない設計`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 15:42:07 +0900

- Entry-ID: `H0040`
- Completed:
  - [x] PR #4 Money ヒーロー再設計: AnimatedYen + MoneyHero + 赤字色クロスフェード + 月切替、motionトークン基盤
- Remaining:
  - [ ] PR #5 ベルドロワー (NotificationInbox 拡張: 自分宛承認 + reassign)
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: PR #4 Money ヒーロー再設計: AnimatedYen + MoneyHero + 赤字色クロスフェード + 月切替、motionトークン基盤
- Validation:
  - `Money 4テスト全パス、frontend tsc クリーン、framer-motion テストモック拡張 (useReducedMotion等)`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 15:48:48 +0900

- Entry-ID: `H0041`
- Completed:
  - [x] PR #1-#4 連続マージ準備完了: 締め払い基盤+UI / 承認ランダム割当 / Money ヒーロー再設計 + モーション基盤
- Remaining:
  - [ ] 次セッション: PR #6 (タブ+フィルタシート+取引先タブ) を推奨 / PR #5 ベルドロワーは PR #3 API 完成済みなので並行可
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: PR #1-#4 連続マージ準備完了: 締め払い基盤+UI / 承認ランダム割当 / Money ヒーロー再設計 + モーション基盤
- Validation:
  - `累計テスト 71 全パス、PR #1-#4 全てスタック構造で正常 push 済み (PR #20→#21→#22→#23)`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 15:52:45 +0900

- Entry-ID: `H0042`
- Completed:
  - [x] セッション終了補足: 次セッション番号 #5 (タブ+フィルタシート+取引先タブ)、起点ブランチは feat/money-hero-redesign
- Remaining:
  - [ ] PR #5/8: git checkout -b feat/money-tabs-filter-sheet origin/feat/money-hero-redesign で開始
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: セッション終了補足: 次セッション番号 #5 (タブ+フィルタシート+取引先タブ)、起点ブランチは feat/money-hero-redesign
- Validation:
  - `PR #1-#4 (open: #20-#23) はスタック構造、master 起点は不可 (未マージ分が消える)`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 17:54:47 +0900

- Entry-ID: `H0043`
- Completed:
  - [x] PR #23 (feat/money-hero-redesign) の ESLint failure を fix: ChevronLeft / PLMetric / formatCurrency dead code 削除
- Remaining:
  - [ ] push して CI 通過 → PR #23 merge → PR #25 merge
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: PR #23 (feat/money-hero-redesign) の ESLint failure を fix: ChevronLeft / PLMetric / formatCurrency dead code 削除
- Validation:
  - `npx eslint src/pages/Money.tsx: 0 errors`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 18:04:16 +0900

- Entry-ID: `H0044`
- Completed:
  - [x] PR #1-#3 rollup マージ完了 (PR #26)、PR #25 を master 起点でクリーンに再構築中
- Remaining:
  - [ ] PR #5 4 commit cherry-pick 続行 → push → merge
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: PR #1-#3 rollup マージ完了 (PR #26)、PR #25 を master 起点でクリーンに再構築中
- Validation:
  - `rollup merge 確認、cherry-pick 進行中`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 18:04:40 +0900

- Entry-ID: `H0045`
- Completed:
  - [x] cherry-pick 進行: HANDOFF conflict 再 resolve
- Remaining:
  - [ ] 残コミット適用
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: cherry-pick 進行: HANDOFF conflict 再 resolve
- Validation:
  - `in-progress`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 18:05:23 +0900

- Entry-ID: `H0046`
- Completed:
  - [x] cherry-pick commit 3 (v3.3 mock 準拠) 適用中
- Remaining:
  - [ ] 残り commit 4 (lint fix)
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: cherry-pick commit 3 (v3.3 mock 準拠) 適用中
- Validation:
  - `pending`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 18:09:09 +0900

- Entry-ID: `H0047`
- Completed:
  - [x] VendorCard lint 修正再適用 (cherry-pick skip で失われた分)
- Remaining:
  - [ ] force-push + PR #25 merge
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: VendorCard lint 修正再適用 (cherry-pick skip で失われた分)
- Validation:
  - `eslint 0 / tsc 0`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 19:19:06 +0900

- Entry-ID: `H0048`
- Completed:
  - [x] PR #8: 月次推移グラフ追加 (GET /accounting/pl/trend + MonthlyTrendChart 縦棒、黒字緑/赤字赤、零線とスケールヒント、タップで月切替)
- Remaining:
  - [ ] PR #8 を GitHub PR 化、必要なら PR #6/#7 のレビュー反映
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: PR #8: 月次推移グラフ追加 (GET /accounting/pl/trend + MonthlyTrendChart 縦棒、黒字緑/赤字赤、零線とスケールヒント、タップで月切替)
- Validation:
  - `server tsc OK / frontend tsc + eslint OK / 6 バー + 零線 + 選択月ハイライト + 月ラベルを preview で確認 (mock データでも検証)`
- Landmines:
  - No new landmines reported in this chunk.

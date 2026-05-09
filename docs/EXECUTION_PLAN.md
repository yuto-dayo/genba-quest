# GENBA QUEST 実行計画（Single Source of Truth）

最終更新: 2026-02-18（進捗率は次回オーナーレビュー要 — PATH governance / MonthClose / Communications / Invoice flow が並行進行中だが本計画には未反映）

このドキュメントは「今どこまで実装されたか」と「次に何を実装するか」を一箇所で管理するための正本です。

> **Phase A-0/A-1/B/C/D の位置付け**: 本計画では実装トラッキング用のタクティカル呼称として継続使用する。**思想・不変条件レベルの正本は `docs/DESIGN_PHILOSOPHY.md` 「実装フェーズ（並行進行中の現実）」セクション**（達成済み不変条件 / 進行中 / 守りたい次の不変条件 / 未着手 の4バケットモデル）。両者は別軸として併用する。

---

## 1. 使い方（運用ルール）

- 長期構想は `docs/EVOLUTION_ROADMAP.md` を参照する
- 日々の実行計画と進捗はこのファイルだけを更新する
- セッションごとの詳細ログは `HANDOFF.md` に残す
- Phase A-D に分類しにくい並行領域（PATH governance / MonthClose / Communications / Invoice flow）は §3.5 を参照

---

## 2. フェーズ進捗ダッシュボード

| Phase | 目的 | 状態 | 進捗 |
|---|---|---|---|
| A-0 | Proposal/ledgerのMVP基盤 | 完了 | 100% |
| A-1 | 承認フローの原子性・ポリシー運用 | 進行中 | 92% |
| B | Sherpa統合 + AI制約運用 | 一部着手 | 45% |
| C | UI刷新（Today/Calendar/Sites/Money） | 一部着手 | 45% |
| D | 高度機能（委任・監査可視化等） | 未着手 | 0% |

---

## 3. 実装済み範囲（可視化）

### A-0 MVP基盤（完了）

- `proposals` / `ledger_events` / `ledger_transactions` / `ledger_entries` テーブル
  - `supabase/migrations/011_proposals.sql`
- `ProposalService` CRUD/submit/approve/reject/execute 基本フロー
  - `server/src/services/ProposalService.ts`
- PolicyテーブルとPolicyEngineの基本評価
  - `supabase/migrations/012_policies.sql`
  - `server/src/services/PolicyEngine.ts`

### A-1 承認フロー（進行中）

- 原子関数（DBトランザクション境界）
  - `execute_proposal_atomic`: `supabase/migrations/013_execute_proposal_atomic.sql`
  - `approve_proposal_atomic`: `supabase/migrations/014_approve_proposal_atomic.sql`
  - `reject_proposal_atomic`: `supabase/migrations/015_reject_proposal_atomic.sql`
  - `pending` 用語統一 + 関数更新: `supabase/migrations/016_pending_status_unification.sql`
  - `assignment.create` の atomic副作用反映: `supabase/migrations/017_execute_atomic_assignment_side_effects.sql`
  - reward canonical guard: `supabase/migrations/054_canonical_reward_guards.sql`
  - explicit event type alignment (`assignment.update` / `assignment.cancel`): `supabase/migrations/055_execute_proposal_explicit_event_types.sql`
- stg/prod 適用Runbook（順序・検証項目を標準化）
  - `docs/DB_MIGRATION_RUNBOOK_A1.md`
- 適用後の自動検証スクリプト
  - `server/src/scripts/verify-a1-migration.ts`
  - `server/src/scripts/verify-a1-health.ts`
  - `verify-a1-migration` は assignment.create / leave.request の atomic 副作用に加え、055 explicit event type と 021で削除した legacy 関数の残存も確認
- サービス層はRPC優先 + フォールバック構成
  - `server/src/services/ProposalService.ts`
- フォールバック削減方針を feature flag 化
  - `PROPOSAL_RPC_FALLBACK_MODE=disabled` で atomic RPC 必須（`ATOMIC_RPC_REQUIRED`）
  - `server/src/services/ProposalService.ts`
  - `server/src/routes/proposals.ts`
- APIエラーハンドリング統一（mapped error + code返却）
  - `server/src/routes/proposals.ts`
- 統合テスト整備（DB統合）
  - `server/src/__tests__/integration/executeProposalAtomic.integration.test.ts`
  - `server/src/__tests__/integration/executeProposalAtomicLeaveRequest.integration.test.ts`
  - `server/src/__tests__/integration/approveProposalAtomic.integration.test.ts`
  - `server/src/__tests__/integration/rejectProposalAtomic.integration.test.ts`
  - `server/src/__tests__/integration/proposalsApi.integration.test.ts`
- CI常設ゲート（Typecheck/Lint + DB統合テスト）
  - `.github/workflows/server-ci.yml`
  - `db-integration` は `PROPOSAL_RPC_FALLBACK_MODE=disabled` で実行
  - `db-integration` 後に `npm run verify:a1-migration` を実行

### B Sherpa統合（一部着手）

- AI提案テーブルとRLS
  - `supabase/migrations/010_ai_proposals.sql`
- Sherpa APIルート存在
  - `server/src/routes/sherpa.ts`
- Sherpa -> Proposal 作成API（AI actor固定、submit切替）
  - `POST /api/v1/sherpa/proposals`
  - `server/src/routes/sherpa.ts`
- integration actor Proposal取込（Gmail webhook, 冪等化）
  - `server/src/routes/webhooks.ts`
  - `server/src/routes/proposals.ts` (`/api/v1/proposals/integration`)
- Gmail webhook 手動E2E runbook / 検証スクリプト
  - `docs/GMAIL_WEBHOOK_PENDING_QUEUE_MANUAL_E2E.md`
  - `server/src/scripts/verify-gmail-manual-e2e.ts`
- AI自己承認禁止ゲート（サービス + SQL）
  - `server/src/services/PolicyEngine.ts`
  - `supabase/migrations/014_approve_proposal_atomic.sql`

### C UI刷新（一部着手）

- 4画面の骨格ファイルは存在
  - `frontend/src/pages/Today.tsx`
  - `frontend/src/pages/Calendar.tsx`
  - `frontend/src/pages/Sites.tsx`
  - `frontend/src/pages/Money.tsx`
- 承認カード/FAB/Sherpaチャット部品
  - `frontend/src/components/ApprovalCard.tsx`
  - `frontend/src/components/FloatingActionButton.tsx`
  - `frontend/src/components/SherpaChat.tsx`
- 現場シミュレーターのアーキテクチャ計画を策定
  - `docs/PHASE_C_ASSIGNMENT_SIMULATOR_ARCHITECTURE.md`

### 3.5 並行進行中の領域（Phase A-D に収まらない）

これらは Phase A-D の線形配列に当てはまらず、複数Phase をまたいで稼働している。実装の正本は `server/src/services/` 配下と `docs/DESIGN_PHILOSOPHY.md` の「ドメイン構成」を参照。

- **PATH governance V3.1 / V3.2** — 多Proposal集約決定、月次分配・skill認定・reward pool調整
  - `server/src/services/PathV31Service.ts` / `PathV32SimpleRewardService.ts`
  - `DeterministicPathReviewer.ts` / `PathPolicyBundleService.ts`
  - 関連event: `path.site_close.finalized` / `path.skill_certification.decided` / `path.reward_run.approved` / `path.monthly_distribution.finalized`
- **Month Close** — closed period の不可侵性、`month_closes` テーブル
  - `site.close.finalize` / `site.close.reopen` Proposal type
  - `server/src/services/SiteCompleteWithCloseService.ts`
- **Communication ドメイン** — 顧客接点の review/task ループ
  - `communication.review` / `communication.task` Proposal type
  - `frontend/src/pages/Communications.tsx`
  - `server/src/services/communication-contact-read-model.ts`
- **Invoice flow（請求漏れゼロ MVPアウトカム直結）** — 発行/送付/入金確認
  - `invoice.create` / `invoice.send` / `invoice.mark_paid` Proposal type
  - `server/src/services/InvoiceEligibilityService.ts` / `InvoiceLineItemsService.ts` / `InvoicePdfService.ts`
  - `frontend/src/components/InvoiceModal.tsx`
- **LUQO** — `luqo.reward.calculate`（独自報酬DSL、reward.calculate と並列）

---

## 4. 残タスク（完成まで）

## M1: A-1クローズ（最優先）

1. 全環境へ `013/014/015/016/017/054/055` の適用手順を標準化（stg/prod）
   - Runbook作成済み: `docs/DB_MIGRATION_RUNBOOK_A1.md`
   - 残: stg/prod 実環境への適用実施と記録
2. `ProposalService` のフォールバック削減方針を段階適用（stg→prodで `PROPOSAL_RPC_FALLBACK_MODE=disabled` を有効化）
3. `pending` 用語統一のフロント側反映（UI/APIクライアント）を完了 ✅
4. CI用シークレット（`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`）を設定し、DB統合ゲートを本番運用化

完了条件:
- Proposalライフサイクルが全環境で同一挙動
- 原子関数が正式経路として運用固定

## M2: B強化（Sherpa実運用）

1. Sherpa → Proposal作成フローを正式化
2. integration actor（Gmail等）からProposal連携を標準化
   - Webhook実装は `proposals` 連携へ移行済み。Runbook整備済み。
   - 残: 手動E2Eの approve/reject 証跡取得と DB 検証ログ添付
3. AI提案の人間承認フローをUI/APIで閉じる

## M3: C仕上げ（現場UX）

1. Today/Calendar/Sites/MoneyをProposal read modelに統一接続
2. 承認待ち一覧→詳細→承認/却下のワンタップ導線を完了
3. リアルタイム更新の反映基準を決めて実装
4. 現場シミュレーター実装を以下の順で実施
   - C1: Read Model/API土台
   - C2: Drag&DropシミュレーターUI
   - C3: Commit→Proposal化（override対応）
   - C4: Ledger/月次報酬Proposal連携
   - C5: E2E/運用Runbook/監視整備

## M4: D着手（高度機能）

1. 複数承認者ワークフロー高度化（委任含む）
2. 監査ログビューア（Proposal/Event起点）実装
3. 予算超過・ポリシー違反アラートを追加

## M5: MVPアウトカム計測（最優先 — Phase 横断）

`docs/DESIGN_PHILOSOPHY.md` で MVPアウトカムを「請求漏れゼロ + 黒字可視化」と明示済み。これを計測可能にする実装は Phase A-D の線形に乗らないため、独立Milestoneとして追跡する。

1. **請求漏れゼロ計測** — 完了現場と未請求残の乖離を Money画面ダッシュボードで常時可視化
2. **黒字可視化計測** — 現場別利益 / 月次PL を Money画面で1タップ参照可能に
3. **closed month Guard の UI 側完備** — 既存API資産を活かし UI 側から書き換え禁止を物理化
4. **Sherpa output 透明性の徹底**（Calm Cockpit #5）— 全AI出力に Proposal/根拠/影響/承認パスを必須化

---

## 5. 直近2スプリント実行計画

### Sprint N（A-1クローズ）

1. DB migration runbook（stg/prod）作成 ✅
2. CI統合テストゲート化
3. status用語統一PR（`proposed` vs `pending`）

### Sprint N+1（B/C接続）

1. Sherpa提案→承認→実行のE2Eシナリオ実装
2. Money/Todayで承認待ちUIを本番データ接続
3. 監査用最小ダッシュボード（Proposal/Eventリスト）追加

---

## 6. 更新ルール

- 実装したら「3.実装済み範囲」を更新
- 新しく決まった優先タスクは「4.残タスク」を更新
- 2週間ごとに進捗率を見直す
- 詳細経緯は `HANDOFF.md` に残し、このファイルは常に要約状態を保つ

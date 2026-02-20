# GENBA QUEST 実行計画（Single Source of Truth）

最終更新: 2026-02-18

このドキュメントは「今どこまで実装されたか」と「次に何を実装するか」を一箇所で管理するための正本です。

---

## 1. 使い方（運用ルール）

- 長期構想は `docs/EVOLUTION_ROADMAP.md` を参照する
- 日々の実行計画と進捗はこのファイルだけを更新する
- セッションごとの詳細ログは `HANDOFF.md` に残す

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
  - `server/sql/011_proposals.sql`
- `ProposalService` CRUD/submit/approve/reject/execute 基本フロー
  - `server/src/services/ProposalService.ts`
- PolicyテーブルとPolicyEngineの基本評価
  - `server/sql/012_policies.sql`
  - `server/src/services/PolicyEngine.ts`

### A-1 承認フロー（進行中）

- 原子関数（DBトランザクション境界）
  - `execute_proposal_atomic`: `server/sql/013_execute_proposal_atomic.sql`
  - `approve_proposal_atomic`: `server/sql/014_approve_proposal_atomic.sql`
  - `reject_proposal_atomic`: `server/sql/015_reject_proposal_atomic.sql`
  - `pending` 用語統一 + 関数更新: `server/sql/016_pending_status_unification.sql`
  - `assignment.create` の atomic副作用反映: `server/sql/017_execute_atomic_assignment_side_effects.sql`
- stg/prod 適用Runbook（順序・検証項目を標準化）
  - `docs/DB_MIGRATION_RUNBOOK_A1.md`
- 適用後の自動検証スクリプト
  - `server/src/scripts/verify-a1-migration.ts`
  - `server/src/scripts/verify-a1-health.ts`
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
  - `server/src/__tests__/integration/approveProposalAtomic.integration.test.ts`
  - `server/src/__tests__/integration/rejectProposalAtomic.integration.test.ts`
  - `server/src/__tests__/integration/proposalsApi.integration.test.ts`
- CI常設ゲート（Typecheck/Lint + DB統合テスト）
  - `.github/workflows/server-ci.yml`
  - `db-integration` は `PROPOSAL_RPC_FALLBACK_MODE=disabled` で実行
  - `db-integration` 後に `npm run verify:a1-migration` を実行

### B Sherpa統合（一部着手）

- AI提案テーブルとRLS
  - `server/sql/010_ai_proposals.sql`
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
  - `server/sql/014_approve_proposal_atomic.sql`

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

---

## 4. 残タスク（完成まで）

## M1: A-1クローズ（最優先）

1. 全環境へ `013/014/015/016/017` の適用手順を標準化（stg/prod）
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

## M4: D着手（高度機能）

1. 複数承認者ワークフロー高度化（委任含む）
2. 監査ログビューア（Proposal/Event起点）実装
3. 予算超過・ポリシー違反アラートを追加

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

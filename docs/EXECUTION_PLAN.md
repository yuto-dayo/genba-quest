# GENBA QUEST 実行計画（Single Source of Truth）

最終更新: 2026-02-17

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
| A-1 | 承認フローの原子性・ポリシー運用 | 進行中 | 85% |
| B | Sherpa統合 + AI制約運用 | 一部着手 | 35% |
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
- サービス層はRPC優先 + フォールバック構成
  - `server/src/services/ProposalService.ts`
- APIエラーハンドリング統一（mapped error + code返却）
  - `server/src/routes/proposals.ts`
- 統合テスト整備（DB統合）
  - `server/src/__tests__/integration/executeProposalAtomic.integration.test.ts`
  - `server/src/__tests__/integration/approveProposalAtomic.integration.test.ts`
  - `server/src/__tests__/integration/rejectProposalAtomic.integration.test.ts`
  - `server/src/__tests__/integration/proposalsApi.integration.test.ts`

### B Sherpa統合（一部着手）

- AI提案テーブルとRLS
  - `server/sql/010_ai_proposals.sql`
- Sherpa APIルート存在
  - `server/src/routes/sherpa.ts`
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

1. 全環境へ `013/014/015` の適用手順を標準化（stg/prod）
2. `ProposalService` のフォールバック削減方針を決定（完全移行条件を明記）
3. `proposed` / `pending` の用語統一方針を確定（DB・API・UIで揃える）
4. CIでDB統合テスト（`npm run test:integration`）を常設ゲート化

完了条件:
- Proposalライフサイクルが全環境で同一挙動
- 原子関数が正式経路として運用固定

## M2: B強化（Sherpa実運用）

1. Sherpa → Proposal作成フローを正式化
2. integration actor（Gmail等）からProposal連携を標準化
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

1. DB migration runbook（stg/prod）作成
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


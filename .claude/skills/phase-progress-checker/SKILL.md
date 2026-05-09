---
name: phase-progress-checker
description: GENBA QUEST 実装進捗の確認と次の一手提案。達成済み不変条件 / 進行中 / 守りたい次の不変条件 / 未着手 を philosophy に沿って点検し、優先度順アクションを返す。「今どこまで進んだ？」「次は何を優先すべき？」に答える。
---

# Implementation Progress Checker

GENBA QUEST の実装進捗を、`docs/DESIGN_PHILOSOPHY.md` の「実装フェーズ（並行進行中の現実）」フレームで点検する。
旧Phase A-0/A-1/B/C/D は線形ロードマップとして廃止済み。本スキルは **不変条件4層** で現在地を記述する。

## 使用タイミング

- スプリント計画時
- 「DAO実装どこまで進んでる？」「今どこ？」と聞かれた時
- 「次に何を優先すべき？」と聞かれた時
- philosophy doc 更新後の整合確認

## 4 層フレーム

### 1. 達成済み不変条件（Locked-in）

回帰させてはいけない条件。コードレビューでもチェック対象。

**検証コマンド:**
```bash
# proposals テーブル起点
Grep: "CREATE TABLE.*proposals" path="supabase/migrations"

# Policy評価が承認APIの最終ゲート
Grep: "PolicyEngine|canApprove" path="server/src/services"

# Actor区別（human/ai/integration/system）
Grep: "ActorRef|actor\.type|created_by\.type" path="server/src"

# AI自己承認禁止ゲート
Grep: "AI_SELF_APPROVAL|self.?approval" path="server/src" -i

# pending含む承認フロー稼働
Grep: "status.*pending|status.*approved|status.*executed" path="server/src/routes"

# LedgerEvent / Transaction / Entry のダブルエントリー
Grep: "ledger_events|ledger_transactions|ledger_entries" path="supabase/migrations"

# トランザクション境界（RPC）
Grep: "approve_proposal_atomic|execute_proposal_atomic" path="supabase/migrations"

# Sherpa Chat 稼働
Glob: "**/SherpaChat*.tsx" path="frontend/src"
Glob: "**/FloatingActionButton*.tsx" path="frontend/src/components"

# PATH governance V3.1/V3.2
Glob: "**/PathV3*Service.ts" path="server/src/services"

# MonthClose テーブル
Grep: "CREATE TABLE.*month_closes|month_closes" path="supabase/migrations"
```

### 2. 進行中（In flight）

実装中。完成度はバラつくため、画面/機能単位で進捗を確認する。

**検証コマンド:**
```bash
# Inline Suggestion / 育つフォーム
Grep: "InlineSuggestion|suggestion|prefill" path="frontend/src" -i

# Calm Cockpit 5原則の適用
Grep: "Calm Cockpit|Decision-first|Direct.*Sherpa" path="design-system"

# Invoice flow（請求漏れゼロMVPに直結）
Glob: "**/InvoiceModal*.tsx" path="frontend/src/components"
Grep: "invoice\.create|invoice\.send|invoice\.mark_paid" path="server/src/services"

# Communication review/task ループ
Glob: "**/Communications*.tsx" path="frontend/src/pages"
Grep: "communication\.review|communication\.task" path="server/src/services"

# PATH governance Read Model
Glob: "**/PathRewardAnalysis*.ts" path="server/src/services"
Glob: "**/PathRewardConfirmation*.tsx" path="frontend/src/pages"
```

### 3. 守りたい次の不変条件（Next gates）

完了したら Locked-in に昇格。MVPアウトカム達成のために最優先。

**検証コマンド:**
```bash
# 請求漏れゼロ計測（完了現場と未請求残の乖離可視化）
Grep: "unbilled|missing_invoice|invoice.*gap" path="frontend/src" -i
# → ヒット0件なら未着手

# 黒字可視化計測（現場別利益・月次PL）
Grep: "monthly_pl|site_profit|profit.*site" path="frontend/src" -i
# → ヒット0件なら未着手

# closed month の Guard（UI/API両側での書き換え拒否）
Grep: "isClosedMonth|month_close.*guard|MONTH_CLOSE_LOCKED" path="server/src"

# AI Suggestion の可逆性（無視/Undoがワンタップ）
Grep: "undoSuggestion|revertSuggestion|suggestion.*undo" path="frontend/src"

# Sherpa output の透明性（proposal_id/evidence/impact/approval path）
Grep: "evidence|impact|approval_path" path="server/src/services" glob="*Sherpa*"

# 本番運用ゲート
Glob: "**/runbooks/*" path="docs"
Grep: "alert|monitoring" path="docs/runbooks"
```

### 4. 未着手の高度化候補

優先度低。MVPアウトカム（請求漏れゼロ + 黒字可視化）に直結しないもの。

- AIによる自動承認の範囲拡大（閾値ベース → 文脈ベース）
- Policy Editor（ルール変更UI）
- 監査ダッシュボード
- 複数組織横断
- integration actor 本格運用（Gmail/銀行APIの自動化深掘り）

これらは検証コマンドではなく、Linear / GitHub Issues で別タスクとして追跡。

## 出力フォーマット

```markdown
## GENBA QUEST 実装進捗レポート

### 1. 達成済み不変条件（回帰NG）

- ✅ Proposal 中心の状態変更（`proposals` テーブル起点）
- ✅ Policy評価 = 承認APIの最終ゲート（`PolicyEngine`）
- ✅ Actor区別 4種（human/ai/integration/system）
- ✅ AI自己承認禁止ゲート（`canApprove` 二段構造）
- ✅ pending含む承認フロー稼働
- ✅ ダブルエントリー Ledger（events/transactions/entries）
- ✅ トランザクション境界（RPC `approve_proposal_atomic` 等）
- ✅ Sherpa Chat（FAB起動）
- ✅ PATH governance V3.1/V3.2
- ✅ MonthClose（`month_closes` テーブル）

### 2. 進行中（In flight）

| 項目 | Status | 備考 |
|------|--------|------|
| Invoice flow | 🔄 | InvoiceModal実装済、請求漏れ計測未 |
| Communication review/task | 🔄 | Communications.tsx 稼働中 |
| Inline Suggestion / 育つフォーム | 🔄 | ExpenseModal で部分実装 |
| PATH governance Read Model | 🔄 | PathRewardConfirmation で可視化中 |
| Calm Cockpit 5原則の全画面適用 | 🔄 | Today / Calendar 中心に進行 |

### 3. 守りたい次の不変条件（Next gates） — MVPアウトカム直結

| ゲート | Status | 次の一手 |
|-------|--------|---------|
| 請求漏れゼロ計測 | ❌ 未着手 | Money画面に未請求残ダッシュボード追加 |
| 黒字可視化計測 | ❌ 未着手 | 現場別利益 / 月次PL の1タップ参照 |
| closed month Guard | 🔄 部分 | UI側Guard追加、API側は実装済 |
| AI Suggestionの可逆性 | ❌ 未着手 | Undo / 無視の挙動を Suggestion 層に組み込み |
| Sherpa output 透明性 | 🔄 部分 | proposal_id/evidence は揃う、impact/approval pathが不揃い |
| 本番運用ゲート | 🔄 | 監視アラート連携・Runbook演習が要 |

### 推奨される次の一手（優先度順）

1. **請求漏れゼロ計測** の実装（MVPアウトカム #1 に直結、未着手）
2. **黒字可視化計測** の実装（MVPアウトカム #2 に直結、未着手）
3. **closed month Guard** の UI側実装完了（既存API資産を活かす）
4. **AI Suggestion の可逆性** 確立（Inline Suggestion 本実装の前提条件）

### ブロッカー

- なし（要確認: 本番運用ゲートのRunbook演習スケジュール）
```

## 使用例

**ユーザー:** 「DAO実装どこまで進んでる？」「次は何を優先すべき？」

**実行手順:**
1. 各層の検証コマンドを実行（並列OK）
2. 結果を4バケットに分類
3. MVPアウトカム（請求漏れゼロ / 黒字可視化）に最も近い未達成項目を「次の一手」として優先度順に並べる
4. 上記フォーマットで出力

## 関連スキル

- `genba-quest-dao-principles` — 不変条件の定義（コードレビュー時の根拠）
- `dao-impl-checker` — Proposalトランザクション・自己承認禁止の実装品質検証
- `directing-continuous-improvement` — ディレクター視点で「現在の形」を判断
- `incremental-handoff` — 進捗レポートを HANDOFF.md に追記

---
name: phase-progress-checker
description: DAO実装フェーズ（A-0, A-1, B, C, D）の進捗確認。各フェーズの完了条件チェックと次ステップ提案。
---

# Phase Progress Checker

DAO実装フェーズの進捗状況を確認し、次のアクションを提案します。

## 使用タイミング

- スプリント計画時
- 実装状況の確認時
- 「今どこまで進んでる？」と聞かれた時

## フェーズ定義

### Phase A-0: MVP基盤（ログ記録）

**完了条件:**
- [ ] `proposals` テーブル存在
- [ ] ProposalService CRUD実装
- [ ] 全状態変更がProposal経由でログ記録

**検証コマンド:**
```bash
# テーブル確認
Grep: "CREATE TABLE.*proposals" path="server/sql"

# Service確認
Grep: "class ProposalService|ProposalService" path="server/src"

# 直接DB操作の残存確認（0件が理想）
Grep: "\.update\(|\.insert\(" path="server/src/routes" --exclude="*proposal*"
```

### Phase A-1: 承認フロー

**完了条件:**
- [ ] PolicyEngine実装
- [ ] 承認ルール（金額閾値）動作
- [ ] 承認UI実装

**検証コマンド:**
```bash
# PolicyEngine確認
Grep: "PolicyEngine|getApprovalPolicy" path="server/src"

# 金額閾値定義
Grep: "5000|30000" path="server/src" glob="*policy*"

# 承認API
Grep: "approve|/proposals/.*/approve" path="server/src/routes"
```

### Phase B: Sherpa統合 + AI制約

**完了条件:**
- [ ] AI自己承認禁止ゲート実装
- [ ] SherpaからProposal生成
- [ ] AI提案→人間承認フロー
- [ ] Orchestrator + SubAgents アーキテクチャ実装
- [ ] 各SubAgentのskill.md定義
- [ ] integration actor（Gmail等）→ Proposal連携

**検証コマンド:**
```bash
# AI自己承認禁止
Grep: "AI_SELF_APPROVAL|自己承認禁止" path="server/src"

# Sherpa→Proposal連携
Grep: "sherpa.*proposal|proposal.*sherpa" path="server/src" -i

# Actor type チェック
Grep: "actor.type.*ai|created_by.type" path="server/src"

# Orchestrator/SubAgent構造
Grep: "Orchestrator|SubAgent|IntentRouter" path="server/src"

# skill.md定義
Glob: "**/skill.md" path="server/src"
```

### Phase C: UI刷新

**完了条件:**
- [ ] 4画面構成（Today / Calendar / Sites / Money）
- [ ] FAB Sherpaチャット
- [ ] 承認待ちリストUI
- [ ] 提案詳細モーダル
- [ ] ワンタップ承認/却下
- [ ] Direct Manipulation vs Conversational UI 原則の適用
- [ ] リアルタイム更新

**検証コマンド:**
```bash
# 4画面構成
Glob: "**/Today*.tsx" path="frontend/src/pages"
Glob: "**/Calendar*.tsx" path="frontend/src/pages"
Glob: "**/Sites*.tsx" path="frontend/src/pages"
Glob: "**/Money*.tsx" path="frontend/src/pages"

# FAB Sherpa
Grep: "FloatingAction|FAB|sherpa" path="frontend/src/components"

# 承認UI
Glob: "**/Approval*.tsx" path="frontend/src"

# Proposalコンポーネント
Grep: "proposal|Proposal" path="frontend/src/components"
```

### Phase D: 高度機能

**完了条件:**
- [ ] 複数承認者ワークフロー
- [ ] 承認委任機能
- [ ] 監査ログビューア
- [ ] 予算超過アラート

**検証コマンド:**
```bash
# 複数承認
Grep: "required_approvers|approval_count" path="server/src"

# 監査ログ
Grep: "audit|AuditLog" path="server/src"
```

## 出力フォーマット

```markdown
## DAO実装進捗レポート

### 現在のフェーズ: A-1（承認フロー）

| Phase | Status | Progress |
|-------|--------|----------|
| A-0 MVP基盤 | ✅ 完了 | 100% |
| A-1 承認フロー | 🔄 進行中 | 60% |
| B Sherpa統合 | ⏳ 未着手 | 0% |
| C UI刷新 | ⏳ 未着手 | 0% |
| D 高度機能 | ⏳ 未着手 | 0% |

### Phase A-1 詳細

| 項目 | Status | 備考 |
|------|--------|------|
| PolicyEngine | ✅ | server/src/services/PolicyEngine.ts |
| 金額閾値ルール | ✅ | 5000/30000円で動作確認済 |
| 承認API | 🔄 | POST /proposals/:id/approve 実装中 |
| 承認UI | ❌ | 未着手 |

### 次のアクション

1. 承認APIの完成（残り: レビュワー割当ロジック）
2. フロントエンド承認ボタン実装
3. E2Eテスト追加

### ブロッカー

- なし
```

## 使用例

**ユーザー:** 「DAO実装どこまで進んでる？」

**実行:**
1. 各フェーズの検証コマンドを実行
2. 結果を集計
3. 進捗レポート出力

## 関連スキル

- `genba-quest-dao-principles` - フェーズ定義の確認
- `dao-impl-checker` - 実装品質の検証
- `design-executor` - 次フェーズの実装計画

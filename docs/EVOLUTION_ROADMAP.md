# GENBA QUEST - 進化ロードマップ

> 実装状況と直近実行計画の正本は `docs/EXECUTION_PLAN.md` を参照してください。  
> 本ドキュメントは中長期の思想・到達像を定義します。

## 思想：自己進化するシステム

> 天才がやるのは「方向転換」じゃなくて、今の設計をさらに「小さく」「抽象化して」「自己進化可能にする」っていう"圧縮とブースト"

このドキュメントは、GENBA QUESTを「事故らないシステム」から「学習・進化するシステム」へ昇華させるロードマップを定義する。

---

## 現在地と目標

```text
現在地（Phase A）:
  ├── Proposal中心 ✓
  ├── Ledger追記のみ ✓
  ├── AI自己承認禁止 ✓
  └── Policy評価 ✓（ただしハードコード）

目標（Phase D以降）:
  ├── 1コア（Proposal + Event）
  ├── Policy DSLから全自動生成
  ├── Sandbox環境でルールA/Bテスト
  └── SherpaがPolicy改善を提案
```

---

## Phase 1: Policy DSL（ルールの一元化）

### 目的

**人間がルールを一箇所にしか書かない**

### 現状の問題

```typescript
// PolicyEngine.ts（今）
if (amount <= 5000) {
  return { autoApprove: true };
} else if (amount <= 30000) {
  return { requiredApprovers: 1, aiAllowed: true };
} else {
  return { requiredApprovers: 2, aiAllowed: false };
}
```

問題点:

- ルールがTypeScriptにハードコード
- DB制約と乖離する可能性
- テストケースと同期しない
- ドキュメントが古くなる

### 解決: Policy DSL

```yaml
# policies/expense.yaml
expense.create:
  rules:
    - name: auto_approve_small
      when:
        amount: "<= 5000"
      action:
        auto_approve: true

    - name: single_approval_medium
      when:
        amount: "> 5000 AND <= 30000"
      action:
        required_approvers: 1
        ai_allowed: true

    - name: dual_approval_large
      when:
        amount: "> 30000"
      action:
        required_approvers: 2
        ai_allowed: false
```

### 自動生成パイプライン

```text
policies/*.yaml
       │
       ▼
  ┌─────────────┐
  │ DSLコンパイラ │
  └─────────────┘
       │
       ├──▶ server/src/generated/PolicyRules.ts（TypeScript判定関数）
       ├──▶ server/sql/generated/policy_checks.sql（CHECK制約）
       ├──▶ server/tests/generated/policy.test.ts（テストケース）
       └──▶ docs/generated/POLICY_RULES.md（ドキュメント）
```

### 実装ステップ

1. YAML → TypeScript のコンパイラ作成
2. 既存ルールをYAMLに移行
3. CI/CDでコンパイル自動実行
4. 生成物をgit管理（差分確認用）

---

## Phase 2: 1コア化（Proposal + Event）

### 目的

**「会計」「報酬」「アサイン」は異なる機能じゃなくて、全部"時間をまたいだ状態変更ログ"の解釈違い**

### 現状の問題

```text
今:
  proposals → expenses テーブル
  proposals → invoices テーブル
  proposals → assignments テーブル
  （ドメインごとにテーブルが増える）
```

### 解決: Event + View

```text
圧縮後:
  proposals → events → View定義で解釈
  （1コア + N個のRead Model）
```

### データモデル

```sql
-- 1コア: events テーブル
CREATE TABLE events (
  id UUID PRIMARY KEY,
  proposal_id UUID REFERENCES proposals(id),
  event_type TEXT NOT NULL,  -- 'expense.created', 'assignment.created', etc.
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  org_id UUID NOT NULL
);

-- Read Model: expenses View
CREATE VIEW expenses AS
SELECT
  e.id,
  e.proposal_id,
  (e.payload->>'amount')::NUMERIC as amount,
  e.payload->>'description' as description,
  e.payload->>'site_id' as site_id,
  e.occurred_at as created_at,
  e.org_id
FROM events e
WHERE e.event_type = 'expense.created';

-- Read Model: assignments View
CREATE VIEW assignments AS
SELECT
  e.id,
  e.proposal_id,
  e.payload->>'worker_id' as worker_id,
  e.payload->>'site_id' as site_id,
  (e.payload->>'date')::DATE as date,
  e.occurred_at as created_at,
  e.org_id
FROM events e
WHERE e.event_type = 'assignment.created';
```

### メリット

- 新ドメイン追加 = View定義追加（スキーマ変更なし）
- 過去の任意時点の状態を再構築可能
- 監査ログが自動的に完全

---

## Phase 2.5: Bayesian Design Principles（生きた設計文書）

### 目的

**設計原則を「確定事項」ではなく「検証可能な仮説」として扱う**

Think Again（Adam Grant）× Thompson Sampling（ベイズ統計）のアプローチ。

### 仕組み

各設計原則に Beta分布パラメータ `(α, β)` を持たせる:
- Proposalが正常に実行 → 関連原則の α += 1（成功観測）
- 問題が発生 → 関連原則の β += 1（失敗観測）
- 確信度 = α / (α + β)、不確実性 = αβ / ((α+β)²(α+β+1))

### 実装状態

- Phase 1（データ基盤）: `design_principles` + `principle_observations` テーブル、API、seed data ✅
- Phase 2（自動観測）: ProposalService連携 → Phase A-1完了後
- Phase 3（UI + Sherpa）: ダッシュボード可視化 → Phase B以降

### DAO的意義

- 確信度が数値化 → 透明性
- 更新は自動のみ → 確認バイアス排除
- 観測履歴がLedger的に追記 → 監査可能
- 確信度低下で自動的に `under_review` → 自律的再考

---

## Phase 3: Sandbox環境（ルールのA/Bテスト）

### 目的

**ポリシーとルール自体が学習・進化する**

### 構成

```text
┌─────────────────────────────────────────────────┐
│                  本番環境                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ Policy  │  │ Proposal│  │ Events  │         │
│  │   v1    │  │         │  │         │         │
│  └─────────┘  └─────────┘  └─────────┘         │
└─────────────────────────────────────────────────┘
         │
         │ 1ヶ月分のイベントログをコピー
         ▼
┌─────────────────────────────────────────────────┐
│                 Sandbox環境                      │
│  ┌─────────┐  ┌─────────┐                       │
│  │ Policy  │  │ Policy  │                       │
│  │   v1    │  │   v2    │                       │
│  └────┬────┘  └────┬────┘                       │
│       │            │                            │
│       ▼            ▼                            │
│  ┌─────────┐  ┌─────────┐                       │
│  │ 結果A   │  │ 結果B   │                       │
│  └─────────┘  └─────────┘                       │
│                                                  │
│  比較メトリクス:                                 │
│  - 高額承認の見逃し数                            │
│  - 余計な承認の数                                │
│  - 人間の手動介入数                              │
└─────────────────────────────────────────────────┘
```

### ワークフロー

1. Sherpaが「この金額帯の経費は最近全部通ってます」と分析
2. 「閾値を5000→8000に上げませんか？」とPolicy変更を提案
3. Sandbox環境で過去1ヶ月分を再評価
4. 「v2適用で承認作業が30%減、見逃しリスクは変化なし」とレポート
5. 人間が承認 → 本番反映

---

## Phase 4: Sherpaによるルール進化提案

### 目的

**SherpaがPolicy改善のProposalを出す**

### 新しいProposal Type

```yaml
policy.update:
  description: "ポリシールールの変更提案"
  payload:
    policy_name: string
    current_rule: object
    proposed_rule: object
    rationale: string      # 変更理由
    simulation_result:     # Sandbox結果
      approval_reduction: number
      risk_assessment: string
  approval:
    required_approvers: 2  # 必ず人間2人
    ai_allowed: false      # AIは承認不可
```

### Sherpaの分析例

```text
Sherpa: 「過去3ヶ月の経費データを分析しました。

発見:
- 5,001〜8,000円の経費は100%承認されています
- 平均承認時間: 4.2時間
- 却下ゼロ

提案:
- expense.create の auto_approve 閾値を 5,000円 → 8,000円 に変更

Sandbox結果:
- 承認作業: 月あたり -12件（-28%）
- リスク: 変化なし（過去に却下された8,000円以下の経費ゼロ）

この変更を提案しますか？」
```

### 安全性

- AI自己承認禁止は絶対に維持
- Policy変更は必ず人間2人の承認が必要
- Sandbox結果なしの変更は禁止

---

## 実装優先度

| Phase | 内容 | 依存 | 工数 | 優先度 |
| ----- | ---- | ---- | ---- | ------ |
| 1 | Policy DSL | なし | 2週間 | 高 |
| 2 | 1コア化 | Phase A-1完了 | 3週間 | 中 |
| 3 | Sandbox環境 | Phase 1, 2 | 2週間 | 中 |
| 4 | Sherpaルール提案 | Phase 3 | 1週間 | 低 |

---

## 天才でも変えないもの

どんなに進化しても、以下は絶対に維持:

1. **Proposal中心** - 直接UPDATE禁止
2. **Ledger追記のみ** - 修正は逆仕訳
3. **AI自己承認禁止** - 絶対に抜けないゲート
4. **org境界の明確さ** - クロス組織アクセス禁止
5. **Read ModelとWrite Modelの分離** - CQRS原則

これらは「思想そのもの」であり、天才がやるのは「より抽象化／自動化する」であって、逆には戻さない。

---

## 関連ドキュメント

- [DESIGN_PHILOSOPHY.md](./DESIGN_PHILOSOPHY.md) - DAO×AI設計思想
- [POLICY_SYSTEM.md](./POLICY_SYSTEM.md) - 現在のPolicy設計
- [PROPOSAL_SYSTEM.md](./PROPOSAL_SYSTEM.md) - Proposalライフサイクル

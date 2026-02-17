# Policy（憲法）システム設計書

## 概要

組織のルールを **Policy（憲法）** として定義し、
人間とAIの両方が読める形式で管理する。

---

## 設計原則

### 1. 機械可読 + 人間可読
- ルールはJSONで定義（機械が評価可能）
- 各ルールに説明文を付与（人間が理解可能）

### 2. AIはルールを「読む側」
- AIがルールを自動生成しない
- AIはルールに従って判断・提案する
- ルール変更は必ずProposal経由

### 3. 階層的ルール
- 組織全体のルール
- ドメイン別ルール（会計、報酬、アサイン）
- 例外ルール

---

## データモデル

### Policy

```typescript
interface Policy {
  id: string;
  org_id: string;
  version: number;

  // メタ情報
  name: string;
  description: string;
  effective_from: string;
  effective_until?: string;

  // ルール群
  rules: PolicyRule[];

  // 変更履歴
  created_at: string;
  created_by: ActorRef;
  proposal_id?: string;  // 変更時のProposal
}

interface PolicyRule {
  id: string;
  domain: PolicyDomain;
  name: string;
  description: string;  // 人間向け説明

  // 条件
  conditions: Condition[];

  // アクション
  action: PolicyAction;

  // 優先度（高い方が優先）
  priority: number;

  // AI向けヒント
  ai_hint?: string;
}

type PolicyDomain =
  | 'approval'      // 承認ルール
  | 'accounting'    // 会計ルール
  | 'reward'        // 報酬ルール
  | 'assignment'    // アサインルール
  | 'notification'; // 通知ルール
```

### Condition（条件）

```typescript
interface Condition {
  field: string;
  operator: ConditionOperator;
  value: unknown;
}

type ConditionOperator =
  | 'eq'          // 等しい
  | 'neq'         // 等しくない
  | 'gt'          // より大きい
  | 'gte'         // 以上
  | 'lt'          // より小さい
  | 'lte'         // 以下
  | 'in'          // 含まれる
  | 'not_in'      // 含まれない
  | 'contains'    // 文字列に含む
  | 'matches'     // 正規表現マッチ
  | 'is_null'     // nullである
  | 'is_not_null'; // nullでない
```

### PolicyAction（アクション）

```typescript
type PolicyAction =
  // 承認関連
  | { type: 'auto_approve' }
  | { type: 'require_approval'; approvers: ApproverSpec[]; count: number }
  | { type: 'require_all_approval'; approvers: ApproverSpec[] }
  | { type: 'escalate'; to: ApproverSpec }

  // 通知関連
  | { type: 'notify'; targets: NotifyTarget[]; template: string }

  // 制限関連
  | { type: 'reject'; reason: string }
  | { type: 'limit'; max: number; per: 'day' | 'week' | 'month' }

  // AI関連
  | { type: 'ai_review'; confidence_threshold: number }
  | { type: 'ai_suggest' };

interface ApproverSpec {
  type: 'role' | 'specific' | 'any_member' | 'ai' | 'proposer_excluded';
  value?: string;
}

interface NotifyTarget {
  type: 'all' | 'role' | 'specific';
  value?: string;
}
```

---

## ルール定義例

### 承認ルール

```json
{
  "id": "expense-approval-tiers",
  "domain": "approval",
  "name": "経費承認の階層",
  "description": "経費金額に応じた承認者を決定する",
  "rules": [
    {
      "id": "expense-auto-approve-small",
      "name": "少額経費の自動承認",
      "description": "5,000円以下の経費は自動承認",
      "conditions": [
        { "field": "type", "operator": "eq", "value": "expense.create" },
        { "field": "payload.amount", "operator": "lte", "value": 5000 }
      ],
      "action": { "type": "auto_approve" },
      "priority": 100,
      "ai_hint": "少額経費は即時承認してよい。レシート画像の確認は任意。"
    },
    {
      "id": "expense-require-one-approval",
      "name": "中額経費の1人承認",
      "description": "5,000円超〜30,000円以下は1人の承認が必要",
      "conditions": [
        { "field": "type", "operator": "eq", "value": "expense.create" },
        { "field": "payload.amount", "operator": "gt", "value": 5000 },
        { "field": "payload.amount", "operator": "lte", "value": 30000 }
      ],
      "action": {
        "type": "require_approval",
        "approvers": [{ "type": "proposer_excluded" }],
        "count": 1
      },
      "priority": 90,
      "ai_hint": "AIは承認可能。ただしカテゴリと金額の妥当性を確認すること。"
    },
    {
      "id": "expense-require-two-approval",
      "name": "高額経費の2人承認",
      "description": "30,000円超は2人の承認が必要",
      "conditions": [
        { "field": "type", "operator": "eq", "value": "expense.create" },
        { "field": "payload.amount", "operator": "gt", "value": 30000 }
      ],
      "action": {
        "type": "require_approval",
        "approvers": [{ "type": "any_member" }],
        "count": 2
      },
      "priority": 80,
      "ai_hint": "AIは承認不可。人間2人の確認が必要。"
    }
  ]
}
```

### 報酬ルール

```json
{
  "id": "reward-calculation",
  "domain": "reward",
  "name": "報酬計算パラメータ",
  "description": "報酬分配の計算ルール",
  "rules": [
    {
      "id": "reward-boost-factor",
      "name": "ブースト指数",
      "description": "技術力の差をどの程度報酬に反映するか",
      "conditions": [],
      "action": {
        "type": "set_param",
        "params": {
          "boost_p": 1.5,
          "company_rate": 0,
          "max_ratio": 5
        }
      },
      "priority": 100,
      "ai_hint": "boost_p=1.5で、同じ稼働日数での報酬格差は約3〜5倍に収まる"
    }
  ]
}
```

### アサインルール

```json
{
  "id": "assignment-rules",
  "domain": "assignment",
  "name": "アサインルール",
  "description": "職人の現場配置に関するルール",
  "rules": [
    {
      "id": "ai-assignment-needs-approval",
      "name": "AI提案は承認必要",
      "description": "AIが提案したアサインは人間の承認が必要",
      "conditions": [
        { "field": "type", "operator": "eq", "value": "assignment.create" },
        { "field": "payload.is_ai_proposed", "operator": "eq", "value": true }
      ],
      "action": {
        "type": "require_approval",
        "approvers": [{ "type": "any_member" }],
        "count": 1
      },
      "priority": 100,
      "ai_hint": "自分が提案したアサインは自分で承認できない"
    },
    {
      "id": "human-assignment-auto-approve",
      "name": "人間作成は自動承認",
      "description": "人間が作成したアサインは自動承認",
      "conditions": [
        { "field": "type", "operator": "eq", "value": "assignment.create" },
        { "field": "payload.is_ai_proposed", "operator": "eq", "value": false }
      ],
      "action": { "type": "auto_approve" },
      "priority": 90
    }
  ]
}
```

---

## Policy評価エンジン

### 評価フロー

```typescript
class PolicyEngine {
  async evaluate(proposal: Proposal): Promise<PolicyDecision> {
    const rules = await this.loadRules(proposal.org_id, proposal.type);

    // 優先度順にソート
    const sortedRules = rules.sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (this.matchConditions(rule.conditions, proposal)) {
        return {
          rule_id: rule.id,
          rule_name: rule.name,
          action: rule.action,
          ai_hint: rule.ai_hint,
        };
      }
    }

    // デフォルト: 手動承認
    return {
      rule_id: 'default',
      rule_name: 'デフォルトルール',
      action: {
        type: 'require_approval',
        approvers: [{ type: 'any_member' }],
        count: 1,
      },
    };
  }

  private matchConditions(conditions: Condition[], proposal: Proposal): boolean {
    return conditions.every(c => this.evaluateCondition(c, proposal));
  }

  private evaluateCondition(condition: Condition, proposal: Proposal): boolean {
    const value = this.getFieldValue(condition.field, proposal);
    switch (condition.operator) {
      case 'eq': return value === condition.value;
      case 'gt': return value > condition.value;
      case 'lte': return value <= condition.value;
      // ... 他のオペレーター
    }
  }
}
```

### AI向けコンテキスト

AIがProposalを審査する際、Policyエンジンから以下を受け取る:

```typescript
interface AIReviewContext {
  proposal: Proposal;
  matched_rule: PolicyDecision;
  ai_hint: string;
  similar_cases: Proposal[];  // 過去の類似ケース
  org_context: {
    member_count: number;
    recent_expenses: number;
    monthly_budget: number;
  };
}
```

---

## Policy変更フロー

1. **変更Proposal作成**
   - `policy.update` Proposalを作成
   - 変更内容（diff）を含む

2. **全員合意**
   - Policy変更は全メンバーの承認が必要
   - 1人でも反対すれば却下

3. **バージョン管理**
   - 承認後、新バージョンのPolicyが有効化
   - 旧バージョンは履歴として保存

4. **適用タイミング**
   - `effective_from` で即時 or 将来日を指定可能

---

## UI設計

### Policy一覧

```
┌─────────────────────────────────────────────┐
│  組織ルール                                  │
├─────────────────────────────────────────────┤
│  📋 承認ルール                               │
│     ・少額経費（≤5,000円）→ 自動承認         │
│     ・中額経費（〜30,000円）→ 1人承認        │
│     ・高額経費（>30,000円）→ 2人承認         │
├─────────────────────────────────────────────┤
│  💰 報酬ルール                               │
│     ・ブースト指数: 1.5                      │
│     ・会社取り分: 0%                         │
│     ・最大格差: 5倍                          │
├─────────────────────────────────────────────┤
│  📅 アサインルール                           │
│     ・AI提案 → 人間の承認必要                │
│     ・人間作成 → 自動承認                    │
├─────────────────────────────────────────────┤
│                                             │
│  [ルール変更を提案]                          │
└─────────────────────────────────────────────┘
```

### 変更履歴

```
┌─────────────────────────────────────────────┐
│  ルール変更履歴                              │
├─────────────────────────────────────────────┤
│  v3 (現在) - 2026-02-01                     │
│     高額経費の閾値を30,000円に引き上げ        │
│     提案者: 田中  承認: 全員                 │
├─────────────────────────────────────────────┤
│  v2 - 2026-01-15                            │
│     AI提案アサインの承認ルール追加            │
│     提案者: Sherpa  承認: 全員               │
├─────────────────────────────────────────────┤
│  v1 - 2025-12-01                            │
│     初期ルール設定                           │
└─────────────────────────────────────────────┘
```

---

## 次のステップ

- [ ] Policyテーブル設計
- [ ] Policy評価エンジン実装
- [ ] デフォルトPolicy定義（JSON）
- [ ] Policy変更Proposalフロー
- [ ] AI向けコンテキスト生成

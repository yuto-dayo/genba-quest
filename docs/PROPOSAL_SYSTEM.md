# Proposal システム設計書

## 概要

すべてのデータ変更は **Proposal（提案）** を経由する。
これにより「いつ・誰が・なぜ」変更したかを完全に追跡可能にする。

---

## Proposalライフサイクル

```
  draft → pending → approved → executed
             ↓
          rejected
```

| ステータス | 説明 |
|-----------|------|
| `draft` | 下書き。まだ提出されていない |
| `pending` | 提出済み。承認待ち |
| `approved` | 承認済み。実行待ち |
| `rejected` | 却下。理由付き |
| `executed` | 実行完了。イベント生成済み |

---

## データモデル

### Proposal

```typescript
interface Proposal {
  id: string;
  org_id: string;

  // 種別
  type: ProposalType;

  // ステータス
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'executed';

  // 作成者
  created_by: ActorRef;
  created_at: string;

  // 内容（JSON）
  payload: Record<string, unknown>;

  // 説明（人間・AI両方が読める）
  description: string;

  // 適用されたポリシー
  policy_ref?: string;

  // 承認情報
  approvals: Approval[];
  required_approvals: number;  // 必要な承認数

  // 実行結果
  executed_at?: string;
  executed_by?: ActorRef;
  result_event_id?: string;  // 生成されたイベントID

  // 却下理由
  rejection_reason?: string;
}

interface ActorRef {
  type: 'human' | 'ai' | 'integration' | 'system';
  id: string;
  name: string;
}

interface Approval {
  actor: ActorRef;
  decision: 'approve' | 'reject';
  reason?: string;
  at: string;
}
```

### ProposalType

```typescript
type ProposalType =
  // 経費・売上
  | 'expense.create'
  | 'expense.update'
  | 'expense.void'
  | 'income.create'
  | 'income.update'

  // 請求
  | 'invoice.create'
  | 'invoice.send'
  | 'invoice.mark_paid'

  // 報酬
  | 'reward.calculate'
  | 'reward.adjust'

  // スキル・評価
  | 'skill.achieve'
  | 'skill.revoke'
  | 'evaluation.submit'
  | 'evaluation.finalize'

  // アサイン
  | 'assignment.create'
  | 'assignment.update'
  | 'assignment.cancel'

  // 現場
  | 'site.create'
  | 'site.complete'

  // ポリシー
  | 'policy.update';
```

---

## 承認ルール

### 承認者の決定

Policyに基づいて自動決定される。

```typescript
interface ApprovalRule {
  proposal_type: ProposalType;
  conditions: Condition[];
  required_approvers: ApproverSpec[];
  auto_approve?: boolean;
}

interface Condition {
  field: string;
  operator: 'eq' | 'gt' | 'lt' | 'contains';
  value: unknown;
}

interface ApproverSpec {
  type: 'role' | 'specific' | 'any_member' | 'ai';
  value?: string;
}
```

### デフォルトルール

| Proposal Type | 条件 | 承認者 | 自動承認 |
|---------------|------|--------|----------|
| `expense.create` | 金額 ≤ 5,000円 | - | Yes |
| `expense.create` | 金額 > 5,000円 | any_member | No |
| `expense.create` | 金額 > 30,000円 | 2人以上 | No |
| `income.create` | - | - | Yes |
| `reward.calculate` | - | 全員確認 | No |
| `skill.achieve` | - | 熟練者 | No |
| `assignment.create` | AI提案 | any_member | No |
| `assignment.create` | 人間作成 | - | Yes |
| `policy.update` | - | 全員合意 | No |

---

## AIの承認権限

### AIが承認できる条件

1. **Policy で明示的に許可されている**
2. **金額が閾値以下**
3. **パターンが過去の承認済みと類似**

### AIが承認できない場合

1. **高額取引**（閾値超え）
2. **Policy変更**
3. **報酬計算の確定**
4. **初めてのパターン**

### AIの承認時の出力

```typescript
interface AIApprovalReason {
  decision: 'approve' | 'escalate';
  confidence: number;  // 0-1
  reasoning: string;   // 人間が読める説明
  policy_refs: string[];  // 参照したルール
  similar_cases?: string[];  // 類似の過去ケース
}
```

---

## API設計

### Proposal CRUD

```
POST   /api/v1/proposals              # 作成
GET    /api/v1/proposals              # 一覧（フィルター可）
GET    /api/v1/proposals/:id          # 詳細
PATCH  /api/v1/proposals/:id          # 更新（draft状態のみ）
DELETE /api/v1/proposals/:id          # 削除（draft状態のみ）
```

### ライフサイクル操作

```
POST   /api/v1/proposals/:id/submit   # 提出（draft → pending）
POST   /api/v1/proposals/:id/approve  # 承認
POST   /api/v1/proposals/:id/reject   # 却下
POST   /api/v1/proposals/:id/execute  # 実行（承認済みのみ）
```

### AI用エンドポイント

```
POST   /api/v1/proposals/:id/ai-review  # AIによる審査
```

---

## ワークフロー例

### 経費登録（低額）

```
1. ユーザーが経費を入力
2. システムがProposal(expense.create)を作成
3. Policy評価: 金額 ≤ 5,000円 → 自動承認
4. 即時 executed に遷移
5. LedgerEventが生成される
```

### 経費登録（高額）

```
1. ユーザーが経費を入力
2. システムがProposal(expense.create)を作成
3. Policy評価: 金額 > 30,000円 → 2人の承認必要
4. 他メンバーに通知
5. 2人が承認 → approved
6. システムが execute → LedgerEvent生成
```

### AI提案のアサイン

```
1. Sherpaがスケジュール分析
2. Proposal(assignment.create)を作成（is_ai_proposed: true）
3. Policy評価: AI提案 → 人間の承認必要
4. メンバーに通知
5. 誰かが承認 → approved → executed
```

---

## UI設計

### Proposal一覧画面

```
┌─────────────────────────────────────────────┐
│  承認待ち (3件)                              │
├─────────────────────────────────────────────┤
│  🟡 経費: ホームセンターで資材購入 ¥32,000   │
│     提案者: 田中  1時間前                    │
│     [承認] [却下] [詳細]                     │
├─────────────────────────────────────────────┤
│  🤖 アサイン: 来週月曜 山田→A現場           │
│     提案者: Sherpa  30分前                   │
│     [承認] [却下] [詳細]                     │
├─────────────────────────────────────────────┤
│  🟡 スキル: 佐藤「天井貼り6畳以上」達成      │
│     提案者: 佐藤(自己評価)  2時間前          │
│     [承認] [却下] [詳細]                     │
└─────────────────────────────────────────────┘
```

### 詳細モーダル

```
┌─────────────────────────────────────────────┐
│  経費登録の承認                              │
├─────────────────────────────────────────────┤
│  種別: 資材                                  │
│  金額: ¥32,000                              │
│  日付: 2026-02-07                           │
│  現場: 〇〇ビル改修工事                      │
│  説明: パテ材料・下地材                      │
│  レシート: [画像]                            │
├─────────────────────────────────────────────┤
│  📋 適用ルール                               │
│  ・金額 > ¥30,000 → 2人の承認が必要         │
│  ・現在: 0/2 承認                            │
├─────────────────────────────────────────────┤
│  💬 コメント（任意）                          │
│  ┌─────────────────────────────────────┐    │
│  │                                     │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [却下]                        [承認する]   │
└─────────────────────────────────────────────┘
```

---

## 監査ログ

すべてのProposalは永久保存され、監査証跡となる。

```sql
-- 過去1年の経費Proposalを確認
SELECT
  p.id,
  p.type,
  p.status,
  p.payload->>'amount' as amount,
  p.created_by->>'name' as proposer,
  p.approvals as approval_history,
  p.executed_at
FROM proposals p
WHERE p.type LIKE 'expense.%'
  AND p.created_at > NOW() - INTERVAL '1 year'
ORDER BY p.created_at DESC;
```

---

## 次のステップ

- [ ] Proposalテーブル設計
- [ ] Policy評価エンジン実装
- [ ] 承認通知システム
- [ ] AI審査ロジック

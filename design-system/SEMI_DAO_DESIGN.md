# GENBA QUEST - 半DAO実装設計書

**Version**: 1.0
**Date**: 2026-02-02
**Status**: Draft

---

## 目次

1. [ビジョン: 半DAOとは](#1-ビジョン-半daoとは)
2. [現在の実装状況](#2-現在の実装状況)
3. [Phase 1: 統合承認ダッシュボード](#3-phase-1-統合承認ダッシュボード)
4. [Phase 2: AI自動提案エンジン](#4-phase-2-ai自動提案エンジン)
5. [Phase 3: スマートルールエンジン](#5-phase-3-スマートルールエンジン)
6. [Phase 4: DAO要素拡張](#6-phase-4-dao要素拡張)
7. [データベース拡張設計](#7-データベース拡張設計)
8. [API設計](#8-api設計)
9. [UI/UX設計](#9-uiux設計)
10. [実装ロードマップ](#10-実装ロードマップ)

---

## 1. ビジョン: 半DAOとは

### コンセプト

```
従来の業務フロー:
人間が入力 → 人間が処理 → 人間が承認 → 人間が実行

半DAOの業務フロー:
AI/自動化が入力 → AI/自動化が処理 → 人間が承認 → AI/自動化が実行
```

### 設計原則

1. **人間は意思決定のみ** - ルーチン作業は自動化
2. **透明性の確保** - すべての自動処理を記録・監査可能
3. **段階的な自律化** - ルールベース → AI判断 → 完全自律へ
4. **民主的ガバナンス** - 重要事項はメンバー投票
5. **フェイルセーフ** - 異常検知時は人間にエスカレーション

---

## 2. 現在の実装状況

### ✅ 実装済みの半DAO要素

| 機能 | 状態 | 自動化レベル |
|------|------|-------------|
| OCR自動読み取り | ✅ 完了 | レベル3: 自動抽出+検証提案 |
| 経費リスク自動判定 | ✅ 完了 | レベル2: ルールベース判定 |
| 承認者自動割当 | ✅ 完了 | レベル2: 権限ベースマッチング |
| 仕訳自動生成 | ✅ 完了 | レベル3: 承認時トリガー |
| パーク投票システム | ✅ 完了 | レベル4: 民主的意思決定 |
| Sherpa AI相棒 | ✅ 完了 | レベル3: Tool Use統合 |
| モンスター自動生成 | ✅ 完了 | レベル3: AI画像生成 |
| 請求書番号自動採番 | ✅ 完了 | レベル3: 年度ベース管理 |

### ❌ 未実装の必須要素

| 機能 | 優先度 | 自動化目標 |
|------|--------|-----------|
| 統合承認ダッシュボード | 🔴 最高 | すべての承認を1画面で |
| 自動タスク生成 | 🔴 最高 | 現場→タスク分解 |
| 自動請求書生成 | 🟡 高 | 現場完了→請求書 |
| 自動休暇提案 | 🟡 高 | スタミナ低下検知 |
| リスクアラート | 🟡 高 | 予算・納期・人員 |
| 条件付き自動承認 | 🟢 中 | ルール設定UI |
| 自動レポート生成 | 🟢 中 | 週次・月次集計 |
| トークンエコノミー | 🔵 低 | 貢献度の可視化 |

---

## 3. Phase 1: 統合承認ダッシュボード

### 3.1 目的

**すべての承認待ちアイテムを1画面で表示し、ワンクリック承認を実現**

### 3.2 承認対象の一元化

現在分散している承認対象:

```
1. 経費承認 (accounting_transactions)
   └─ status='pending_review' AND reviewer_id=current_user

2. パーク承認 (badge_applications)
   └─ status='pending' AND 自分が未投票

3. 休暇申請承認 (未実装)

4. 現場承認 (未実装)
   └─ 受注可否の投票

5. 大型投資承認 (未実装)
```

### 3.3 データベース拡張

#### 3.3.1 新テーブル: approval_queue

```sql
CREATE TABLE approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 承認対象の識別
  item_type text NOT NULL
    CHECK (item_type IN ('expense', 'perk', 'holiday', 'site_order', 'investment')),
  item_id uuid NOT NULL,

  -- 承認者情報
  assigned_to uuid REFERENCES auth.users(id),
  assigned_at timestamptz DEFAULT now(),

  -- 優先度・期限
  priority text DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date timestamptz,

  -- 自動判定結果
  ai_recommendation text CHECK (ai_recommendation IN ('approve', 'reject', 'review_required')),
  ai_confidence numeric CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ai_reason text,

  -- ステータス
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'escalated', 'auto_approved')),

  -- 処理結果
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_comment text,

  -- メタ情報
  created_at timestamptz DEFAULT now(),

  UNIQUE(item_type, item_id)
);

CREATE INDEX approval_queue_assigned_idx ON approval_queue(assigned_to, status);
CREATE INDEX approval_queue_priority_idx ON approval_queue(priority, due_date);
```

#### 3.3.2 ビュー: unified_approval_view

```sql
CREATE VIEW unified_approval_view AS
SELECT
  q.id as approval_id,
  q.item_type,
  q.item_id,
  q.assigned_to,
  q.priority,
  q.due_date,
  q.ai_recommendation,
  q.ai_confidence,
  q.status,

  -- 経費の場合
  CASE WHEN q.item_type = 'expense' THEN
    jsonb_build_object(
      'vendor_name', t.vendor_name,
      'amount', t.amount_total,
      'description', t.description,
      'category', t.category,
      'risk_level', t.risk_level
    )
  END as expense_data,

  -- パークの場合
  CASE WHEN q.item_type = 'perk' THEN
    jsonb_build_object(
      'applicant', p.username,
      'badge_id', ba.badge_id,
      'level', ba.level,
      'reason', ba.reason
    )
  END as perk_data,

  q.created_at
FROM approval_queue q
LEFT JOIN accounting_transactions t ON (q.item_type = 'expense' AND q.item_id = t.id)
LEFT JOIN badge_applications ba ON (q.item_type = 'perk' AND q.item_id = ba.id)
LEFT JOIN profiles p ON (ba.applicant_id = p.id);
```

### 3.4 API設計

#### GET /api/v1/approvals/queue

**すべての承認待ちを取得**

```typescript
// Request
GET /api/v1/approvals/queue?status=pending&priority=high

// Response
{
  items: [
    {
      approval_id: "uuid",
      item_type: "expense",
      item_id: "uuid",
      priority: "high",
      due_date: "2024-01-20T00:00:00Z",
      ai_recommendation: "approve",
      ai_confidence: 0.92,
      ai_reason: "金額が閾値以下かつOCR信頼度が高い",
      expense_data: {
        vendor_name: "株式会社ABC",
        amount: 45000,
        description: "内装材料",
        category: "material",
        risk_level: "LOW"
      },
      created_at: "2024-01-18T10:00:00Z"
    },
    {
      approval_id: "uuid",
      item_type: "perk",
      item_id: "uuid",
      priority: "normal",
      perk_data: {
        applicant: "tanaka",
        badge_id: "floor_master",
        level: "silver",
        reason: "床施工50件以上完了"
      },
      ai_recommendation: "review_required",
      ai_confidence: null
    }
  ],
  summary: {
    total: 15,
    by_type: {
      expense: 10,
      perk: 5
    },
    by_priority: {
      urgent: 2,
      high: 5,
      normal: 8
    }
  }
}
```

#### POST /api/v1/approvals/batch-review

**一括承認API**

```typescript
// Request
POST /api/v1/approvals/batch-review
{
  approval_ids: ["uuid1", "uuid2", "uuid3"],
  action: "approve",
  comment: "一括承認"
}

// Response
{
  success: ["uuid1", "uuid2"],
  failed: [
    {
      approval_id: "uuid3",
      error: "承認権限不足"
    }
  ]
}
```

### 3.5 UI設計

#### ダッシュボード構成

```
┌─ 承認ダッシュボード ────────────────────────────────────┐
│                                                        │
│  📊 承認サマリー                                        │
│  ┌────────┬────────┬────────┬────────┐                │
│  │ 緊急: 2 │ 高: 5  │ 通常: 8│ 合計:15│                │
│  └────────┴────────┴────────┴────────┘                │
│                                                        │
│  🔴 緊急承認 (2件)                                      │
│  ┌──────────────────────────────────────┐             │
│  │ [経費] ¥150,000 - 外注費 (納期: 今日)   │             │
│  │ AI推奨: 要確認 ⚠️                      │             │
│  │ [承認] [詳細]                          │             │
│  └──────────────────────────────────────┘             │
│                                                        │
│  🟡 高優先度 (5件)                                      │
│  ┌──────────────────────────────────────┐             │
│  │ [経費] ¥45,000 - 材料費                │             │
│  │ AI推奨: 承認 ✅ (信頼度: 92%)           │             │
│  │ [ワンクリック承認] [詳細]               │             │
│  └──────────────────────────────────────┘             │
│  ┌──────────────────────────────────────┐             │
│  │ [パーク] 田中 - 床職人 Silver申請       │             │
│  │ 投票状況: 3/7 (過半数まで1票)           │             │
│  │ [承認投票] [詳細]                       │             │
│  └──────────────────────────────────────┘             │
│                                                        │
│  🟢 通常 (8件) [展開 ▼]                                 │
│                                                        │
│  一括操作: [全て承認] [選択承認] [フィルター]           │
└────────────────────────────────────────────────────────┘
```

#### ApprovalCard コンポーネント

```typescript
interface ApprovalCardProps {
  approval: UnifiedApproval;
  onApprove: (id: string, comment?: string) => void;
  onReject: (id: string, comment: string) => void;
  onViewDetail: (id: string) => void;
}

export function ApprovalCard({ approval, onApprove, onReject }: ApprovalCardProps) {
  const getPriorityColor = () => {
    switch (approval.priority) {
      case 'urgent': return 'red';
      case 'high': return 'orange';
      default: return 'blue';
    }
  };

  const AIBadge = () => {
    if (!approval.ai_recommendation) return null;

    return (
      <div className={styles.aiBadge}>
        {approval.ai_recommendation === 'approve' ? '✅' : '⚠️'}
        AI推奨: {approval.ai_recommendation === 'approve' ? '承認' : '要確認'}
        {approval.ai_confidence && ` (${(approval.ai_confidence * 100).toFixed(0)}%)`}
      </div>
    );
  };

  return (
    <div className={styles.card} data-priority={approval.priority}>
      <div className={styles.header}>
        <span className={styles.type}>[{typeLabels[approval.item_type]}]</span>
        <span className={styles.priority}>{priorityLabels[approval.priority]}</span>
      </div>

      <div className={styles.content}>
        {approval.expense_data && (
          <>
            <h4>¥{approval.expense_data.amount.toLocaleString()} - {approval.expense_data.category}</h4>
            <p>{approval.expense_data.vendor_name}</p>
          </>
        )}
        {approval.perk_data && (
          <>
            <h4>{approval.perk_data.applicant} - {approval.perk_data.badge_id} {approval.perk_data.level}</h4>
            <p>{approval.perk_data.reason}</p>
          </>
        )}
      </div>

      <AIBadge />

      <div className={styles.actions}>
        {approval.ai_recommendation === 'approve' && approval.ai_confidence > 0.8 && (
          <button className={styles.quickApprove} onClick={() => onApprove(approval.approval_id)}>
            ⚡ ワンクリック承認
          </button>
        )}
        <button onClick={() => onApprove(approval.approval_id)}>承認</button>
        <button onClick={() => onReject(approval.approval_id, '')}>否認</button>
        <button onClick={() => onViewDetail(approval.approval_id)}>詳細</button>
      </div>
    </div>
  );
}
```

---

## 4. Phase 2: AI自動提案エンジン

### 4.1 目的

**業務イベントを検知してAIが自動で次のアクションを提案**

### 4.2 提案エンジンのアーキテクチャ

```
┌─ イベント検知 ─────────────────────────────────────┐
│                                                    │
│  Database Triggers / Scheduled Jobs                │
│  ├─ 現場完了検知 (sites.status = 'completed')       │
│  ├─ スタミナ低下検知 (profiles.stamina < 30)        │
│  ├─ 予算超過検知 (actual_hours > estimated * 1.2)  │
│  └─ 納期接近検知 (deadline - today < 3days)        │
│                                                    │
└─────────────┬──────────────────────────────────────┘
              │
              ▼
┌─ AI判断レイヤー ───────────────────────────────────┐
│                                                    │
│  Gemini / Claude に状況を送信                       │
│  ├─ 現場データ                                      │
│  ├─ 作業ログ                                        │
│  ├─ メンバー状態                                    │
│  └─ 過去の類似ケース                                │
│                                                    │
│  AI出力:                                           │
│  {                                                 │
│    "action": "create_invoice",                    │
│    "confidence": 0.95,                            │
│    "reason": "現場完了から3日経過、請求書未作成",    │
│    "proposal": {                                  │
│      "amount": 5500000,                           │
│      "due_date": "2024-02-15",                    │
│      "items": [...]                               │
│    }                                              │
│  }                                                │
└─────────────┬──────────────────────────────────────┘
              │
              ▼
┌─ 提案キュー ───────────────────────────────────────┐
│                                                    │
│  ai_proposals テーブルに保存                        │
│  └─ ダッシュボードで通知                            │
│                                                    │
└─────────────┬──────────────────────────────────────┘
              │
              ▼
┌─ 人間の承認 ───────────────────────────────────────┐
│                                                    │
│  [承認] → 自動実行                                  │
│  [編集して承認] → 修正後実行                         │
│  [却下] → キューから削除                            │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 4.3 データベース設計

#### ai_proposals テーブル

```sql
CREATE TABLE ai_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 提案タイプ
  proposal_type text NOT NULL
    CHECK (proposal_type IN (
      'create_invoice',        -- 請求書作成
      'suggest_holiday',       -- 休暇推奨
      'budget_alert',          -- 予算アラート
      'deadline_alert',        -- 納期アラート
      'auto_task_split',       -- タスク自動分解
      'schedule_optimization'  -- スケジュール最適化
    )),

  -- 対象リソース
  target_type text,
  target_id uuid,

  -- AI判定
  ai_provider text DEFAULT 'gemini',
  ai_model text,
  ai_confidence numeric CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ai_reasoning text,

  -- 提案内容
  proposal_data jsonb NOT NULL,

  -- ステータス
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),

  -- 処理結果
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  executed_at timestamptz,
  execution_result jsonb,

  -- メタ
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX ai_proposals_status_idx ON ai_proposals(status, created_at);
CREATE INDEX ai_proposals_target_idx ON ai_proposals(target_type, target_id);
```

### 4.4 提案エンジン実装例

#### 4.4.1 現場完了→請求書自動生成

```typescript
// server/src/services/proposalEngine.ts

import { supabase } from '../lib/supabase';
import { callGemini } from '../lib/gemini';

export async function proposeSiteInvoice(siteId: string) {
  // 1. 現場データ取得
  const { data: site } = await supabase
    .from('sites')
    .select('*, client:clients(*)')
    .eq('id', siteId)
    .single();

  // 2. 作業ログ・経費集計
  const { data: expenses } = await supabase
    .from('accounting_transactions')
    .select('*')
    .eq('site_id', siteId)
    .eq('kind', 'expense')
    .eq('status', 'posted');

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount_total, 0);

  // 3. AIに提案を依頼
  const prompt = `
あなたは経理AIアシスタントです。以下の現場が完了しました。請求書を作成すべきか判断してください。

現場情報:
- 名称: ${site.name}
- クライアント: ${site.client.name}
- 売上予定: ¥${site.revenue.toLocaleString()}
- 実績工数: ${site.actual_hours}h
- 経費合計: ¥${totalExpenses.toLocaleString()}

判断基準:
1. 現場完了から3日以内に請求書を作成すべき
2. 売上予定額をベースに請求金額を提案
3. 経費が予算を大幅に超えている場合は警告

以下のJSON形式で回答してください:
{
  "should_create": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "理由",
  "proposed_amount": 金額,
  "proposed_due_date": "YYYY-MM-DD",
  "warnings": ["警告があれば"]
}
`;

  const aiResponse = await callGemini(prompt);
  const proposal = JSON.parse(aiResponse);

  if (proposal.should_create && proposal.confidence > 0.7) {
    // 4. ai_proposals テーブルに保存
    await supabase.from('ai_proposals').insert({
      proposal_type: 'create_invoice',
      target_type: 'site',
      target_id: siteId,
      ai_provider: 'gemini',
      ai_model: 'gemini-2.0-flash-exp',
      ai_confidence: proposal.confidence,
      ai_reasoning: proposal.reasoning,
      proposal_data: {
        site_id: siteId,
        client_id: site.client_id,
        amount_subtotal: proposal.proposed_amount / 1.1,
        tax_amount: proposal.proposed_amount * 0.1,
        amount_total: proposal.proposed_amount,
        due_date: proposal.proposed_due_date,
        warnings: proposal.warnings
      },
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7日後
    });

    return { success: true, proposal };
  }

  return { success: false, reason: 'AI信頼度が低い' };
}
```

#### 4.4.2 スタミナ低下→休暇推奨

```typescript
export async function proposeHoliday(userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profile.stamina >= 30) {
    return { success: false, reason: 'スタミナ十分' };
  }

  // AI判定
  const prompt = `
ユーザー ${profile.full_name} のスタミナが ${profile.stamina}% に低下しています。
休暇日数残高: ${profile.holiday_days} 日
目標: ${profile.holiday_target} 日

休暇を推奨すべきか、何日間推奨すべきか判断してください。

JSON形式:
{
  "should_recommend": true/false,
  "recommended_days": 数値,
  "reasoning": "理由",
  "urgency": "low/medium/high"
}
`;

  const aiResponse = await callGemini(prompt);
  const proposal = JSON.parse(aiResponse);

  if (proposal.should_recommend) {
    await supabase.from('ai_proposals').insert({
      proposal_type: 'suggest_holiday',
      target_type: 'user',
      target_id: userId,
      ai_confidence: 0.85,
      ai_reasoning: proposal.reasoning,
      proposal_data: {
        user_id: userId,
        days: proposal.recommended_days,
        urgency: proposal.urgency
      }
    });
  }

  return { success: true, proposal };
}
```

### 4.5 スケジューラー設計

```typescript
// server/src/jobs/proposalScheduler.ts

import cron from 'node-cron';

// 毎日午前9時に実行
cron.schedule('0 9 * * *', async () => {
  console.log('[ProposalEngine] 日次チェック開始');

  // 1. 完了した現場で請求書未作成のものをチェック
  const { data: completedSites } = await supabase
    .from('sites')
    .select('*')
    .eq('status', 'completed')
    .is('completed_at', 'not', null);

  for (const site of completedSites) {
    const { data: invoice } = await supabase
      .from('accounting_invoices')
      .select('id')
      .eq('site_id', site.id)
      .single();

    if (!invoice) {
      await proposeSiteInvoice(site.id);
    }
  }

  // 2. スタミナ低下者をチェック
  const { data: lowStaminaUsers } = await supabase
    .from('profiles')
    .select('*')
    .lt('stamina', 30);

  for (const user of lowStaminaUsers) {
    await proposeHoliday(user.id);
  }

  console.log('[ProposalEngine] 日次チェック完了');
});
```

---

## 5. Phase 3: スマートルールエンジン

### 5.1 目的

**条件を満たしたら自動承認・自動実行するルール設定**

### 5.2 ルール定義

#### approval_rules テーブル

```sql
CREATE TABLE approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ルール識別
  name text NOT NULL,
  description text,

  -- 適用対象
  applies_to text NOT NULL
    CHECK (applies_to IN ('expense', 'perk', 'holiday', 'invoice')),

  -- 条件 (JSONB形式)
  conditions jsonb NOT NULL,
  -- 例:
  -- { "amount": { "lt": 5000 }, "category": { "in": ["office_supply", "food"] } }
  -- { "stamina": { "lt": 20 }, "holiday_days": { "gte": 5 } }

  -- アクション
  action text NOT NULL
    CHECK (action IN ('auto_approve', 'escalate', 'notify', 'auto_execute')),

  -- 優先度
  priority integer DEFAULT 0,

  -- 有効/無効
  is_active boolean DEFAULT true,

  -- 作成者・更新者
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX approval_rules_applies_idx ON approval_rules(applies_to, is_active);
```

### 5.3 ルールエンジン実装

```typescript
// server/src/services/ruleEngine.ts

interface Rule {
  id: string;
  name: string;
  applies_to: string;
  conditions: any;
  action: 'auto_approve' | 'escalate' | 'notify' | 'auto_execute';
  priority: number;
}

export class RuleEngine {
  async evaluateExpense(transaction: any): Promise<{ matched: Rule | null; should_auto_approve: boolean }> {
    const { data: rules } = await supabase
      .from('approval_rules')
      .select('*')
      .eq('applies_to', 'expense')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    for (const rule of rules) {
      if (this.matchConditions(transaction, rule.conditions)) {
        if (rule.action === 'auto_approve') {
          return { matched: rule, should_auto_approve: true };
        }
      }
    }

    return { matched: null, should_auto_approve: false };
  }

  private matchConditions(data: any, conditions: any): boolean {
    for (const [key, condition] of Object.entries(conditions)) {
      const value = data[key];

      if ('lt' in condition && !(value < condition.lt)) return false;
      if ('lte' in condition && !(value <= condition.lte)) return false;
      if ('gt' in condition && !(value > condition.gt)) return false;
      if ('gte' in condition && !(value >= condition.gte)) return false;
      if ('eq' in condition && value !== condition.eq) return false;
      if ('in' in condition && !condition.in.includes(value)) return false;
    }

    return true;
  }
}

// 使用例
const ruleEngine = new RuleEngine();
const result = await ruleEngine.evaluateExpense(newExpense);

if (result.should_auto_approve) {
  // 自動承認処理
  await approveExpense(newExpense.id, 'system', `自動承認ルール: ${result.matched.name}`);
}
```

### 5.4 ルール設定UI

```typescript
// frontend/src/pages/RuleSettings.tsx

export function RuleSettings() {
  const [rules, setRules] = useState<Rule[]>([]);

  const createRule = async (rule: Partial<Rule>) => {
    await api('/api/v1/rules', {
      method: 'POST',
      body: JSON.stringify(rule)
    });
  };

  return (
    <div className={styles.container}>
      <h1>自動承認ルール設定</h1>

      <section>
        <h2>経費自動承認ルール</h2>
        <button onClick={() => setShowCreateModal(true)}>+ 新規ルール</button>

        {rules.map(rule => (
          <div key={rule.id} className={styles.ruleCard}>
            <h3>{rule.name}</h3>
            <p>{rule.description}</p>
            <div className={styles.conditions}>
              条件: {JSON.stringify(rule.conditions, null, 2)}
            </div>
            <div className={styles.actions}>
              アクション: {rule.action}
            </div>
            <button onClick={() => toggleRule(rule.id)}>
              {rule.is_active ? '無効化' : '有効化'}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
```

---

## 6. Phase 4: DAO要素拡張

### 6.1 投票システムの拡張

#### vote_proposals テーブル

```sql
CREATE TABLE vote_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 提案タイプ
  proposal_type text NOT NULL
    CHECK (proposal_type IN (
      'site_order',          -- 現場受注可否
      'large_investment',    -- 大型投資
      'hire_member',         -- メンバー採用
      'policy_change'        -- ルール変更
    )),

  -- 提案内容
  title text NOT NULL,
  description text,
  proposal_data jsonb,

  -- 提案者
  proposed_by uuid REFERENCES auth.users(id),

  -- 投票設定
  voting_type text DEFAULT 'simple_majority'
    CHECK (voting_type IN ('simple_majority', 'supermajority', 'unanimous')),
  voting_ends_at timestamptz NOT NULL,

  -- ステータス
  status text DEFAULT 'voting'
    CHECK (status IN ('voting', 'approved', 'rejected', 'expired')),

  -- 結果
  votes_for integer DEFAULT 0,
  votes_against integer DEFAULT 0,
  decided_at timestamptz,

  created_at timestamptz DEFAULT now()
);

CREATE TABLE vote_ballots (
  proposal_id uuid REFERENCES vote_proposals(id),
  voter_id uuid REFERENCES auth.users(id),
  vote text NOT NULL CHECK (vote IN ('for', 'against', 'abstain')),
  voted_at timestamptz DEFAULT now(),

  PRIMARY KEY (proposal_id, voter_id)
);
```

### 6.2 トークンエコノミー

#### user_tokens テーブル

```sql
CREATE TABLE user_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),

  -- トークン残高
  balance numeric DEFAULT 0 CHECK (balance >= 0),

  -- 累計獲得
  lifetime_earned numeric DEFAULT 0,

  -- メタ
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE token_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),

  -- トークン増減
  amount numeric NOT NULL,
  balance_after numeric NOT NULL,

  -- 理由
  reason text NOT NULL,
  source_type text
    CHECK (source_type IN ('work', 'approval', 'contribution', 'spend')),
  source_id uuid,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX token_tx_user_idx ON token_transactions(user_id, created_at DESC);
```

#### トークン獲得ルール

```typescript
// 作業時間に応じてトークン付与
export async function awardWorkTokens(userId: string, hoursWorked: number) {
  const tokens = hoursWorked * 10; // 1時間 = 10トークン

  await supabase.rpc('add_user_tokens', {
    p_user_id: userId,
    p_amount: tokens,
    p_reason: `作業時間 ${hoursWorked}h`,
    p_source_type: 'work'
  });
}

// 承認作業でトークン付与
export async function awardApprovalTokens(reviewerId: string) {
  const tokens = 5; // 1承認 = 5トークン

  await supabase.rpc('add_user_tokens', {
    p_user_id: reviewerId,
    p_amount: tokens,
    p_reason: '承認作業',
    p_source_type: 'approval'
  });
}

// トークンで休暇購入
export async function purchaseHoliday(userId: string, days: number) {
  const cost = days * 100; // 1日 = 100トークン

  const { data: userTokens } = await supabase
    .from('user_tokens')
    .select('balance')
    .eq('user_id', userId)
    .single();

  if (userTokens.balance < cost) {
    throw new Error('トークン不足');
  }

  await supabase.rpc('spend_user_tokens', {
    p_user_id: userId,
    p_amount: cost,
    p_reason: `休暇購入 ${days}日`,
    p_source_type: 'spend'
  });

  await supabase
    .from('profiles')
    .update({ holiday_days: supabase.raw('holiday_days + ?', [days]) })
    .eq('id', userId);
}
```

---

## 7. データベース拡張設計

### 7.1 マイグレーション一覧

| ファイル | 内容 |
|---------|------|
| 009_approval_queue.sql | 統合承認キュー |
| 010_ai_proposals.sql | AI提案システム |
| 011_approval_rules.sql | ルールエンジン |
| 012_vote_system.sql | 投票システム拡張 |
| 013_token_economy.sql | トークンエコノミー |
| 014_task_system.sql | タスク管理 (Phase 5) |

### 7.2 009_approval_queue.sql

```sql
-- 統合承認キュー
CREATE TABLE approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL
    CHECK (item_type IN ('expense', 'perk', 'holiday', 'site_order', 'investment')),
  item_id uuid NOT NULL,
  assigned_to uuid REFERENCES auth.users(id),
  assigned_at timestamptz DEFAULT now(),
  priority text DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date timestamptz,
  ai_recommendation text CHECK (ai_recommendation IN ('approve', 'reject', 'review_required')),
  ai_confidence numeric CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ai_reason text,
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'escalated', 'auto_approved')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(item_type, item_id)
);

CREATE INDEX approval_queue_assigned_idx ON approval_queue(assigned_to, status);
CREATE INDEX approval_queue_priority_idx ON approval_queue(priority, due_date);

-- RLS
ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Approval Queue" ON approval_queue;
CREATE POLICY "Read Approval Queue" ON approval_queue FOR SELECT TO authenticated
  USING (assigned_to = auth.uid() OR auth.uid() IN (SELECT id FROM profiles WHERE role IN ('admin', 'manager')));

DROP POLICY IF EXISTS "Update Approval Queue" ON approval_queue;
CREATE POLICY "Update Approval Queue" ON approval_queue FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid());
```

---

## 8. API設計

### 8.1 承認API

| エンドポイント | メソッド | 機能 |
|---------------|---------|------|
| /api/v1/approvals/queue | GET | 承認待ち一覧 |
| /api/v1/approvals/:id | GET | 承認詳細 |
| /api/v1/approvals/:id/approve | POST | 承認 |
| /api/v1/approvals/:id/reject | POST | 否認 |
| /api/v1/approvals/batch-review | POST | 一括承認 |
| /api/v1/approvals/stats | GET | 統計情報 |

### 8.2 AI提案API

| エンドポイント | メソッド | 機能 |
|---------------|---------|------|
| /api/v1/proposals | GET | AI提案一覧 |
| /api/v1/proposals/:id | GET | 提案詳細 |
| /api/v1/proposals/:id/approve | POST | 提案承認・実行 |
| /api/v1/proposals/:id/reject | POST | 提案却下 |
| /api/v1/proposals/trigger/:type | POST | 手動トリガー |

### 8.3 ルールAPI

| エンドポイント | メソッド | 機能 |
|---------------|---------|------|
| /api/v1/rules | GET | ルール一覧 |
| /api/v1/rules | POST | ルール作成 |
| /api/v1/rules/:id | PUT | ルール更新 |
| /api/v1/rules/:id | DELETE | ルール削除 |
| /api/v1/rules/:id/toggle | POST | 有効/無効切替 |

---

## 9. UI/UX設計

### 9.1 ダッシュボード再設計

```
┌─ GENBA QUEST Dashboard ──────────────────────────────┐
│                                                       │
│  🔔 通知 (5)  📋 承認待ち (15)  🤖 AI提案 (3)         │
│                                                       │
│  ┌─ 今日やること ─────────────────────────────────┐  │
│  │                                                 │  │
│  │  🔴 緊急承認 (2件)                               │  │
│  │  ├─ [経費] ¥150,000 外注費 (今日期限)            │  │
│  │  └─ [現場] 新規受注可否投票 (あと2票)             │  │
│  │                                                 │  │
│  │  🤖 AI提案 (3件)                                 │  │
│  │  ├─ 現場A 請求書作成推奨 (信頼度: 95%)            │  │
│  │  ├─ 田中さん 休暇推奨 (スタミナ: 25%)             │  │
│  │  └─ 予算超過アラート: 現場B                      │  │
│  │                                                 │  │
│  │  ⚡ ワンクリック承認可能 (8件)                    │  │
│  │  [一括承認する]                                  │  │
│  │                                                 │  │
│  └─────────────────────────────────────────────┘  │
│                                                       │
│  ┌─ 稼働中の現場 (モンスター) ─────────────────────┐  │
│  │  [MonsterBattleCard × 3]                         │  │
│  └─────────────────────────────────────────────┘  │
│                                                       │
│  ┌─ パーティメンバー ──────────────────────────┐  │
│  │  [MemberCard × 7]                                │  │
│  └─────────────────────────────────────────────┘  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 9.2 AI提案パネル

```typescript
// frontend/src/components/AIProposalPanel.tsx

export function AIProposalPanel() {
  const [proposals, setProposals] = useState<AIProposal[]>([]);

  return (
    <div className={styles.panel}>
      <h2>🤖 AI提案</h2>

      {proposals.map(proposal => (
        <div key={proposal.id} className={styles.proposalCard}>
          <div className={styles.header}>
            <span className={styles.type}>{typeLabels[proposal.proposal_type]}</span>
            <span className={styles.confidence}>信頼度: {(proposal.ai_confidence * 100).toFixed(0)}%</span>
          </div>

          <p className={styles.reasoning}>{proposal.ai_reasoning}</p>

          {proposal.proposal_type === 'create_invoice' && (
            <div className={styles.invoicePreview}>
              <p>請求額: ¥{proposal.proposal_data.amount_total.toLocaleString()}</p>
              <p>支払期限: {proposal.proposal_data.due_date}</p>
            </div>
          )}

          <div className={styles.actions}>
            <button onClick={() => approveProposal(proposal.id)}>承認して実行</button>
            <button onClick={() => editProposal(proposal.id)}>編集</button>
            <button onClick={() => rejectProposal(proposal.id)}>却下</button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 10. 実装ロードマップ

### Week 1-2: Phase 1 - 統合承認ダッシュボード

- [ ] Day 1-2: DB設計 (approval_queue, unified_approval_view)
- [ ] Day 3-4: API実装 (/api/v1/approvals/*)
- [ ] Day 5-7: Frontend実装 (ApprovalDashboard, ApprovalCard)
- [ ] Day 8-10: 既存承認フローの統合 (経費・パーク)
- [ ] Day 11-14: テスト・バグ修正

### Week 3-4: Phase 2 - AI自動提案エンジン

- [ ] Day 1-3: DB設計 (ai_proposals)
- [ ] Day 4-7: 提案エンジン実装 (proposeSiteInvoice, proposeHoliday)
- [ ] Day 8-10: スケジューラー実装
- [ ] Day 11-12: Frontend (AIProposalPanel)
- [ ] Day 13-14: テスト・調整

### Week 5-6: Phase 3 - スマートルールエンジン

- [ ] Day 1-2: DB設計 (approval_rules)
- [ ] Day 3-5: ルールエンジン実装
- [ ] Day 6-8: ルール設定UI
- [ ] Day 9-10: 既存フローへの統合
- [ ] Day 11-14: テスト・ドキュメント作成

### Week 7-8: Phase 4 - DAO要素拡張

- [ ] Day 1-3: 投票システム拡張
- [ ] Day 4-7: トークンエコノミー実装
- [ ] Day 8-10: Frontend統合
- [ ] Day 11-14: 総合テスト・リリース準備

---

## 付録A: プロンプト例

### A.1 請求書生成プロンプト

```
あなたは建設業の経理AIです。以下の現場が完了しました。

現場情報:
- ID: {site_id}
- 名称: {site_name}
- クライアント: {client_name}
- 売上予定: ¥{revenue}
- 実績工数: {actual_hours}h (予定: {estimated_hours}h)
- 完了日: {completed_at}

経費集計:
- 材料費: ¥{material_cost}
- 外注費: ¥{subcontract_cost}
- その他: ¥{other_cost}
- 経費合計: ¥{total_expenses}

請求書を作成すべきか判断し、以下のJSON形式で回答してください:

{
  "should_create": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "判断理由",
  "proposed_invoice": {
    "amount_subtotal": 税抜金額,
    "tax_amount": 消費税,
    "amount_total": 税込合計,
    "due_date": "YYYY-MM-DD",
    "notes": "備考"
  },
  "warnings": ["警告があれば"]
}

判断基準:
1. 現場完了から3営業日以内に請求書を作成すべき
2. 経費が売上の70%を超える場合は警告
3. 実績工数が予定の150%を超える場合は要確認
```

### A.2 休暇推奨プロンプト

```
あなたは労務管理AIです。以下のメンバーの状態を分析してください。

メンバー情報:
- 名前: {full_name}
- スタミナ: {stamina}%
- 休暇残高: {holiday_days}日
- 年間目標: {holiday_target}日
- 現在の現場: {current_site_name}
- 直近1ヶ月の稼働: {recent_hours}h

休暇を推奨すべきか、何日間推奨すべきか判断し、JSON形式で回答してください:

{
  "should_recommend": true/false,
  "recommended_days": 数値,
  "reasoning": "理由",
  "urgency": "low/medium/high",
  "timing_suggestion": "推奨タイミング"
}

判断基準:
1. スタミナ30%以下は休暇推奨
2. スタミナ20%以下は緊急
3. 休暇残高と年間目標のペースも考慮
```

---

## 変更履歴

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-02 | Claude | 初版作成 |

---

**次のステップ**: Phase 1の実装を開始

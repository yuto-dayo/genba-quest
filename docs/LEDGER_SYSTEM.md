# Ledger（会計）システム設計書

## 概要

ダブルエントリー（複式簿記）をベースとした、
イベント志向の会計システム。

---

## 設計原則

### 1. イベント志向
- すべての変更は **LedgerEvent** として記録
- イベントは不変（immutable）
- 修正は「逆仕訳イベント」で対応

### 2. ダブルエントリー
- 1つの取引は複数の **LedgerEntry** を持つ
- 借方合計 = 貸方合計（必ずバランス）

### 3. Proposal経由
- 直接書き込みは禁止
- 必ずProposalが承認されてからイベント生成

---

## データモデル

### LedgerEvent（イベント）

```typescript
interface LedgerEvent {
  id: string;
  org_id: string;

  // Proposalとの紐付け
  proposal_id: string;

  // 種別
  type: LedgerEventType;

  // タイムスタンプ
  occurred_at: string;   // 実際の発生日時
  recorded_at: string;   // 記録日時

  // アクター
  actor: ActorRef;

  // 説明
  description: string;

  // メタデータ
  metadata: Record<string, unknown>;
}

type LedgerEventType =
  | 'expense'      // 経費
  | 'income'       // 売上
  | 'reward'       // 報酬支払い
  | 'adjustment'   // 調整
  | 'transfer'     // 振替
  | 'reversal';    // 逆仕訳（修正用）
```

### LedgerTransaction（取引）

```typescript
interface LedgerTransaction {
  id: string;
  event_id: string;

  // ステータス
  status: 'pending' | 'posted' | 'voided';

  // 金額合計（検証用）
  total_amount: number;

  // エントリ（子）
  entries: LedgerEntry[];
}
```

### LedgerEntry（仕訳明細）

```typescript
interface LedgerEntry {
  id: string;
  transaction_id: string;

  // 勘定科目
  account: AccountCode;

  // 借方・貸方
  debit: number;   // 借方金額
  credit: number;  // 貸方金額

  // 文脈（紐付け）
  site_id?: string;
  worker_id?: string;
  vendor_id?: string;

  // 説明
  memo?: string;
}

// 勘定科目コード
type AccountCode =
  // 資産
  | 'cash'              // 現金
  | 'bank'              // 預金
  | 'accounts_receivable' // 売掛金
  | 'inventory'         // 棚卸資産

  // 負債
  | 'accounts_payable'  // 買掛金
  | 'accrued_expenses'  // 未払金
  | 'rewards_payable'   // 未払報酬

  // 収益
  | 'revenue'           // 売上高
  | 'other_income'      // 雑収入

  // 費用
  | 'materials'         // 材料費
  | 'tools'             // 工具費
  | 'transportation'    // 交通費
  | 'food'              // 食費
  | 'rewards_expense'   // 報酬費用
  | 'other_expense';    // その他経費
```

---

## 仕訳パターン

### 経費（現金払い）

```
経費登録: ホームセンターで資材購入 ¥10,000

  借方              貸方
  ─────────────────────────
  材料費  10,000  │ 現金  10,000
```

### 経費（後払い/立替）

```
経費登録: 業者から資材購入（後払い）¥50,000

  借方              貸方
  ─────────────────────────
  材料費  50,000  │ 買掛金  50,000

支払い時:
  借方              貸方
  ─────────────────────────
  買掛金  50,000  │ 現金  50,000
```

### 売上

```
売上登録: 〇〇ビル工事 ¥500,000

  借方              貸方
  ─────────────────────────
  売掛金  500,000 │ 売上高  500,000

入金時:
  借方              貸方
  ─────────────────────────
  現金  500,000   │ 売掛金  500,000
```

### 報酬分配

```
報酬計算: 〇〇ビル工事 分配総額 ¥350,000

  借方              貸方
  ─────────────────────────
  報酬費用  350,000 │ 未払報酬(田中)  150,000
                   │ 未払報酬(山田)  120,000
                   │ 未払報酬(佐藤)   80,000

支払い時:
  借方              貸方
  ─────────────────────────
  未払報酬(田中)  150,000 │ 現金  150,000
  未払報酬(山田)  120,000 │ 現金  120,000
  未払報酬(佐藤)   80,000 │ 現金   80,000
```

### 修正（逆仕訳）

```
間違った経費を修正: 元の記録 ¥10,000 → 正しくは ¥8,000

1. 逆仕訳（元を取り消し）
  借方              貸方
  ─────────────────────────
  現金  10,000    │ 材料費  10,000

2. 正しい仕訳
  借方              貸方
  ─────────────────────────
  材料費  8,000   │ 現金  8,000
```

---

## 勘定科目ツリー

```
1000 資産
  1100 流動資産
    1110 現金
    1120 預金
    1130 売掛金
  1200 棚卸資産
    1210 材料

2000 負債
  2100 流動負債
    2110 買掛金
    2120 未払金
    2130 未払報酬

3000 資本
  3100 元入金
  3200 繰越利益

4000 収益
  4100 売上高
  4200 雑収入

5000 費用
  5100 材料費
  5200 工具費
  5300 交通費
  5400 食費
  5500 報酬費用
  5900 その他経費
```

---

## Read Models（UIビュー）

### MonthlyPL（月次損益）

```typescript
interface MonthlyPL {
  org_id: string;
  month: string;  // YYYY-MM

  revenue: number;        // 売上高
  expenses: number;       // 経費合計
  rewards: number;        // 報酬費用
  profit: number;         // 営業利益
  distributable: number;  // 分配可能額

  by_category: Record<string, number>;  // 科目別内訳
  by_site: Record<string, SitePL>;      // 現場別内訳
}

interface SitePL {
  site_id: string;
  site_name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;  // 利益率
}
```

### AccountBalance（勘定残高）

```typescript
interface AccountBalance {
  account: AccountCode;
  account_name: string;
  debit_total: number;
  credit_total: number;
  balance: number;
  as_of: string;
}
```

### TransactionList（取引一覧）

```typescript
interface TransactionView {
  id: string;
  date: string;
  type: LedgerEventType;
  description: string;
  amount: number;
  account: string;
  site?: string;
  worker?: string;
  status: string;
}
```

---

## クエリ例

### 現場別利益

```sql
SELECT
  s.id,
  s.name,
  COALESCE(SUM(e.credit) FILTER (WHERE e.account = 'revenue'), 0) as revenue,
  COALESCE(SUM(e.debit) FILTER (WHERE e.account LIKE '5%'), 0) as expenses,
  COALESCE(SUM(e.credit) FILTER (WHERE e.account = 'revenue'), 0) -
    COALESCE(SUM(e.debit) FILTER (WHERE e.account LIKE '5%'), 0) as profit
FROM sites s
LEFT JOIN ledger_entries e ON e.site_id = s.id
LEFT JOIN ledger_transactions t ON t.id = e.transaction_id
WHERE t.status = 'posted'
GROUP BY s.id, s.name;
```

### 月次PL

```sql
WITH monthly AS (
  SELECT
    DATE_TRUNC('month', ev.occurred_at) as month,
    e.account,
    SUM(e.debit) as debit,
    SUM(e.credit) as credit
  FROM ledger_entries e
  JOIN ledger_transactions t ON t.id = e.transaction_id
  JOIN ledger_events ev ON ev.id = t.event_id
  WHERE t.status = 'posted'
  GROUP BY 1, 2
)
SELECT
  month,
  SUM(credit) FILTER (WHERE account = 'revenue') as revenue,
  SUM(debit) FILTER (WHERE account LIKE '5%' AND account != 'rewards_expense') as expenses,
  SUM(debit) FILTER (WHERE account = 'rewards_expense') as rewards
FROM monthly
GROUP BY month
ORDER BY month DESC;
```

---

## イベント→仕訳の変換

Proposalが承認されると、変換ルールに従ってLedgerEvent/Transactionが生成される。

```typescript
interface JournalTemplate {
  event_type: LedgerEventType;
  entries: EntryTemplate[];
}

interface EntryTemplate {
  account: AccountCode | ((payload: any) => AccountCode);
  debit: ((payload: any) => number) | null;
  credit: ((payload: any) => number) | null;
  site_id?: ((payload: any) => string);
  worker_id?: ((payload: any) => string);
}

// 例: 経費テンプレート
const expenseTemplate: JournalTemplate = {
  event_type: 'expense',
  entries: [
    {
      account: (p) => categoryToAccount(p.category),
      debit: (p) => p.amount,
      credit: null,
      site_id: (p) => p.site_id,
    },
    {
      account: 'cash',
      debit: null,
      credit: (p) => p.amount,
    },
  ],
};
```

---

## 整合性チェック

### バランスチェック

```sql
-- 全取引の借方・貸方バランス確認
SELECT
  t.id,
  SUM(e.debit) as total_debit,
  SUM(e.credit) as total_credit,
  SUM(e.debit) - SUM(e.credit) as imbalance
FROM ledger_transactions t
JOIN ledger_entries e ON e.transaction_id = t.id
GROUP BY t.id
HAVING SUM(e.debit) != SUM(e.credit);
-- 結果が0件であるべき
```

### 監査ログ

```sql
-- Proposal → Event → Transaction の追跡
SELECT
  p.id as proposal_id,
  p.type,
  p.created_by->>'name' as proposer,
  p.approvals,
  ev.id as event_id,
  t.id as transaction_id,
  t.total_amount
FROM proposals p
LEFT JOIN ledger_events ev ON ev.proposal_id = p.id
LEFT JOIN ledger_transactions t ON t.event_id = ev.id
WHERE p.status = 'executed'
ORDER BY p.created_at DESC;
```

---

## 次のステップ

- [ ] 勘定科目マスタ設計
- [ ] LedgerEvent/Transaction/Entry テーブル設計
- [ ] 仕訳テンプレートエンジン実装
- [ ] Read Model（MaterializedView）設計
- [ ] 整合性チェックジョブ

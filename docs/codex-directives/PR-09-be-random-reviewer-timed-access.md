# PR-09 — BE: メンバー請求書発行時の経理ランダム割当 + 時限アクセス RPC

## Goal
メンバー請求書が発行されたとき、経理フラグ持ちプールからランダム1人を選び、その人だけが**時限的に**当該請求書詳細(振込先・本名)を閲覧できるようにする。

## Acceptance criteria

- [ ] member_invoice 発行 Proposal executor 内に `assignFinanceReviewer(invoice_id)` を呼び出すフック
- [ ] `org_finance_reviewer_pool`(または既存の経理フラグ機構)から候補抽出 → ランダム1選
- [ ] `invoice_review_assignments` テーブル新設: `invoice_id, reviewer_user_id, expires_at, completed_at`
- [ ] expires_at は発行から 7 日(設定可能、`org_settings.finance_review_window_hours`)
- [ ] reviewer に通知 insert: `type='approval_required'`, `data={ invoice_id, kind: 'member_invoice_pay' }`
- [ ] `GET /api/v1/accounting/invoices/:id/payout-detail` 新設: 振込先・本名含む。assigned reviewer かつ未完了/未失効のみ 200
- [ ] `POST /api/v1/accounting/invoices/:id/mark-paid` 新設: 既存 `invoice.member_mark_paid` Proposal を発行、completed_at を更新
- [ ] 失効/完了後の `payout-detail` 取得は 403
- [ ] 単体テスト: 候補1人 / 0人 / 自分が候補に含まれる場合 / expires 後の挙動

## Files

- `supabase/migrations/YYYYMMDD_invoice_review_assignments.sql`
- `server/src/services/InvoiceReviewerAssignmentService.ts` 新規
- `server/src/services/ProposalService.ts` — `invoice.create` 実行成功時に hook
- `server/src/routes/accounting.ts` — 2 endpoints 追加

## Migration sketch

```sql
CREATE TABLE public.invoice_review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES member_invoices(id),
  reviewer_user_id uuid NOT NULL REFERENCES auth.users(id),
  org_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  reassigned_from uuid REFERENCES invoice_review_assignments(id),
  CONSTRAINT invoice_review_assignments_invoice_unique
    UNIQUE (invoice_id, reviewer_user_id, expires_at)
);

CREATE INDEX ON invoice_review_assignments (reviewer_user_id, expires_at, completed_at);
CREATE INDEX ON invoice_review_assignments (invoice_id);

-- RLS: 当該 reviewer のみ自分のアサインを読める
ALTER TABLE invoice_review_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviewer_sees_own" ON invoice_review_assignments
  FOR SELECT USING (reviewer_user_id = auth.uid());
```

## `payout-detail` endpoint

```
GET /api/v1/accounting/invoices/:id/payout-detail
```

Logic:
1. assignment が存在 / `reviewer_user_id = req.userId` / `completed_at IS NULL` / `expires_at > NOW()` を確認
2. 上記すべて真なら member_invoice の `snapshot_bank, snapshot_name, snapshot_tax_id, body_html` を返す
3. それ以外は 403

Response 200:
```ts
{
  invoice_id: string;
  amount: number;
  issued_at: string;
  snapshot: {
    bank_name: string;
    branch_name: string;
    account_type: string;
    account_number: string;
    account_holder: string;
    real_name: string;
    tax_id: string | null;
  };
  body_html: string;          // 請求書本文
  expires_at: string;
}
```

## `mark-paid` endpoint

```
POST /api/v1/accounting/invoices/:id/mark-paid
```

Body: `{ paid_at: string, memo?: string }`
Auth: assignment が active な reviewer のみ

Side effect:
1. `invoice.member_mark_paid` Proposal を AI 自己承認禁止のため human actor として executed 実行(Proposal 制度経由)
2. `invoice_review_assignments.completed_at = NOW()`
3. 元請求書発行者に通知 `type='approval_result', data={ kind: 'paid', invoice_id }`

## Reassignment

assignment が expires_at を超えた未完了は cron(別 PR 拡張)で `expires_at` を延長 + 新規 reviewer を再ランダム選出。本 PR では `reassign(invoice_id)` 内部関数だけ実装、定期実行は後続。

## Edge cases

- 経理フラグ持ちが 0 人: assignment 作らず、通知を全 admin に送るフォールバック
- 経理フラグ持ちが 1 人で本人=発行者: 発行者除外 → 0 人にフォールバック
- ロールが流動的(`org_member.finance_flag` 想定):無ければ `org_settings.finance_reviewer_pool[]` を見る
- 失効後の payout-detail: 403 + `{ error: "assignment expired" }`

## Forbidden

- assigned reviewer 以外に payout-detail を返す
- snapshot_* を本人以外のクライアントへ送る別経路を作る
- Proposal を経由せず DB 直接更新

## Reference
- Memory: `project_billing_reminder_assignment.md`, `project_random_reviewer_assignment.md`, `project_member_consent_invoice_flow.md`
- 既存: `webhooks.ts` の `approval_required` insert pattern
- baseline migration: `member_invoices` 定義(snapshot_* 列)

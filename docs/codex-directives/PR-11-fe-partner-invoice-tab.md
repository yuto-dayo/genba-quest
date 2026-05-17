# PR-11 — FE: 取引先タブを「取引先・請求書」にリネーム + 件数チップ + カード内 invoice inline

## Goal
Money 画面の「取引先」タブを「取引先・請求書」に拡張。期限軸の件数チップ + 各取引先カードに直近請求書状態を inline 表示 + 取引先詳細ドロワーで請求書履歴・操作。

## Acceptance criteria

- [x] タブ名を「取引先」→「取引先・請求書」に変更
- [x] タブ上部に件数フィルタチップ: `[期限超過 N][今週入金予定 N][下書き N][全部]`
- [x] 各取引先カードに直近1件の請求書状態(MoneyMock.tsx の partnerCard 構造)
- [x] 期限超過カードは左に 3px 縦バー(`--money-status-overdue`)
- [x] カードタップ → 右ドロワー(取引先詳細)open
- [x] ドロワーに過去全請求書のタイムライン + `[入金を記録]` ボタン
- [x] **`[+ 新規請求書を発行]` ボタンは置かない**(FAB一本化、案Y)
- [x] tsc/lint/test グリーン

## Files

- `frontend/src/pages/Money.tsx` — タブラベル更新
- `frontend/src/components/InvoiceListPanel`(存在すれば) — 機能を取引先タブに吸収、PR-12 で本体削除
- `frontend/src/components/PartnerCard.tsx` — invoice line inline 追加
- `frontend/src/components/money/PartnerDetailDrawer.tsx`(新規) — 右ドロワー
- `frontend/src/components/money/InvoiceFilterRow.tsx`(新規) — 件数チップ

## Filter logic

```ts
const buckets = {
  overdue: invoices.filter(i => isOverdue(i)),
  this_week: invoices.filter(i => !isOverdue(i) && daysUntilDue(i) <= 7),
  draft: invoices.filter(i => i.status === 'draft'),
  all: invoices,
};
```

`isOverdue`: due_date < today (JST)
`daysUntilDue`: (due_date - today) in days

## API

- 新: `GET /api/v1/accounting/invoices?bucket=overdue|this_week|later|draft|all` — bucket 単位フィルタ
- 既存: `GET /api/v1/accounting/invoices` をクエリで拡張

## Drawer

- 取引先 1 件分の請求書を時系列で list
- 各行: 発行日 / 金額 / 状態 / アクション(`[入金を記録]`/`[PDF]`)
- フッタ: 連絡先(Communication tab と連動するなら link)
- 下端固定で `[閉じる]`

## Edge cases

- 期限超過 0 件: チップ「期限超過 0」は非表示(空状態見せない)
- フィルタ適用後 0 件: 「該当する請求書はありません」inline
- 取引先名長い: text-overflow ellipsis、aria-label 保持

## Forbidden

- ドロワー内に新規請求書発行 CTA を置く
- カード内に長い説明文
- タブ内に独立した検索 UI(既存検索バーで足りる)

## Reference
- Mock: `MoneyMock.tsx` の `InvoiceTab`, `FilterChip`, `partnerCard` 系
- Memory: `project_pr6_partner_summary.md`, `feedback_money_design_principles.md`

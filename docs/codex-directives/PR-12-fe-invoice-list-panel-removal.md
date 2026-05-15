# PR-12 — FE: InvoiceListPanel 廃止

## Goal
Money 画面のサイドカラム `InvoiceListPanel` を削除。機能は PR-11 で取引先タブに吸収済み前提。

## Acceptance criteria

- [ ] `frontend/src/components/InvoiceListPanel.tsx` ファイル削除
- [ ] `frontend/src/pages/Money.tsx` から `InvoiceListPanel` の import / 使用箇所削除
- [ ] サイドカラム自体不要なら `Money.module.css` のレイアウトクラス整理
- [ ] InvoiceListPanel の test ファイルがあれば削除
- [ ] tsc/lint/test グリーン

## Files

- `frontend/src/components/InvoiceListPanel.tsx` — 削除
- `frontend/src/components/InvoiceListPanel.module.css` — 削除
- `frontend/src/components/InvoiceListPanel.test.tsx`(存在すれば) — 削除
- `frontend/src/pages/Money.tsx` — 参照削除

## Forbidden

- 機能を別所に部分残し
- InvoiceListPanel が他ページ(Today, Sites など)で使われていたら本 PR で削除しない、ログだけ残して別 PR 化

## Reference
- PR-11 が前提

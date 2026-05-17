# PR-13 — FE: 旧メンバー請求書セクションのMoney画面からの削除

## Goal
Money 画面の旧「未請求残」「支払い対象」セクション(`OutstandingInvoicesCard`, `AdminInvoiceActionableList`, `MemberInvoiceDraftBanner`, `MyMemberInvoicesList`)を画面から削除。これらの役割は自分カード詳細モーダル(PR-04)とベル経由フロー(PR-08, PR-10)に吸収済み。

## Acceptance criteria

- [x] `Money.tsx` から下記コンポーネントの使用箇所を削除:
  - `OutstandingInvoicesCard`
  - `AdminInvoiceActionableList`
  - `MemberInvoiceDraftBanner`
  - `MyMemberInvoicesList`
- [x] 上記コンポーネント自体は **削除しない**(将来再利用余地 / 他ページで参照されてる可能性)。Money 画面からの参照のみ落とす
- [x] 関連 import 整理、未使用 hook / state 削除
- [x] スナップショットテストが既存にあれば更新
- [x] tsc/lint/test グリーン

## Files

- `frontend/src/pages/Money.tsx` — 4 コンポーネントの使用箇所削除(line 711–722 周辺)

## Verification

PR-04 で自分カードモーダルが invoice issue を吸収していること、PR-10 でベル経由の支払い操作が動くこと、PR-11 で取引先タブから顧客請求書管理ができることを確認してから本 PR をマージする。

## Forbidden

- コンポーネント本体を削除(別 PR でクリーンアップ)
- Money 以外のページから参照を削る(scope 越え)

## Reference
- PR-04, PR-10, PR-11 マージ後にマージする
- Memory: `project_money_as_single_finance_entry.md`

# PR-15 — FE: FAB 統一(ラベル付き `[+ 追加]`、ボトムシート化)+ ExpenseModal `paid_by` 分岐

## Goal
Money 画面の作成エントリを FAB 一本に統合。Quick Actions Buttons(desktop only)と InvoiceListPanel の作成 CTA を削除。FAB タップで bottom sheet 展開で 3択(経費・立替/請求書/売上)。ExpenseModal は立替/会社払いの分岐を持つ。

## Acceptance criteria

- [ ] Money 画面の FAB がラベル付き `[+ 追加]`
- [ ] FAB タップで `<FabSheet>` 展開: 3 項目(経費・立替を記録 / 請求書を発行 / 売上を記録)
- [ ] 報酬請求書は FAB に **含めない**(自分カードモーダル経由のみ)
- [ ] `Money.tsx` line 733–748 の Quick Actions Buttons 削除
- [ ] `ExpenseModal` に `paid_by: 'org' | 'member'` フィールド追加(タブ or トグル切替)
- [ ] member 選択時に `claimant_member_id`(default = 自分)プルダウン表示
- [ ] tsc/lint/test グリーン

## Files

- `frontend/src/pages/Money.tsx` — Quick Actions 削除、FAB 改修
- `frontend/src/components/money/FabSheet.tsx` 新規
- `frontend/src/components/money/FabSheet.module.css`
- `frontend/src/components/ExpenseModal.tsx` — paid_by フィールド追加
- `frontend/src/lib/api.ts` — `CreateExpenseRequest` への paid_by 等は PR-02 で済み

## FabSheet spec

per `MoneyMock.tsx` の `FabSheet`:
- ヘッダ: 「何を追加しますか？」 + 閉じる
- 3 行(高さ 64px 以上、タップターゲット 48px 確保):
  - 💰 経費・立替を記録 / サブテキスト「立替/会社払いはモーダル内で選択」
  - 📄 請求書を発行 / サブテキスト「顧客向け」
  - 💵 売上を記録 / サブテキスト「手入力」
- 各タップで対応モーダル(ExpenseModal / 顧客請求書発行 / 売上記録)を inline 起動、FabSheet は閉じる

## ExpenseModal paid_by 分岐

UI:
```
誰が払った？ [会社] [立替]    ← セグメントコントロール
```

`paid_by === 'member'` 時の追加フィールド:
- `claimant_member_id`: default = `req.userId`、必要なら他メンバーを選べる(チームで誰かの立替を代理入力するケース)
- `payment_account`: 任意

`paid_by === 'org'` の時は従来挙動。

## Edge cases

- FabSheet 開いてる時に scroll: scrim 越しにスクロール阻止
- ExpenseModal の paid_by 切替で既入力フィールドは保持
- 立替モードで claimant が org member でない人を選んだら disabled

## Forbidden

- 報酬請求書を FabSheet に含める
- FAB を desktop で別 UI にする(同一 UI、レスポンシブ調整のみ)
- ExpenseModal を 2 画面に分割

## Reference
- Mock: `MoneyMock.tsx` の `FabSheet`
- Memory: `project_money_fab_single_entry.md`
- 既存: `frontend/src/components/ExpenseModal.tsx`

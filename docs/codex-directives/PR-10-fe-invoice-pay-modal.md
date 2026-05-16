# PR-10 — FE: ベル経由 請求書支払い操作モーダル(時限表示)

## Goal
PR-09 で経理担当ランダム割当された reviewer が、ベル通知タップで時限的に請求書詳細(振込先・本名)を閲覧 + `[支払い済みにする]` 操作するモーダル実装。

## Acceptance criteria

- [ ] BellDrawer の `approval_required` で `kind: 'member_invoice_pay'` の通知をリスト表示
- [ ] 通知タップで `/money?modal=invoice_pay&invoice_id=...` に遷移
- [ ] Money 画面が URL を検知して `<InvoicePayModal>` を開く
- [ ] モーダル内で `fetchInvoicePayoutDetail(invoiceId)` を呼ぶ
- [ ] 振込先・本名・T番号・金額・期限・残り閲覧時間 を表示
- [ ] `[支払い済みにする]` で `markInvoicePaid(invoiceId, { paid_at })` を呼ぶ、確認ダイアログのみ
- [ ] 完了時にトースト + モーダル閉じ + 該当通知を read 化
- [ ] 失効した assignment の場合は 403 → 「閲覧期間が終了しました」表示
- [ ] tsc/lint/test グリーン

## Files

- `frontend/src/components/money/InvoicePayModal.tsx`
- `frontend/src/components/money/InvoicePayModal.module.css`
- `frontend/src/lib/api.ts` — `fetchInvoicePayoutDetail`, `markInvoicePaid` 追加
- `frontend/src/pages/Money.tsx` — URL ルーティング(`modal=invoice_pay`)
- `frontend/src/components/BellDrawer.tsx` — 通知 kind 判定 + navigate

## Modal layout

per `MoneyMock.tsx` の `InvoicePayModal`:
- ヘッダ: 「請求書の支払い」
- メトリクスカード: 取引先 nickname placeholder(実態は発行者 nickname) + 金額
- 詳細表: 期限 / 状態 / 振込先(銀行 / 支店 / 種類 / 口座番号 / 名義) / T番号 / 本名
- 残り時間バナー: 「閲覧可能時間: あと N 時間」
- アクション: `[閉じる][支払い済みにする]`

確認ダイアログ:
```
銀行への振込は完了しましたか？

[キャンセル] [はい、支払い済みにする]
```

## Time-bound display

`expires_at` を表示。5 分ごとに再 fetch して残り時間更新(useEffect + setInterval)。失効後は inline で 403 メッセージ。

## Edge cases

- マルチ assignments(再アサイン後など): 最新の自分の assignment を選択
- ネットワーク断中: ローカル "支払い済み準備中" 状態にして、復帰時に再送(stale-while-revalidate)
- 別タブで支払済になった: モーダル開く時点で 410 Gone → 「他のメンバーが処理済みです」

## Forbidden

- snapshot_* を localStorage / sessionStorage に保存
- expires_at を超えても表示し続ける(client 側でも 403 を尊重)
- 支払い済みを取り消す UI を出す(別経路)

## Reference
- Mock: `MoneyMock.tsx` の `InvoicePayModal`
- API: PR-09 で定義された `payout-detail`, `mark-paid`
- Memory: `project_transparency_as_defense.md`, `project_billing_reminder_assignment.md`

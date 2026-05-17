# PR-17 — FE: UX 計測(FAB / 報酬カード / 請求書発行 / 月確定 / 未請求解消率)

## Goal
Money リデザインの効果計測のため、主要イベントを既存 telemetry 基盤に追加。

## Acceptance criteria

- [x] 以下イベントが発火する:
  - `money.fab.clicked` `{ from_tab }`
  - `money.fab.option_clicked` `{ option: 'expense'|'invoice'|'sale' }`
  - `money.reward_card.tapped` `{ is_self, status }`
  - `money.invoice.issued` `{ from: 'own_reward_modal'|'fab' }`
  - `money.month_close.completed` `{ duration_ms, members_count }`
  - `money.month_close.cta_seen` `{ from: 'bell'|'url_param' }`
  - `money.invoice.paid` `{ from: 'bell'|'partner_drawer' }`
  - `money.shield.opened`
  - `money.partner_tab.filter_changed` `{ bucket }`
- [x] PII を含めない(member_id, amount すら出さない。集計時に件数だけ)
- [x] 既存 telemetry helper(なければ最小ラッパ `frontend/src/lib/telemetry.ts` 新規)経由
- [x] tsc/lint/test グリーン

## Files

- `frontend/src/lib/telemetry.ts` 新規(または既存利用)
- 各コンポーネントに `track('money.xxx', payload)` 呼び出し追加

## Helper sketch

```ts
type TelemetryEvent =
  | { type: 'money.fab.clicked'; from_tab: string }
  | { type: 'money.fab_sheet.option_clicked'; option: 'expense' | 'invoice' | 'sale' }
  | { type: 'money.reward_card.tapped'; is_self: boolean; status: string }
  ;

export function track(event: TelemetryEvent) {
  if (import.meta.env.DEV) {
    console.debug('[telemetry]', event);
    return;
  }
  // production: POST /api/v1/telemetry or Pendo/Mixpanel SDK等
}
```

## Forbidden

- amount / member_id / invoice_id を payload に含める
- console.error を意図的に発生させる
- IP / userAgent 等のヘッダを暗黙送信(明示同意なし)

## Reference
- Memory: 計測ポイントは `feedback_money_design_principles.md` の「4つの問い」を裏付ける指標

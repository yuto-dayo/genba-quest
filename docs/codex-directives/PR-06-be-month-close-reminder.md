# PR-06 — BE: 月確定リマインダー基盤(notification type + 生成 endpoint)

## Goal
月確定リマインダー通知を全メンバーに配るための DB / API 基盤を整える。Cron が叩く endpoint と、`notifications.type` enum 追加。

## Acceptance criteria

- [ ] migration: `notifications_type_check` に `month_close_reminder` を追加
- [ ] endpoint: `POST /api/v1/path/month/_remind-close` 動作
  - Authorization: `Bearer ${CRON_SECRET}` ヘッダで保護
  - 各 org に対し、前月が `finalized=false` ならメンバー全員に通知 insert
  - 当日分は upsert(同じ org/member/month/date キーで idempotent)
- [ ] notifications.data に `{ month: "YYYY-MM" }` を埋め込む
- [ ] 月確定済の org はスキップ + 200 で結果サマリ返す
- [ ] 単体テスト: 未確定 org → insert 発生 / 確定済 org → skip
- [ ] tsc/lint/test グリーン

## Files

- `supabase/migrations/YYYYMMDD_add_month_close_reminder_notification_type.sql`
- `server/src/routes/pathModule.ts`(または専用ファイル) — `POST /month/_remind-close`
- `server/src/services/MonthCloseReminderService.ts`(新規) — 集計 + insert ロジック
- `server/src/middleware/cronAuth.ts`(無ければ新規) — Bearer token 検証

## Migration sketch

```sql
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('auto_quest','approval_required','approval_result','schedule_conflict','system_alert','month_close_reminder'));
```

## Endpoint contract

`POST /api/v1/path/month/_remind-close`

Headers: `Authorization: Bearer ${CRON_SECRET}`

Body (optional override for testing): `{ "month"?: "YYYY-MM", "force"?: boolean }`

Default behavior: previous month(JST) を対象。今日が `YYYY-06-03` なら `2026-05` を確認。

Response 200:
```ts
{
  target_month: string;
  orgs_processed: number;
  orgs_already_finalized: number;
  notifications_inserted: number;
  errors: Array<{ org_id: string; reason: string }>;
}
```

## Idempotency

同一 (org_id, user_id, month, DATE(NOW())) で既に通知があればスキップ。SQL で:
```sql
INSERT INTO notifications (...)
SELECT ... WHERE NOT EXISTS (
  SELECT 1 FROM notifications
  WHERE user_id = $1 AND type = 'month_close_reminder'
    AND data->>'month' = $2 AND created_at::date = CURRENT_DATE
);
```

## Edge cases

- Org にメンバーがいない → skip
- 該当 user が deactivated → skip
- `CRON_SECRET` 未設定 → 環境変数チェックで 500 fail-fast(silent skip 禁止)
- 月末ロックされてないのに月初リマインダー出すケース: `is_locked` 確認も追加。lock 未実施なら異なる文言の通知(「ロックがまだ走ってません」)も検討 — ただし本 PR では single 通知タイプで足りる、文言は固定。

## Forbidden

- Endpoint を unauthenticated にする
- 通知に振込先・個人情報を含める
- notification を delete する処理を含める(append-only)

## Reference
- Memory: `project_month_close_reminder_timing.md`
- 既存: `server/src/routes/webhooks.ts`(APPROVAL_REQUIRED_NOTIFICATION_TYPE の insert パターン)
- `supabase/migrations/20260501130150_remote_baseline_20260430.sql`(notifications 定義)

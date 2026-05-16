# PR-01 — BE: 立替残高 API + PATHチーム報酬 API

## Goal
Money画面のヒーロー①「報酬」と②「立替」が必要とするチーム単位の集計データを提供するエンドポイントを2本追加する。

## Acceptance criteria

- [x] `GET /api/v1/accounting/member-reimbursements-summary?month=YYYY-MM` 動作: 全メンバーの立替集計を返す
- [x] `GET /api/v1/accounting/member/:memberId/reimbursement-balance?month=YYYY-MM` 動作: 個別メンバーの立替明細
- [x] `GET /api/v1/path/module/team-reward-summary?month=YYYY-MM` 動作: チーム全員のPATH月次報酬
- [x] 認可: org_member であれば誰でも他人の集計を読める(透明性)。ただし memberの実名・振込先などは含めない
- [x] 月引数の妥当性検証(`/^\d{4}-\d{2}$/`、過去24ヶ月以内)
- [x] vitest/node-test で各エンドポイントに happy-path + 異常系1ケース以上
- [x] OpenAPI/型に追加(存在すれば) — OpenAPI定義なし。backend service型を追加し、frontend型はPR-02範囲に維持。

## Files

### 新規/拡張
- `server/src/routes/accounting.ts` — 2エンドポイント追加
- `server/src/routes/pathModule.ts`(または `pathRewards.ts`) — チーム報酬集計1本追加
- `server/src/services/PathV33MonthlyService.ts`(類) — `getTeamRewardSummary(orgId, month)` 関数追加。既存の個別 `getRewardConfirmationSummary` をループするより、SQL 1発で取れるなら必ずそちらを採る
- 必要なら `supabase/migrations/YYYYMMDD_*.sql` で RPC 追加(個別残高/チーム集計が SQL でまとめられるなら)

### 既存活用
- `accounting_transactions` テーブル(`paid_by`, `claimant_member_id`, `settlement_type`, `reimbursement_status` 列既存)
- `PathGovernedModuleService.getRewardConfirmationSummary` を team 集計の中で再利用可

## API contracts

### `GET /api/v1/accounting/member-reimbursements-summary?month=YYYY-MM`

Response 200:
```ts
{
  month: string;                      // "2026-05"
  members: Array<{
    member_id: string;
    nickname: string;                 // from member profile, ≤5 chars
    total_advanced: number;           // 全立替合計(unsettled + settled の今月分)
    unsettled: number;                // 精算待ち
    settled: number;                  // 振込済(reimbursed)
    count_pending: number;            // 件数(unsettled)
    status: 'pending' | 'in_review' | 'none' | 'settled';
  }>
}
```

Sort: self first if request authenticated as one of `members`. Then by `total_advanced` desc.

### `GET /api/v1/accounting/member/:memberId/reimbursement-balance?month=YYYY-MM`

Response 200:
```ts
{
  member_id: string;
  month: string;
  total_advanced: number;
  unsettled: number;
  settled: number;
  by_status: {
    unsubmitted: number;
    submitted: number;
    approved: number;
    reimbursed: number;
  };
  recent_items: Array<{               // 直近5件
    id: string;
    occurred_on: string;              // YYYY-MM-DD
    category: string;                 // 駐車 / 材料 / ガソリン 等
    amount: number;
    reimbursement_status: string;
  }>
}
```

Auth: `req.userId` ≠ `memberId` でも 200 を返す。ただし `recent_items` の `category` までで、店舗名・領収書URLなどは含めない(透明性の境界)。

### `GET /api/v1/path/module/team-reward-summary?month=YYYY-MM`

Response 200:
```ts
{
  month: string;
  is_finalized: boolean;
  members: Array<{
    member_id: string;
    nickname: string;
    level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
    attendance_days: number;
    amount: number;                   // result_amount or base_amount
    status: 'finalized' | 'preview' | 'pending';
    has_invoice: boolean;             // 本人が請求書発行済か
    has_paid: boolean;
  }>
}
```

`has_invoice` / `has_paid` は本人匿名で集計可能 — 他人の請求書 ID は返さない(本人プロフィール RLS で守られているため、Service layer で boolean 化のみ)。

## Edge cases

- 月が当月超え → 400 `{ error: "future month" }`
- 月が24ヶ月超え過去 → 400 `{ error: "out of range" }`
- 該当 member が org に属さない → reimbursement-balance は 403
- 該当 month のデータがゼロ → 各数値 0, `members: []` を返す(404 にしない)
- PATH の `result_amount` が null(まだ算出されてない) → `amount: base_amount`, `status: 'pending'`

## Forbidden

- 振込先(`snapshot_bank`)・本名・T番号・領収書本文をレスポンスに含める
- `member_id = auth.uid()` の RLS ポリシーを変更する(チーム集計は SECURITY DEFINER RPC で実装、RLS は触らない)
- N+1 クエリ(`forEach(member => fetch())` 禁止、SQL 集約)

## Review checklist (Approver)

- Postman/curl で 3エンドポイント叩いてレスポンス検証
- 別 org のユーザでアクセスして 403/404 になるか
- Supabase の DB ログで「SELECT \* FROM member_invoices」が出ないこと(RLS違反)
- 集計が偶数桁(¥1k 単位)で揃ってないこと(端数も含めて正確)

## Reference
- Mock: `frontend/src/pages/MoneyMock.tsx` の `MOCK_REWARDS`, `MOCK_EXPENSES` がレスポンス形状の参考
- Memory: `project_transparency_as_defense.md`, `project_member_personal_stake_priority.md`
- Existing baseline: `supabase/migrations/20260501130150_remote_baseline_20260430.sql` (member_invoices テーブル定義)

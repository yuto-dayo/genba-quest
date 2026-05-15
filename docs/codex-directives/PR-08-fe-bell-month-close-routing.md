# PR-08 — FE: BellDrawer お知らせ section + 月確定モーダル + URL ルーティング

## Goal
ベル通知から月確定モーダルへの動線を整える。既存 `BellDrawer` の「お知らせ」セクション(プレースホルダ)を実装、`month_close_reminder` 通知タイプを処理。URL パラメータでモーダル自動オープン。

## Acceptance criteria

- [ ] `BellDrawer.tsx` のお知らせ section が実データを表示(現状コメント `// 後続 PR に残す` を消す)
- [ ] `month_close_reminder` 通知を「📅 N月分の月確定ができます」として表示
- [ ] 通知タップで `/money?modal=month_close&period=YYYY-MM` に遷移
- [ ] Money 画面が URL search params を検知して `<MonthCloseModal>` を自動オープン
- [ ] `<MonthCloseModal>` 実装: 対象月の集計を表示、確認画面方式(typed confirmation 不要)
- [ ] 確定実行で既存 `lockPathV33MonthDrafts` → `expirePathV33MonthObjections` → `finalizePathV33Month` の3ステップを直列実行(または summary endpoint があれば1本)
- [ ] 確定完了で該当通知を read 化、トースト表示
- [ ] tsc/lint/test グリーン

## Files

- `frontend/src/components/BellDrawer.tsx` — お知らせ section 実装
- `frontend/src/components/money/MonthCloseModal.tsx` — 新規
- `frontend/src/components/money/MonthCloseModal.module.css`
- `frontend/src/pages/Money.tsx` — `useSearchParams` でモーダル制御

## MonthCloseModal spec

per `MoneyMock.tsx` の `MonthCloseModal`:
- ヘッダ: 「N月分を確定します」
- 説明文: 「確定すると、全員の報酬額が固定され、請求書を発行できるようになります。確定後の修正には別途異議申立が必要です。」
- 集計カード: 対象メンバー数 / 総報酬額 / 異議申立件数
- アクション: `[戻る][N月分を確定]`

確定ボタン押下 → ロジック:
```ts
await lockPathV33MonthDrafts(month);
await expirePathV33MonthObjections(month);
const result = await finalizePathV33Month(month);
```

エラー時は段階を表示(`「ロック失敗」`等)、リトライ可。

## URL handling

```ts
const [params] = useSearchParams();
useEffect(() => {
  const modal = params.get('modal');
  const period = params.get('period');
  if (modal === 'month_close' && period) {
    setMonthCloseOpen(true);
    setTargetMonth(period);
  }
}, [params]);
```

閉じる時に URL clean up(modal/period パラメータ削除)。

## Bell integration

`BellDrawer` のお知らせ section:
- `notifications.filter(n => n.type === 'month_close_reminder' && !n.read)` を表示
- 表示文言: `📅 ${n.data.month} 分の月確定ができます`
- クリックで navigate(`/money?modal=month_close&period=${n.data.month}`)
- 通知の `read` 更新は確定完了時にする(タップしただけでは消さない、催促を保つ)

## Edge cases

- 既に確定済の月で modal が開いた: 「すでに確定済みです」表示 + 閉じるのみ
- 異議が未決着: ボタン無効 + 「○件の異議が決着していません」表示
- ネットワークエラー: 各段階で個別エラー、リトライ可
- 別タブで確定された場合: 開いた時点で再 fetch、状態反映

## Forbidden

- typed confirmation を導入する
- 通知タップで read を即時消す(完了まで催促保持)
- 月確定中の状態を localStorage に持つ(マルチデバイス想定)

## Reference
- Mock: `MoneyMock.tsx` の `MonthCloseModal`
- 既存: `BellDrawer.tsx` line 174–186(プレースホルダ位置)
- 既存: `PathV33MonthFinalize` コンポーネント(確定ロジック流用)
- Memory: `project_money_as_single_finance_entry.md`, `project_month_close_reminder_timing.md`

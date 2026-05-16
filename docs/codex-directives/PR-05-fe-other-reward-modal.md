# PR-05 — FE: 他人カード詳細モーダル(異議申立)

## Goal
ヒーロー① 報酬の他人カードタップで開くモーダル。閲覧 + 異議申立 を可能にする。請求書情報は出さない(本人プライバシー)。

## Acceptance criteria

- [x] 他人カードタップで `<OtherRewardModal memberId>` が開く
- [x] そのメンバーの報酬額・レベル・出勤日数・計算根拠 を表示
- [x] 異議申立期間中(月末+3〜+7日)のみ `[異議を申し立てる]` ボタン表示
- [x] ボタン押下で既存 `ObjectionSubmitSheet` を inline 起動
- [x] 請求書状態は表示しない(本人プライバシー)
- [x] 「全員を見る」カードタップ時は `<TeamSummaryModal>` を開く(同モーダルの一覧バリアント、簡易リスト表示)
- [x] tsc/lint/test グリーン

## Files

- `frontend/src/components/money/OtherRewardModal.tsx`
- `frontend/src/components/money/OtherRewardModal.module.css`
- `frontend/src/components/money/TeamSummaryModal.tsx`(全員一覧用、薄く)
- `frontend/src/pages/Money.tsx` — open state 管理

## Component spec

### `<OtherRewardModal memberId month onClose>`
- fetch: `fetchRewardConfirmation({ month, memberId })`(他人取得可)
- 表示: メンバー nickname + 報酬額 + 計算根拠 + 過去 3 ヶ月推移(取得可能なら)
- アクション:
  - 異議期間内: `[閉じる][異議を申し立てる]`
  - 期間外: `[閉じる]` のみ
- 異議申立: `ObjectionSubmitSheet` を inline open(既存コンポーネント)

### `<TeamSummaryModal month onClose>`
- fetch: `fetchTeamRewardSummary(month)`
- 全メンバーを 1 行ずつ縦リスト表示(nickname / level / 金額)
- 各行タップで `OtherRewardModal`(または OwnRewardModal if 自分)に切替

## Edge cases

- memberId が無効: 「メンバーが見つかりません」エラー表示
- 異議期間判定: クライアントで月末日 + 3〜7 を計算(タイムゾーン JST 固定)。サーバが is_objection_window を返してくれるなら優先

## Forbidden

- 他人の請求書状態・本名・振込先表示
- 異議申立期間外にボタン表示

## Reference
- Mock: `MoneyMock.tsx` の `OtherRewardModal`
- 既存: `ObjectionSubmitSheet`(PathRewardConfirmation 内で使用)
- Memory: `project_transparency_as_defense.md`(金額透明 / プライバシー保護の線引き)

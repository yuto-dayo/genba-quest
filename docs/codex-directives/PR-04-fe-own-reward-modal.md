# PR-04 — FE: 自分カード詳細モーダル(報酬 + 請求書発行統合)

## Goal
ヒーロー① 報酬の自分カードタップで開く詳細モーダルを実装する。**月確定 → 報酬額確認 → 請求書発行** の月初儀式を1つのフローに統合する。

## Acceptance criteria

- [ ] 自分カードタップで `<OwnRewardModal>` が開く
- [ ] モーダル内に「あなたの報酬」金額 + 計算根拠(L, 出勤日数, 基本給, 加算)
- [ ] 月確定前は「月確定後に発行できます」ゲート、請求書アクション無効
- [ ] 月確定後 + 請求書未発行: `[請求書を出す]` ボタン
- [ ] ボタン押下で既存 `IssueModal`(member invoice 発行 UI) を inline 起動
- [ ] 発行済: 「発行中 — 経理担当が振込を準備しています」 + `[取消]`(既存 void フロー)
- [ ] 支払済: 「✓ MM/DD 振込完了」緑バナー
- [ ] PATH 計算詳細(`getRewardConfirmationSummary` 結果)が見える(PATHページが廃止される前提のため、ここで吸収)
- [ ] レベル修正は既存 `LevelRevisionSheet` を inline で呼ぶ(ボタン: `[レベルを修正]`、月確定前のみ)
- [ ] tsc/lint/test グリーン

## Files

- `frontend/src/components/money/OwnRewardModal.tsx` — 新規
- `frontend/src/components/money/OwnRewardModal.module.css`
- `frontend/src/pages/Money.tsx` — `<OwnRewardModal>` の open state を管理(自分カードタップで開く)
- 既存 `IssueModal`(member invoice 発行)を import して再利用(現状の MyMemberInvoicesList で使われているはず)

## Component spec

### `<OwnRewardModal selfMemberId month onClose>`
- props: `selfMemberId`, `month`, `onClose`
- fetch on mount:
  - `fetchRewardConfirmation({ month, memberId: selfMemberId })` — 既存 API
  - `fetchMyMemberInvoices({ month })` — 既存。本人の請求書状態を取得
- 内部 state:
  - reward summary
  - invoice state derived from API: `'before_close' | 'unissued' | 'issued' | 'paid'`
- 表示分岐: `MoneyMock.tsx` の `OwnRewardModal` 完全模倣

### Layout (per mock)
1. ヘッダ: 「N月分の報酬」 + 閉じる
2. メトリクスカード: ラベル「あなたの報酬」 + 金額(display-small)
3. 計算根拠 (level, 出勤日数, 基本給, 加算)
4. 状態バナー(invoice state に応じて文言と色変更)
5. アクション領域(状態に応じて):
   - before_close: `[閉じる][レベルを修正]`(後者は LevelRevisionSheet を inline open)
   - unissued: `[閉じる][請求書を出す]`(IssueModal inline)
   - issued: `[取消][閉じる]`
   - paid: `[閉じる]` のみ

## Modal nesting

inline で開くシート(`LevelRevisionSheet`, `IssueModal`) は OwnRewardModal の **上に重ねる**(scrim 二重)。閉じると OwnRewardModal に戻る。OwnRewardModal 自身は閉じない。

## Edge cases

- API 404(報酬データなし): `<EmptyState>` で「データがありません」、アクションなし
- API 500: 既存 ErrorScreen パターン
- 月切替中の race: AbortController で前リクエストキャンセル
- IssueModal 発行成功後: 自モーダルの invoice state を再取得して `issued` に遷移、トースト「請求書を発行しました」

## Forbidden

- 他人の報酬を表示(自分専用モーダル)
- 振込先・本名を表示(`snapshot_*` はそもそも API で返らない、念のため)
- 月確定前に請求書発行ボタンを表示
- typed confirmation(取消・発行はワンクリック確認ダイアログのみ)

## Reference
- Mock: `MoneyMock.tsx` の `OwnRewardModal`
- 既存: `frontend/src/components/MyMemberInvoicesList.tsx`, `frontend/src/components/MemberInvoiceDraftBanner.tsx`(IssueModal の使い方), `frontend/src/components/LevelRevisionSheet.tsx`
- API: `fetchRewardConfirmation`, `fetchMyMemberInvoices`, `cancelMemberInvoice` 既存
- Memory: `project_money_as_single_finance_entry.md`(月初儀式の統合)

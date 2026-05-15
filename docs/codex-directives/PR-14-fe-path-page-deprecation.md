# PR-14 — FE: /path リダイレクト + ボトムナビから PATH 削除 + ディープリンク吸収

## Goal
PATH ページを廃止し、ボトムナビからアイコンを削除。既存 `/path` URL は Money の対応モーダルにリダイレクト。`SiteDetailModal` 等の `/path?reward=...` ディープリンクも吸収。

## Acceptance criteria

- [ ] `App.tsx` のボトムナビ items から `{ path: "/path", label: "PATH", icon: RouteIcon }` を削除
- [ ] `/path` および `/luqo` ルートを `<Navigate>` で `/money` 系にリダイレクト
- [ ] `?reward=1&member=...&period=...&site=...` ディープリンクを `/money?modal=reward&member=...&period=...&site=...` に変換
- [ ] `SiteDetailModal` 内のリンクを `/money?...` に書き換え
- [ ] `PathRewardConfirmation.tsx` は当面残す(後続で削除予定)、ただし import / 経路を消す
- [ ] tsc/lint/test グリーン

## Files

- `frontend/src/App.tsx` — nav items & route 変更
- `frontend/src/components/SiteDetailModal.tsx`(または該当ファイル) — リンク書き換え
- 新規: `frontend/src/lib/legacyRouteRedirect.ts`(共通変換ロジック)

## Redirect logic

```tsx
<Route
  path="/path"
  element={<RedirectPathToMoney />}
/>
<Route
  path="/luqo"
  element={<RedirectPathToMoney />}
/>

function RedirectPathToMoney() {
  const [params] = useSearchParams();
  const target = new URLSearchParams();
  if (params.get('reward')) target.set('modal', 'reward');
  if (params.get('member')) target.set('member', params.get('member'));
  if (params.get('period')) target.set('period', params.get('period'));
  if (params.get('site')) target.set('site', params.get('site'));
  return <Navigate to={`/money?${target}`} replace />;
}
```

## Money URL handlers

`Money.tsx` で `modal=reward`, `member=X` を検知:
- `member === selfMemberId` なら `OwnRewardModal` を開く
- else `OtherRewardModal` を開く

## Edge cases

- 古いブックマーク: redirect で吸収
- bell drawer に古い `/path` への通知 data があるケース: そのまま通知タップで redirect 経由動作

## Forbidden

- PathRewardConfirmation ファイル削除(後続 PR でクリーンアップ)
- 関連 API endpoint 削除(governance flow は内部的に存続)
- ボトムナビの並びを変える(`PATH` の場所が空になるだけ、他項目はそのまま)

## Reference
- Memory: `project_money_as_single_finance_entry.md`
- 既存: `App.tsx` line 88 周辺(nav items)

# Today Site Card Density Handoff

## Summary

- Today現場カードからカード内の今日やることを外し、ページ下の「今日やること」に集約。
- 現場カード内に工事内容チップと工事追加導線を追加。工種が多い場合は横流れ表示。
- 右上の主要アクションとして、取引先担当者と地図を大きめの2分割アイコンで配置。
- 時間チップ横にチーム担当の小アイコンを追加。担当未設定は `未`、複数人は最大3人と `+N`。
- 「現場の数字」は今日の現場ごとに売上・経費・利益を表示。

## Validation

- `cd frontend && npm test -- TodayAssignments.test.tsx Today.test.tsx` => 10/10 pass
- `cd frontend && npm run build` => pass, chunk size warning only
- Browser reload `http://127.0.0.1:5173/` => Today現場カードの担当/地図/時間横チーム担当表示を確認

## Follow Up

- assigned_users が入った実データでイニシャル表示と `+N` 表示を確認。
- 未コミットの別作業差分はこの変更とは別スコープで扱う。

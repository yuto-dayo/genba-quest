# Frontend API Client Handoff

## Goal

- `frontend/src/lib/api.ts` の拡張を独立 chunk として切り出す

## Included

- communications / invoice / PATH / simulator 向け API client 追加
- UI 依存を持たない型・fetch helper の更新

## Next

- `frontend/src/lib/api.ts` を先に commit し、その後 page/component 単位で差分を分割する

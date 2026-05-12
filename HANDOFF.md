# Project Handoff Profile / Domain Index - 2026-05-12

## Active Director-Flagged Work

- **Today 日付ナビ + 責任レベル入力フロー刷新** (5 PR、Director: Claude / Implementer: Codex)
  - 計画書: `docs/TODAY_LEVEL_FLOW_PLAN.md`
  - PR1 プロンプト: `docs/TODAY_LEVEL_FLOW_CODEX_PROMPT.md`
  - PR1 ブランチ: `feature/today-day-swipe`（未着手、2026-05-12 開始）

## Active Domains

| Domain | File | Last Updated | Status |
| ------ | ---- | ------------ | ------ |
| local | `handoff/local.md` | 2026-05-12 | active |

## Domain Selection Guide

- Standard local profile: `--profile local` -> `handoff/local.md`
- Standard production profile: `--profile production` -> `handoff/deploy/production.md`
- Server work (API, DB, SQL, services): `handoff/server.md`
- Frontend shared work (routing/design system): `handoff/frontend.md`
- Frontend page scope: `--domain frontend/today` -> `handoff/frontend/today.md`
- Server feature scope: `--domain server/proposals` -> `handoff/server/proposals.md`
- Integration scope: `--domain integration/gmail` -> `handoff/integration/gmail.md`
- Active session details: see `.session/active_session`
- Legacy single-file mode: omit both `--profile` and `--domain` to write `HANDOFF.md`

# Project Handoff Profile / Domain Index - 2026-05-18

## Active Domains

| Domain | File | Last Updated | Status |
| ------ | ---- | ------------ | ------ |
| local | `handoff/local.md` | 2026-05-17 | active |
| frontend/payout-modal-rename | `handoff/frontend/payout-modal-rename.md` | 2026-05-18 | Prepare rename-only commit and PR; note full npm test bas... |
| server/level-fallback | `handoff/server/level-fallback.md` | 2026-05-18 | active |

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

# Project Handoff Profile / Domain Index - 2026-05-07

## Active Domains

| Domain | File | Last Updated | Status |
| ------ | ---- | ------------ | ------ |
| local | `handoff/local.md` | 2026-05-07 | active |
| deploy/production | `handoff/deploy/production.md` | 2026-05-06 | active |
| repo/handoff-infra-sync | `handoff/repo/handoff-infra-sync.md` | 2026-05-06 | active |
| frontend/today-count-cleanup | `handoff/frontend/today-count-cleanup.md` | 2026-05-07 | Push current commit to origin/master |

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

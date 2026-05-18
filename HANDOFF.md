# Project Handoff Profile / Domain Index - 2026-05-18

## Active Domains

| Domain | File | Last Updated | Status |
| ------ | ---- | ------------ | ------ |
| local | `handoff/local.md` | 2026-05-17 | active |
| frontend/payout-modal-rename | `handoff/frontend/payout-modal-rename.md` | 2026-05-18 | Prepare rename-only commit and PR; note full npm test bas... |
| server/level-fallback | `handoff/server/level-fallback.md` | 2026-05-18 | Run final validation summary, commit product files only, ... |
| server/recurring-expenses | `handoff/server/recurring-expenses.md` | 2026-05-18 | Review PR, then fix existing migration duplicate 20260515... |
| server/cash-receipts | `handoff/server/cash-receipts.md` | 2026-05-18 | commit product files and create PR |
| server/invoice-registration | `handoff/server/invoice-registration.md` | 2026-05-18 | PR #87 is open; address CI/review, then run Supabase db r... |
| server/payout-allocation | `handoff/server/payout-allocation.md` | 2026-05-18 | Push branch and create PR |
| frontend/payout-hero-card | `handoff/frontend/payout-hero-card.md` | 2026-05-18 | active |

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

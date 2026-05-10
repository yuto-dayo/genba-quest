# Project Handoff Profile / Domain Index - 2026-05-10

## Active Domains

| Domain | File | Last Updated | Status |
| ------ | ---- | ------------ | ------ |
| deploy/production | `handoff/deploy/production.md` | 2026-05-07 | Open production /money in browser if visual smoke is needed |
| local | `handoff/local.md` | 2026-05-10 | User selected option (a): production migration repair + s... |

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

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `merge PR + verify Render auto-deploy + spot-check /money on production`. Source: realtime
- [H0001] Completed: v2.2 hotfix: PostgREST embed FK disambiguation in accounting.ts (5 sites) — server tsc clean, accountingRoute 56/56 PASS
- [H0001] Remaining: merge PR + verify Render auto-deploy + spot-check /money on production
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0001] Auto-captured decision: v2.2 hotfix: PostgREST embed FK disambiguation in accounting.ts (5 sites) — server tsc clean, accountingRoute 56/56 PASS
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0001] No new landmines reported in this chunk.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0001] merge PR + verify Render auto-deploy + spot-check /money on production
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `1`
- last_compacted_at: `never`
- archived_entries: `0`
<!-- HANDOFF_L2_STATE_END -->

---

## 11. Incremental Updates

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- (no events recorded yet)
<!-- HANDOFF_SESSION_EVENTS_END -->

### 2026-05-10 17:09:12 +0900

- Entry-ID: `H0001`
- Completed:
  - [x] v2.2 hotfix: PostgREST embed FK disambiguation in accounting.ts (5 sites) — server tsc clean, accountingRoute 56/56 PASS
- Remaining:
  - [ ] merge PR + verify Render auto-deploy + spot-check /money on production
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: v2.2 hotfix: PostgREST embed FK disambiguation in accounting.ts (5 sites) — server tsc clean, accountingRoute 56/56 PASS
- Validation:
  - `npx tsc --noEmit + jest accountingRoute`
- Landmines:
  - No new landmines reported in this chunk.

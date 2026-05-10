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
- [focus] NEXT_CMD: `S-1..S-5 server: scope branching, invoice_number column writer, field_change_log writer, anomaly rules, bucket aggregation endpoint`. Source: realtime
- [H0005] Completed: M-1..M-5 DB migrations applied locally; expense_scope expanded to 4 values; flags TEXT[] + GIN; expense_field_change_log append-only RLS; expense_lifecycle_state with backfill; invoice_number first-class column
- [H0005] Remaining: S-1..S-5 server: scope branching, invoice_number column writer, field_change_log writer, anomaly rules, bucket aggregation endpoint
- [H0004] Completed: Plain-language pass: added 職人語 vocabulary mapping to MONEY_EXPENSE_FLOW.md §11, replaced jargon (scope/posted/verified/missing_*) throughout HTML mock with 職人 readable Japanese, added feedback memory
- [H0004] Remaining: M-1..M-5 DB migrations
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0005] Auto-captured decision: M-1..M-5 DB migrations applied locally; expense_scope expanded to 4 values; flags TEXT[] + GIN; expense_field_change_log append-only RLS; expense_lifecycle_state with backfill; ...
- [H0004] Auto-captured decision: Plain-language pass: added 職人語 vocabulary mapping to MONEY_EXPENSE_FLOW.md §11, replaced jargon (scope/posted/verified/missing_*) throughout HTML mock with 職人 readabl...
- [H0003] Auto-captured decision: T-FIX-1: persist invoice_number end-to-end (api type, ExpenseModal payload, accounting destructure, T+13 format validation, metadata_json on legacy and canonical paths, proposal...
- [H0002] Auto-captured decision: Designed expense approval flow: spec doc, gap analysis (found T番号 destructure bug), HTML mock (dashboard/detail/capture)
- [H0001] Auto-captured decision: v2.2 hotfix: PostgREST embed FK disambiguation in accounting.ts (5 sites) — server tsc clean, accountingRoute 56/56 PASS
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0005] No new landmines reported in this chunk.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0005] S-1..S-5 server: scope branching, invoice_number column writer, field_change_log writer, anomaly rules, bucket aggregation endpoint
- [H0004] M-1..M-5 DB migrations
- [H0003] M-1..M-5 DB migrations: scope 4-value CHECK, flags TEXT[] column, expense_field_change_log table (append-only RLS), review_status enum extension, invoice_number column with index
- [H0002] T-FIX-1: wire invoice_number through accounting.ts:1211 destructure -> insertExpenseTransaction; then DB migrations M-1..M-5
- [H0001] merge PR + verify Render auto-deploy + spot-check /money on production
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `5`
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

### 2026-05-10 17:54:57 +0900

- Entry-ID: `H0002`
- Completed:
  - [x] Designed expense approval flow: spec doc, gap analysis (found T番号 destructure bug), HTML mock (dashboard/detail/capture)
- Remaining:
  - [ ] T-FIX-1: wire invoice_number through accounting.ts:1211 destructure -> insertExpenseTransaction; then DB migrations M-1..M-5
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: Designed expense approval flow: spec doc, gap analysis (found T番号 destructure bug), HTML mock (dashboard/detail/capture)
- Validation:
  - `design docs lint clean, mock renders in preview`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 20:06:48 +0900

- Entry-ID: `H0003`
- Completed:
  - [x] T-FIX-1: persist invoice_number end-to-end (api type, ExpenseModal payload, accounting destructure, T+13 format validation, metadata_json on legacy and canonical paths, proposal lineage payload). Added regression test (accountingRoute 57/57).
- Remaining:
  - [ ] M-1..M-5 DB migrations: scope 4-value CHECK, flags TEXT[] column, expense_field_change_log table (append-only RLS), review_status enum extension, invoice_number column with index
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: T-FIX-1: persist invoice_number end-to-end (api type, ExpenseModal payload, accounting destructure, T+13 format validation, metadata_json on legacy and canonical paths, proposal...
- Validation:
  - `server tsc clean, frontend tsc clean, accountingRoute jest 57/57 PASS`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 20:15:25 +0900

- Entry-ID: `H0004`
- Completed:
  - [x] Plain-language pass: added 職人語 vocabulary mapping to MONEY_EXPENSE_FLOW.md §11, replaced jargon (scope/posted/verified/missing_*) throughout HTML mock with 職人 readable Japanese, added feedback memory
- Remaining:
  - [ ] M-1..M-5 DB migrations
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: Plain-language pass: added 職人語 vocabulary mapping to MONEY_EXPENSE_FLOW.md §11, replaced jargon (scope/posted/verified/missing_*) throughout HTML mock with 職人 readabl...
- Validation:
  - `preview renders, no UI string in english on user-facing surfaces`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 20:23:30 +0900

- Entry-ID: `H0005`
- Completed:
  - [x] M-1..M-5 DB migrations applied locally; expense_scope expanded to 4 values; flags TEXT[] + GIN; expense_field_change_log append-only RLS; expense_lifecycle_state with backfill; invoice_number first-class column
- Remaining:
  - [ ] S-1..S-5 server: scope branching, invoice_number column writer, field_change_log writer, anomaly rules, bucket aggregation endpoint
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: M-1..M-5 DB migrations applied locally; expense_scope expanded to 4 values; flags TEXT[] + GIN; expense_field_change_log append-only RLS; expense_lifecycle_state with backfill; ...
- Validation:
  - `supabase db reset clean, accountingRoute jest 57/57`
- Landmines:
  - No new landmines reported in this chunk.

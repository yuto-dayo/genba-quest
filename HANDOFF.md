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
- [focus] NEXT_CMD: `Wait CI green and merge`. Source: realtime
- [H0020] Completed: fix(lint): split _shared.tsx → _shared-utils.ts (react-refresh/only-export-components), createElement(Body) instead of JSX (react-hooks/static-components), framer-motion mock filter pattern, drop unused getSiteLevelDraftSiteName
- [H0020] Remaining: Wait CI green and merge
- [H0019] Completed: docs(reward): V3.3 transparent governance design (Phase 0) — 3-tier per-site self-report → weighted average → 5-tier monthly with 1.25 multiplier; team-visible peer review (Objection + Co-sign) replaces 番頭 approval
- [H0019] Remaining: Implementation in new branch feat/path-reward-v33-transparent (Phase 1: schema + aggregation function)
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0020] Auto-captured decision: fix(lint): split _shared.tsx → _shared-utils.ts (react-refresh/only-export-components), createElement(Body) instead of JSX (react-hooks/static-components), framer-motion mock ...
- [H0019] Auto-captured decision: docs(reward): V3.3 transparent governance design (Phase 0) — 3-tier per-site self-report → weighted average → 5-tier monthly with 1.25 multiplier; team-visible peer review...
- [H0018] Auto-captured decision: fix(fab): raise FAB above bottom tab bar so 🔔 chip stays visible (FAB_MARGIN_BOTTOM 16→92, mobile media query bottom calc)
- [H0017] Auto-captured decision: refactor(proposal): per-type body registry — PathReward / Accounting / Invoice / CommunicationTask / CommunicationReview / Generic; ProposalDetailModal slimmed 740→256 lines
- [H0016] Auto-captured decision: refactor(money): drop alertBanner + pathQueueSection, route entry through bell inbox, emit window events on mutation
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0020] No new landmines reported in this chunk.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0020] Wait CI green and merge
- [H0019] Implementation in new branch feat/path-reward-v33-transparent (Phase 1: schema + aggregation function)
- [H0018] Commit V3.3 design doc
- [H0017] FAB margin fix commit
- [H0016] Continue with body registry refactor commit
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `20`
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

### 2026-05-10 20:26:50 +0900

- Entry-ID: `H0006`
- Completed:
  - [x] S-1 server scope branching: route accepts 4 values (job/job_advance/stockpile/overhead), site requirement gated by scope, canonical RPC bypassed for new scopes (legacy insert path takes job_advance/stockpile until RPC migration). 58/58 tests passing.
- Remaining:
  - [ ] S-2 policy migration / S-3 field_change_log writer / S-4 anomaly rules / S-5 bucket aggregation endpoint, then F-1..F-4 frontend
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: S-1 server scope branching: route accepts 4 values (job/job_advance/stockpile/overhead), site requirement gated by scope, canonical RPC bypassed for new scopes (legacy insert pa...
- Validation:
  - `tsc clean, accountingRoute jest 58/58`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 20:35:29 +0900

- Entry-ID: `H0007`
- Completed:
  - [x] S-3 expense_field_change_log writer (registered + ocr_extracted entries on create, append-only via supabaseAdmin); S-5 GET /expense_buckets aggregation endpoint (6 buckets: unassigned/needs_review/awaiting_verify/posted/asset_candidates/advance_stale + oldest_unassigned_age_days). Frontend api client wired with fetchExpenseBuckets. accountingRoute jest 59/59.
- Remaining:
  - [ ] S-2 threshold policy migration / S-4 anomaly rule engine (auto-set flags on insert) / F-1 bucket dashboard rendering
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: S-3 expense_field_change_log writer (registered + ocr_extracted entries on create, append-only via supabaseAdmin); S-5 GET /expense_buckets aggregation endpoint (6 buckets: unas...
- Validation:
  - `tsc clean (server + frontend), accountingRoute jest 59/59 including new bucket aggregation test`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 20:39:12 +0900

- Entry-ID: `H0008`
- Completed:
  - [x] S-4 minimal anomaly rules: missing_invoice_number, missing_receipt, asset_candidate flags computed and persisted at insert time on both canonical and legacy paths. Also persisted typed invoice_number column. accountingRoute jest 60/60.
- Remaining:
  - [ ] F-1 bucket dashboard frontend rendering, then S-4 dynamic flags (duplicate_suspected, advance_stale, budget_overrun) as a follow-up batch job, plus S-2 threshold policy migration
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: S-4 minimal anomaly rules: missing_invoice_number, missing_receipt, asset_candidate flags computed and persisted at insert time on both canonical and legacy paths. Also persiste...
- Validation:
  - `tsc clean, accountingRoute jest 60/60 incl. anomaly flag computation test`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 20:41:45 +0900

- Entry-ID: `H0009`
- Completed:
  - [x] F-1 bucket dashboard: new MoneyBucketDashboard component with 6 buckets (未割当/要確認/確認待ち/帳簿入り/高額な工具/先行仕入れ・古い), 職人語 labels file (expenseLabels.ts), responsive grid (2/3/6 cols), pulse + stale alert + skeleton states. Integrated into Money.tsx between PL summary and quick actions. tsc clean, vite build clean.
- Remaining:
  - [ ] F-2 detail view with field_change_log history; F-3 capture flow scope chips; S-2 policy migration; S-4 dynamic flags via batch job
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: F-1 bucket dashboard: new MoneyBucketDashboard component with 6 buckets (未割当/要確認/確認待ち/帳簿入り/高額な工具/先行仕入れ・古い), 職人語 label...
- Validation:
  - `frontend tsc + vite build clean`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 20:47:08 +0900

- Entry-ID: `H0010`
- Completed:
  - [x] F-2 expense detail history view: GET /expenses/:id/history backend endpoint (org-scoped, append-only fetch); ExpenseHistoryTimeline component with 職人語 actor/source/field labels (registered + ocr_extracted + per-field old/new diffs); embedded in TransactionDetailModal for kind=expense. accountingRoute jest 62/62.
- Remaining:
  - [ ] F-3 capture flow scope chips for ExpenseModal
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: F-2 expense detail history view: GET /expenses/:id/history backend endpoint (org-scoped, append-only fetch); ExpenseHistoryTimeline component with 職人語 actor/source/field l...
- Validation:
  - `tsc clean (server + frontend), accountingRoute jest 62/62 incl. 2 new history endpoint tests, vite build clean`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 20:50:57 +0900

- Entry-ID: `H0011`
- Completed:
  - [x] F-3 capture flow scope chips: 4-value chip picker (現場/先行仕入れ/共通在庫/本部・会社) replaces the SITE/HQ radio in ExpenseModal, with hint text per option, auto-derives cost_center, hides site selector for stockpile/overhead, label changes to '今日 (or 直近) に作業した現場の経費' style. CreateExpenseRequest gains expense_scope. tsc + vite build clean.
- Remaining:
  - [ ] S-2 threshold policy migration / S-4 dynamic flags / final PR review
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: F-3 capture flow scope chips: 4-value chip picker (現場/先行仕入れ/共通在庫/本部・会社) replaces the SITE/HQ radio in ExpenseModal, with hint text per option, au...
- Validation:
  - `frontend tsc clean, vite build clean`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 21:00:10 +0900

- Entry-ID: `H0012`
- Completed:
  - [x] S-4 dynamic flag (partial): duplicate_suspected — same org/vendor/date/amount lookup at insert time. Cheap heuristic catches re-uploaded receipts. Added regression test asserting the dup query keys and the resulting flag. accountingRoute jest 63/63.
- Remaining:
  - [ ] S-2 threshold policy migration / advance_stale + budget_overrun batch / Phase 1 PR
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: S-4 dynamic flag (partial): duplicate_suspected — same org/vendor/date/amount lookup at insert time. Cheap heuristic catches re-uploaded receipts. Added regression test assert...
- Validation:
  - `tsc clean, accountingRoute jest 63/63`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 21:18:16 +0900

- Entry-ID: `H0013`
- Completed:
  - [x] Browser E2E verification on remote Supabase (M-1..M-5 pushed via supabase db push): bucket dashboard renders, scope chips work, 201 on canonical RPC, missing_invoice_number flag → 要確認, history timeline shows fields in 職人語 (after fixing category to render via EXPENSE_CATEGORY_LABEL), void → reversal nets to zero. Cosmetic gap: reversal entries have NULL expense_scope and land in 未割当 — out of scope for this PR.
- Remaining:
  - [ ] Commit category label fix; open Phase 1 PR
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: Browser E2E verification on remote Supabase (M-1..M-5 pushed via supabase db push): bucket dashboard renders, scope chips work, 201 on canonical RPC, missing_invoice_number flag...
- Validation:
  - `Production-DB E2E happy path verified, jest 63/63`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-10 21:27:48 +0900

- Entry-ID: `H0014`
- Completed:
  - [x] Fix CI lint failure: refactor MoneyBucketDashboard + ExpenseHistoryTimeline to derive loading from staleness instead of synchronous setLoading/setError inside useEffect (react-hooks/set-state-in-effect rule)
- Remaining:
  - [ ] Push, wait for CI, merge PR #11
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: Fix CI lint failure: refactor MoneyBucketDashboard + ExpenseHistoryTimeline to derive loading from staleness instead of synchronous setLoading/setError inside useEffect (react-h...
- Validation:
  - `eslint clean, tsc clean, vite build clean`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 00:40:52 +0900

- Entry-ID: `H0015`
- Completed:
  - [x] feat(notify): unified bell + inbox bottom sheet (App.tsx state lift, NotificationInbox new component, ring motion on count change)
- Remaining:
  - [ ] Continue committing remaining 4 chunks then ask about push/PR
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(notify): unified bell + inbox bottom sheet (App.tsx state lift, NotificationInbox new component, ring motion on count change)
- Validation:
  - `tsc green, vitest 119/125 (6 pre-existing failures), build clean`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 00:41:21 +0900

- Entry-ID: `H0016`
- Completed:
  - [x] refactor(money): drop alertBanner + pathQueueSection, route entry through bell inbox, emit window events on mutation
- Remaining:
  - [ ] Continue with body registry refactor commit
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: refactor(money): drop alertBanner + pathQueueSection, route entry through bell inbox, emit window events on mutation
- Validation:
  - `Money tests 4/4 green via deep link`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 00:42:05 +0900

- Entry-ID: `H0017`
- Completed:
  - [x] refactor(proposal): per-type body registry — PathReward / Accounting / Invoice / CommunicationTask / CommunicationReview / Generic; ProposalDetailModal slimmed 740→256 lines
- Remaining:
  - [ ] FAB margin fix commit
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: refactor(proposal): per-type body registry — PathReward / Accounting / Invoice / CommunicationTask / CommunicationReview / Generic; ProposalDetailModal slimmed 740→256 lines
- Validation:
  - `tsc green`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 00:42:36 +0900

- Entry-ID: `H0018`
- Completed:
  - [x] fix(fab): raise FAB above bottom tab bar so 🔔 chip stays visible (FAB_MARGIN_BOTTOM 16→92, mobile media query bottom calc)
- Remaining:
  - [ ] Commit V3.3 design doc
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: fix(fab): raise FAB above bottom tab bar so 🔔 chip stays visible (FAB_MARGIN_BOTTOM 16→92, mobile media query bottom calc)
- Validation:
  - `FAB test updated 772→696`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 00:43:04 +0900

- Entry-ID: `H0019`
- Completed:
  - [x] docs(reward): V3.3 transparent governance design (Phase 0) — 3-tier per-site self-report → weighted average → 5-tier monthly with 1.25 multiplier; team-visible peer review (Objection + Co-sign) replaces 番頭 approval
- Remaining:
  - [ ] Implementation in new branch feat/path-reward-v33-transparent (Phase 1: schema + aggregation function)
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: docs(reward): V3.3 transparent governance design (Phase 0) — 3-tier per-site self-report → weighted average → 5-tier monthly with 1.25 multiplier; team-visible peer review...
- Validation:
  - `design doc reviewed, all 11 design questions resolved`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 00:53:48 +0900

- Entry-ID: `H0020`
- Completed:
  - [x] fix(lint): split _shared.tsx → _shared-utils.ts (react-refresh/only-export-components), createElement(Body) instead of JSX (react-hooks/static-components), framer-motion mock filter pattern, drop unused getSiteLevelDraftSiteName
- Remaining:
  - [ ] Wait CI green and merge
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: fix(lint): split _shared.tsx → _shared-utils.ts (react-refresh/only-export-components), createElement(Body) instead of JSX (react-hooks/static-components), framer-motion mock ...
- Validation:
  - `eslint 0 errors (was 26), tsc 0, vitest 119/125 (pre-existing 6 fails), build clean`
- Landmines:
  - No new landmines reported in this chunk.

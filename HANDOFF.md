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
- [focus] NEXT_CMD: `Phase 5: month-end lock cron + finalization modal + reward_run hook`. Source: realtime
- [H0025] Completed: feat(reward): V3.3 Phase 4 — PathV33ObjectionService + level.objection Proposal type + ObjectionBody in registry + ObjectionSubmitSheet on team feed (異議 button) + co-sign auto-accept flow
- [H0025] Remaining: Phase 5: month-end lock cron + finalization modal + reward_run hook
- [H0024] Completed: feat(reward): V3.3 Phase 3 — GET /v33/team-feed + PathV33PersonalDashboard + PathV33TeamFeed + tabbed /path page (個人 / チーム / 報酬確認)
- [H0024] Remaining: Phase 4: Objection + Co-sign proposal type + ObjectionBody UI + co-sign API
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0025] Auto-captured decision: feat(reward): V3.3 Phase 4 — PathV33ObjectionService + level.objection Proposal type + ObjectionBody in registry + ObjectionSubmitSheet on team feed (異議 button) + co-sign ...
- [H0024] Auto-captured decision: feat(reward): V3.3 Phase 3 — GET /v33/team-feed + PathV33PersonalDashboard + PathV33TeamFeed + tabbed /path page (個人 / チーム / 報酬確認)
- [H0023] Auto-captured decision: feat(reward): V3.3 Phase 2 — POST/GET /api/v1/path/module/v33/level-drafts + LevelDraftSheet + bell rewires + Today 役割 button removed
- [H0022] Auto-captured decision: feat(reward): V3.3 Phase 1 restored on rebased branch (migration + aggregateMonthlyLevel pure fn + 16 unit tests)
- [H0021] Auto-captured decision: fix(build): hotfix JSX namespace TS2503 errors on master — added 'import type { JSX } from react' to 7 files, removed now-unused @ts-expect-error in App.test.tsx
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0025] No new landmines reported in this chunk.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0025] Phase 5: month-end lock cron + finalization modal + reward_run hook
- [H0024] Phase 4: Objection + Co-sign proposal type + ObjectionBody UI + co-sign API
- [H0023] Phase 3: /path/team feed + personal dashboard
- [H0022] Phase 2: LevelDraftSheet UI + bell notification wiring + remove Today role chip
- [H0021] open PR; merge once CI green so Render deploys master
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `16`
- last_compacted_at: `2026-05-11 05:54:12 +0900`
- archived_entries: `9`
<!-- HANDOFF_L2_STATE_END -->

---

## 11. Incremental Updates

> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260511_055412.md` at 2026-05-11 05:54:12 +0900.


## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- (no events recorded yet)
<!-- HANDOFF_SESSION_EVENTS_END -->

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

### 2026-05-11 05:54:12 +0900

- Entry-ID: `H0021`
- Completed:
  - [x] fix(build): hotfix JSX namespace TS2503 errors on master — added 'import type { JSX } from react' to 7 files, removed now-unused @ts-expect-error in App.test.tsx
- Remaining:
  - [ ] open PR; merge once CI green so Render deploys master
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: fix(build): hotfix JSX namespace TS2503 errors on master — added 'import type { JSX } from react' to 7 files, removed now-unused @ts-expect-error in App.test.tsx
- Validation:
  - `frontend build clean / eslint 0 / vitest App.test.tsx 25/25 / server tsc clean`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 05:58:30 +0900

- Entry-ID: `H0022`
- Completed:
  - [x] feat(reward): V3.3 Phase 1 restored on rebased branch (migration + aggregateMonthlyLevel pure fn + 16 unit tests)
- Remaining:
  - [ ] Phase 2: LevelDraftSheet UI + bell notification wiring + remove Today role chip
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(reward): V3.3 Phase 1 restored on rebased branch (migration + aggregateMonthlyLevel pure fn + 16 unit tests)
- Validation:
  - `jest PathV33RewardService.test.ts 16/16`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 06:19:55 +0900

- Entry-ID: `H0023`
- Completed:
  - [x] feat(reward): V3.3 Phase 2 — POST/GET /api/v1/path/module/v33/level-drafts + LevelDraftSheet + bell rewires + Today 役割 button removed
- Remaining:
  - [ ] Phase 3: /path/team feed + personal dashboard
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(reward): V3.3 Phase 2 — POST/GET /api/v1/path/module/v33/level-drafts + LevelDraftSheet + bell rewires + Today 役割 button removed
- Validation:
  - `server build ✓ / V3.3 jest 16/16 ✓ / frontend build ✓ / eslint 0 ✓ / vitest 119/125 (6 pre-existing)`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 06:39:36 +0900

- Entry-ID: `H0024`
- Completed:
  - [x] feat(reward): V3.3 Phase 3 — GET /v33/team-feed + PathV33PersonalDashboard + PathV33TeamFeed + tabbed /path page (個人 / チーム / 報酬確認)
- Remaining:
  - [ ] Phase 4: Objection + Co-sign proposal type + ObjectionBody UI + co-sign API
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(reward): V3.3 Phase 3 — GET /v33/team-feed + PathV33PersonalDashboard + PathV33TeamFeed + tabbed /path page (個人 / チーム / 報酬確認)
- Validation:
  - `server build ✓ / frontend build ✓ / eslint 0 ✓ / vitest 120 pass (+1 from baseline), 6 pre-existing failures`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 06:52:51 +0900

- Entry-ID: `H0025`
- Completed:
  - [x] feat(reward): V3.3 Phase 4 — PathV33ObjectionService + level.objection Proposal type + ObjectionBody in registry + ObjectionSubmitSheet on team feed (異議 button) + co-sign auto-accept flow
- Remaining:
  - [ ] Phase 5: month-end lock cron + finalization modal + reward_run hook
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(reward): V3.3 Phase 4 — PathV33ObjectionService + level.objection Proposal type + ObjectionBody in registry + ObjectionSubmitSheet on team feed (異議 button) + co-sign ...
- Validation:
  - `server build ✓ / jest PathV33ObjectionService 4/4 ✓ / PathV33RewardService 16/16 ✓ / frontend build ✓ / eslint 0 ✓ / vitest 120 pass (no new failures)`
- Landmines:
  - No new landmines reported in this chunk.

# Project Handoff Profile / Domain Index - 2026-05-11

## Active Domains

| Domain | File | Last Updated | Status |
| ------ | ---- | ------------ | ------ |
| deploy/production | `handoff/deploy/production.md` | 2026-05-07 | Open production /money in browser if visual smoke is needed |
| local | `handoff/local.md` | 2026-05-10 | User selected option (a): production migration repair + s... |
| server | `handoff/server.md` | 2026-05-11 | active |

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
- [focus] NEXT_CMD: `PR #18 のmerge後、必要に応じてvendorsテーブル (法人外注先) や admin向け他メンバー閲覧API を Phase 2 で検討`. Source: realtime
- [H0034] Completed: feat(profile): profiles拡張 (phone/job_type/employment_kind/振込先5列/インボイス番号/住所5列/緊急連絡) + Settings UI 4カード + 機微列のRLS REVOKE
- [H0034] Remaining: PR #18 のmerge後、必要に応じてvendorsテーブル (法人外注先) や admin向け他メンバー閲覧API を Phase 2 で検討
- [H0033] Completed: feat(org): 招待発行(POST/GET/DELETE) + ?invite=<uuid>自動受諾 + プロフィール氏名/username編集
- [H0033] Remaining: Phase 1: profiles拡張 (phone/job_type/employment_kind/振込先4列/インボイス番号/住所/緊急連絡) を別ブランチで実装
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0034] Auto-captured decision: feat(profile): profiles拡張 (phone/job_type/employment_kind/振込先5列/インボイス番号/住所5列/緊急連絡) + Settings UI 4カード + 機微列のRLS REVOKE
- [H0033] Auto-captured decision: feat(org): 招待発行(POST/GET/DELETE) + ?invite=<uuid>自動受諾 + プロフィール氏名/username編集
- [H0032] Auto-captured decision: feat(nav): ベルを下部ナビから外し全画面共通の floating ボタンへ移行（FAB の左横に着地）
- [H0031] Auto-captured decision: fix(sites): PUT /:id で status を active/tentative/in_progress に制限し completed/deleted バイパスを封じた
- [H0030] Auto-captured decision: chore(sites): 論理削除時の dead status='deleted' 書き込みを除去（deleted_at が唯一の真実）
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0034] No new landmines reported in this chunk.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0034] PR #18 のmerge後、必要に応じてvendorsテーブル (法人外注先) や admin向け他メンバー閲覧API を Phase 2 で検討
- [H0033] Phase 1: profiles拡張 (phone/job_type/employment_kind/振込先4列/インボイス番号/住所/緊急連絡) を別ブランチで実装
- [H0032] 実機で見え方確認・スマホで親指届くか検証
- [H0031] 他バグ調査継続 or 担当者ON/OFFのoptimistic lock
- [H0030] 現場ページ周辺の他バグ調査を継続
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `16`
- last_compacted_at: `2026-05-11 07:44:56 +0900`
- archived_entries: `18`
<!-- HANDOFF_L2_STATE_END -->

---

## 11. Incremental Updates

> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260511_074456.md` at 2026-05-11 07:44:56 +0900.


> L3 compaction: archived 9 entries to `.session/handoff_archive/L3_compacted_20260511_055412.md` at 2026-05-11 05:54:12 +0900.


## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- (no events recorded yet)
<!-- HANDOFF_SESSION_EVENTS_END -->

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

### 2026-05-11 07:09:17 +0900

- Entry-ID: `H0026`
- Completed:
  - [x] audit(reward-v33): close 4 HIGH findings — lock draft on accept (#1), reject locked re-submit (#2), block self-objection (#10), route objection proposal through ProposalService + suppress UI approve button (#4); document 6 deferred items for Phase 5/6
- Remaining:
  - [ ] Phase 5: month-end lock cron + finalization modal + reward_run hook
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: audit(reward-v33): close 4 HIGH findings — lock draft on accept (#1), reject locked re-submit (#2), block self-objection (#10), route objection proposal through ProposalServic...
- Validation:
  - `server build ✓ / V3.3 jest 20/20 ✓ / frontend build ✓ / eslint 0 ✓ / vitest 120 pass (baseline)`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 07:16:51 +0900

- Entry-ID: `H0027`
- Completed:
  - [x] feat(reward): V3.3 Phase 5 — PathV33MonthService (lock/expire/finalize) + admin endpoints + finalization tab UI + audit #3/#5/#6/#8/#9 fixes
- Remaining:
  - [ ] Phase 6: V3.2→V3.3 cutover + data migration + deprecate path.level.update proposals
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(reward): V3.3 Phase 5 — PathV33MonthService (lock/expire/finalize) + admin endpoints + finalization tab UI + audit #3/#5/#6/#8/#9 fixes
- Validation:
  - `server build ✓ / V3.3 jest 20/20 ✓ / frontend build ✓ / eslint 0 ✓ / vitest 120 pass (baseline)`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 07:25:43 +0900

- Entry-ID: `H0028`
- Completed:
  - [x] feat(reward): V3.3 Phase 6 cutover — remap V3.2 history to V3.3 scale (migration) + fetchPriorMonthLevel defensive mapping (audit #7) + remove SiteDetailModal levelDraftSection + spec v1.0
- Remaining:
  - [ ] V3.3 implementation complete; merge PR #14 after manual smoke test
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(reward): V3.3 Phase 6 cutover — remap V3.2 history to V3.3 scale (migration) + fetchPriorMonthLevel defensive mapping (audit #7) + remove SiteDetailModal levelDraftSectio...
- Validation:
  - `server build ✓ / V3.3 jest 20/20 ✓ / frontend build ✓ / eslint 0 ✓ / vitest 120 pass (baseline)`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 07:36:13 +0900

- Entry-ID: `H0029`
- Completed:
  - [x] fix(sites): 連続施工+期間未入力をフロント/サーバー両面でブロック
- Remaining:
  - [ ] 別セッションのPathV33作業を待ち、必要に応じてuseCalendar側にも保険を入れる
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: fix(sites): 連続施工+期間未入力をフロント/サーバー両面でブロック
- Validation:
  - `frontend tsc --noEmit ✅ / server tsc --noEmit ✅`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 07:44:56 +0900

- Entry-ID: `H0030`
- Completed:
  - [x] chore(sites): 論理削除時の dead status='deleted' 書き込みを除去（deleted_at が唯一の真実）
- Remaining:
  - [ ] 現場ページ周辺の他バグ調査を継続
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: chore(sites): 論理削除時の dead status='deleted' 書き込みを除去（deleted_at が唯一の真実）
- Validation:
  - `server tsc --noEmit ✅`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 12:26:42 +0900

- Entry-ID: `H0031`
- Completed:
  - [x] fix(sites): PUT /:id で status を active/tentative/in_progress に制限し completed/deleted バイパスを封じた
- Remaining:
  - [ ] 他バグ調査継続 or 担当者ON/OFFのoptimistic lock
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: fix(sites): PUT /:id で status を active/tentative/in_progress に制限し completed/deleted バイパスを封じた
- Validation:
  - `server tsc --noEmit ✅`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 12:49:28 +0900

- Entry-ID: `H0032`
- Completed:
  - [x] feat(nav): ベルを下部ナビから外し全画面共通の floating ボタンへ移行（FAB の左横に着地）
- Remaining:
  - [ ] 実機で見え方確認・スマホで親指届くか検証
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(nav): ベルを下部ナビから外し全画面共通の floating ボタンへ移行（FAB の左横に着地）
- Validation:
  - `frontend tsc ✅ / vitest App.test 25/25 ✅`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 13:43:11 +0900

- Entry-ID: `H0033`
- Completed:
  - [x] feat(org): 招待発行(POST/GET/DELETE) + ?invite=<uuid>自動受諾 + プロフィール氏名/username編集
- Remaining:
  - [ ] Phase 1: profiles拡張 (phone/job_type/employment_kind/振込先4列/インボイス番号/住所/緊急連絡) を別ブランチで実装
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(org): 招待発行(POST/GET/DELETE) + ?invite=<uuid>自動受諾 + プロフィール氏名/username編集
- Validation:
  - `frontend tsc/eslint/vite build/App.test 25/25 OK, server tsc OK, vitest 120 pass (baseline), server jest 422 pass (baseline)`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-11 13:49:28 +0900

- Entry-ID: `H0034`
- Completed:
  - [x] feat(profile): profiles拡張 (phone/job_type/employment_kind/振込先5列/インボイス番号/住所5列/緊急連絡) + Settings UI 4カード + 機微列のRLS REVOKE
- Remaining:
  - [ ] PR #18 のmerge後、必要に応じてvendorsテーブル (法人外注先) や admin向け他メンバー閲覧API を Phase 2 で検討
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: feat(profile): profiles拡張 (phone/job_type/employment_kind/振込先5列/インボイス番号/住所5列/緊急連絡) + Settings UI 4カード + 機微列のRLS REVOKE
- Validation:
  - `frontend tsc/eslint/vite build/App.test 25/25 OK, server tsc OK`
- Landmines:
  - No new landmines reported in this chunk.

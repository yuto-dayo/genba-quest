# Session Handoff - 2026-05-08

## 0. Quick Resume (AI)

- NEXT_CMD: `Next: wire invoice creation to revenue_basis allocations and prevent PL duplication by recording invoice issuance as no-op or BS transfer via posting_group invoice_transfer.`
- SUCCESS_CRITERIA: `Completed / Remaining / Quality Gate が現セッション内容で更新されている`
- HOTSET:
  - `/Users/yutoyoshino/Documents/genba-quest/handoff/local.md`
  - `/Users/yutoyoshino/Documents/genba-quest/docs/DESIGN_PHILOSOPHY.md`
- DO_NOT_READ:
  - `docs/DESIGN_PHILOSOPHY.md` (full)
- VERIFY_FIRST:
  - `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`
- STATE:
  - Branch: `codex/a`
  - Uncommitted: `6 files`
  - DB migrations: `latest local: none found`
  - Tests: `not run yet`
  - Lint: `not run yet`

  - HEAD: `dc79f63`
  - Updated: `2026-05-08T22:54:21+0900`
<!-- L0_END: セッション開始時はここまで読めばOK。L1以降は必要時のみ。 -->

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- 2026-05-08 22:03:12 +0900 — started by codex
- 2026-05-08 22:04:08 +0900 — ended by codex
- 2026-05-08 22:24:14 +0900 — started by codex
- 2026-05-08 22:29:33 +0900 — ended by codex
- 2026-05-08 22:31:11 +0900 — started by codex
- 2026-05-08 22:37:50 +0900 — ended by codex
- 2026-05-08 22:40:03 +0900 — started by codex
- 2026-05-08 22:47:41 +0900 — ended by codex
- 2026-05-08 22:49:27 +0900 — started by codex
- 2026-05-08 22:54:51 +0900 — ended by codex
- 2026-05-08 22:56:17 +0900 — started by codex
<!-- HANDOFF_SESSION_EVENTS_END -->

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `Next: wire invoice creation to revenue_basis allocations and prevent PL duplication by recording invoice issuance as no-op or BS transfer via posting_group invoice_transfer.`. Source: realtime
- [H0005] Completed: Updated PathGovernedModuleService payout journal writes to include org_id on accounting_journal_entries and accounting_journal_lines so P0 child org constraints will not break PATH payout postings.
- [H0005] Remaining: Next: wire invoice creation to revenue_basis allocations and prevent PL duplication by recording invoice issuance as no-op or BS transfer via posting_group invoice_transfer.
- [H0004] Completed: Frontend Money API wrappers now attach client idempotency keys for expense/sale/invoice/void writes.
- [H0004] Remaining: Next P0.5: design revenue_basis / proposal_executions / posting_groups / accounting_journal_* canonical schema and keep accounting_transactions as projection.
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0005] Auto-captured decision: Updated PathGovernedModuleService payout journal writes to include org_id on accounting_journal_entries and accounting_journal_lines so P0 child org constraints will not break P...
- [H0004] Auto-captured decision: Frontend Money API wrappers now attach client idempotency keys for expense/sale/invoice/void writes.
- [H0003] Auto-captured decision: P0 accounting DB integrity guard migration drafted: accounting write idempotency table, child-table org_id columns/backfill, NOT VALID org-required checks/composite FKs, posted ...
- [H0002] Auto-captured decision: P0 accounting route org boundary hardened: active org membership middleware added, DEFAULT_ORG_ID fallback removed from accounting route, org_id filters added to transaction/inv...
- [H0001] Auto-captured decision: Calendar FAB/long-press schedule behavior verified; preparing commit, branch push, master merge
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0005] No new landmines reported in this chunk.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0005] Next: wire invoice creation to revenue_basis allocations and prevent PL duplication by recording invoice issuance as no-op or BS transfer via posting_group invoice_transfer.
- [H0004] Next P0.5: design revenue_basis / proposal_executions / posting_groups / accounting_journal_* canonical schema and keep accounting_transactions as projection.
- [H0003] Implement idempotency_key required flow end-to-end in Money API wrappers and accounting write routes, then validate migration after resolving local storage.buckets blocker in prior drawing migration.
- [H0002] Design P0 migration for child-table org_id/composite FK and idempotency key table before remote DB writes
- [H0001] stage, commit, push codex/a, merge to master, push master
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

## 1. Resume（次の1手）

```text
Agent: 未定（Claude Code / Codex）
Branch: codex/a
Phase: A-0/A-1
```

> [carryover] Working tree was dirty at session start (6 files). Prior session may have unfinished work — verify NEXT_CMD before executing.

1. `docs/DESIGN_PHILOSOPHY.md` の冒頭を確認
2. このファイルを更新しながら実装を進める

---

## 2. Goal（このセッションの目的）

**Ticket**: 未設定
現セッションでの目的を記載

---

## 3. Completed

- [x] Updated PathGovernedModuleService payout journal writes to include org_id on accounting_journal_entries and accounting_journal_lines so P0 child org constraints will not break PATH payout postings.
- [x] Frontend Money API wrappers now attach client idempotency keys for expense/sale/invoice/void writes.
- [x] P0 accounting DB integrity guard migration drafted: accounting write idempotency table, child-table org_id columns/backfill, NOT VALID org-required checks/composite FKs, posted journal immutability triggers, and journal balance RPC helper. Server child inserts now provide org_id for transaction items, invoice sources, journal entries, and journal lines.
- [x] P0 accounting route org boundary hardened: active org membership middleware added, DEFAULT_ORG_ID fallback removed from accounting route, org_id filters added to transaction/invoice/document read-write paths, document storage keys now use org prefix
- [x] Calendar FAB/long-press schedule behavior verified; preparing commit, branch push, master merge
---

## 4. Remaining（優先順位順）

- [ ] **P0**: Next: wire invoice creation to revenue_basis allocations and prevent PL duplication by recording invoice issuance as no-op or BS transfer via posting_group invoice_transfer.
- [ ] **P1**: Next P0.5: design revenue_basis / proposal_executions / posting_groups / accounting_journal_* canonical schema and keep accounting_transactions as projection.
- [ ] **P1**: Implement idempotency_key required flow end-to-end in Money API wrappers and accounting write routes, then validate migration after resolving local storage.buckets blocker in prior drawing migration.
- [ ] **P1**: Design P0 migration for child-table org_id/composite FK and idempotency key table before remote DB writes
- [ ] **P1**: stage, commit, push codex/a, merge to master, push master
---

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| `(not recorded)` | No file list provided (use --file "path - semantic description") |
| `server/src/__tests__/unit/accountingRoute.test.ts` | assert org_id propagation on accounting child writes |
| `server/src/routes/accounting.ts` | include org_id in accounting child writes for new constraints |
| `supabase/migrations/20260508133147_p0_accounting_integrity_guards.sql` | P0 accounting integrity/idempotency schema guards |
| `server/src/__tests__/unit/accountingRoute.test.ts` | cover org scoped accounting route behavior |
| `server/src/routes/accounting.ts` | enforce active org and explicit org scoped accounting access |
| `frontend/src/pages/Calendar.test.tsx` | FAB and long-press expectations updated |
| `frontend/src/pages/Calendar.tsx` | schedule-only FAB and inspect-date focus |
| `frontend/src/components/calendar/MonthCalendar.tsx` | long press now inspects selected date |
| `frontend/src/components/calendar/CalendarScheduleModal.tsx` | removes assignment menu option |
---

## 6. Locked Files（編集中 - 他エージェント触らない）

> なし
---

## 7. Quality Gate

```bash
cd server && npx tsc --noEmit
cd frontend && npx tsc --noEmit
cd frontend && npx eslint src/
```

| Check | Result | Notes |
| ----- | ------ | ----- |
| server typecheck | PASS | run by session-end (2026-05-08 22:54) |
| frontend typecheck | PASS | run by session-end (2026-05-08 22:54) |
| lint | PASS | frontend eslint src/ at 2026-05-08 22:54 |
| test | PASS | server npm test -- --runInBand at 2026-05-08 22:54 |

---

## 8. Key Decisions

| Decision | Rationale |
| -------- | --------- |
| `docs/DESIGN_PHILOSOPHY.md` を作業前に参照 | 設計逸脱を防ぐため |

---

## 9. Risks / Blockers

- 新規の blocker は未記録
---

## 10. References

- `docs/DESIGN_PHILOSOPHY.md` - 作業前に必ず参照
- `docs/AGENT_OPS.md` - セッション運用手順

---

## 11. Incremental Updates

### 2026-05-08 22:03:32 +0900

- Entry-ID: `H0001`
- Completed:
  - [x] Calendar FAB/long-press schedule behavior verified; preparing commit, branch push, master merge
- Remaining:
  - [ ] stage, commit, push codex/a, merge to master, push master
- Changed Files:
  - `frontend/src/components/calendar/CalendarScheduleModal.tsx` - removes assignment menu option
  - `frontend/src/components/calendar/MonthCalendar.tsx` - long press now inspects selected date
  - `frontend/src/pages/Calendar.tsx` - schedule-only FAB and inspect-date focus
  - `frontend/src/pages/Calendar.test.tsx` - FAB and long-press expectations updated
- Working Context:
  - Auto-captured decision: Calendar FAB/long-press schedule behavior verified; preparing commit, branch push, master merge
- Validation:
  - `cd frontend && npm test -- Calendar.test.tsx => PASS (12 tests)`
  - `cd frontend && npm run build => PASS`
  - `cd frontend && npm run lint => PASS`
  - `Playwright calendar right-click date => selected day schedule shown, no add dialog, no 現場に入れる`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-08 22:29:12 +0900

- Entry-ID: `H0002`
- Completed:
  - [x] P0 accounting route org boundary hardened: active org membership middleware added, DEFAULT_ORG_ID fallback removed from accounting route, org_id filters added to transaction/invoice/document read-write paths, document storage keys now use org prefix
- Remaining:
  - [ ] Design P0 migration for child-table org_id/composite FK and idempotency key table before remote DB writes
- Changed Files:
  - `server/src/routes/accounting.ts` - enforce active org and explicit org scoped accounting access
  - `server/src/__tests__/unit/accountingRoute.test.ts` - cover org scoped accounting route behavior
- Working Context:
  - Auto-captured decision: P0 accounting route org boundary hardened: active org membership middleware added, DEFAULT_ORG_ID fallback removed from accounting route, org_id filters added to transaction/inv...
- Validation:
  - `cd server && npm test -- accountingRoute.test.ts --runInBand => PASS (33/33); cd server && npx tsc --noEmit => PASS`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-08 22:37:33 +0900

- Entry-ID: `H0003`
- Completed:
  - [x] P0 accounting DB integrity guard migration drafted: accounting write idempotency table, child-table org_id columns/backfill, NOT VALID org-required checks/composite FKs, posted journal immutability triggers, and journal balance RPC helper. Server child inserts now provide org_id for transaction items, invoice sources, journal entries, and journal lines.
- Remaining:
  - [ ] Implement idempotency_key required flow end-to-end in Money API wrappers and accounting write routes, then validate migration after resolving local storage.buckets blocker in prior drawing migration.
- Changed Files:
  - `supabase/migrations/20260508133147_p0_accounting_integrity_guards.sql` - P0 accounting integrity/idempotency schema guards
  - `server/src/routes/accounting.ts` - include org_id in accounting child writes for new constraints
  - `server/src/__tests__/unit/accountingRoute.test.ts` - assert org_id propagation on accounting child writes
- Working Context:
  - Auto-captured decision: P0 accounting DB integrity guard migration drafted: accounting write idempotency table, child-table org_id columns/backfill, NOT VALID org-required checks/composite FKs, posted ...
- Validation:
  - `scripts/db/check-sql-boundaries.sh => PASS; docker psql transaction smoke for 20260508133147_p0_accounting_integrity_guards.sql => PASS/ROLLBACK; cd server && npm test -- accountingRoute.test.ts --runInBand => PASS (33/33); cd server && npx tsc --noEmit => PASS; cd frontend && npx tsc --noEmit => PASS; supabase migration up --local => BLOCKED before new migration by existing 20260506043949 storage.buckets missing`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-08 22:47:24 +0900

- Entry-ID: `H0004`
- Completed:
  - [x] Frontend Money API wrappers now attach client idempotency keys for expense/sale/invoice/void writes.
- Remaining:
  - [ ] Next P0.5: design revenue_basis / proposal_executions / posting_groups / accounting_journal_* canonical schema and keep accounting_transactions as projection.
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: Frontend Money API wrappers now attach client idempotency keys for expense/sale/invoice/void writes.
- Validation:
  - `server accountingRoute.test.ts=pass|35 tests`
  - `server tsc=pass|npx tsc --noEmit`
  - `frontend tsc=pass|npx tsc --noEmit`
  - `sql-boundaries=pass|canonical SQL limited to supabase/migrations and supabase/seed.sql`
  - `migration dry-run=pass|docker postgres BEGIN + migration + ROLLBACK`
  - `supabase migration up --local=blocked|pre-existing 20260506043949_add_private_site_drawings.sql fails because storage.buckets relation is absent`
- Landmines:
  - No new landmines reported in this chunk.

### 2026-05-08 22:54:21 +0900

- Entry-ID: `H0005`
- Completed:
  - [x] Updated PathGovernedModuleService payout journal writes to include org_id on accounting_journal_entries and accounting_journal_lines so P0 child org constraints will not break PATH payout postings.
- Remaining:
  - [ ] Next: wire invoice creation to revenue_basis allocations and prevent PL duplication by recording invoice issuance as no-op or BS transfer via posting_group invoice_transfer.
- Changed Files:
  - No file list provided (use --file "path - semantic description")
- Working Context:
  - Auto-captured decision: Updated PathGovernedModuleService payout journal writes to include org_id on accounting_journal_entries and accounting_journal_lines so P0 child org constraints will not break P...
- Validation:
  - `p0+p05 migration dry-run=pass|docker postgres BEGIN + both migrations + ROLLBACK`
  - `server accountingRoute.test.ts=pass|35 tests`
  - `PathGovernedModuleService.test.ts=pass|16 tests`
  - `server tsc=pass|npx tsc --noEmit`
  - `frontend tsc=pass|npx tsc --noEmit`
  - `sql-boundaries=pass|canonical SQL limited to supabase/migrations and supabase/seed.sql`
  - `git diff --check=pass`
  - `supabase migration up --local=blocked|pre-existing 20260506043949_add_private_site_drawings.sql fails because storage.buckets relation is absent`
- Landmines:
  - No new landmines reported in this chunk.

# Session Handoff - 2026-05-08

## 0. Quick Resume (AI)

- NEXT_CMD: `Continue P1 by moving invoice creation command orchestration into AccountingCommandService, then layer Proposal-shaped responses over the isolated command service.`
- SUCCESS_CRITERIA: `Completed / Remaining / Quality Gate が現セッション内容で更新されている`
- HOTSET:
  - `/Users/yutoyoshino/Documents/genba-quest/handoff/local.md`
  - `/Users/yutoyoshino/Documents/genba-quest/docs/DESIGN_PHILOSOPHY.md`
- DO_NOT_READ:
  - `docs/DESIGN_PHILOSOPHY.md` (full)
- VERIFY_FIRST:
  - `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`
- STATE:
  - Branch: `codex/money-fix`
  - Uncommitted: `5 files`
  - DB migrations: `latest local: none found`
  - Tests: `not run yet`
  - Lint: `not run yet`

  - HEAD: `18442c2`
  - Updated: `2026-05-08T23:33:52+0900`
<!-- L0_END: セッション開始時はここまで読めばOK。L1以降は必要時のみ。 -->

## Session Events (audit log)

<!-- HANDOFF_SESSION_EVENTS_START -->
- 2026-05-08 23:14:34 +0900 — started by codex
<!-- HANDOFF_SESSION_EVENTS_END -->

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [focus] NEXT_CMD: `Continue P1 by moving invoice creation command orchestration into AccountingCommandService, then layer Proposal-shaped responses over the isolated command service.`. Source: realtime
- [H0004] Completed: P1 prep: moved payment allocation RPC and void reversal command bodies into AccountingCommandService while keeping route-level validation, idempotency, and HTTP error mapping.
- [H0004] Remaining: Continue P1 by moving invoice creation command orchestration into AccountingCommandService, then layer Proposal-shaped responses over the isolated command service.
- [H0003] Completed: P1 prep: extracted the legacy accounting transaction/journal write helpers for expenses and sales into server/src/services/AccountingCommandService.ts, leaving accounting routes as HTTP/org/idempotency adapters while preserving existing behavior.
- [H0003] Remaining: Continue P1 by moving invoice/payment/void command bodies behind the same service boundary, then introduce Proposal-return shapes once the write commands are isolated.
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [H0004] This continues Hume's recommended P1 command-service seam. Proposal/ledger/RLS/auth policy remains parent-owned and unchanged.
- [H0003] Subagent Hume confirmed the safest P1 route/service seam is to isolate idempotent Money write commands first; parent kept Proposal/ledger/RLS/auth decisions in route-owned scope for now.
- [H0002] Subagents investigated invoice atomic RPC and P1 helper extraction. Parent implemented invoice RPC boundary; remote DB migration/push still unexecuted.
- [H0001] Subagents investigated P0.5/P1 next slices. Parent kept accounting/org/ledger implementation local. Remote DB migration/push still unexecuted.
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [H0004] Invoice creation orchestration is still route-local; command service is not yet returning the final proposal/execution/posting/projection response shape.
- [H0003] This is behavior-preserving extraction only; invoice/payment/void command bodies are still route-local and Proposal-backed Money response shape is not implemented yet.
- [H0002] Remote Supabase migration remains unexecuted; supabase migration up --local remains blocked by pre-existing storage.buckets issue.
- [H0001] Local supabase migration up --local remains blocked by pre-existing storage.buckets issue before these migrations; remote Supabase writes still require explicit approval.
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [H0004] Continue P1 by moving invoice creation command orchestration into AccountingCommandService, then layer Proposal-shaped responses over the isolated command service.
- [H0003] Continue P1 by moving invoice/payment/void command bodies behind the same service boundary, then introduce Proposal-return shapes once the write commands are isolated.
- [H0002] Commit this atomic invoice slice; next choose either P1 helper extraction for Proposal-backed Money writes or DB integration tests for rpc_create_accounting_invoice.
- [H0001] Next slice: make invoice creation itself atomic via RPC, or begin P1 by extracting direct accounting write helpers for Proposal execution reuse.
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- current_l3_entries: `4`
- last_compacted_at: `never`
- archived_entries: `0`
<!-- HANDOFF_L2_STATE_END -->

---

## 1. Resume（次の1手）

```text
Agent: 未定（Claude Code / Codex）
Branch: codex/money-fix
Phase: A-0/A-1
```

> [carryover] Working tree was dirty at session start (5 files). Prior session may have unfinished work — verify NEXT_CMD before executing.

1. `docs/DESIGN_PHILOSOPHY.md` の冒頭を確認
2. このファイルを更新しながら実装を進める

---

## 2. Goal（このセッションの目的）

**Ticket**: 未設定
現セッションでの目的を記載

---

## 3. Completed

- [x] P1 prep: moved payment allocation RPC and void reversal command bodies into AccountingCommandService while keeping route-level validation, idempotency, and HTTP error mapping.
- [x] P1 prep: extracted the legacy accounting transaction/journal write helpers for expenses and sales into server/src/services/AccountingCommandService.ts, leaving accounting routes as HTTP/org/idempotency adapters while preserving existing behavior.
- [x] P0.5 invoice creation now prefers atomic DB RPC: invoice numbering, invoice insert, source links, revenue allocations, and legacy transaction kind updates are one transaction, with legacy fallback only when the RPC is unavailable.
- [x] Committed P0.5 invoice/payment allocation hardening: invoice allocation preflight rejects over-allocation before numbering, DB trigger serializes invoice allocation cap per revenue_basis, and payment allocation route uses atomic RPC without PL journal writes.
---

## 4. Remaining（優先順位順）

- [ ] **P0**: Continue P1 by moving invoice creation command orchestration into AccountingCommandService, then layer Proposal-shaped responses over the isolated command service.
- [ ] **P1**: Continue P1 by moving invoice/payment/void command bodies behind the same service boundary, then introduce Proposal-return shapes once the write commands are isolated.
- [ ] **P1**: Commit this atomic invoice slice; next choose either P1 helper extraction for Proposal-backed Money writes or DB integration tests for rpc_create_accounting_invoice.
- [ ] **P1**: Next slice: make invoice creation itself atomic via RPC, or begin P1 by extracting direct accounting write helpers for Proposal execution reuse.
---

## 5. Changed Files

| File | What Changed |
| ---- | ------------ |
| `server/src/routes/accounting.ts` | route delegates payment/void writes to command service |
| `server/src/services/AccountingCommandService.ts` | payment allocation and void reversal command bodies |
| `server/src/routes/accounting.ts` | now imports accounting command helpers and keeps route-level validation/idempotency |
| `server/src/services/AccountingCommandService.ts` | extracted expense/sale write helpers and journal creation |
| `supabase/migrations/20260508141832_atomic_invoice_creation.sql` | rpc_create_accounting_invoice atomic write boundary |
| `server/src/__tests__/unit/accountingRoute.test.ts` | atomic invoice RPC and missing-RPC fallback coverage |
| `server/src/routes/accounting.ts` | atomic invoice RPC preference with missing-function legacy fallback |
| `supabase/migrations/20260508141045_enforce_invoice_allocation_capacity.sql` | DB trigger for invoice allocation cap and atomic payment allocation RPC |
| `server/src/__tests__/unit/accountingRoute.test.ts` | invoice over-allocation and payment allocation tests |
| `server/src/routes/accounting.ts` | invoice allocation preflight guard and payment allocation RPC route |
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
| server typecheck | PASS | `cd server && npx tsc --noEmit` |
| frontend typecheck | SKIP | not run yet |
| lint | SKIP | not run yet |
| test | PASS | `cd server && npm test -- accountingRoute.test.ts --runInBand` (38 tests) |

---

## 8. Key Decisions

| Decision | Rationale |
| -------- | --------- |
| `docs/DESIGN_PHILOSOPHY.md` を作業前に参照 | 設計逸脱を防ぐため |

---

## 9. Risks / Blockers

- Invoice creation orchestration is still route-local; command service is not yet returning the final proposal/execution/posting/projection response shape.
- This is behavior-preserving extraction only; invoice/payment/void command bodies are still route-local and Proposal-backed Money response shape is not implemented yet.
- Remote Supabase migration remains unexecuted; supabase migration up --local remains blocked by pre-existing storage.buckets issue.
- Local supabase migration up --local remains blocked by pre-existing storage.buckets issue before these migrations; remote Supabase writes still require explicit approval.
---

## 10. References

- `docs/DESIGN_PHILOSOPHY.md` - 作業前に必ず参照
- `docs/AGENT_OPS.md` - セッション運用手順

---

## 11. Incremental Updates

### 2026-05-08 23:15:10 +0900

- Entry-ID: `H0001`
- Completed:
  - [x] Committed P0.5 invoice/payment allocation hardening: invoice allocation preflight rejects over-allocation before numbering, DB trigger serializes invoice allocation cap per revenue_basis, and payment allocation route uses atomic RPC without PL journal writes.
- Remaining:
  - [ ] Next slice: make invoice creation itself atomic via RPC, or begin P1 by extracting direct accounting write helpers for Proposal execution reuse.
- Changed Files:
  - `server/src/routes/accounting.ts` - invoice allocation preflight guard and payment allocation RPC route
  - `server/src/__tests__/unit/accountingRoute.test.ts` - invoice over-allocation and payment allocation tests
  - `supabase/migrations/20260508141045_enforce_invoice_allocation_capacity.sql` - DB trigger for invoice allocation cap and atomic payment allocation RPC
- Working Context:
  - Subagents investigated P0.5/P1 next slices. Parent kept accounting/org/ledger implementation local. Remote DB migration/push still unexecuted.
- Validation:
  - `commit=pass|feat: harden invoice and payment allocations; server accountingRoute.test.ts=pass|38 tests; server tsc=pass|npx tsc --noEmit; migration dry-run=pass|docker psql BEGIN + P0/P0.5/new migration + ROLLBACK; sql-boundaries=pass; git diff --check=pass`
- Landmines:
  - Local supabase migration up --local remains blocked by pre-existing storage.buckets issue before these migrations; remote Supabase writes still require explicit approval.

### 2026-05-08 23:25:04 +0900

- Entry-ID: `H0002`
- Completed:
  - [x] P0.5 invoice creation now prefers atomic DB RPC: invoice numbering, invoice insert, source links, revenue allocations, and legacy transaction kind updates are one transaction, with legacy fallback only when the RPC is unavailable.
- Remaining:
  - [ ] Commit this atomic invoice slice; next choose either P1 helper extraction for Proposal-backed Money writes or DB integration tests for rpc_create_accounting_invoice.
- Changed Files:
  - `server/src/routes/accounting.ts` - atomic invoice RPC preference with missing-function legacy fallback
  - `server/src/__tests__/unit/accountingRoute.test.ts` - atomic invoice RPC and missing-RPC fallback coverage
  - `supabase/migrations/20260508141832_atomic_invoice_creation.sql` - rpc_create_accounting_invoice atomic write boundary
- Working Context:
  - Subagents investigated invoice atomic RPC and P1 helper extraction. Parent implemented invoice RPC boundary; remote DB migration/push still unexecuted.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; migration dry-run=pass|docker psql BEGIN + P0/P0.5/payment/allocation + atomic invoice migration + ROLLBACK; sql-boundaries=pass; git diff --check=pass`
- Landmines:
  - Remote Supabase migration remains unexecuted; supabase migration up --local remains blocked by pre-existing storage.buckets issue.

### 2026-05-08 23:29:53 +0900

- Entry-ID: `H0003`
- Completed:
  - [x] P1 prep: extracted the legacy accounting transaction/journal write helpers for expenses and sales into server/src/services/AccountingCommandService.ts, leaving accounting routes as HTTP/org/idempotency adapters while preserving existing behavior.
- Remaining:
  - [ ] Continue P1 by moving invoice/payment/void command bodies behind the same service boundary, then introduce Proposal-return shapes once the write commands are isolated.
- Changed Files:
  - `server/src/services/AccountingCommandService.ts` - extracted expense/sale write helpers and journal creation
  - `server/src/routes/accounting.ts` - now imports accounting command helpers and keeps route-level validation/idempotency
- Working Context:
  - Subagent Hume confirmed the safest P1 route/service seam is to isolate idempotent Money write commands first; parent kept Proposal/ledger/RLS/auth decisions in route-owned scope for now.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; git diff --check=pass`
- Landmines:
  - This is behavior-preserving extraction only; invoice/payment/void command bodies are still route-local and Proposal-backed Money response shape is not implemented yet.

### 2026-05-08 23:33:52 +0900

- Entry-ID: `H0004`
- Completed:
  - [x] P1 prep: moved payment allocation RPC and void reversal command bodies into AccountingCommandService while keeping route-level validation, idempotency, and HTTP error mapping.
- Remaining:
  - [ ] Continue P1 by moving invoice creation command orchestration into AccountingCommandService, then layer Proposal-shaped responses over the isolated command service.
- Changed Files:
  - `server/src/services/AccountingCommandService.ts` - payment allocation and void reversal command bodies
  - `server/src/routes/accounting.ts` - route delegates payment/void writes to command service
- Working Context:
  - This continues Hume's recommended P1 command-service seam. Proposal/ledger/RLS/auth policy remains parent-owned and unchanged.
- Validation:
  - `server accountingRoute.test.ts=pass|39 tests; server tsc=pass|npx tsc --noEmit; git diff --check=pass`
- Landmines:
  - Invoice creation orchestration is still route-local; command service is not yet returning the final proposal/execution/posting/projection response shape.

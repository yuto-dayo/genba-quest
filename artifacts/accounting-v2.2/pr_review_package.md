# Accounting v2.2 PR Review Package

Generated: 2026-05-10 JST

Branch: `codex/money-fix`

Remote DB migration / push / migration repair: **not executed**.

## Draft PR Title

```text
Accounting v2.2: harden org/RPC boundaries and add canonical posting evidence
```

## Draft PR Body

```markdown
## Summary

This PR advances GENBA QUEST accounting v2.2 without touching remote DB state.

Main goals:

- stop org/document boundary leaks in accounting and site document flows
- enforce accounting write idempotency and transition lineage semantics
- move Money writes toward canonical posting while preserving legacy-compatible responses
- add local evidence that PL compare, invoice/payment no-PL-revenue, reversals, and posted journal immutability hold
- harden accounting SECURITY DEFINER RPC grants and search_path settings

Remote DB migration / push / migration repair have not been executed.

## Key Changes

### P0 boundary hardening

- Accounting write routes resolve active org/membership and ignore body/URL org spoofing.
- Site/accounting document access now verifies active-org ownership before signed URL / OCR / PDF paths.
- New document storage paths are org-prefixed.
- Legacy unprefixed document paths fail closed: no signed URL, OCR denied before Storage download.

### Idempotency and transition lineage

- Accounting write idempotency uses request hash, response snapshot, status, and endpoint-scoped keys.
- Replays return the original response and do not create duplicate lineage/projection/posting rows.
- Transition proposal lineage is explicitly marked as:
  - `lineage_mode: "transition"`
  - `lifecycle_engine: "money_transition"`
  - `full_proposal_lifecycle: false`

### Canonical posting path

- Added/connected canonical posting RPCs for:
  - sales
  - sales reversal
  - low-risk expenses
  - invoice transfer without PL revenue
  - payment receipt without PL revenue
  - payment allocation without PL revenue
- `accounting_transactions` remains a compatibility projection.
- `/pl` now supports `source=legacy|journal|compare`.
- Compare mode uses journal gross-compatible totals for diff while keeping journal net accounting totals visible.

### SECURITY DEFINER hardening

- Protected accounting/site RPC direct execute is revoked from `public`, `anon`, and `authenticated`.
- Membership-aware/canonical accounting RPCs validate `org_id + actor_user_id + membership_id`.
- Accounting helper/trigger functions now use `search_path=pg_catalog` and service-role-only execute.
- Legacy accounting base RPCs now use `search_path=pg_catalog`; service_role compatibility is intentionally retained for wrapper/canonical fallback paths.

## Local Evidence

Evidence artifacts are under `artifacts/accounting-v2.2/`.

- `migration_verification_report.md`
- `security_definer_hardening_test.md`
- `org_boundary_negative_test.md`
- `document_boundary_test.md`
- `idempotency_parallel_test.md`
- `local_posting_chain_integration_result.md`
- `pl_compare_posted_journal_invariants.md`
- `legacy_rpc_search_path_classification.md`
- `private_helper_hardening_test.md`
- `legacy_base_rpc_hardening_test.md`

Representative local commands run:

```bash
supabase migration up --local
node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs
node artifacts/accounting-v2.2/local_org_boundary_negative_test.mjs
node artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs
node artifacts/accounting-v2.2/local_idempotency_concurrency_test.mjs
node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs
cd server && npx tsc --noEmit
cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand
scripts/db/check-sql-boundaries.sh
git diff --check
```

Most recent local checks passed:

- local migration apply: pass
- RPC hardening negative script: pass
- PL compare / reversal / posted journal immutability script: pass
- server TypeScript: pass
- accounting route unit tests: pass, 56/56
- SQL boundary guard: pass
- whitespace diff check: pass

## Important Accounting Contracts Locked

- Invoice/payment postings do not increase PL revenue.
- Posted journal entries and lines cannot be updated or deleted.
- Posted sale reversal keeps the original transaction/journal and adds a separate reversal transaction/journal.
- Legacy PL and journal gross-compatible PL diff is zero for representative sale/expense/invoice/payment/reversal flows.
- `accounting_transactions` is treated as a projection, not the final source of truth.

## Not Done In This PR

- Remote DB migration was not applied.
- Remote migration repair was not run.
- Push/production deploy was not performed.
- Legacy unprefixed document path backfill is intentionally deferred. Current behavior is fail-closed.
- Non-accounting legacy SECURITY DEFINER functions are not fully classified in this PR.
- Final PL source switch from legacy to journal is not performed; compare mode is the bridge.

## Review Notes

Please review in this order:

1. `supabase/migrations/*accounting*` and the two latest RPC hardening migrations.
2. `server/src/services/AccountingCommandService.ts`.
3. `server/src/routes/accounting.ts`.
4. Evidence artifacts under `artifacts/accounting-v2.2/`.

The riskiest compatibility point is that some old base RPCs retain `service_role` execute for wrapper/canonical fallback compatibility. Direct app-role execute remains revoked.
```

## Pre-Remote Go / No-Go Checklist

Do not run remote migration until all of these are accepted:

- [ ] PR review accepts local migration order.
- [ ] PR review accepts service_role compatibility retained on old base RPCs.
- [ ] `supabase migration up --local` passes from a clean local DB.
- [ ] `node artifacts/accounting-v2.2/local_rpc_hardening_negative_test.mjs` passes.
- [ ] `node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs` passes.
- [ ] `cd server && npx tsc --noEmit` passes.
- [ ] `cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand` passes.
- [ ] `scripts/db/check-sql-boundaries.sh` passes.
- [ ] rollback/repair plan is written for staging.
- [ ] user explicitly approves remote DB migration.

## Suggested Next Step

Push branch and open a draft PR after user approval.

Suggested command sequence:

```bash
git status -sb
git push -u origin codex/money-fix
gh pr create --draft --base master --head codex/money-fix --title "Accounting v2.2: harden org/RPC boundaries and add canonical posting evidence" --body-file artifacts/accounting-v2.2/pr_review_package.md
```

Use the draft PR body above instead of the whole review package if creating manually in GitHub.

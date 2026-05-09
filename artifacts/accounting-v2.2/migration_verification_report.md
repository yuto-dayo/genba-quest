# Accounting v2.2 Local Migration Verification

Date: 2026-05-09

## Scope

- Target org_id: not_applicable_local_dry_run
- Remote DB migration: not executed
- Remote DB push: not executed
- Migration repair: not executed

## Scenario

Implemented and locally verified the first v2.2 slice:

- SECURITY DEFINER RPC hardening for accounting/site-completion RPC entrypoints
- Active membership propagation from HTTP routes into service-role RPC calls
- Transition lineage semantics for Money expense and sales writes
- Sales transition proposal lineage response envelope
- Transition lineage for invoice issue, payment allocation, and transaction reversal
- `no_pl_journal` response wording replaced with `no_pl_revenue` for invoice/payment posting modes
- Accounting transaction projection metadata columns for v2.2 source mode and expense reimbursement dimensions
- `/expenses` payload acceptance for `expense_scope`, `paid_by`, claimant, settlement, payment account, reimbursement status, and recurring template references

## Commands

```bash
docker run --name genba-v22-sqlcheck -e POSTGRES_PASSWORD=postgres -v /Users/yutoyoshino/Documents/genba-quest:/repo:ro -d postgres:16
psql -v ON_ERROR_STOP=1 -h localhost -p 55432 -U postgres -d postgres -f /repo/supabase/migrations/20260509100057_harden_accounting_rpc_membership.sql
cd server && npx tsc --noEmit
cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts src/__tests__/unit/SiteCompletionService.test.ts --runInBand
scripts/db/check-sql-boundaries.sh
git diff --check
```

## Expected Failure Contracts Covered By This Slice

- `RPC_MEMBERSHIP_REQUIRED`: service-role RPC wrapper should fail when `p_membership_id` is missing or does not match active org/user membership.
- Direct RPC execution by `public`, `anon`, and `authenticated` is revoked in migration for hardened accounting/site completion RPC signatures.
- Money transition lineage responses must identify `lineage_mode=transition`, `lifecycle_engine=money_transition`, and `full_proposal_lifecycle=false`.
- Invoice/payment posting responses must identify `affects_pl=false`, `affects_revenue=false`, and AR impact separately.
- Member-paid expenses must reject requests without `claimant_member_id`.

## Result

- Migration syntax dry-run: pass
- TypeScript: pass
- Targeted unit tests: pass, 45 tests
- Accounting route unit tests after invoice/payment/void lineage: pass, 39 tests
- Accounting route unit tests after expense reimbursement payload: pass, 40 tests
- Projection metadata migration syntax dry-run: pass
- SQL boundary check: pass
- Whitespace check: pass

## Row Counts / Checksums

- Row counts: not_applicable_local_dry_run
- Before checksum: not_applicable_local_dry_run
- After checksum: not_applicable_local_dry_run

## Notes

- This artifact is local evidence only. DB integration evidence against a real Supabase database still needs explicit approval before remote execution.
- Existing legacy service-role RPC signatures remain available for compatibility but are also revoked from `public`, `anon`, and `authenticated`.

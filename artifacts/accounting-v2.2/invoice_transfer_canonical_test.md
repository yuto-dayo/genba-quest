# Accounting v2.2 Invoice Transfer Canonical Evidence

Date: 2026-05-09
Branch: codex/money-fix
Target org_id: 11111111-1111-4111-8111-111111111111 (unit fixture)

## Scenario

- `POST /api/v1/accounting/invoices` now calls `rpc_create_accounting_invoice_canonical` when available.
- The canonical RPC creates transition `invoice.create` lineage and optional `invoice_transfer` journal lines.
- Invoice issue uses `posting.mode = invoice_issue_no_pl_revenue`.
- `affects_pl = false`, `affects_revenue = false`, `affects_ar = true`.
- If recognized revenue was already `accounts_receivable`, posting is `not_required`.
- If recognized revenue was `contract_asset` or `unbilled_receivable`, the RPC posts only BS transfer lines:
  - Dr `1200` accounts receivable
  - Cr `1220` contract asset and/or `1210` unbilled receivable

## Idempotency

- Same-key replay is checked before duplicate invoice detection.
- Replay returns the saved response snapshot without creating another invoice, proposal, posting group, journal entry, or projection.
- RPC replay only returns `succeeded` executions and validates a source request signature.
- Mismatched replay raises `IDEMPOTENCY_CONFLICT`.

## Verification

Executed:

```bash
cd server && npx tsc --noEmit
cd server && npm test -- --runTestsByPath src/__tests__/unit/accountingRoute.test.ts --runInBand
scripts/db/check-sql-boundaries.sh
git diff --check
```

Result:

- TypeScript: PASS
- Accounting route tests: PASS, 55/55
- SQL boundary check: PASS
- Diff whitespace check: PASS

## Row Counts / Checksums

Remote DB migration was not executed. Local SQL was kept as a migration artifact only.

- Created migration file: `supabase/migrations/20260509135652_canonical_invoice_transfer_posting_rpc.sql`
- Runtime DB row counts: not collected
- Before/after checksum: not collected


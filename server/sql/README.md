# Legacy SQL Boundary

`server/sql` is no longer the executable migration path, and this directory
must not contain direct `*.sql` files.

Canonical DB history now lives in:

- `supabase/migrations/*.sql`
- `supabase/seed.sql`

Former numbered SQL files were moved to `archive/server-sql/*.sql.legacy`.
Those files are retained only as historical reference and must not be run
against local, staging, or production databases.

## Cleanup Buckets

Use `docs/SQL_INVENTORY.md` as the current decision record.

| Bucket | Meaning |
| --- | --- |
| `IN_BASELINE` | Required behavior is already represented in canonical Supabase migrations. Do not re-run this file. |
| `MISSING_FROM_BASELINE` | Runtime-needed behavior is absent and must be rewritten as a new forward migration. Do not copy the legacy file verbatim. |
| `DELETE_CANDIDATE` | No runtime reference was found; eligible for archive/delete after explicit approval. |
| `QUARANTINE_DANGEROUS` | Contains unsafe legacy patterns such as stale RLS, direct Proposal/Ledger mutation, broad DDL, or cascade-heavy changes. Do not execute. |
| `LEGACY_ONLY` | Historical evidence only. |

## Current Rewrite Candidates

As of 2026-05-04, the previously missing runtime-needed legacy deltas have
been forward-migrated:

- `supabase/migrations/20260504085000_add_reward_snapshot_tables.sql`
- `supabase/migrations/20260504090000_add_site_complete_with_close_attempts.sql`

Accounting reference rows from legacy `007_master_data` were adopted into
`supabase/migrations/20260504084000_seed_accounting_master_data.sql`.

Run `scripts/db/check-sql-boundaries.sh` before committing DB cleanup work.

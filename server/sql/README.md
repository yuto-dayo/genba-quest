# Legacy SQL Archive

`server/sql` is no longer the executable migration path.

Canonical DB history now lives in:

- `supabase/migrations/*.sql`
- `supabase/seed.sql`

Do not run files in this directory against local, staging, or production databases. These files are retained only as historical reference while the legacy archive is being cleaned up.

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

As of 2026-05-04, only these legacy files are known to contain runtime-needed objects missing from the canonical DB:

- `server/sql/059_path_canonical_reward_writer_cutover.sql`
- `server/sql/064_site_complete_with_close_attempts.sql`

Any required behavior from those files must be implemented as small new files under `supabase/migrations`, using current RLS helpers such as `private.is_active_member(org_id)`.

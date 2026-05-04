# Legacy Server SQL Archive

This directory contains the former `server/sql/*.sql` files after Supabase
baseline adoption.

These files are not executable migrations. They keep historical context only.
The `.sql.legacy` suffix is intentional so shell globs and SQL runners do not
pick them up as active database changes.

Use these paths only as reference when rewriting a currently needed delta into
`supabase/migrations/*.sql`.

Current canonical SQL entrypoints:

- `supabase/migrations/*.sql`
- `supabase/seed.sql`

Do not run files in this archive against local, staging, or production
databases.

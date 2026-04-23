---
name: guarding-supabase-rls-sql
description: Use this skill when creating or reviewing Supabase/Postgres SQL migrations, RLS policies, or public views in GENBA QUEST. This includes adding tables under public, writing org-scoped policies, fixing lint items such as "RLS Disabled in Public", "RLS references user metadata", or "Security Definer View", and choosing between membership-based, parent-derived, shared-master, or security-invoker view patterns.
---

# Guarding Supabase RLS SQL

Use this skill for `server/sql/*.sql` work that can affect Supabase exposure, RLS, or view execution context.

## Why this skill exists

This repo accumulated three recurring SQL security mistakes:

1. New `public.*` tables were added without companion RLS enablement and policies in the same migration or the immediate next migration.
2. Older policies used `auth.jwt() -> 'user_metadata' ->> 'org_id'`, which is user-editable and unsafe in security predicates.
3. A public view was defined as `SECURITY DEFINER`, causing it to evaluate with owner privileges instead of caller privileges.

## Mandatory guardrails

- Never use `auth.jwt() -> 'user_metadata'` in RLS.
- Prefer `private.is_active_member(org_id)` for org-scoped reads/writes.
- Prefer `private.has_org_role(org_id, ARRAY['admin']::text[])` for org-admin-only management paths.
- If a child table has no `org_id`, derive access from its parent with `EXISTS (...)`.
- If a table is in `public`, assume PostgREST exposure and add explicit RLS in the same migration or the immediate next migration unless it is intentionally private and protected some other way.
- Do not use `SECURITY DEFINER` on views exposed to application queries.
- For views over RLS-protected tables, prefer `WITH (security_invoker = true)`.

## Pattern selection

### 1. Org-scoped table with `org_id`

Use:

```sql
USING (private.is_active_member(org_id))
WITH CHECK (private.is_active_member(org_id))
```

For admin-only writes:

```sql
USING (private.has_org_role(org_id, ARRAY['admin']::text[]))
WITH CHECK (private.has_org_role(org_id, ARRAY['admin']::text[]))
```

### 2. Child table without `org_id`

Derive access from the parent table.

Examples:
- `site_line_items` via `site_id -> public.sites`
- `accounting_invoice_sources` via `invoice_id -> public.accounting_invoices`

Use `EXISTS` against the parent and apply `private.is_active_member(parent.org_id)` or the parent ownership rule there.

### 3. Shared reference/master table

If the table is global shared data and intentionally not tenant-scoped:

- still `ENABLE ROW LEVEL SECURITY`
- usually allow `SELECT` to `authenticated`
- avoid direct client writes unless there is a clear admin workflow

### 4. Public views

If the view is queried by app roles and reads from RLS-protected tables:

- define it with `WITH (security_invoker = true)`
- do not rely on `SECURITY DEFINER`

## Review checklist

Before finishing any SQL migration, check:

1. Does every new `public.*` table have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` in the same migration or the immediate next migration?
2. Are there explicit `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies where needed?
3. Does any policy reference `user_metadata`? If yes, rewrite it.
4. Does org authorization use `org_memberships` helpers instead of JWT claims?
5. If the table has no `org_id`, is access derived from the correct parent?
6. If a view was added or changed, does it use `security_invoker`?
7. If management access is org-scoped, is it using `private.has_org_role` rather than legacy `profiles.role`?

## Validation commands

Run these after editing SQL:

```bash
./.claude/skills/guarding-supabase-rls-sql/scripts/check-migration-guards.sh server/sql/080_example.sql
rg -n "auth\\.jwt\\(\\).*user_metadata|NULLIF\\(auth\\.jwt\\(\\) -> 'user_metadata'" server/sql
rg -n "profiles\\.role" server/sql
rg -n "CREATE( OR REPLACE)? VIEW public\\.|WITH \\(security_invoker = true\\)" server/sql
rg -n "ENABLE ROW LEVEL SECURITY|CREATE POLICY" server/sql
git diff --check -- server/sql
```

The `rg` checks are a low-noise pre-flight. Use the Supabase/schema linter after applying migrations. This skill is not a replacement for linting.

## References

- See `./references/sql-rls-patterns.md` for repo-specific before/after patterns.

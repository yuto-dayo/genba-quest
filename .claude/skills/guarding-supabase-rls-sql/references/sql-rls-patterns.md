# SQL RLS Patterns For GENBA QUEST

## Root cause summary

The issues fixed in this session were mostly copy-forward mistakes:

1. Older migrations used JWT org claim checks with:

```sql
COALESCE(
  NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
  NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid
)
```

This became stale after `org_memberships` and helper functions were introduced in `056_org_membership_foundation.sql`.

2. New `public` tables were created without an RLS companion in the same migration or the immediate next migration.

3. A convenience view over an RLS-protected table was left as owner-executed instead of caller-executed.

## Safe replacements

### Org-scoped table

Replace:

```sql
org_id = COALESCE(...)
```

With:

```sql
private.is_active_member(org_id)
```

### Admin-only manage path

Replace legacy org-bound checks such as:

```sql
EXISTS (
  SELECT 1
  FROM public.profiles
  WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'manager')
)
```

With:

```sql
private.has_org_role(org_id, ARRAY['admin']::text[])
```

Note: this repo's `org_memberships` currently normalizes org authority to `admin/member`.

### Child table without `org_id`

Use parent-derived access:

```sql
EXISTS (
  SELECT 1
  FROM public.sites site
  WHERE site.id = site_id
    AND private.is_active_member(site.org_id)
)
```

### Shared master table

For tables like `trade_families`:

```sql
ALTER TABLE public.trade_families ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read trade_families" ON public.trade_families
  FOR SELECT TO authenticated
  USING (true);
```

### Public view over RLS tables

Use:

```sql
CREATE OR REPLACE VIEW public.some_view
WITH (security_invoker = true) AS
SELECT ...
```

## Timing rule for new public tables

When a migration creates `public.some_table`, one of these must also happen before the work is considered complete:

1. The same migration enables RLS and creates the required policies.
2. The immediately following migration does it as an intentional split.

Do not leave a new public table exposed across multiple later migrations.

## Fast local verification

After creating or editing a migration, run:

```bash
./.claude/skills/guarding-supabase-rls-sql/scripts/check-migration-guards.sh server/sql/080_example.sql
```

This catches the repo's main copy-forward hazards before schema linting:

- executable `user_metadata` references
- executable `profiles.role` authorization
- public views missing `security_invoker`
- new `public` tables missing RLS/policies in the same or next migration

## Migrations added in this session

Representative fixes created during this session:

- `065_accounting_invoice_sources_rls.sql`
- `066_trade_families_rls.sql`
- `067_site_line_items_rls.sql`
- `068_proposal_executions_rls_membership.sql`
- `069_posting_groups_rls_membership.sql`
- `070_month_closes_rls_membership.sql`
- `071_month_close_lines_rls_membership.sql`
- `072_month_close_line_sources_rls_membership.sql`
- `073_reward_runs_rls_membership.sql`
- `074_focus_items_rls_membership.sql`
- `075_reward_run_lines_rls_membership.sql`
- `076_reward_write_controls_rls_membership.sql`
- `077_site_completion_events_rls_membership.sql`
- `078_revenue_basis_rls_membership.sql`
- `079_reward_write_guard_status_security_invoker.sql`

Use them as concrete local examples when editing adjacent tables.

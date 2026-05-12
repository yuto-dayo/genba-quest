-- Drop PATH v3.1 dead reward/role tables.
-- Superseded by v3.3 level draft flow.

DROP TABLE IF EXISTS public.site_member_reward_inputs;
DROP TABLE IF EXISTS public.site_member_role_plans;
DROP FUNCTION IF EXISTS public.path_role_shares_valid(jsonb);

-- Rollback (manual):
-- Recreate dropped objects by referencing
-- supabase/migrations/20260501130150_remote_baseline_20260430.sql
-- sections for:
-- - public.path_role_shares_valid(jsonb)
-- - public.site_member_reward_inputs
-- - public.site_member_role_plans

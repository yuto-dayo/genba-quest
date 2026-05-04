-- ============================================================
-- Make reward_write_guard_status respect caller RLS
-- ============================================================
-- SECURITY DEFINER views evaluate with the view owner's privileges.
-- This view should inherit the caller's permissions on reward_write_controls.

CREATE OR REPLACE VIEW public.reward_write_guard_status
WITH (security_invoker = true) AS
SELECT
  org_id,
  MAX(control_mode) FILTER (WHERE control_key = 'legacy_reward_write') AS legacy_reward_write_mode,
  MAX(control_mode) FILTER (WHERE control_key = 'canonical_reward_system') AS canonical_reward_system_mode,
  (MAX(config_json::text) FILTER (WHERE control_key = 'legacy_reward_write'))::jsonb AS legacy_reward_write_config,
  (MAX(config_json::text) FILTER (WHERE control_key = 'canonical_reward_system'))::jsonb AS canonical_reward_system_config,
  MAX(updated_at) AS updated_at
FROM public.reward_write_controls
GROUP BY org_id;

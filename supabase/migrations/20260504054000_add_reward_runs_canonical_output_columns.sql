-- Add canonical reward output metadata columns expected by current PATH services.
-- Existing table/RLS policies come from the remote baseline; this migration only
-- reconciles schema drift for local reset reproducibility.

ALTER TABLE public.reward_runs
  ADD COLUMN IF NOT EXISTS policy_bundle_version_id uuid,
  ADD COLUMN IF NOT EXISTS policy_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reward_engine_version text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rounding_mode text NOT NULL DEFAULT 'half_up',
  ADD COLUMN IF NOT EXISTS rounding_scale integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounding_minor_unit integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS input_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preview_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS closed_profit numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS path_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variable_pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guaranteed_total_amount numeric(15, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.reward_runs.policy_fingerprint IS
  'Policy or PATH rule fingerprint used to produce the immutable reward run.';
COMMENT ON COLUMN public.reward_runs.input_hash IS
  'Stable hash of the calculation input/snapshot for idempotency and drift checks.';
COMMENT ON COLUMN public.reward_runs.preview_snapshot_id IS
  'Optional PATH preview snapshot used by governed reward execution.';

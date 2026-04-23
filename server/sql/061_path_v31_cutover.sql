-- ============================================================
-- 061: PATH V3.1 cutover foundation
-- ============================================================

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_type_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_type_check
  CHECK (type IN (
    'expense.create',
    'expense.update',
    'expense.void',
    'income.create',
    'income.update',
    'income.reverse',
    'invoice.create',
    'invoice.send',
    'invoice.mark_paid',
    'reward.calculate',
    'reward.adjust',
    'skill.achieve',
    'skill.revoke',
    'evaluation.submit',
    'evaluation.finalize',
    'assignment.create',
    'assignment.update',
    'assignment.cancel',
    'leave.request',
    'communication.review',
    'communication.task',
    'task.revision.request',
    'site.create',
    'site.complete',
    'site.close.finalize',
    'site.close.reopen',
    'policy.update',
    'luqo.catalog.add',
    'luqo.star.achieve',
    'luqo.score.update',
    'luqo.reward.calculate'
  ));

ALTER TABLE public.reward_runs
  DROP CONSTRAINT IF EXISTS reward_runs_calculation_system_check;

ALTER TABLE public.reward_runs
  ADD CONSTRAINT reward_runs_calculation_system_check
  CHECK (calculation_system IN ('path_v22', 'path_v31'));

CREATE TABLE IF NOT EXISTS public.path_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  version text NOT NULL,
  effective_from date NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  fingerprint text NOT NULL,
  constants_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, version)
);

CREATE INDEX IF NOT EXISTS path_rule_versions_org_status_effective_idx
  ON public.path_rule_versions (org_id, status, effective_from DESC);

ALTER TABLE public.path_rule_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read path_rule_versions" ON public.path_rule_versions;
DROP POLICY IF EXISTS "Insert path_rule_versions" ON public.path_rule_versions;
DROP POLICY IF EXISTS "Update path_rule_versions" ON public.path_rule_versions;

CREATE POLICY "Read path_rule_versions"
ON public.path_rule_versions
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Insert path_rule_versions"
ON public.path_rule_versions
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Update path_rule_versions"
ON public.path_rule_versions
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS path_rule_versions_set_updated_at ON public.path_rule_versions;
CREATE TRIGGER path_rule_versions_set_updated_at
BEFORE UPDATE ON public.path_rule_versions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.site_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  recognized_revenue numeric(15, 2) NOT NULL DEFAULT 0,
  material_cost numeric(15, 2) NOT NULL DEFAULT 0,
  external_cost numeric(15, 2) NOT NULL DEFAULT 0,
  direct_cost numeric(15, 2) NOT NULL DEFAULT 0,
  overhead_allocated numeric(15, 2) NOT NULL DEFAULT 0,
  known_rework_cost numeric(15, 2) NOT NULL DEFAULT 0,
  approved_adjustments numeric(15, 2) NOT NULL DEFAULT 0,
  distributable_profit numeric(15, 2) NOT NULL DEFAULT 0,
  difficulty_band text NOT NULL CHECK (difficulty_band IN ('S1', 'S2', 'S3')),
  share_mode text NOT NULL CHECK (share_mode IN ('auto_points', 'fixed_template')),
  fixed_template_key text,
  fixed_template_reason_code text,
  share_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  path_rule_version_id uuid REFERENCES public.path_rule_versions(id) ON DELETE SET NULL,
  path_rule_version text NOT NULL,
  path_rule_fingerprint text NOT NULL,
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by jsonb,
  status text NOT NULL DEFAULT 'finalized' CHECK (status IN ('draft', 'finalized', 'reopened', 'superseded')),
  reopened_by_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS site_closes_org_closed_idx
  ON public.site_closes (org_id, closed_at DESC, site_id);

ALTER TABLE public.site_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_closes" ON public.site_closes;
DROP POLICY IF EXISTS "Insert site_closes" ON public.site_closes;
DROP POLICY IF EXISTS "Update site_closes" ON public.site_closes;

CREATE POLICY "Read site_closes"
ON public.site_closes
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Insert site_closes"
ON public.site_closes
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Update site_closes"
ON public.site_closes
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS site_closes_set_updated_at ON public.site_closes;
CREATE TRIGGER site_closes_set_updated_at
BEFORE UPDATE ON public.site_closes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.site_day_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  date date NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  trade_families jsonb NOT NULL DEFAULT '[]'::jsonb,
  role_type text NOT NULL CHECK (role_type IN ('assist', 'lead', 'solo', 'support')),
  credited_unit numeric(12, 2) NOT NULL DEFAULT 0,
  memo text NOT NULL DEFAULT '',
  locked_by_site_close_id uuid REFERENCES public.site_closes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_day_logs_org_date_idx
  ON public.site_day_logs (org_id, date DESC, site_id, member_id);

CREATE INDEX IF NOT EXISTS site_day_logs_locked_idx
  ON public.site_day_logs (locked_by_site_close_id)
  WHERE locked_by_site_close_id IS NOT NULL;

ALTER TABLE public.site_day_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_day_logs" ON public.site_day_logs;
DROP POLICY IF EXISTS "Insert site_day_logs" ON public.site_day_logs;
DROP POLICY IF EXISTS "Update site_day_logs" ON public.site_day_logs;

CREATE POLICY "Read site_day_logs"
ON public.site_day_logs
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Insert site_day_logs"
ON public.site_day_logs
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Update site_day_logs"
ON public.site_day_logs
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS site_day_logs_set_updated_at ON public.site_day_logs;
CREATE TRIGGER site_day_logs_set_updated_at
BEFORE UPDATE ON public.site_day_logs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.site_member_outcome_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_close_id uuid NOT NULL REFERENCES public.site_closes(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  outcome_status text NOT NULL CHECK (outcome_status IN ('ok', 'rework', 'unknown')),
  rework_units numeric(12, 2) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_close_id, member_id)
);

CREATE INDEX IF NOT EXISTS site_member_outcomes_org_close_idx
  ON public.site_member_outcome_snapshots (org_id, site_close_id, member_id);

ALTER TABLE public.site_member_outcome_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read site_member_outcome_snapshots" ON public.site_member_outcome_snapshots;
DROP POLICY IF EXISTS "Insert site_member_outcome_snapshots" ON public.site_member_outcome_snapshots;
DROP POLICY IF EXISTS "Update site_member_outcome_snapshots" ON public.site_member_outcome_snapshots;

CREATE POLICY "Read site_member_outcome_snapshots"
ON public.site_member_outcome_snapshots
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Insert site_member_outcome_snapshots"
ON public.site_member_outcome_snapshots
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Update site_member_outcome_snapshots"
ON public.site_member_outcome_snapshots
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS site_member_outcomes_set_updated_at ON public.site_member_outcome_snapshots;
CREATE TRIGGER site_member_outcomes_set_updated_at
BEFORE UPDATE ON public.site_member_outcome_snapshots
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.monthly_distribution_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  canonical_month_close_id uuid REFERENCES public.month_closes(id) ON DELETE SET NULL,
  pool_amount numeric(15, 2) NOT NULL DEFAULT 0,
  floor_rate numeric(8, 4) NOT NULL DEFAULT 0.35,
  result_rate numeric(8, 4) NOT NULL DEFAULT 0.65,
  nonlinear_exponent numeric(8, 4) NOT NULL DEFAULT 1.12,
  path_rule_version_id uuid REFERENCES public.path_rule_versions(id) ON DELETE SET NULL,
  path_rule_version text NOT NULL,
  path_rule_fingerprint text NOT NULL,
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by jsonb,
  status text NOT NULL DEFAULT 'finalized' CHECK (status IN ('draft', 'finalized', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS monthly_distribution_closes_org_month_idx
  ON public.monthly_distribution_closes (org_id, month, closed_at DESC);

ALTER TABLE public.monthly_distribution_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read monthly_distribution_closes" ON public.monthly_distribution_closes;
DROP POLICY IF EXISTS "Insert monthly_distribution_closes" ON public.monthly_distribution_closes;
DROP POLICY IF EXISTS "Update monthly_distribution_closes" ON public.monthly_distribution_closes;

CREATE POLICY "Read monthly_distribution_closes"
ON public.monthly_distribution_closes
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Insert monthly_distribution_closes"
ON public.monthly_distribution_closes
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Update monthly_distribution_closes"
ON public.monthly_distribution_closes
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS monthly_distribution_closes_set_updated_at ON public.monthly_distribution_closes;
CREATE TRIGGER monthly_distribution_closes_set_updated_at
BEFORE UPDATE ON public.monthly_distribution_closes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.monthly_distribution_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  monthly_distribution_close_id uuid NOT NULL REFERENCES public.monthly_distribution_closes(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  floor_units numeric(12, 2) NOT NULL DEFAULT 0,
  floor_pay numeric(15, 2) NOT NULL DEFAULT 0,
  raw_result_weight numeric(15, 4) NOT NULL DEFAULT 0,
  boosted_result_weight numeric(15, 4) NOT NULL DEFAULT 0,
  speed_class text NOT NULL DEFAULT 'normal' CHECK (speed_class IN ('slow', 'normal', 'fast')),
  speed_coeff numeric(8, 4) NOT NULL DEFAULT 1.0,
  result_pay numeric(15, 2) NOT NULL DEFAULT 0,
  correction numeric(15, 2) NOT NULL DEFAULT 0,
  total_pay numeric(15, 2) NOT NULL DEFAULT 0,
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (monthly_distribution_close_id, member_id)
);

CREATE INDEX IF NOT EXISTS monthly_distribution_lines_close_idx
  ON public.monthly_distribution_lines (monthly_distribution_close_id, member_id);

ALTER TABLE public.monthly_distribution_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read monthly_distribution_lines" ON public.monthly_distribution_lines;
DROP POLICY IF EXISTS "Insert monthly_distribution_lines" ON public.monthly_distribution_lines;
DROP POLICY IF EXISTS "Update monthly_distribution_lines" ON public.monthly_distribution_lines;

CREATE POLICY "Read monthly_distribution_lines"
ON public.monthly_distribution_lines
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Insert monthly_distribution_lines"
ON public.monthly_distribution_lines
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Update monthly_distribution_lines"
ON public.monthly_distribution_lines
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.skill_ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  member_id uuid NOT NULL,
  trade_family text NOT NULL REFERENCES public.trade_families(key),
  assist_units numeric(12, 2) NOT NULL DEFAULT 0,
  lead_units numeric(12, 2) NOT NULL DEFAULT 0,
  solo_units numeric(12, 2) NOT NULL DEFAULT 0,
  recent_90d_units numeric(12, 2) NOT NULL DEFAULT 0,
  ok_count integer NOT NULL DEFAULT 0,
  rework_count integer NOT NULL DEFAULT 0,
  last_performed_at date,
  derived_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, member_id, trade_family)
);

CREATE INDEX IF NOT EXISTS skill_ledgers_org_member_idx
  ON public.skill_ledgers (org_id, member_id, trade_family);

ALTER TABLE public.skill_ledgers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read skill_ledgers" ON public.skill_ledgers;
DROP POLICY IF EXISTS "Insert skill_ledgers" ON public.skill_ledgers;
DROP POLICY IF EXISTS "Update skill_ledgers" ON public.skill_ledgers;

CREATE POLICY "Read skill_ledgers"
ON public.skill_ledgers
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Insert skill_ledgers"
ON public.skill_ledgers
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Update skill_ledgers"
ON public.skill_ledgers
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS skill_ledgers_set_updated_at ON public.skill_ledgers;
CREATE TRIGGER skill_ledgers_set_updated_at
BEFORE UPDATE ON public.skill_ledgers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.lead_assignment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  date date NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  trade_family text NOT NULL REFERENCES public.trade_families(key),
  difficulty_band text NOT NULL CHECK (difficulty_band IN ('S1', 'S2', 'S3')),
  risk_band text NOT NULL CHECK (risk_band IN ('low', 'medium', 'high')),
  candidate_member_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  recommendation_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_member_id uuid,
  chosen_member_id uuid,
  confidence text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  predicted_productivity numeric(8, 4) NOT NULL DEFAULT 0,
  growth_bonus numeric(8, 4) NOT NULL DEFAULT 0,
  fairness_bonus numeric(8, 4) NOT NULL DEFAULT 0,
  override_reason_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_assignment_logs_org_date_idx
  ON public.lead_assignment_logs (org_id, date DESC, site_id);

ALTER TABLE public.lead_assignment_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read lead_assignment_logs" ON public.lead_assignment_logs;
DROP POLICY IF EXISTS "Insert lead_assignment_logs" ON public.lead_assignment_logs;

CREATE POLICY "Read lead_assignment_logs"
ON public.lead_assignment_logs
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Insert lead_assignment_logs"
ON public.lead_assignment_logs
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE TABLE public.member_tax_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  member_id uuid NOT NULL REFERENCES auth.users(id),
  contract_type text NOT NULL CHECK (contract_type IN ('subcontract','employee_like','undetermined')),
  tax_withholding_category text NOT NULL DEFAULT 'none' CHECK (tax_withholding_category IN ('none','10.21%','custom')),
  custom_withholding_rate numeric(5,4),  -- tax_withholding_category='custom'時
  classification_check_status text NOT NULL CHECK (classification_check_status IN ('verified','review_needed','unset')),
  classification_check_results jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- {q1_substitution: bool, q2_time_freedom: bool, q3_work_autonomy: bool, q4_own_tools: bool, q5_outcome_liability: bool}
  classification_notes text,
  effective_from date NOT NULL,
  effective_until date,
  decided_by uuid NOT NULL REFERENCES auth.users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  proposal_id uuid REFERENCES proposals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE UNIQUE INDEX uq_member_tax_classifications_active
  ON member_tax_classifications (org_id, member_id)
  WHERE effective_until IS NULL;

CREATE INDEX idx_member_tax_classifications_lookup
  ON member_tax_classifications (org_id, member_id, effective_from DESC);

ALTER TABLE member_tax_classifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT private.has_org_role(p_org_id, ARRAY['admin']::text[]);
$$;

CREATE POLICY mtc_select_self ON member_tax_classifications
  FOR SELECT USING (member_id = auth.uid());

CREATE POLICY mtc_select_admin ON member_tax_classifications
  FOR SELECT USING (is_org_admin(org_id));

-- INSERT/UPDATE は service_role のみ

COMMENT ON TABLE public.member_tax_classifications IS
  '職人ごとの外注/給与扱い判定履歴。profiles 直拡張を避け、税務根拠を履歴管理する。';
COMMENT ON COLUMN public.member_tax_classifications.classification_check_results IS
  '5項目チェック: q1_substitution/q2_time_freedom/q3_work_autonomy/q4_own_tools/q5_outcome_liability';

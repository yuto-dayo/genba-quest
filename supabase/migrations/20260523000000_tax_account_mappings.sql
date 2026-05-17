-- PR-33: UI display labels and tax ledger accounts must be separated.
-- This layer reduces 所基通28-1 payroll-classification risk by ensuring
-- worker-facing wording such as "手当" is never used as the ledger account.

ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS display_label_snapshot text;

COMMENT ON COLUMN public.ledger_entries.display_label_snapshot
  IS 'UI display label frozen at posting time. Existing rows remain NULL; mapping edits do not rewrite history.';

ALTER TABLE public.ledger_events
  DROP CONSTRAINT IF EXISTS ledger_events_event_type_check;

ALTER TABLE public.ledger_events
  ADD CONSTRAINT ledger_events_event_type_check
  CHECK (
    event_type = ANY (
      ARRAY[
        'expense_recorded',
        'expense_voided',
        'income_recorded',
        'invoice_issued',
        'invoice_sent',
        'payment_received',
        'reward_calculated',
        'reward_adjusted',
        'skill_achieved',
        'skill_revoked',
        'evaluation_finalized',
        'assignment.scheduled',
        'assignment.rescheduled',
        'assignment.cancelled',
        'leave.recorded',
        'communication.review_recorded',
        'communication.task_recorded',
        'task.revision_requested',
        'site.created',
        'internal_transfer',
        'reward.calculate',
        'reward.adjust',
        'reward.pool.adjust',
        'payout.scheduled',
        'payout.executed',
        'expense.create',
        'invoice.create',
        'invoice.member_issue',
        'cash_receipt.record',
        'payment.record',
        'payment.allocate',
        'recurring_expense.create'
      ]::text[]
    )
  );

CREATE TABLE IF NOT EXISTS public.tax_account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_label text NOT NULL,
  tax_account_code text NOT NULL REFERENCES public.account_master(code),
  tax_account_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('income','expense','asset','liability','equity')),
  applicable_proposal_types text[] NOT NULL DEFAULT '{}',
  effective_from date NOT NULL,
  effective_until date,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(display_label) <> ''),
  CHECK (btrim(tax_account_code) <> ''),
  CHECK (btrim(tax_account_name) <> ''),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

COMMENT ON TABLE public.tax_account_mappings
  IS 'Org-scoped history-managed mapping from UI display labels to statutory ledger account codes.';
COMMENT ON COLUMN public.tax_account_mappings.display_label
  IS 'Worker-facing UI/accounting label, e.g. 手当. Never treat this as a ledger account.';
COMMENT ON COLUMN public.tax_account_mappings.tax_account_code
  IS 'Statutory ledger account code recorded to ledger_entries.account_code.';
COMMENT ON COLUMN public.tax_account_mappings.applicable_proposal_types
  IS 'Allow-list of proposal/event types that may use this label.';

CREATE INDEX IF NOT EXISTS idx_tax_mappings_lookup
  ON public.tax_account_mappings (org_id, display_label, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_tax_mappings_reverse_lookup
  ON public.tax_account_mappings (org_id, tax_account_code, effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_mappings_active
  ON public.tax_account_mappings (org_id, display_label)
  WHERE effective_until IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_mappings_label_from
  ON public.tax_account_mappings (org_id, display_label, effective_from);

ALTER TABLE public.tax_account_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read tax_account_mappings" ON public.tax_account_mappings;
CREATE POLICY "Read tax_account_mappings"
  ON public.tax_account_mappings
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP POLICY IF EXISTS "Manage tax_account_mappings as admin" ON public.tax_account_mappings;
CREATE POLICY "Manage tax_account_mappings as admin"
  ON public.tax_account_mappings
  FOR ALL
  TO authenticated
  USING (private.has_org_role(org_id, ARRAY['admin']::text[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['admin']::text[]));

DROP VIEW IF EXISTS public.tax_account_mapping_active;
CREATE VIEW public.tax_account_mapping_active
WITH (security_invoker = true)
AS
SELECT
  id,
  org_id,
  display_label,
  tax_account_code,
  tax_account_name,
  category,
  applicable_proposal_types,
  effective_from,
  effective_until,
  created_by,
  created_at
FROM public.tax_account_mappings
WHERE effective_from <= CURRENT_DATE
  AND (effective_until IS NULL OR effective_until > CURRENT_DATE);

GRANT SELECT ON public.tax_account_mappings TO authenticated;
GRANT SELECT ON public.tax_account_mapping_active TO authenticated;
GRANT ALL ON public.tax_account_mappings TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_replace_tax_account_mapping(
  p_org_id uuid,
  p_mapping_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_tax_account_code text,
  p_tax_account_name text,
  p_category text,
  p_applicable_proposal_types text[],
  p_effective_from date DEFAULT CURRENT_DATE
)
RETURNS public.tax_account_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_membership record;
  v_current public.tax_account_mappings%ROWTYPE;
  v_inserted public.tax_account_mappings%ROWTYPE;
BEGIN
  IF p_org_id IS NULL OR p_mapping_id IS NULL OR p_actor_user_id IS NULL OR p_membership_id IS NULL THEN
    RAISE EXCEPTION 'TAX_MAPPING_MEMBERSHIP_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.org_memberships AS membership
  WHERE membership.id = p_membership_id
    AND membership.org_id = p_org_id
    AND membership.user_id = p_actor_user_id
    AND membership.status = 'active'
    AND membership.role = 'admin'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORG_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_tax_account_code IS NULL OR btrim(p_tax_account_code) = '' THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_CODE_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_tax_account_name IS NULL OR btrim(p_tax_account_name) = '' THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_NAME_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_category NOT IN ('income','expense','asset','liability','equity') THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_CATEGORY_INVALID'
      USING ERRCODE = '23514';
  END IF;

  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'EFFECTIVE_FROM_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_applicable_proposal_types IS NULL OR cardinality(p_applicable_proposal_types) = 0 THEN
    RAISE EXCEPTION 'APPLICABLE_PROPOSAL_TYPES_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.account_master AS account
  WHERE account.code = btrim(p_tax_account_code)
    AND account.is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_CODE_NOT_FOUND'
      USING ERRCODE = '23503';
  END IF;

  SELECT mapping.*
  INTO v_current
  FROM public.tax_account_mappings AS mapping
  WHERE mapping.id = p_mapping_id
    AND mapping.org_id = p_org_id
    AND mapping.effective_until IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAX_MAPPING_ACTIVE_ROW_NOT_FOUND'
      USING ERRCODE = '02000';
  END IF;

  IF p_effective_from <= v_current.effective_from THEN
    RAISE EXCEPTION 'EFFECTIVE_FROM_MUST_BE_AFTER_CURRENT'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.tax_account_mappings
  SET effective_until = p_effective_from
  WHERE id = v_current.id;

  INSERT INTO public.tax_account_mappings (
    org_id,
    display_label,
    tax_account_code,
    tax_account_name,
    category,
    applicable_proposal_types,
    effective_from,
    created_by
  )
  VALUES (
    p_org_id,
    v_current.display_label,
    btrim(p_tax_account_code),
    btrim(p_tax_account_name),
    p_category,
    p_applicable_proposal_types,
    p_effective_from,
    p_actor_user_id
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_replace_tax_account_mapping(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_replace_tax_account_mapping(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text[],
  date
) TO authenticated, service_role;

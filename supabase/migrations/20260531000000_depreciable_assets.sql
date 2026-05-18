-- PR-30: Depreciable asset master + monthly depreciation schedule.
-- 税務分類:
--   < 10万円: 即時費用
--   10万円以上20万円未満: 一括償却資産 (3年均等)
--   20万円以上30万円未満: 中小企業少額減価償却資産特例 (年300万円枠内)
--   30万円以上: 通常償却

INSERT INTO public.account_master (
  code,
  name,
  category,
  parent_code,
  is_active,
  display_order,
  description
)
VALUES
  ('1290', '減価償却累計額', 'asset', '1200', true, 290, 'PR-30 accumulated depreciation contra-asset account'),
  ('5360', '減価償却費', 'expense', '5100', true, 360, 'PR-30 monthly depreciation expense account')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

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
        'recurring_expense.create',
        'depreciation.monthly'
      ]::text[]
    )
  );

CREATE TABLE IF NOT EXISTS public.depreciable_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid REFERENCES auth.users(id),
  category text NOT NULL,
  title text NOT NULL,
  acquisition_amount numeric(15,2) NOT NULL CHECK (acquisition_amount > 0),
  acquisition_date date NOT NULL,
  classification text NOT NULL CHECK (classification IN (
    'expense_immediate',
    'three_year_special',
    'small_amount_special',
    'standard_depreciation'
  )),
  useful_life_years integer CHECK (useful_life_years IS NULL OR useful_life_years > 0),
  depreciation_method text CHECK (depreciation_method IN ('straight_line','declining_balance')),
  residual_value numeric(15,2) DEFAULT 0 CHECK (residual_value >= 0),
  is_active boolean NOT NULL DEFAULT true,
  source_transaction_id uuid REFERENCES public.accounting_transactions(id) ON DELETE SET NULL,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(category) <> ''),
  CHECK (btrim(title) <> '')
);

CREATE TABLE IF NOT EXISTS public.depreciation_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.depreciable_assets(id) ON DELETE CASCADE,
  scheduled_month text NOT NULL CHECK (scheduled_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','cancelled')),
  posted_at timestamptz,
  ledger_event_id uuid REFERENCES public.ledger_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, scheduled_month)
);

CREATE INDEX IF NOT EXISTS idx_depreciable_org
  ON public.depreciable_assets (org_id, is_active);

CREATE INDEX IF NOT EXISTS idx_depreciable_org_acquired
  ON public.depreciable_assets (org_id, acquisition_date DESC);

CREATE INDEX IF NOT EXISTS idx_depreciation_schedule_pending
  ON public.depreciation_schedule (scheduled_month, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_depreciation_schedule_asset
  ON public.depreciation_schedule (asset_id, scheduled_month);

ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS depreciable_asset_id uuid REFERENCES public.depreciable_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_transactions_depreciable_asset
  ON public.accounting_transactions (org_id, depreciable_asset_id)
  WHERE depreciable_asset_id IS NOT NULL;

DROP VIEW IF EXISTS public.v_special_depreciation_usage;
CREATE VIEW public.v_special_depreciation_usage
WITH (security_invoker = true)
AS
SELECT
  org_id,
  EXTRACT(YEAR FROM acquisition_date)::int AS fiscal_year,
  COUNT(*)::int AS asset_count,
  COALESCE(SUM(acquisition_amount), 0)::numeric(15,2) AS used_amount,
  GREATEST(3000000 - COALESCE(SUM(acquisition_amount), 0), 0)::numeric(15,2) AS remaining_amount,
  3000000::numeric(15,2) AS annual_limit_amount
FROM public.depreciable_assets
WHERE classification = 'small_amount_special'
  AND is_active = true
GROUP BY org_id, EXTRACT(YEAR FROM acquisition_date);

ALTER TABLE public.depreciable_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depreciation_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read depreciable_assets" ON public.depreciable_assets;
CREATE POLICY "Read depreciable_assets"
  ON public.depreciable_assets
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

DROP POLICY IF EXISTS "Manage depreciable_assets as member" ON public.depreciable_assets;
CREATE POLICY "Manage depreciable_assets as member"
  ON public.depreciable_assets
  FOR ALL
  TO authenticated
  USING (private.is_active_member(org_id))
  WITH CHECK (private.is_active_member(org_id));

DROP POLICY IF EXISTS "Read depreciation_schedule" ON public.depreciation_schedule;
CREATE POLICY "Read depreciation_schedule"
  ON public.depreciation_schedule
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.depreciable_assets AS asset
      WHERE asset.id = depreciation_schedule.asset_id
        AND private.is_active_member(asset.org_id)
    )
  );

REVOKE ALL ON TABLE public.depreciable_assets FROM anon, authenticated;
REVOKE ALL ON TABLE public.depreciation_schedule FROM anon, authenticated;
REVOKE ALL ON public.v_special_depreciation_usage FROM anon, authenticated;

GRANT SELECT ON TABLE public.depreciable_assets TO authenticated;
GRANT SELECT ON TABLE public.depreciation_schedule TO authenticated;
GRANT SELECT ON public.v_special_depreciation_usage TO authenticated;
GRANT ALL ON TABLE public.depreciable_assets TO service_role;
GRANT ALL ON TABLE public.depreciation_schedule TO service_role;
GRANT SELECT ON public.v_special_depreciation_usage TO service_role;

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
SELECT
  org.id,
  mapping.display_label,
  mapping.tax_account_code,
  mapping.tax_account_name,
  mapping.category,
  mapping.applicable_proposal_types::text[],
  '2026-01-01'::date,
  creator.user_id
FROM public.organizations AS org
JOIN LATERAL (
  SELECT membership.user_id
  FROM public.org_memberships AS membership
  WHERE membership.org_id = org.id
    AND membership.status = 'active'
  ORDER BY (membership.role = 'admin') DESC, membership.joined_at NULLS LAST, membership.created_at
  LIMIT 1
) AS creator ON true
CROSS JOIN (VALUES
  ('減価償却費', '5360', '減価償却費', 'expense', ARRAY['depreciation.monthly']),
  ('減価償却累計額', '1290', '減価償却累計額', 'asset', ARRAY['depreciation.monthly'])
) AS mapping(display_label, tax_account_code, tax_account_name, category, applicable_proposal_types)
ON CONFLICT (org_id, display_label, effective_from) DO UPDATE
SET applicable_proposal_types = (
  SELECT ARRAY(
    SELECT DISTINCT proposed.value
    FROM unnest(public.tax_account_mappings.applicable_proposal_types || EXCLUDED.applicable_proposal_types) AS proposed(value)
    ORDER BY proposed.value
  )
);

COMMENT ON TABLE public.depreciable_assets IS 'PR-30 org-scoped fixed asset master for depreciation classification and schedule generation.';
COMMENT ON TABLE public.depreciation_schedule IS 'PR-30 monthly depreciation schedule; idempotent by UNIQUE(asset_id, scheduled_month).';
COMMENT ON VIEW public.v_special_depreciation_usage IS 'Org fiscal-year usage of the 3,000,000 JPY small depreciable asset special limit.';

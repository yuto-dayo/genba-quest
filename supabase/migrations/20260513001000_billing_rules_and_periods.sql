-- 締め払いルール基盤
-- ============================================================
-- 取引先の締め払いルールを履歴管理（過去不変）+ 物理化された締め期間
-- 大手元請のweekly化など頻繁な変更に対応

-- 1. client_billing_rules: 締め払いルールの履歴
CREATE TABLE IF NOT EXISTS public.client_billing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  effective_until date,  -- NULL = 現行
  billing_cycle text NOT NULL,
  closing_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT client_billing_rules_cycle_check
    CHECK (billing_cycle IN ('weekly', 'biweekly', 'monthly', 'custom')),
  CONSTRAINT client_billing_rules_effective_range_check
    CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT client_billing_rules_unique_start
    UNIQUE (client_id, effective_from)
);

CREATE INDEX IF NOT EXISTS client_billing_rules_org_id_idx
  ON public.client_billing_rules (org_id);
CREATE INDEX IF NOT EXISTS client_billing_rules_client_id_idx
  ON public.client_billing_rules (client_id);
CREATE INDEX IF NOT EXISTS client_billing_rules_active_idx
  ON public.client_billing_rules (client_id, effective_from DESC)
  WHERE effective_until IS NULL;

CREATE TRIGGER client_billing_rules_set_updated_at
  BEFORE UPDATE ON public.client_billing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_billing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read Client Billing Rules"
  ON public.client_billing_rules FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));
-- INSERT/UPDATE/DELETE は service_role 経由のみ（履歴改変を防ぐ）

COMMENT ON TABLE public.client_billing_rules IS
  '取引先の締め払いルール履歴。effective_from/until で時間軸管理、過去ルールは不変。';
COMMENT ON COLUMN public.client_billing_rules.billing_cycle IS
  'weekly: 毎週、biweekly: 隔週、monthly: 月次、custom: その他';
COMMENT ON COLUMN public.client_billing_rules.closing_rule IS
  '締め日: monthly={day:1-28|99(末)}, weekly/biweekly={weekday:0-6}, custom=任意';
COMMENT ON COLUMN public.client_billing_rules.payment_rule IS
  '入金: {days:N} (N日後) or {month_offset:0|1|2, day:1-28|99}';

-- 2. billing_periods: 物理化された締め期間
CREATE TABLE IF NOT EXISTS public.billing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.client_billing_rules(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  payment_due_date date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  invoice_id uuid REFERENCES public.accounting_invoices(id) ON DELETE SET NULL,
  closed_at timestamptz,
  invoiced_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_periods_status_check
    CHECK (status IN ('open', 'closed', 'invoiced', 'paid')),
  CONSTRAINT billing_periods_date_range_check
    CHECK (period_end >= period_start AND payment_due_date >= period_end),
  CONSTRAINT billing_periods_unique_per_client
    UNIQUE (client_id, period_end)
);

CREATE INDEX IF NOT EXISTS billing_periods_org_id_idx
  ON public.billing_periods (org_id);
CREATE INDEX IF NOT EXISTS billing_periods_client_id_idx
  ON public.billing_periods (client_id);
CREATE INDEX IF NOT EXISTS billing_periods_status_idx
  ON public.billing_periods (status);
CREATE INDEX IF NOT EXISTS billing_periods_payment_due_idx
  ON public.billing_periods (payment_due_date)
  WHERE status IN ('invoiced', 'closed');
CREATE INDEX IF NOT EXISTS billing_periods_period_end_idx
  ON public.billing_periods (period_end DESC);

CREATE TRIGGER billing_periods_set_updated_at
  BEFORE UPDATE ON public.billing_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.billing_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read Billing Periods"
  ON public.billing_periods FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));
-- INSERT/UPDATE/DELETE は service_role 経由のみ

COMMENT ON TABLE public.billing_periods IS
  '物理化された締め期間。client_billing_rules から生成、過去 period は不変。';
COMMENT ON COLUMN public.billing_periods.status IS
  'open: 未締め / closed: 締め済 / invoiced: 請求済 / paid: 入金済';

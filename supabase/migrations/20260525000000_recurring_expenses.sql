-- PR-19: recurring reimbursable expenses.
-- Period-managed templates for monthly member-fronted fixed costs.

CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES auth.users(id),
  category text NOT NULL CHECK (category IN (
    '車両ローン','携帯代','月極駐車','工具リース','事務所家賃','保険','その他'
  )),
  title text NOT NULL,
  monthly_amount numeric(15,2) NOT NULL CHECK (monthly_amount > 0),
  effective_from text NOT NULL,
  effective_until text,
  cycle text NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('monthly','quarterly')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  expense_scope text NOT NULL DEFAULT 'overhead' CHECK (expense_scope IN ('overhead','stockpile')),
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  CHECK (btrim(title) <> ''),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (effective_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CHECK (effective_until IS NULL OR effective_until ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE INDEX IF NOT EXISTS idx_recurring_org_active
  ON public.recurring_expenses (org_id, status, effective_until)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_recurring_member
  ON public.recurring_expenses (member_id, effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_member_active_title
  ON public.recurring_expenses (org_id, member_id, lower(btrim(title)))
  WHERE status = 'active' AND effective_until IS NULL;

ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS re_select_self ON public.recurring_expenses;
CREATE POLICY re_select_self
  ON public.recurring_expenses
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR private.has_org_role(org_id, ARRAY['admin']::text[])
  );

-- INSERT/UPDATE/DELETE are intentionally service_role only via Proposal execution.
GRANT SELECT ON TABLE public.recurring_expenses TO authenticated;
GRANT ALL ON TABLE public.recurring_expenses TO service_role;

COMMENT ON TABLE public.recurring_expenses IS
  'Period-managed recurring member-fronted expenses such as vehicle loans, phone bills, parking, rent, insurance.';
COMMENT ON COLUMN public.recurring_expenses.effective_from IS
  'Inclusive start month in YYYY-MM.';
COMMENT ON COLUMN public.recurring_expenses.effective_until IS
  'Inclusive end month in YYYY-MM; NULL means ongoing.';

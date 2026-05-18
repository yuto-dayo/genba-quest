-- PR-21: payout schedule rows generated from one payout.scheduled Proposal.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'payout_schedule_status'
  ) THEN
    CREATE TYPE public.payout_schedule_status AS ENUM ('scheduled', 'executed', 'cancelled');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.payout_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cash_receipt_id uuid NOT NULL REFERENCES public.cash_receipts(id) ON DELETE CASCADE,
  scheduled_proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  executed_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  ledger_event_id uuid REFERENCES public.ledger_events(id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.org_memberships(id) ON DELETE CASCADE,
  status public.payout_schedule_status NOT NULL DEFAULT 'scheduled',
  reimbursement_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (reimbursement_amount >= 0),
  carry_over_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (carry_over_amount >= 0),
  reward_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
  withholding_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0),
  payout_amount numeric(15,2) GENERATED ALWAYS AS (
    reimbursement_amount + carry_over_amount + reward_amount - withholding_amount
  ) STORED,
  tax_withholding_decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reimbursement_amount + carry_over_amount + reward_amount >= withholding_amount),
  CHECK (status <> 'executed' OR ledger_event_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_schedule_proposal_member
  ON public.payout_schedule (scheduled_proposal_id, member_id);

CREATE INDEX IF NOT EXISTS idx_payout_schedule_org_status
  ON public.payout_schedule (org_id, status, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_schedule_member
  ON public.payout_schedule (member_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_schedule_cash_receipt
  ON public.payout_schedule (cash_receipt_id);

ALTER TABLE public.payout_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_schedule_select_self ON public.payout_schedule;
CREATE POLICY payout_schedule_select_self
  ON public.payout_schedule
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_memberships AS membership
      WHERE membership.id = member_id
        AND membership.user_id = auth.uid()
        AND membership.status = 'active'
        AND membership.suspended_at IS NULL
    )
  );

DROP POLICY IF EXISTS payout_schedule_select_admin ON public.payout_schedule;
CREATE POLICY payout_schedule_select_admin
  ON public.payout_schedule
  FOR SELECT
  TO authenticated
  USING (private.has_org_role(org_id, ARRAY['admin']::text[]));

GRANT SELECT ON public.payout_schedule TO authenticated;
GRANT ALL ON public.payout_schedule TO service_role;

COMMENT ON TABLE public.payout_schedule IS
  'PR-21 payout allocations. One payout.scheduled Proposal owns N rows; payout.executed flips them atomically as one payout decision.';
COMMENT ON COLUMN public.payout_schedule.payout_amount IS
  'Generated total ledger credit basis: reimbursement + carry-over + reward - withholding.';

-- P0.5 accounting canonical revenue boundary.
-- Existing tables already exist from the baseline. This migration extends them
-- additively so accounting_transactions can keep serving as a compatibility
-- projection while revenue_basis / proposal_executions / posting_groups /
-- accounting_journal_* become the accounting source of truth.

ALTER TABLE public.revenue_basis
  ADD COLUMN IF NOT EXISTS recognition_policy text NOT NULL DEFAULT 'job_close',
  ADD COLUMN IF NOT EXISTS recognition_trigger text NOT NULL DEFAULT 'job_closed',
  ADD COLUMN IF NOT EXISTS recognized_on date,
  ADD COLUMN IF NOT EXISTS service_period_start date,
  ADD COLUMN IF NOT EXISTS service_period_end date,
  ADD COLUMN IF NOT EXISTS amount_ex_tax numeric,
  ADD COLUMN IF NOT EXISTS tax_amount numeric,
  ADD COLUMN IF NOT EXISTS amount_inc_tax numeric,
  ADD COLUMN IF NOT EXISTS tax_rate_code text NOT NULL DEFAULT '10_STANDARD',
  ADD COLUMN IF NOT EXISTS right_to_invoice boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS receivable_account_type text NOT NULL DEFAULT 'accounts_receivable',
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS source_event_type text,
  ADD COLUMN IF NOT EXISTS proposal_id uuid,
  ADD COLUMN IF NOT EXISTS posted_entry_id uuid,
  ADD COLUMN IF NOT EXISTS customer_id uuid;

UPDATE public.revenue_basis
SET recognized_on = recognition_date
WHERE recognized_on IS NULL;

UPDATE public.revenue_basis
SET source_event_id = origin_completion_event_id,
    source_event_type = 'site_completion_event'
WHERE source_event_id IS NULL
  AND origin_completion_event_id IS NOT NULL;

COMMENT ON COLUMN public.revenue_basis.recognition_policy
  IS 'Revenue recognition policy such as job_close, service_period, milestone, manual, cash, or custom.';
COMMENT ON COLUMN public.revenue_basis.recognition_trigger
  IS 'Event trigger that caused recognition. job_closed is only the default trigger, not the policy itself.';
COMMENT ON COLUMN public.revenue_basis.recognized_on
  IS 'Accounting recognition date. recognition_date remains a compatibility alias during migration.';
COMMENT ON COLUMN public.revenue_basis.right_to_invoice
  IS 'Whether unconditional invoicing right exists at recognition time.';
COMMENT ON COLUMN public.revenue_basis.receivable_account_type
  IS 'Balance sheet account used before/at invoicing: accounts_receivable, contract_asset, unbilled_receivable, or contract_liability.';
COMMENT ON COLUMN public.revenue_basis.posted_entry_id
  IS 'Journal entry that posted this revenue_basis. Invoice issuance must not create duplicate PL revenue.';

ALTER TABLE public.proposal_executions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.posting_groups
  ADD COLUMN IF NOT EXISTS invoice_id uuid,
  ADD COLUMN IF NOT EXISTS payment_id uuid,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.posting_groups.invoice_id
  IS 'Invoice anchor for balance-sheet transfer postings. Revenue stays anchored by revenue_basis.';
COMMENT ON COLUMN public.posting_groups.payment_id
  IS 'Payment anchor for collection/cash postings.';

ALTER TABLE public.accounting_journal_entries
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.accounting_journal_lines
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS vendor_id uuid,
  ADD COLUMN IF NOT EXISTS department_id uuid,
  ADD COLUMN IF NOT EXISTS tax_code_id uuid,
  ADD COLUMN IF NOT EXISTS dimension_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.accounting_journal_lines.dimension_json
  IS 'Forward-compatible dimension payload for job/customer/vendor/department/tax projections.';

CREATE UNIQUE INDEX IF NOT EXISTS revenue_basis_org_id_id_unique
  ON public.revenue_basis (org_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_executions_org_id_id_unique
  ON public.proposal_executions (org_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS proposals_org_id_id_unique
  ON public.proposals (org_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_executions_org_idempotency_unique
  ON public.proposal_executions (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS revenue_basis_org_policy_status_idx
  ON public.revenue_basis (org_id, recognition_policy, status, recognized_on DESC);

CREATE INDEX IF NOT EXISTS revenue_basis_org_receivable_idx
  ON public.revenue_basis (org_id, receivable_account_type, right_to_invoice)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS accounting_journal_lines_dimensions_idx
  ON public.accounting_journal_lines (org_id, revenue_basis_id, site_id, customer_id, vendor_id, department_id, tax_code_id);

CREATE INDEX IF NOT EXISTS posting_groups_invoice_idx
  ON public.posting_groups (org_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS posting_groups_payment_idx
  ON public.posting_groups (org_id, payment_id)
  WHERE payment_id IS NOT NULL;

ALTER TABLE public.posting_groups
  DROP CONSTRAINT IF EXISTS posting_groups_anchor_check;

ALTER TABLE public.posting_groups
  DROP CONSTRAINT IF EXISTS posting_groups_group_type_check;

ALTER TABLE public.posting_groups
  ADD CONSTRAINT posting_groups_group_type_check
  CHECK (group_type = ANY (ARRAY[
    'income_post',
    'income_reverse',
    'invoice_transfer',
    'payment_receipt',
    'payment_allocation',
    'manual_adjustment',
    'historical_import',
    'payout_post',
    'payout_reverse'
  ]));

ALTER TABLE public.posting_groups
  ADD CONSTRAINT posting_groups_anchor_check
  CHECK (
    (
      group_type = ANY (ARRAY['income_post', 'income_reverse'])
      AND revenue_basis_id IS NOT NULL
      AND reward_run_id IS NULL
    )
    OR (
      group_type = ANY (ARRAY['invoice_transfer'])
      AND invoice_id IS NOT NULL
      AND reward_run_id IS NULL
    )
    OR (
      group_type = ANY (ARRAY['payment_receipt', 'payment_allocation'])
      AND payment_id IS NOT NULL
      AND reward_run_id IS NULL
    )
    OR (
      group_type = ANY (ARRAY['manual_adjustment', 'historical_import'])
      AND reward_run_id IS NULL
    )
    OR (
      group_type = ANY (ARRAY['payout_post', 'payout_reverse'])
      AND reward_run_id IS NOT NULL
    )
  );

ALTER TABLE public.revenue_basis
  DROP CONSTRAINT IF EXISTS revenue_basis_recognition_policy_check;

ALTER TABLE public.revenue_basis
  ADD CONSTRAINT revenue_basis_recognition_policy_check
  CHECK (recognition_policy = ANY (ARRAY[
    'job_close',
    'service_period',
    'milestone',
    'manual',
    'invoice',
    'cash',
    'custom'
  ]));

ALTER TABLE public.revenue_basis
  DROP CONSTRAINT IF EXISTS revenue_basis_recognition_trigger_check;

ALTER TABLE public.revenue_basis
  ADD CONSTRAINT revenue_basis_recognition_trigger_check
  CHECK (recognition_trigger = ANY (ARRAY[
    'job_closed',
    'service_delivered',
    'period_elapsed',
    'milestone_accepted',
    'manual_adjustment',
    'invoice_issued',
    'payment_received',
    'historical_import',
    'custom'
  ]));

ALTER TABLE public.revenue_basis
  DROP CONSTRAINT IF EXISTS revenue_basis_receivable_account_type_check;

ALTER TABLE public.revenue_basis
  ADD CONSTRAINT revenue_basis_receivable_account_type_check
  CHECK (receivable_account_type = ANY (ARRAY[
    'accounts_receivable',
    'contract_asset',
    'unbilled_receivable',
    'contract_liability',
    'none'
  ]));

ALTER TABLE public.revenue_basis
  DROP CONSTRAINT IF EXISTS revenue_basis_service_period_check;

ALTER TABLE public.revenue_basis
  ADD CONSTRAINT revenue_basis_service_period_check
  CHECK (
    service_period_start IS NULL
    OR service_period_end IS NULL
    OR service_period_start <= service_period_end
  );

CREATE TABLE IF NOT EXISTS public.accounting_invoice_line_revenue_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_line_key text NOT NULL DEFAULT 'invoice_total',
  revenue_basis_id uuid NOT NULL,
  allocation_amount_ex_tax numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  amount_inc_tax numeric NOT NULL DEFAULT 0,
  rounding_adjustment numeric NOT NULL DEFAULT 0,
  allocation_kind text NOT NULL DEFAULT 'invoice_issue',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT accounting_invoice_line_revenue_allocations_amount_check
    CHECK (amount_inc_tax >= 0 AND allocation_amount_ex_tax >= 0 AND tax_amount >= 0),
  CONSTRAINT accounting_invoice_line_revenue_allocations_kind_check
    CHECK (allocation_kind = ANY (ARRAY['invoice_issue', 'credit_note', 'adjustment', 'historical_import']))
);

COMMENT ON TABLE public.accounting_invoice_line_revenue_allocations
  IS 'Allocates invoice lines to recognized revenue_basis rows. Invoice issuance moves BS balances only and must not duplicate PL revenue.';

CREATE UNIQUE INDEX IF NOT EXISTS accounting_invoice_line_revenue_allocations_unique
  ON public.accounting_invoice_line_revenue_allocations (org_id, invoice_id, invoice_line_key, revenue_basis_id);

CREATE INDEX IF NOT EXISTS accounting_invoice_allocations_revenue_basis_idx
  ON public.accounting_invoice_line_revenue_allocations (org_id, revenue_basis_id);

ALTER TABLE public.accounting_invoice_line_revenue_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_invoice_line_revenue_allocations FROM anon, authenticated;
GRANT SELECT ON TABLE public.accounting_invoice_line_revenue_allocations TO authenticated;
GRANT ALL ON TABLE public.accounting_invoice_line_revenue_allocations TO service_role;

DROP POLICY IF EXISTS "Read invoice revenue allocations" ON public.accounting_invoice_line_revenue_allocations;
CREATE POLICY "Read invoice revenue allocations"
  ON public.accounting_invoice_line_revenue_allocations
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE TABLE IF NOT EXISTS public.accounting_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  customer_id uuid,
  received_on date NOT NULL,
  amount numeric NOT NULL,
  unapplied_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'JPY',
  payment_method text,
  payment_account text,
  external_reference text,
  status text NOT NULL DEFAULT 'received',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT accounting_payments_amount_check
    CHECK (amount > 0 AND unapplied_amount >= 0),
  CONSTRAINT accounting_payments_status_check
    CHECK (status = ANY (ARRAY['received', 'allocated', 'partially_allocated', 'voided', 'historical_import']))
);

COMMENT ON TABLE public.accounting_payments
  IS 'Cash receipt root. Allocation to invoices affects AR aging / collection status / cashflow, not PL revenue.';

CREATE UNIQUE INDEX IF NOT EXISTS accounting_payments_org_id_id_unique
  ON public.accounting_payments (org_id, id);

CREATE INDEX IF NOT EXISTS accounting_payments_org_received_idx
  ON public.accounting_payments (org_id, received_on DESC, status);

ALTER TABLE public.accounting_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_payments FROM anon, authenticated;
GRANT SELECT ON TABLE public.accounting_payments TO authenticated;
GRANT ALL ON TABLE public.accounting_payments TO service_role;

DROP POLICY IF EXISTS "Read accounting payments" ON public.accounting_payments;
CREATE POLICY "Read accounting payments"
  ON public.accounting_payments
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  allocated_amount numeric NOT NULL,
  allocated_on date NOT NULL DEFAULT CURRENT_DATE,
  posting_group_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT payment_allocations_amount_check
    CHECK (allocated_amount > 0)
);

COMMENT ON TABLE public.payment_allocations
  IS 'Allocates payments to invoices. Used for AR aging, collection status, and cashflow projections.';

CREATE UNIQUE INDEX IF NOT EXISTS payment_allocations_org_payment_invoice_unique
  ON public.payment_allocations (org_id, payment_id, invoice_id);

CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx
  ON public.payment_allocations (org_id, invoice_id);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_allocations FROM anon, authenticated;
GRANT SELECT ON TABLE public.payment_allocations TO authenticated;
GRANT ALL ON TABLE public.payment_allocations TO service_role;

DROP POLICY IF EXISTS "Read payment allocations" ON public.payment_allocations;
CREATE POLICY "Read payment allocations"
  ON public.payment_allocations
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

ALTER TABLE public.revenue_basis
  ADD CONSTRAINT revenue_basis_org_proposal_fkey
  FOREIGN KEY (org_id, proposal_id)
  REFERENCES public.proposals (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.revenue_basis
  ADD CONSTRAINT revenue_basis_org_posted_entry_fkey
  FOREIGN KEY (org_id, posted_entry_id)
  REFERENCES public.accounting_journal_entries (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.posting_groups
  ADD CONSTRAINT posting_groups_org_proposal_execution_fkey
  FOREIGN KEY (org_id, proposal_execution_id)
  REFERENCES public.proposal_executions (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.posting_groups
  ADD CONSTRAINT posting_groups_org_invoice_fkey
  FOREIGN KEY (org_id, invoice_id)
  REFERENCES public.accounting_invoices (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.posting_groups
  ADD CONSTRAINT posting_groups_org_payment_fkey
  FOREIGN KEY (org_id, payment_id)
  REFERENCES public.accounting_payments (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.accounting_invoice_line_revenue_allocations
  ADD CONSTRAINT accounting_invoice_allocations_org_invoice_fkey
  FOREIGN KEY (org_id, invoice_id)
  REFERENCES public.accounting_invoices (org_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.accounting_invoice_line_revenue_allocations
  ADD CONSTRAINT accounting_invoice_allocations_org_revenue_basis_fkey
  FOREIGN KEY (org_id, revenue_basis_id)
  REFERENCES public.revenue_basis (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_org_payment_fkey
  FOREIGN KEY (org_id, payment_id)
  REFERENCES public.accounting_payments (org_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_org_invoice_fkey
  FOREIGN KEY (org_id, invoice_id)
  REFERENCES public.accounting_invoices (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_org_posting_group_fkey
  FOREIGN KEY (org_id, posting_group_id)
  REFERENCES public.posting_groups (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

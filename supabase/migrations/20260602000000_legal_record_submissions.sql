-- PR-28: legal record submissions for annual 支払調書 output.
-- Snapshot columns freeze member profile facts at generation time so later
-- profile/tax-classification edits do not mutate submitted evidence.

CREATE TABLE IF NOT EXISTS public.legal_record_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payout_total numeric(15,2) NOT NULL CHECK (payout_total >= 0),
  reward_total numeric(15,2) NOT NULL CHECK (reward_total >= 0),
  correction_total numeric(15,2) NOT NULL DEFAULT 0,
  withholding_total numeric(15,2) NOT NULL CHECK (withholding_total >= 0),
  reimbursement_total numeric(15,2) NOT NULL CHECK (reimbursement_total >= 0),
  snapshot_trade_name text,
  snapshot_invoice_registration_no text,
  snapshot_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_bank jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_withholding_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  monthly_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  submission_file_path text,
  member_copy_path text,
  submitted_at timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, fiscal_year, member_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_records_year
  ON public.legal_record_submissions (org_id, fiscal_year);

CREATE INDEX IF NOT EXISTS idx_legal_records_member_year
  ON public.legal_record_submissions (org_id, member_id, fiscal_year DESC);

DROP TRIGGER IF EXISTS legal_record_submissions_set_updated_at ON public.legal_record_submissions;
CREATE TRIGGER legal_record_submissions_set_updated_at
  BEFORE UPDATE ON public.legal_record_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.legal_record_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lrs_select_self ON public.legal_record_submissions;
CREATE POLICY lrs_select_self
  ON public.legal_record_submissions
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR private.has_org_role(org_id, ARRAY['admin']::text[])
  );

DROP POLICY IF EXISTS lrs_insert_admin ON public.legal_record_submissions;
CREATE POLICY lrs_insert_admin
  ON public.legal_record_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (private.has_org_role(org_id, ARRAY['admin']::text[]));

DROP POLICY IF EXISTS lrs_update_admin ON public.legal_record_submissions;
CREATE POLICY lrs_update_admin
  ON public.legal_record_submissions
  FOR UPDATE
  TO authenticated
  USING (private.has_org_role(org_id, ARRAY['admin']::text[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['admin']::text[]));

GRANT SELECT ON public.legal_record_submissions TO authenticated;
GRANT INSERT, UPDATE ON public.legal_record_submissions TO authenticated;
GRANT ALL ON public.legal_record_submissions TO service_role;

COMMENT ON TABLE public.legal_record_submissions IS
  'Annual legal record submissions for 報酬、料金、契約金及び賞金の支払調書. Member facts are frozen as generation snapshots.';
COMMENT ON COLUMN public.legal_record_submissions.fiscal_year IS
  'Calendar year for 支払調書 aggregation, not the accounting fiscal year.';
COMMENT ON COLUMN public.legal_record_submissions.snapshot_withholding_decision IS
  'PR-34 tax_withholding_decision_snapshot copied from payout execution evidence when available.';
COMMENT ON COLUMN public.legal_record_submissions.monthly_breakdown IS
  'Per-month totals used by the FE preview and PDF member copy.';

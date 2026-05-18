ALTER TABLE public.member_tax_classifications
  ADD COLUMN IF NOT EXISTS invoice_registration_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS invoice_registration_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'member_tax_classifications_invoice_status_check'
      AND conrelid = 'public.member_tax_classifications'::regclass
  ) THEN
    ALTER TABLE public.member_tax_classifications
      ADD CONSTRAINT member_tax_classifications_invoice_status_check
      CHECK (invoice_registration_status IN ('registered', 'exempt', 'transitional', 'unknown'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'member_tax_classifications_invoice_number_format'
      AND conrelid = 'public.member_tax_classifications'::regclass
  ) THEN
    ALTER TABLE public.member_tax_classifications
      ADD CONSTRAINT member_tax_classifications_invoice_number_format
      CHECK (
        invoice_registration_number IS NULL OR
        invoice_registration_number ~ '^T[0-9]{13}$'
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mtc_invoice_status
  ON public.member_tax_classifications (org_id, invoice_registration_status)
  WHERE effective_until IS NULL;

CREATE OR REPLACE VIEW public.v_member_invoice_status_current
WITH (security_invoker = true) AS
SELECT
  mtc.org_id,
  mtc.member_id,
  mtc.invoice_registration_status,
  mtc.invoice_registration_number,
  mtc.effective_from,
  mtc.effective_until,
  CASE
    WHEN mtc.invoice_registration_status = 'registered' THEN 1.0
    WHEN mtc.invoice_registration_status IN ('exempt', 'transitional') THEN
      CASE
        WHEN CURRENT_DATE < DATE '2026-10-01' THEN 1.0
        WHEN CURRENT_DATE < DATE '2029-10-01' THEN 0.8
        WHEN CURRENT_DATE < DATE '2032-10-01' THEN 0.5
        ELSE 0.0
      END
    ELSE 1.0
  END AS deduction_rate
FROM public.member_tax_classifications AS mtc
WHERE mtc.effective_until IS NULL;

GRANT SELECT ON public.v_member_invoice_status_current TO authenticated;
GRANT SELECT ON public.v_member_invoice_status_current TO service_role;

COMMENT ON COLUMN public.member_tax_classifications.invoice_registration_status IS
  'Member invoice issuer status for purchase tax credit calculation: registered/exempt/transitional/unknown.';
COMMENT ON COLUMN public.member_tax_classifications.invoice_registration_number IS
  'Qualified invoice issuer number, T + 13 digits. Manual confirmation is done via the NTA public site.';
COMMENT ON VIEW public.v_member_invoice_status_current IS
  'Current active member invoice registration status with purchase tax deduction rate. security_invoker keeps RLS effective through the view.';

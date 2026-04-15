-- ============================================================
-- Extend accounting invoices for qualified invoice handling
-- ============================================================

ALTER TABLE public.accounting_invoices
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS source_transaction_date date,
  ADD COLUMN IF NOT EXISTS source_transaction_id uuid REFERENCES public.accounting_transactions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS issuer_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS registration_number_snapshot text,
  ADD COLUMN IF NOT EXISTS registered_at_snapshot date,
  ADD COLUMN IF NOT EXISTS tax_summary_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS eligibility_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS supplements_invoice_id uuid REFERENCES public.accounting_invoices(id),
  ADD COLUMN IF NOT EXISTS supplemented_at timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_render_status text,
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;

UPDATE public.accounting_invoices
SET source_transaction_id = transaction_id
WHERE source_transaction_id IS NULL;

UPDATE public.accounting_invoices invoice
SET source_transaction_date = tx.recorded_date
FROM public.accounting_transactions tx
WHERE invoice.source_transaction_id = tx.id
  AND invoice.source_transaction_date IS NULL;

UPDATE public.accounting_invoices
SET document_type = 'standard_invoice'
WHERE document_type IS NULL;

UPDATE public.accounting_invoices
SET issuer_snapshot = jsonb_build_object(
  'issuer_name', null,
  'issuer_address', null,
  'issuer_contact', null,
  'bank_account_text', null,
  'invoice_notes_default', null
)
WHERE issuer_snapshot IS NULL;

UPDATE public.accounting_invoices
SET tax_summary_snapshot = jsonb_build_object(
  'by_rate', jsonb_build_array(),
  'currency', 'JPY'
)
WHERE tax_summary_snapshot IS NULL;

UPDATE public.accounting_invoices
SET eligibility_snapshot = jsonb_build_object(
  'eligible_for_qualified_invoice', false,
  'resolved_document_type', COALESCE(document_type, 'standard_invoice'),
  'reason_codes', jsonb_build_array('LEGACY_INVOICE'),
  'evaluated_at', now()
)
WHERE eligibility_snapshot IS NULL;

UPDATE public.accounting_invoices
SET pdf_render_status = CASE
  WHEN pdf_storage_path IS NOT NULL THEN 'generated'
  ELSE 'pending'
END
WHERE pdf_render_status IS NULL;

UPDATE public.accounting_invoices
SET pdf_generated_at = created_at
WHERE pdf_storage_path IS NOT NULL
  AND pdf_generated_at IS NULL;

ALTER TABLE public.accounting_invoices
  ALTER COLUMN document_type SET DEFAULT 'standard_invoice',
  ALTER COLUMN document_type SET NOT NULL,
  ALTER COLUMN source_transaction_id SET NOT NULL,
  ALTER COLUMN source_transaction_date SET NOT NULL,
  ALTER COLUMN issuer_snapshot SET DEFAULT '{}'::jsonb,
  ALTER COLUMN issuer_snapshot SET NOT NULL,
  ALTER COLUMN tax_summary_snapshot SET DEFAULT '{"by_rate":[],"currency":"JPY"}'::jsonb,
  ALTER COLUMN tax_summary_snapshot SET NOT NULL,
  ALTER COLUMN eligibility_snapshot SET DEFAULT '{}'::jsonb,
  ALTER COLUMN eligibility_snapshot SET NOT NULL,
  ALTER COLUMN pdf_render_status SET DEFAULT 'pending',
  ALTER COLUMN pdf_render_status SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'accounting_invoices'
      AND constraint_name = 'accounting_invoices_transaction_id_key'
  ) THEN
    ALTER TABLE public.accounting_invoices
      DROP CONSTRAINT accounting_invoices_transaction_id_key;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'accounting_invoices'
      AND constraint_name = 'accounting_invoices_document_type_check'
  ) THEN
    ALTER TABLE public.accounting_invoices
      ADD CONSTRAINT accounting_invoices_document_type_check
      CHECK (document_type IN ('standard_invoice', 'qualified_invoice', 'invoice_supplement'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'accounting_invoices'
      AND constraint_name = 'accounting_invoices_pdf_render_status_check'
  ) THEN
    ALTER TABLE public.accounting_invoices
      ADD CONSTRAINT accounting_invoices_pdf_render_status_check
      CHECK (pdf_render_status IN ('pending', 'generated', 'failed', 'locked'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'accounting_invoices'
      AND constraint_name = 'accounting_invoices_supplement_link_check'
  ) THEN
    ALTER TABLE public.accounting_invoices
      ADD CONSTRAINT accounting_invoices_supplement_link_check
      CHECK (
        (document_type = 'invoice_supplement' AND supplements_invoice_id IS NOT NULL)
        OR
        (document_type <> 'invoice_supplement' AND supplements_invoice_id IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'accounting_invoices'
      AND constraint_name = 'accounting_invoices_qualified_registration_check'
  ) THEN
    ALTER TABLE public.accounting_invoices
      ADD CONSTRAINT accounting_invoices_qualified_registration_check
      CHECK (
        document_type <> 'qualified_invoice'
        OR registration_number_snapshot ~ '^T[0-9]{13}$'
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS accounting_invoices_source_transaction_date_idx
  ON public.accounting_invoices (source_transaction_date DESC);

CREATE INDEX IF NOT EXISTS accounting_invoices_org_id_idx
  ON public.accounting_invoices (org_id);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_invoices_primary_doc_unique
  ON public.accounting_invoices (source_transaction_id)
  WHERE document_type IN ('standard_invoice', 'qualified_invoice');

CREATE UNIQUE INDEX IF NOT EXISTS accounting_invoices_active_supplement_unique
  ON public.accounting_invoices (supplements_invoice_id)
  WHERE document_type = 'invoice_supplement';

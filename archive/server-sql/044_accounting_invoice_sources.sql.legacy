-- ============================================================
-- Support aggregated invoices with multiple source transactions
-- ============================================================

ALTER TABLE public.accounting_invoices
  ADD COLUMN IF NOT EXISTS source_summary_snapshot jsonb;

UPDATE public.accounting_invoices invoice
SET source_summary_snapshot = jsonb_build_object(
  'source_count', 1,
  'site_count', CASE WHEN tx.site_id IS NULL THEN 0 ELSE 1 END,
  'client_id', tx.client_id,
  'client_name', client.name,
  'period_start', invoice.source_transaction_date,
  'period_end', invoice.source_transaction_date,
  'site_names', CASE
    WHEN site.name IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(site.name)
  END,
  'amount_subtotal', COALESCE(ABS(tx.amount_subtotal), 0),
  'tax_amount', COALESCE(ABS(tx.tax_amount), 0),
  'amount_total', COALESCE(ABS(tx.amount_total), 0),
  'currency', COALESCE(tx.currency, 'JPY')
)
FROM public.accounting_transactions tx
LEFT JOIN public.sites site ON site.id = tx.site_id
LEFT JOIN public.clients client ON client.id = tx.client_id
WHERE invoice.source_transaction_id = tx.id
  AND (
    invoice.source_summary_snapshot IS NULL
    OR invoice.source_summary_snapshot = '{}'::jsonb
  );

UPDATE public.accounting_invoices
SET source_summary_snapshot = jsonb_build_object(
  'source_count', 1,
  'site_count', 0,
  'client_id', null,
  'client_name', null,
  'period_start', source_transaction_date,
  'period_end', source_transaction_date,
  'site_names', '[]'::jsonb,
  'amount_subtotal', 0,
  'tax_amount', 0,
  'amount_total', 0,
  'currency', 'JPY'
)
WHERE source_summary_snapshot IS NULL;

ALTER TABLE public.accounting_invoices
  ALTER COLUMN source_summary_snapshot SET DEFAULT '{}'::jsonb,
  ALTER COLUMN source_summary_snapshot SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.accounting_invoice_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.accounting_invoices(id) ON DELETE CASCADE,
  source_transaction_id uuid NOT NULL REFERENCES public.accounting_transactions(id) ON DELETE CASCADE,
  source_transaction_date date NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_primary_document boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_invoice_sources_invoice_tx_unique
  ON public.accounting_invoice_sources (invoice_id, source_transaction_id);

CREATE INDEX IF NOT EXISTS accounting_invoice_sources_invoice_idx
  ON public.accounting_invoice_sources (invoice_id, sort_order);

CREATE INDEX IF NOT EXISTS accounting_invoice_sources_source_idx
  ON public.accounting_invoice_sources (source_transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_invoice_sources_primary_source_unique
  ON public.accounting_invoice_sources (source_transaction_id)
  WHERE is_primary_document = true;

INSERT INTO public.accounting_invoice_sources (
  invoice_id,
  source_transaction_id,
  source_transaction_date,
  sort_order,
  is_primary_document
)
SELECT
  invoice.id,
  invoice.source_transaction_id,
  invoice.source_transaction_date,
  0,
  invoice.document_type IN ('standard_invoice', 'qualified_invoice')
FROM public.accounting_invoices invoice
ON CONFLICT (invoice_id, source_transaction_id) DO NOTHING;

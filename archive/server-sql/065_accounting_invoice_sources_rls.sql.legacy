-- ============================================================
-- Protect accounting_invoice_sources behind RLS
-- ============================================================
-- This table is exposed via PostgREST because it lives in public.
-- Scope access through the parent invoice's org and writer permissions.

ALTER TABLE public.accounting_invoice_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Accounting Invoice Sources" ON public.accounting_invoice_sources;
DROP POLICY IF EXISTS "Insert Accounting Invoice Sources" ON public.accounting_invoice_sources;
DROP POLICY IF EXISTS "Update Accounting Invoice Sources" ON public.accounting_invoice_sources;
DROP POLICY IF EXISTS "Delete Accounting Invoice Sources" ON public.accounting_invoice_sources;

CREATE POLICY "Read Accounting Invoice Sources" ON public.accounting_invoice_sources
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.accounting_invoices invoice
      WHERE invoice.id = invoice_id
        AND private.is_active_member(
          COALESCE(invoice.org_id, '00000000-0000-0000-0000-000000000001'::uuid)
        )
    )
  );

CREATE POLICY "Insert Accounting Invoice Sources" ON public.accounting_invoice_sources
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.accounting_invoices invoice
      WHERE invoice.id = invoice_id
        AND (
          invoice.created_by = auth.uid()
          OR private.has_org_role(
            COALESCE(invoice.org_id, '00000000-0000-0000-0000-000000000001'::uuid),
            ARRAY['admin']::text[]
          )
        )
    )
  );

CREATE POLICY "Update Accounting Invoice Sources" ON public.accounting_invoice_sources
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.accounting_invoices invoice
      WHERE invoice.id = invoice_id
        AND (
          invoice.created_by = auth.uid()
          OR private.has_org_role(
            COALESCE(invoice.org_id, '00000000-0000-0000-0000-000000000001'::uuid),
            ARRAY['admin']::text[]
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.accounting_invoices invoice
      WHERE invoice.id = invoice_id
        AND (
          invoice.created_by = auth.uid()
          OR private.has_org_role(
            COALESCE(invoice.org_id, '00000000-0000-0000-0000-000000000001'::uuid),
            ARRAY['admin']::text[]
          )
        )
    )
  );

CREATE POLICY "Delete Accounting Invoice Sources" ON public.accounting_invoice_sources
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.accounting_invoices invoice
      WHERE invoice.id = invoice_id
        AND (
          invoice.created_by = auth.uid()
          OR private.has_org_role(
            COALESCE(invoice.org_id, '00000000-0000-0000-0000-000000000001'::uuid),
            ARRAY['admin']::text[]
          )
        )
    )
  );

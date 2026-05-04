-- ============================================================
-- Add invoice issuer settings per organization
-- ============================================================

CREATE TABLE IF NOT EXISTS public.org_invoice_settings (
  org_id uuid PRIMARY KEY,
  issuer_name text NOT NULL,
  issuer_address text,
  issuer_contact text,
  bank_account_text text,
  invoice_issuer_status text NOT NULL
    CHECK (invoice_issuer_status IN ('unregistered', 'applied', 'registered')),
  qualified_invoice_registration_number text,
  qualified_invoice_registered_at date,
  invoice_notes_default text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_invoice_settings_registered_check CHECK (
    (
      invoice_issuer_status = 'registered'
      AND qualified_invoice_registration_number ~ '^T[0-9]{13}$'
      AND qualified_invoice_registered_at IS NOT NULL
    )
    OR
    (
      invoice_issuer_status IN ('unregistered', 'applied')
      AND qualified_invoice_registration_number IS NULL
      AND qualified_invoice_registered_at IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS org_invoice_settings_status_idx
  ON public.org_invoice_settings (invoice_issuer_status);

DROP TRIGGER IF EXISTS org_invoice_settings_set_updated_at ON public.org_invoice_settings;
CREATE TRIGGER org_invoice_settings_set_updated_at
BEFORE UPDATE ON public.org_invoice_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.org_invoice_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Org Invoice Settings" ON public.org_invoice_settings;
DROP POLICY IF EXISTS "Insert Org Invoice Settings" ON public.org_invoice_settings;
DROP POLICY IF EXISTS "Update Org Invoice Settings" ON public.org_invoice_settings;

CREATE POLICY "Read Org Invoice Settings" ON public.org_invoice_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Insert Org Invoice Settings" ON public.org_invoice_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND auth.uid() = updated_by
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Update Org Invoice Settings" ON public.org_invoice_settings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    auth.uid() = updated_by
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'manager')
    )
  );

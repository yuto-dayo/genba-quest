-- P0 accounting integrity guards.
-- This migration is intentionally additive:
-- - existing historical/direct-write rows are not forced through backfill here
-- - NOT VALID constraints protect new rows while P2 backfill can report/fix old rows
-- - service-role API code remains the only writer for accounting command idempotency

CREATE TABLE IF NOT EXISTS public.accounting_write_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  endpoint_name text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text,
  status text NOT NULL DEFAULT 'in_progress',
  response_status integer NOT NULL DEFAULT 200,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_write_idempotency_endpoint_check
    CHECK (endpoint_name = ANY (ARRAY[
      'accounting.expenses.create',
      'accounting.sales.adjust',
      'accounting.invoices.create',
      'accounting.payments.allocate',
      'accounting.void.create',
      'site.close.finalize'
    ])),
  CONSTRAINT accounting_write_idempotency_key_nonblank
    CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT accounting_write_idempotency_status_check
    CHECK (status = ANY (ARRAY['in_progress', 'succeeded', 'failed'])),
  CONSTRAINT accounting_write_idempotency_response_status_check
    CHECK (response_status BETWEEN 100 AND 599)
);

COMMENT ON TABLE public.accounting_write_idempotency_keys
  IS 'P0 service-side idempotency ledger for write endpoints. Unique per org + endpoint + key.';
COMMENT ON COLUMN public.accounting_write_idempotency_keys.request_hash
  IS 'Optional canonical request hash used to detect idempotency-key reuse with a different payload.';

CREATE UNIQUE INDEX IF NOT EXISTS accounting_write_idempotency_keys_unique
  ON public.accounting_write_idempotency_keys (org_id, endpoint_name, idempotency_key);

CREATE INDEX IF NOT EXISTS accounting_write_idempotency_keys_status_idx
  ON public.accounting_write_idempotency_keys (org_id, endpoint_name, status, locked_at);

ALTER TABLE public.accounting_write_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_write_idempotency_keys FROM anon, authenticated;
GRANT ALL ON TABLE public.accounting_write_idempotency_keys TO service_role;

-- Carry org_id onto accounting child tables so parent/child joins can be guarded
-- with composite foreign keys. Existing rows are backfilled where the parent is
-- already resolvable; P2 reports unresolved rows instead of guessing org_id.
ALTER TABLE public.accounting_transaction_items
  ADD COLUMN IF NOT EXISTS org_id uuid;

ALTER TABLE public.accounting_invoice_sources
  ADD COLUMN IF NOT EXISTS org_id uuid;

ALTER TABLE public.accounting_journal_entries
  ADD COLUMN IF NOT EXISTS org_id uuid;

ALTER TABLE public.accounting_journal_lines
  ADD COLUMN IF NOT EXISTS org_id uuid;

UPDATE public.accounting_transaction_items AS item
SET org_id = tx.org_id
FROM public.accounting_transactions AS tx
WHERE item.transaction_id = tx.id
  AND item.org_id IS NULL;

UPDATE public.accounting_invoice_sources AS source
SET org_id = invoice.org_id
FROM public.accounting_invoices AS invoice
WHERE source.invoice_id = invoice.id
  AND source.org_id IS NULL;

UPDATE public.accounting_invoice_sources AS source
SET org_id = tx.org_id
FROM public.accounting_transactions AS tx
WHERE source.source_transaction_id = tx.id
  AND source.org_id IS NULL;

UPDATE public.accounting_journal_entries AS entry
SET org_id = tx.org_id
FROM public.accounting_transactions AS tx
WHERE entry.transaction_id = tx.id
  AND entry.org_id IS NULL;

UPDATE public.accounting_journal_entries AS entry
SET org_id = posting_group.org_id
FROM public.posting_groups AS posting_group
WHERE entry.posting_group_id = posting_group.id
  AND entry.org_id IS NULL;

UPDATE public.accounting_journal_lines AS line
SET org_id = entry.org_id
FROM public.accounting_journal_entries AS entry
WHERE line.entry_id = entry.id
  AND line.org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounting_transactions_org_id_id_unique
  ON public.accounting_transactions (org_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_invoices_org_id_id_unique
  ON public.accounting_invoices (org_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_journal_entries_org_id_id_unique
  ON public.accounting_journal_entries (org_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_journal_entries_org_id_transaction_id_unique
  ON public.accounting_journal_entries (org_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documents_org_id_id_unique
  ON public.documents (org_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS posting_groups_org_id_id_unique
  ON public.posting_groups (org_id, id);

ALTER TABLE public.accounting_transaction_items
  ADD CONSTRAINT accounting_transaction_items_org_id_required
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.accounting_invoice_sources
  ADD CONSTRAINT accounting_invoice_sources_org_id_required
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.accounting_journal_entries
  ADD CONSTRAINT accounting_journal_entries_org_id_required
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.accounting_journal_lines
  ADD CONSTRAINT accounting_journal_lines_org_id_required
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.accounting_transaction_items
  ADD CONSTRAINT accounting_transaction_items_org_transaction_fkey
  FOREIGN KEY (org_id, transaction_id)
  REFERENCES public.accounting_transactions (org_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.accounting_invoice_sources
  ADD CONSTRAINT accounting_invoice_sources_org_invoice_fkey
  FOREIGN KEY (org_id, invoice_id)
  REFERENCES public.accounting_invoices (org_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.accounting_invoice_sources
  ADD CONSTRAINT accounting_invoice_sources_org_source_transaction_fkey
  FOREIGN KEY (org_id, source_transaction_id)
  REFERENCES public.accounting_transactions (org_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.accounting_invoices
  ADD CONSTRAINT accounting_invoices_org_transaction_fkey
  FOREIGN KEY (org_id, transaction_id)
  REFERENCES public.accounting_transactions (org_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.accounting_invoices
  ADD CONSTRAINT accounting_invoices_org_source_transaction_fkey
  FOREIGN KEY (org_id, source_transaction_id)
  REFERENCES public.accounting_transactions (org_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.accounting_invoices
  ADD CONSTRAINT accounting_invoices_org_supplements_invoice_fkey
  FOREIGN KEY (org_id, supplements_invoice_id)
  REFERENCES public.accounting_invoices (org_id, id)
  NOT VALID;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_org_source_document_fkey
  FOREIGN KEY (org_id, source_document_id)
  REFERENCES public.documents (org_id, id)
  NOT VALID;

ALTER TABLE public.accounting_journal_entries
  ADD CONSTRAINT accounting_journal_entries_org_transaction_fkey
  FOREIGN KEY (org_id, transaction_id)
  REFERENCES public.accounting_transactions (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.accounting_journal_entries
  ADD CONSTRAINT accounting_journal_entries_org_posting_group_fkey
  FOREIGN KEY (org_id, posting_group_id)
  REFERENCES public.posting_groups (org_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.accounting_journal_lines
  ADD CONSTRAINT accounting_journal_lines_org_entry_fkey
  FOREIGN KEY (org_id, entry_id)
  REFERENCES public.accounting_journal_entries (org_id, id)
  ON DELETE CASCADE
  NOT VALID;

CREATE OR REPLACE FUNCTION private.assert_accounting_journal_entry_balanced(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_debit numeric;
  v_credit numeric;
  v_line_count integer;
BEGIN
  SELECT
    COALESCE(SUM(line.debit), 0),
    COALESCE(SUM(line.credit), 0),
    COUNT(*)::integer
  INTO v_debit, v_credit, v_line_count
  FROM public.accounting_journal_lines AS line
  WHERE line.entry_id = p_entry_id;

  IF v_line_count = 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'ACCOUNTING_JOURNAL_UNBALANCED'
      USING ERRCODE = '23514',
            DETAIL = format('entry_id=%s debit=%s credit=%s lines=%s', p_entry_id, v_debit, v_credit, v_line_count);
  END IF;
END;
$$;

COMMENT ON FUNCTION private.assert_accounting_journal_entry_balanced(uuid)
  IS 'P0 RPC helper: call before marking a journal entry posted; future migration can promote this to a deferrable constraint trigger.';

CREATE OR REPLACE FUNCTION private.prevent_posted_accounting_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_posted_at timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'accounting_journal_entries' THEN
    v_posted_at := OLD.posted_at;
  ELSIF TG_TABLE_NAME = 'accounting_journal_lines' THEN
    SELECT entry.posted_at
    INTO v_posted_at
    FROM public.accounting_journal_entries AS entry
    WHERE entry.id = OLD.entry_id;
  ELSE
    v_posted_at := NULL;
  END IF;

  IF v_posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE'
      USING ERRCODE = '23514',
            DETAIL = format('table=%s operation=%s', TG_TABLE_NAME, TG_OP);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.prevent_posted_accounting_journal_mutation()
  IS 'Blocks update/delete of posted accounting journal entries and their lines. Corrections must use reversals.';

DROP TRIGGER IF EXISTS accounting_journal_entries_prevent_posted_mutation
  ON public.accounting_journal_entries;

CREATE TRIGGER accounting_journal_entries_prevent_posted_mutation
  BEFORE UPDATE OR DELETE ON public.accounting_journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_posted_accounting_journal_mutation();

DROP TRIGGER IF EXISTS accounting_journal_lines_prevent_posted_mutation
  ON public.accounting_journal_lines;

CREATE TRIGGER accounting_journal_lines_prevent_posted_mutation
  BEFORE UPDATE OR DELETE ON public.accounting_journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_posted_accounting_journal_mutation();

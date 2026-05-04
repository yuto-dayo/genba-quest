-- Harden the highest-risk baseline RLS policies.
-- Scope:
-- - proposals: org-member scoped create/read; lifecycle updates remain RPC/server-only
-- - ledger: org/member reads only; direct authenticated writes removed
-- - accounting: parent-derived/org-member reads only; direct authenticated writes removed

ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS org_id uuid;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS org_id uuid;

UPDATE public.documents AS document
SET org_id = COALESCE(site.org_id, client.org_id, '00000000-0000-0000-0000-000000000001'::uuid)
FROM public.documents AS source_document
LEFT JOIN public.sites AS site ON site.id = source_document.site_id
LEFT JOIN public.clients AS client ON client.id = source_document.client_id
WHERE document.id = source_document.id
  AND document.org_id IS NULL;

UPDATE public.accounting_transactions AS tx
SET org_id = COALESCE(site.org_id, client.org_id, document.org_id, '00000000-0000-0000-0000-000000000001'::uuid)
FROM public.accounting_transactions AS source_tx
LEFT JOIN public.sites AS site ON site.id = source_tx.site_id
LEFT JOIN public.clients AS client ON client.id = source_tx.client_id
LEFT JOIN public.documents AS document ON document.id = source_tx.source_document_id
WHERE tx.id = source_tx.id
  AND tx.org_id IS NULL;

UPDATE public.accounting_invoices AS invoice
SET org_id = COALESCE(tx.org_id, source_tx.org_id, '00000000-0000-0000-0000-000000000001'::uuid)
FROM public.accounting_invoices AS source_invoice
LEFT JOIN public.accounting_transactions AS tx ON tx.id = source_invoice.transaction_id
LEFT JOIN public.accounting_transactions AS source_tx ON source_tx.id = source_invoice.source_transaction_id
WHERE invoice.id = source_invoice.id
  AND invoice.org_id IS NULL;

ALTER TABLE public.accounting_transactions
  ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.documents
  ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.accounting_invoices
  ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  ALTER COLUMN org_id SET NOT NULL;

CREATE OR REPLACE FUNCTION private.can_access_accounting_transaction(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounting_transactions tx
    WHERE tx.id = p_transaction_id
      AND (
        private.is_active_member(tx.org_id)
        OR tx.created_by = auth.uid()
        OR tx.reviewer_id = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.can_access_accounting_journal_entry(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounting_journal_entries entry
    LEFT JOIN public.posting_groups posting_group ON posting_group.id = entry.posting_group_id
    WHERE entry.id = p_entry_id
      AND (
        private.can_access_accounting_transaction(entry.transaction_id)
        OR (posting_group.org_id IS NOT NULL AND private.is_active_member(posting_group.org_id))
        OR entry.created_by = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.can_access_accounting_invoice(p_invoice_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounting_invoices invoice
    WHERE invoice.id = p_invoice_id
      AND (
        (invoice.org_id IS NOT NULL AND private.is_active_member(invoice.org_id))
        OR private.can_access_accounting_transaction(invoice.transaction_id)
        OR private.can_access_accounting_transaction(invoice.source_transaction_id)
        OR invoice.created_by = auth.uid()
      )
  );
$$;

COMMENT ON FUNCTION private.can_access_accounting_transaction(uuid)
  IS 'RLS helper: accounting transaction visibility via site/client org membership or legacy owner/reviewer fallback.';
COMMENT ON FUNCTION private.can_access_accounting_journal_entry(uuid)
  IS 'RLS helper: accounting journal entry visibility via parent transaction, posting group org, or creator fallback.';
COMMENT ON FUNCTION private.can_access_accounting_invoice(uuid)
  IS 'RLS helper: accounting invoice visibility via invoice org, parent transaction, or creator fallback.';

-- Proposals: replace broad access with organization membership.
DROP POLICY IF EXISTS "Create Proposals" ON public.proposals;
DROP POLICY IF EXISTS "Read Proposals" ON public.proposals;
DROP POLICY IF EXISTS "Update Proposals" ON public.proposals;

CREATE POLICY "Create Proposals"
  ON public.proposals
  FOR INSERT
  TO authenticated
  WITH CHECK (private.is_active_member(org_id));

CREATE POLICY "Read Proposals"
  ON public.proposals
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

-- Ledger: keep org-scoped reads; remove direct authenticated writes.
DROP POLICY IF EXISTS "Create Ledger Entries" ON public.ledger_entries;
DROP POLICY IF EXISTS "Create Ledger Events" ON public.ledger_events;
DROP POLICY IF EXISTS "Create Ledger Transactions" ON public.ledger_transactions;
DROP POLICY IF EXISTS "Read Ledger Entries" ON public.ledger_entries;
DROP POLICY IF EXISTS "Read Ledger Events" ON public.ledger_events;
DROP POLICY IF EXISTS "Read Ledger Transactions" ON public.ledger_transactions;

CREATE POLICY "Read Ledger Events"
  ON public.ledger_events
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read Ledger Transactions"
  ON public.ledger_transactions
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read Ledger Entries"
  ON public.ledger_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ledger_transactions tx
      WHERE tx.id = ledger_entries.transaction_id
        AND private.is_active_member(tx.org_id)
    )
  );

-- Accounting: keep reads scoped to org/parents; remove direct authenticated writes.
DROP POLICY IF EXISTS "Read Accounting Transactions" ON public.accounting_transactions;
DROP POLICY IF EXISTS "Insert Accounting Transactions" ON public.accounting_transactions;
DROP POLICY IF EXISTS "Update Accounting Transactions" ON public.accounting_transactions;
DROP POLICY IF EXISTS "Read Accounting Transaction Items" ON public.accounting_transaction_items;
DROP POLICY IF EXISTS "Insert Accounting Transaction Items" ON public.accounting_transaction_items;
DROP POLICY IF EXISTS "Update Accounting Transaction Items" ON public.accounting_transaction_items;
DROP POLICY IF EXISTS "Read Journal Entries" ON public.accounting_journal_entries;
DROP POLICY IF EXISTS "Insert Journal Entries" ON public.accounting_journal_entries;
DROP POLICY IF EXISTS "Update Journal Entries" ON public.accounting_journal_entries;
DROP POLICY IF EXISTS "Read Journal Lines" ON public.accounting_journal_lines;
DROP POLICY IF EXISTS "Insert Journal Lines" ON public.accounting_journal_lines;
DROP POLICY IF EXISTS "Update Journal Lines" ON public.accounting_journal_lines;
DROP POLICY IF EXISTS "Read Invoices" ON public.accounting_invoices;
DROP POLICY IF EXISTS "Insert Invoices" ON public.accounting_invoices;
DROP POLICY IF EXISTS "Update Invoices" ON public.accounting_invoices;
DROP POLICY IF EXISTS "Read Documents" ON public.documents;
DROP POLICY IF EXISTS "Insert Documents" ON public.documents;
DROP POLICY IF EXISTS "Update Documents" ON public.documents;
DROP POLICY IF EXISTS "Read Invoice Sequences" ON public.invoice_number_sequences;
DROP POLICY IF EXISTS "Read finance_payout_postings" ON public.finance_payout_postings;
DROP POLICY IF EXISTS "Insert finance_payout_postings" ON public.finance_payout_postings;
DROP POLICY IF EXISTS "Read Audit Log" ON public.accounting_audit_log;

CREATE POLICY "Read Accounting Transactions"
  ON public.accounting_transactions
  FOR SELECT
  TO authenticated
  USING (
    private.is_active_member(org_id)
    OR accounting_transactions.created_by = auth.uid()
    OR accounting_transactions.reviewer_id = auth.uid()
  );

CREATE POLICY "Read Accounting Transaction Items"
  ON public.accounting_transaction_items
  FOR SELECT
  TO authenticated
  USING (private.can_access_accounting_transaction(transaction_id));

CREATE POLICY "Read Journal Entries"
  ON public.accounting_journal_entries
  FOR SELECT
  TO authenticated
  USING (private.can_access_accounting_journal_entry(id));

CREATE POLICY "Read Journal Lines"
  ON public.accounting_journal_lines
  FOR SELECT
  TO authenticated
  USING (private.can_access_accounting_journal_entry(entry_id));

CREATE POLICY "Read Invoices"
  ON public.accounting_invoices
  FOR SELECT
  TO authenticated
  USING (private.can_access_accounting_invoice(id));

CREATE POLICY "Read Documents"
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (
    private.is_active_member(org_id)
    OR documents.uploaded_by = auth.uid()
  );

CREATE POLICY "Read finance_payout_postings"
  ON public.finance_payout_postings
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

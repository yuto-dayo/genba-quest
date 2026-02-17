-- ============================================================
-- GENBA QUEST - 経理モジュール RLS
-- ============================================================
-- 1パーティ運用: 読み取りは全員、更新は作成者/承認者中心

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_number_sequences ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Documents
-- ============================================================

DROP POLICY IF EXISTS "Read Documents" ON documents;
DROP POLICY IF EXISTS "Insert Documents" ON documents;
DROP POLICY IF EXISTS "Update Documents" ON documents;

CREATE POLICY "Read Documents" ON documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Documents" ON documents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = uploaded_by);
CREATE POLICY "Update Documents" ON documents
  FOR UPDATE TO authenticated USING (auth.uid() = uploaded_by);

-- ============================================================
-- Transactions
-- ============================================================

DROP POLICY IF EXISTS "Read Accounting Transactions" ON accounting_transactions;
DROP POLICY IF EXISTS "Insert Accounting Transactions" ON accounting_transactions;
DROP POLICY IF EXISTS "Update Accounting Transactions" ON accounting_transactions;

CREATE POLICY "Read Accounting Transactions" ON accounting_transactions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Accounting Transactions" ON accounting_transactions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Update Accounting Transactions" ON accounting_transactions
  FOR UPDATE TO authenticated USING (auth.uid() = created_by OR auth.uid() = reviewer_id);

-- ============================================================
-- Transaction Items
-- ============================================================

DROP POLICY IF EXISTS "Read Accounting Transaction Items" ON accounting_transaction_items;
DROP POLICY IF EXISTS "Insert Accounting Transaction Items" ON accounting_transaction_items;
DROP POLICY IF EXISTS "Update Accounting Transaction Items" ON accounting_transaction_items;

CREATE POLICY "Read Accounting Transaction Items" ON accounting_transaction_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Accounting Transaction Items" ON accounting_transaction_items
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Update Accounting Transaction Items" ON accounting_transaction_items
  FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- Journal Entries/Lines（作成者のみ編集。誰でも閲覧）
-- ============================================================

DROP POLICY IF EXISTS "Read Journal Entries" ON accounting_journal_entries;
DROP POLICY IF EXISTS "Insert Journal Entries" ON accounting_journal_entries;
DROP POLICY IF EXISTS "Update Journal Entries" ON accounting_journal_entries;

CREATE POLICY "Read Journal Entries" ON accounting_journal_entries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Journal Entries" ON accounting_journal_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Update Journal Entries" ON accounting_journal_entries
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Read Journal Lines" ON accounting_journal_lines;
DROP POLICY IF EXISTS "Insert Journal Lines" ON accounting_journal_lines;
DROP POLICY IF EXISTS "Update Journal Lines" ON accounting_journal_lines;

CREATE POLICY "Read Journal Lines" ON accounting_journal_lines
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Journal Lines" ON accounting_journal_lines
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accounting_journal_entries e
      WHERE e.id = entry_id AND e.created_by = auth.uid()
    )
  );
CREATE POLICY "Update Journal Lines" ON accounting_journal_lines
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.accounting_journal_entries e
      WHERE e.id = entry_id AND e.created_by = auth.uid()
    )
  );

-- ============================================================
-- Invoices
-- ============================================================

DROP POLICY IF EXISTS "Read Invoices" ON accounting_invoices;
DROP POLICY IF EXISTS "Insert Invoices" ON accounting_invoices;
DROP POLICY IF EXISTS "Update Invoices" ON accounting_invoices;

CREATE POLICY "Read Invoices" ON accounting_invoices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Invoices" ON accounting_invoices
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Update Invoices" ON accounting_invoices
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);

-- ============================================================
-- Invoice Sequences（読み取りのみ。採番は SECURITY DEFINER 関数経由を推奨）
-- ============================================================

DROP POLICY IF EXISTS "Read Invoice Sequences" ON invoice_number_sequences;

CREATE POLICY "Read Invoice Sequences" ON invoice_number_sequences
  FOR SELECT TO authenticated USING (true);

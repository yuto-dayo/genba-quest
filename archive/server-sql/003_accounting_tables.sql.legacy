-- ============================================================
-- GENBA QUEST - 経理モジュール テーブル定義
-- ============================================================
-- NOTE:
-- - 1パーティ運用のため party_id 分離は未導入（将来追加可）
-- - 「HQ」は cost_center='HQ' で表現（site_id は NULL）
-- - 仕訳は accounting_journal_entries/lines を正本にする

-- 汎用 updated_at トリガー関数
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 証憑（レシート/請求書/発注書/納品書）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL CHECK (doc_type IN ('receipt', 'invoice', 'purchase_order', 'delivery_note', 'other')),
  storage_path text NOT NULL, -- Supabase Storage の path を想定
  original_filename text,
  mime_type text,
  file_size bigint,
  sha256 text,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  site_id uuid REFERENCES sites(id),
  client_id uuid REFERENCES clients(id),

  -- OCR結果（bboxハイライト用）
  ocr_provider text, -- 'gemini' など
  ocr_blocks jsonb, -- [{page, text, bbox:{x0,y0,x1,y1}, confidence}, ...]
  ocr_fields jsonb, -- { total_amount: {value, confidence, bbox_refs:[...]}, ... }
  field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb, -- { field: {source:'ocr'|'manual', user_id, at}, ... }

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_doc_type_idx ON documents (doc_type);
CREATE INDEX IF NOT EXISTS documents_site_idx ON documents (site_id);
CREATE INDEX IF NOT EXISTS documents_client_idx ON documents (client_id);
CREATE INDEX IF NOT EXISTS documents_created_at_idx ON documents (created_at DESC);

DROP TRIGGER IF EXISTS documents_set_updated_at ON public.documents;
CREATE TRIGGER documents_set_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 取引（売上/経費/請求書/支払予定の共通ヘッダ）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounting_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('sale', 'expense', 'invoice', 'ap_schedule')),

  cost_center text NOT NULL CHECK (cost_center IN ('SITE', 'HQ')),
  site_id uuid REFERENCES sites(id),
  client_id uuid REFERENCES clients(id),

  vendor_name text, -- 経費や支払予定向け（店名/取引先）
  description text,
  recorded_date date NOT NULL,
  currency text NOT NULL DEFAULT 'JPY',

  amount_subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  amount_total numeric NOT NULL DEFAULT 0,

  -- ワークフロー
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'posted', 'voided')),
  risk_level text NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW', 'HIGH')),
  reviewer_id uuid REFERENCES auth.users(id),
  review_status text NOT NULL DEFAULT 'not_required'
    CHECK (review_status IN ('not_required', 'pending', 'approved', 'rejected')),
  review_comment text,
  review_assigned_at timestamptz,
  reviewed_at timestamptz,

  source_document_id uuid REFERENCES documents(id),
  input_sources jsonb NOT NULL DEFAULT '{}'::jsonb, -- { field: {source:'ocr'|'manual', user_id, at}, ... }

  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- 逆仕訳/取消
  voided_by uuid REFERENCES auth.users(id),
  voided_at timestamptz,
  void_reason text,
  voids_transaction_id uuid REFERENCES accounting_transactions(id),

  -- 税区分（007_master_data.sql で追加されるマスタを参照）
  tax_category text DEFAULT '10_STANDARD',

  CONSTRAINT accounting_transactions_hq_site_check
    CHECK (
      (cost_center = 'HQ' AND site_id IS NULL)
      OR (cost_center = 'SITE' AND site_id IS NOT NULL)
    ),
  CONSTRAINT accounting_transactions_review_consistency
    CHECK (
      (review_status IN ('not_required') AND reviewer_id IS NULL)
      OR (review_status IN ('pending', 'approved', 'rejected') AND reviewer_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS accounting_transactions_kind_idx ON accounting_transactions (kind);
CREATE INDEX IF NOT EXISTS accounting_transactions_recorded_date_idx ON accounting_transactions (recorded_date DESC);
CREATE INDEX IF NOT EXISTS accounting_transactions_site_idx ON accounting_transactions (site_id);
CREATE INDEX IF NOT EXISTS accounting_transactions_status_idx ON accounting_transactions (status);

DROP TRIGGER IF EXISTS accounting_transactions_set_updated_at ON public.accounting_transactions;
CREATE TRIGGER accounting_transactions_set_updated_at
BEFORE UPDATE ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 取引の明細（任意。レシート明細/請求明細）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounting_transaction_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES accounting_transactions(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  quantity numeric DEFAULT 1,
  unit_price numeric DEFAULT 0,
  amount numeric GENERATED ALWAYS AS (COALESCE(quantity, 0) * COALESCE(unit_price, 0)) STORED
);

CREATE INDEX IF NOT EXISTS accounting_transaction_items_tx_idx ON accounting_transaction_items (transaction_id);

-- ============================================================
-- 仕訳（正本）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounting_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid UNIQUE REFERENCES accounting_transactions(id) ON DELETE SET NULL,
  entry_date date NOT NULL,
  memo text,
  posted_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounting_journal_entries_entry_date_idx ON accounting_journal_entries (entry_date DESC);

DROP TRIGGER IF EXISTS accounting_journal_entries_set_updated_at ON public.accounting_journal_entries;
CREATE TRIGGER accounting_journal_entries_set_updated_at
BEFORE UPDATE ON public.accounting_journal_entries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.accounting_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  account_code text NOT NULL,
  account_name text,
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  tax_rate numeric, -- 0.08 / 0.10 など
  tax_type text, -- 'taxable' / 'exempt' など（運用で拡張）
  description text,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT accounting_journal_lines_debit_credit_check
    CHECK (
      (debit >= 0 AND credit >= 0)
      AND NOT (debit > 0 AND credit > 0)
      AND NOT (debit = 0 AND credit = 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_journal_lines_entry_line_no_uniq
  ON accounting_journal_lines (entry_id, line_no);

-- ============================================================
-- 請求書（PDFをアプリ内で生成・管理）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounting_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid UNIQUE NOT NULL REFERENCES accounting_transactions(id) ON DELETE CASCADE,
  invoice_no text UNIQUE NOT NULL,
  issue_date date NOT NULL,
  due_date date,
  billing_name text NOT NULL,
  billing_address text,
  issuer_registration_no text, -- インボイス登録番号
  notes text,
  pdf_storage_path text, -- 生成したPDFのStorage path
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounting_invoices_issue_date_idx ON accounting_invoices (issue_date DESC);

DROP TRIGGER IF EXISTS accounting_invoices_set_updated_at ON public.accounting_invoices;
CREATE TRIGGER accounting_invoices_set_updated_at
BEFORE UPDATE ON public.accounting_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 請求書番号シーケンス
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_number_sequences (
  fiscal_year integer PRIMARY KEY,
  next_seq integer NOT NULL
);

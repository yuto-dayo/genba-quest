-- ============================================================
-- GENBA QUEST - マスタデータ
-- ============================================================

-- ============================================================
-- 税区分マスタ（インボイス対応）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tax_categories (
  code text PRIMARY KEY,
  name text NOT NULL,
  rate numeric NOT NULL,
  is_reduced boolean DEFAULT false,
  effective_from date NOT NULL,
  effective_to date,
  description text
);

INSERT INTO tax_categories (code, name, rate, is_reduced, effective_from, effective_to, description)
VALUES
  ('10_STANDARD', '標準税率', 0.10, false, '2019-10-01', NULL, '標準税率10%'),
  ('08_REDUCED', '軽減税率', 0.08, true, '2019-10-01', NULL, '飲食料品等'),
  ('00_EXEMPT', '非課税', 0.00, false, '1989-04-01', NULL, '土地、有価証券等'),
  ('00_TAXFREE', '不課税', 0.00, false, '1989-04-01', NULL, '給与、寄付等')
ON CONFLICT (code) DO NOTHING;

-- 税区分マスタ RLS
ALTER TABLE tax_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Tax Categories" ON tax_categories;
CREATE POLICY "Read Tax Categories" ON tax_categories
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 勘定科目マスタ
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_master (
  code text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_code text REFERENCES account_master(code),
  is_active boolean DEFAULT true,
  display_order integer,
  description text
);

INSERT INTO account_master (code, name, category, parent_code, is_active, display_order, description)
VALUES
  ('1100', '現金', 'asset', NULL, true, 100, NULL),
  ('1200', '売掛金', 'asset', NULL, true, 200, NULL),
  ('1500', '仮払消費税', 'asset', NULL, true, 500, NULL),
  ('2100', '買掛金', 'liability', NULL, true, 100, NULL),
  ('2500', '仮受消費税', 'liability', NULL, true, 500, NULL),
  ('4100', '売上高', 'revenue', NULL, true, 100, NULL),
  ('5100', '経費', 'expense', NULL, true, 100, NULL),
  ('5110', '材料費', 'expense', '5100', true, 110, NULL),
  ('5120', '工具備品費', 'expense', '5100', true, 120, NULL),
  ('5130', '交通費', 'expense', '5100', true, 130, NULL),
  ('5140', '会議費', 'expense', '5100', true, 140, NULL)
ON CONFLICT (code) DO NOTHING;

-- 勘定科目マスタ RLS
ALTER TABLE account_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Account Master" ON account_master;
CREATE POLICY "Read Account Master" ON account_master
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 外部キー制約追加（テーブル作成後）
-- ============================================================
-- accounting_transactions.tax_category → tax_categories.code
-- 003_accounting_tables.sql で DEFAULT '10_STANDARD' として定義済み
-- ここでカラムが無ければ追加し、外部キー制約を追加

DO $$
BEGIN
  -- カラムが存在しない場合は追加
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accounting_transactions'
      AND column_name = 'tax_category'
  ) THEN
    ALTER TABLE accounting_transactions
      ADD COLUMN tax_category text DEFAULT '10_STANDARD';
  END IF;

  -- 外部キー制約が存在しない場合は追加
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'accounting_transactions_tax_category_fkey'
      AND table_name = 'accounting_transactions'
  ) THEN
    ALTER TABLE accounting_transactions
      ADD CONSTRAINT accounting_transactions_tax_category_fkey
      FOREIGN KEY (tax_category) REFERENCES tax_categories(code);
  END IF;
END;
$$;

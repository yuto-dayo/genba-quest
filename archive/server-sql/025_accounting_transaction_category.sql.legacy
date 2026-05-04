-- ============================================================
-- Add category to accounting transactions for expense classification
-- ============================================================

ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'accounting_transactions'
      AND constraint_name = 'accounting_transactions_category_check'
  ) THEN
    ALTER TABLE public.accounting_transactions
      ADD CONSTRAINT accounting_transactions_category_check
      CHECK (
        category IS NULL
        OR category IN ('material', 'tool', 'travel', 'food', 'fuel', 'utility', 'other')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS accounting_transactions_category_idx
  ON public.accounting_transactions (category);

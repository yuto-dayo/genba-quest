-- ============================================================
-- GENBA QUEST - 監査システム
-- ============================================================

-- 監査ログテーブル
CREATE TABLE IF NOT EXISTS public.accounting_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz DEFAULT now(),
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS audit_log_record_idx ON accounting_audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS audit_log_changed_at_idx ON accounting_audit_log (changed_at DESC);

-- ============================================================
-- 監査ログ用トリガー関数
-- ============================================================

CREATE OR REPLACE FUNCTION public.accounting_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.accounting_audit_log (
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    changed_by
  )
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) END,
    COALESCE(
      CASE WHEN TG_OP != 'DELETE' THEN NEW.created_by END,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.created_by END,
      auth.uid()
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 監査トリガー設定
-- ============================================================

-- accounting_transactions に監査トリガーを設定
DROP TRIGGER IF EXISTS accounting_transactions_audit ON public.accounting_transactions;
CREATE TRIGGER accounting_transactions_audit
AFTER INSERT OR UPDATE OR DELETE ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.accounting_audit_trigger();

-- accounting_journal_entries に監査トリガーを設定
DROP TRIGGER IF EXISTS accounting_journal_entries_audit ON public.accounting_journal_entries;
CREATE TRIGGER accounting_journal_entries_audit
AFTER INSERT OR UPDATE OR DELETE ON public.accounting_journal_entries
FOR EACH ROW EXECUTE FUNCTION public.accounting_audit_trigger();

-- accounting_invoices に監査トリガーを設定
DROP TRIGGER IF EXISTS accounting_invoices_audit ON public.accounting_invoices;
CREATE TRIGGER accounting_invoices_audit
AFTER INSERT OR UPDATE OR DELETE ON public.accounting_invoices
FOR EACH ROW EXECUTE FUNCTION public.accounting_audit_trigger();

-- ============================================================
-- 監査ログ RLS
-- ============================================================

ALTER TABLE accounting_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Audit Log" ON accounting_audit_log;
CREATE POLICY "Read Audit Log" ON accounting_audit_log
  FOR SELECT TO authenticated USING (true);

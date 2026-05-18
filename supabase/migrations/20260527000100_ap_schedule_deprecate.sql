-- PR-21: accounting_transactions.kind='ap_schedule' is deprecated.
-- Existing rows are preserved; the replacement CHECK is NOT VALID so old data
-- can remain while new INSERT/UPDATE attempts are rejected.

DO $$
DECLARE
  v_existing_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_existing_count
  FROM public.accounting_transactions
  WHERE kind = 'ap_schedule';

  IF v_existing_count > 0 THEN
    RAISE WARNING 'Deprecated accounting_transactions.kind=ap_schedule rows remain: %', v_existing_count;
  END IF;
END;
$$;

ALTER TABLE public.accounting_transactions
  DROP CONSTRAINT IF EXISTS accounting_transactions_kind_check;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_kind_check
  CHECK (kind = ANY (ARRAY['sale','expense','invoice']::text[]))
  NOT VALID;

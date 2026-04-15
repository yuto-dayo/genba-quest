CREATE UNIQUE INDEX IF NOT EXISTS accounting_transactions_voids_transaction_unique
  ON public.accounting_transactions (voids_transaction_id)
  WHERE voids_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_accounting_void_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_voids_transaction_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'voided'
     AND COALESCE(OLD.status, '') <> 'voided'
     AND OLD.voids_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'REVERSAL_TRANSACTION_CANNOT_BE_VOIDED';
  END IF;

  IF NEW.voids_transaction_id IS NOT NULL THEN
    SELECT voids_transaction_id
      INTO v_parent_voids_transaction_id
      FROM public.accounting_transactions
     WHERE id = NEW.voids_transaction_id;

    IF v_parent_voids_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'REVERSAL_OF_REVERSAL_NOT_ALLOWED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounting_transactions_guard_void_chain
  ON public.accounting_transactions;

CREATE TRIGGER accounting_transactions_guard_void_chain
BEFORE INSERT OR UPDATE OF status, voids_transaction_id
ON public.accounting_transactions
FOR EACH ROW
EXECUTE FUNCTION public.guard_accounting_void_chain();

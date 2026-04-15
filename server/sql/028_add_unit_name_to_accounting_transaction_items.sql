ALTER TABLE public.accounting_transaction_items
ADD COLUMN IF NOT EXISTS unit_name text;

UPDATE public.accounting_transaction_items
SET unit_name = '式'
WHERE unit_name IS NULL;

ALTER TABLE public.accounting_transaction_items
ALTER COLUMN unit_name SET DEFAULT '式';

ALTER TABLE public.accounting_transaction_items
ALTER COLUMN unit_name SET NOT NULL;

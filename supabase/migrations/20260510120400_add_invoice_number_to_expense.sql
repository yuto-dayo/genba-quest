-- M-5: Promote invoice_number (T番号) from metadata_json to a first-class
-- column on accounting_transactions.
--
-- T-FIX-1 (commit 55eaa1e) plumbed invoice_number end-to-end and stored the
-- value inside metadata_json. That fixed the immediate data loss, but a
-- proper column gives us:
--   - searchability (find transactions by registration number)
--   - format enforcement at the DB level (T followed by exactly 13 digits)
--   - cleaner contracts for the upcoming bucket aggregation API
--
-- Format: 'T' + 13 digits (the インボイス制度 qualified-invoice issuer
-- registration number). NULL means "not provided yet" — surfaced as the
-- missing_invoice_number flag.
--
-- Backfill: copy any value that T-FIX-1 already wrote into metadata_json.
-- The route layer normalises new writes to the column going forward; we
-- intentionally keep metadata_json.invoice_number around for one
-- subsequent migration cycle so older readers do not break.
--
-- Related: docs/MONEY_EXPENSE_FLOW.md §7.1, §11.6 / Gap analysis T-FIX-1

ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS invoice_number text;

ALTER TABLE public.accounting_transactions
  ADD CONSTRAINT accounting_transactions_invoice_number_format_check
  CHECK (
    invoice_number IS NULL
    OR invoice_number ~ '^T[0-9]{13}$'
  ) NOT VALID;

-- Backfill from metadata_json.invoice_number where T-FIX-1 already stored
-- a normalised value. The format CHECK guards against malformed entries
-- that should never have made it through normalizeInvoiceNumber.
UPDATE public.accounting_transactions
SET invoice_number = metadata_json ->> 'invoice_number'
WHERE invoice_number IS NULL
  AND metadata_json ? 'invoice_number'
  AND (metadata_json ->> 'invoice_number') ~ '^T[0-9]{13}$';

ALTER TABLE public.accounting_transactions
  VALIDATE CONSTRAINT accounting_transactions_invoice_number_format_check;

CREATE INDEX IF NOT EXISTS accounting_transactions_invoice_number_idx
  ON public.accounting_transactions (org_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

COMMENT ON COLUMN public.accounting_transactions.invoice_number
  IS 'インボイス制度の登録番号 (T + 13桁). UI表記: インボイス番号. docs/MONEY_EXPENSE_FLOW.md §7.1';

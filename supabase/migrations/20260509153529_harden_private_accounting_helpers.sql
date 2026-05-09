-- v2.2 P0 follow-up: harden private accounting helper/trigger functions.
--
-- These functions are not public API endpoints. They are invoked internally by
-- canonical posting RPCs or database triggers, so direct app-role EXECUTE
-- privileges are unnecessary. Keep the change narrow: do not sweep all legacy
-- SECURITY DEFINER functions in this migration.

ALTER FUNCTION private.assert_accounting_journal_entry_balanced(uuid)
  SET search_path TO 'pg_catalog';

ALTER FUNCTION private.assert_invoice_revenue_allocation_capacity()
  SET search_path TO 'pg_catalog';

ALTER FUNCTION private.prevent_posted_accounting_journal_mutation()
  SET search_path TO 'pg_catalog';

REVOKE ALL ON FUNCTION private.assert_accounting_journal_entry_balanced(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.assert_invoice_revenue_allocation_capacity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.prevent_posted_accounting_journal_mutation()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.assert_accounting_journal_entry_balanced(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.assert_invoice_revenue_allocation_capacity()
  TO service_role;
GRANT EXECUTE ON FUNCTION private.prevent_posted_accounting_journal_mutation()
  TO service_role;

COMMENT ON FUNCTION private.assert_accounting_journal_entry_balanced(uuid)
  IS 'Validates debit/credit balance for a journal entry. Hardened for internal canonical posting use only.';

COMMENT ON FUNCTION private.assert_invoice_revenue_allocation_capacity()
  IS 'Trigger guard that serializes invoice allocations per revenue_basis and rejects allocations beyond recognized amount_inc_tax.';

COMMENT ON FUNCTION private.prevent_posted_accounting_journal_mutation()
  IS 'Trigger guard that blocks update/delete of posted accounting journal entries and lines. Corrections must use reversals.';

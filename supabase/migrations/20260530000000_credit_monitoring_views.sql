-- PR-31: Client credit monitoring read model.
-- Public app-facing view must stay security-invoker so underlying RLS remains effective.

CREATE OR REPLACE VIEW public.v_client_credit_summary
WITH (security_invoker = true)
AS
WITH client_base AS (
  SELECT
    client.id AS client_id,
    client.org_id,
    client.name AS client_name
  FROM public.clients AS client
  WHERE client.deleted_at IS NULL
),
sales_90 AS (
  SELECT
    tx.org_id,
    tx.client_id,
    SUM(tx.amount_total)::numeric(15,2) AS sales_90_days
  FROM public.accounting_transactions AS tx
  WHERE tx.kind = 'sale'
    AND tx.status IN ('posted', 'approved')
    AND tx.client_id IS NOT NULL
    AND tx.recorded_date > (CURRENT_DATE - INTERVAL '90 days')
    AND tx.recorded_date <= CURRENT_DATE
  GROUP BY tx.org_id, tx.client_id
),
invoice_balances AS (
  SELECT
    invoice.org_id,
    source_tx.client_id,
    invoice.id AS invoice_id,
    invoice.due_date,
    GREATEST(
      COALESCE(source_tx.amount_total, 0)
        - COALESCE(allocation.allocated_amount, 0),
      0
    )::numeric(15,2) AS outstanding_amount
  FROM public.accounting_invoices AS invoice
  JOIN public.accounting_transactions AS source_tx
    ON source_tx.id = invoice.source_transaction_id
   AND source_tx.org_id = invoice.org_id
  LEFT JOIN LATERAL (
    SELECT SUM(alloc.allocated_amount)::numeric(15,2) AS allocated_amount
    FROM public.cash_receipt_allocations AS alloc
    JOIN public.cash_receipts AS receipt
      ON receipt.id = alloc.receipt_id
     AND receipt.org_id = invoice.org_id
    WHERE alloc.invoice_transaction_id IN (invoice.source_transaction_id, invoice.transaction_id)
      AND receipt.received_date <= CURRENT_DATE
  ) AS allocation ON true
  WHERE source_tx.client_id IS NOT NULL
    AND source_tx.status IN ('posted', 'approved')
    AND invoice.issue_date <= CURRENT_DATE
),
ar AS (
  SELECT
    org_id,
    client_id,
    SUM(outstanding_amount)::numeric(15,2) AS accounts_receivable_balance,
    COUNT(*) FILTER (
      WHERE outstanding_amount > 0
        AND due_date IS NOT NULL
        AND due_date < CURRENT_DATE
    )::integer AS overdue_count
  FROM invoice_balances
  GROUP BY org_id, client_id
),
summary AS (
  SELECT
    base.org_id,
    base.client_id,
    base.client_name,
    CURRENT_DATE AS as_of_date,
    COALESCE(ar.accounts_receivable_balance, 0)::numeric(15,2) AS accounts_receivable_balance,
    COALESCE(ar.overdue_count, 0)::integer AS overdue_count,
    COALESCE(sales.sales_90_days, 0)::numeric(15,2) AS sales_90_days,
    CASE
      WHEN COALESCE(sales.sales_90_days, 0) = 0 THEN NULL
      ELSE ROUND((COALESCE(ar.accounts_receivable_balance, 0) / NULLIF(sales.sales_90_days, 0)) * 90, 1)
    END AS dso_days
  FROM client_base AS base
  LEFT JOIN ar
    ON ar.org_id = base.org_id
   AND ar.client_id = base.client_id
  LEFT JOIN sales_90 AS sales
    ON sales.org_id = base.org_id
   AND sales.client_id = base.client_id
)
SELECT
  org_id,
  client_id,
  client_name,
  as_of_date,
  accounts_receivable_balance,
  overdue_count,
  sales_90_days,
  dso_days,
  CASE
    WHEN COALESCE(dso_days, 0) > 90 OR accounts_receivable_balance > 5000000 THEN 'blocked'
    WHEN COALESCE(dso_days, 0) > 60 OR accounts_receivable_balance >= 3000000 THEN 'warning'
    WHEN COALESCE(dso_days, 0) >= 45 OR accounts_receivable_balance >= 1000000 THEN 'caution'
    ELSE 'healthy'
  END AS credit_tier,
  CASE
    WHEN COALESCE(dso_days, 0) > 90 OR accounts_receivable_balance > 5000000 THEN 0
    WHEN COALESCE(dso_days, 0) > 60 OR accounts_receivable_balance >= 3000000 THEN 1
    WHEN COALESCE(dso_days, 0) >= 45 OR accounts_receivable_balance >= 1000000 THEN 2
    ELSE 3
  END AS credit_tier_sort
FROM summary;

GRANT SELECT ON public.v_client_credit_summary TO authenticated;
GRANT SELECT ON public.v_client_credit_summary TO service_role;

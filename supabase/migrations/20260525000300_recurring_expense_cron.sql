-- PR-19: recurring_expense month-start generation.
-- Cron is the single source of truth for automatic generation.

CREATE EXTENSION IF NOT EXISTS pg_cron;

INSERT INTO public.account_master (
  code,
  name,
  category,
  parent_code,
  is_active,
  display_order,
  description
)
VALUES
  ('5120', '工具備品費', 'expense', '5100', true, 120, 'Recurring expense tool lease account'),
  ('5900', 'その他経費', 'expense', '5100', true, 190, 'Recurring expense fallback account'),
  ('2110', '未払金', 'liability', NULL, true, 211, 'Recurring expense member reimbursement payable')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

INSERT INTO public.tax_account_mappings (
  org_id,
  display_label,
  tax_account_code,
  tax_account_name,
  category,
  applicable_proposal_types,
  effective_from,
  created_by
)
SELECT
  org.id,
  mapping.display_label,
  mapping.tax_account_code,
  mapping.tax_account_name,
  mapping.category,
  mapping.applicable_proposal_types::text[],
  '2026-01-01'::date,
  creator.user_id
FROM public.organizations AS org
JOIN LATERAL (
  SELECT membership.user_id
  FROM public.org_memberships AS membership
  WHERE membership.org_id = org.id
    AND membership.status = 'active'
  ORDER BY (membership.role = 'admin') DESC, membership.joined_at NULLS LAST, membership.created_at
  LIMIT 1
) AS creator ON true
CROSS JOIN (VALUES
  ('工具備品費', '5120', '工具備品費', 'expense', ARRAY['recurring_expense.create']),
  ('その他経費', '5900', 'その他経費', 'expense', ARRAY['recurring_expense.create']),
  ('未払金', '2110', '未払金', 'liability', ARRAY['invoice.member_issue','recurring_expense.create'])
) AS mapping(display_label, tax_account_code, tax_account_name, category, applicable_proposal_types)
ON CONFLICT (org_id, display_label, effective_from) DO UPDATE
SET applicable_proposal_types = (
  SELECT ARRAY(
    SELECT DISTINCT proposed.value
    FROM unnest(public.tax_account_mappings.applicable_proposal_types || EXCLUDED.applicable_proposal_types) AS proposed(value)
    ORDER BY proposed.value
  )
);

CREATE OR REPLACE FUNCTION public.generate_recurring_expenses_for_current_month()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  rec record;
  current_ym text := to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM');
  generated_date date := (to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') || '-01')::date;
  claimant_membership_id uuid;
  transaction_id uuid;
  ledger_event_id uuid;
  ledger_transaction_id uuid;
  debit_label text;
  debit_account_code text;
  credit_account_code text;
BEGIN
  FOR rec IN
    SELECT *
    FROM public.recurring_expenses
    WHERE status = 'active'
      AND effective_from <= current_ym
      AND (effective_until IS NULL OR effective_until >= current_ym)
  LOOP
    BEGIN
      SELECT membership.id
      INTO claimant_membership_id
      FROM public.org_memberships AS membership
      WHERE membership.org_id = rec.org_id
        AND membership.user_id = rec.member_id
        AND membership.status = 'active'
      ORDER BY membership.created_at DESC
      LIMIT 1;

      IF claimant_membership_id IS NULL THEN
        CONTINUE;
      END IF;

      debit_label := CASE rec.category
        WHEN '車両ローン' THEN '車両費'
        WHEN '月極駐車' THEN '車両費'
        WHEN '携帯代' THEN '通信費'
        WHEN '工具リース' THEN '工具備品費'
        WHEN '事務所家賃' THEN '地代家賃'
        WHEN '保険' THEN '支払保険料'
        ELSE 'その他経費'
      END;

      SELECT mapping.tax_account_code
      INTO debit_account_code
      FROM public.tax_account_mappings AS mapping
      WHERE mapping.org_id = rec.org_id
        AND mapping.display_label = debit_label
        AND mapping.effective_from <= generated_date
        AND (mapping.effective_until IS NULL OR mapping.effective_until > generated_date)
        AND 'recurring_expense.create' = ANY(mapping.applicable_proposal_types)
      ORDER BY mapping.effective_from DESC
      LIMIT 1;

      SELECT mapping.tax_account_code
      INTO credit_account_code
      FROM public.tax_account_mappings AS mapping
      WHERE mapping.org_id = rec.org_id
        AND mapping.display_label = '未払金'
        AND mapping.effective_from <= generated_date
        AND (mapping.effective_until IS NULL OR mapping.effective_until > generated_date)
        AND 'recurring_expense.create' = ANY(mapping.applicable_proposal_types)
      ORDER BY mapping.effective_from DESC
      LIMIT 1;

      IF debit_account_code IS NULL OR credit_account_code IS NULL THEN
        RAISE EXCEPTION 'RECURRING_EXPENSE_MAPPING_MISSING: %, org %', debit_label, rec.org_id;
      END IF;

      INSERT INTO public.accounting_transactions (
        org_id,
        kind,
        cost_center,
        category,
        description,
        recorded_date,
        amount_subtotal,
        tax_amount,
        amount_total,
        status,
        review_status,
        expense_scope,
        expense_lifecycle_state,
        paid_by,
        claimant_member_id,
        settlement_type,
        reimbursement_status,
        recurring_template_id,
        recurring_expense_id,
        generated_for_month,
        created_by
      ) VALUES (
        rec.org_id,
        'expense',
        'HQ',
        CASE rec.category
          WHEN '車両ローン' THEN 'travel'
          WHEN '携帯代' THEN 'utility'
          WHEN '月極駐車' THEN 'travel'
          WHEN '工具リース' THEN 'tool'
          WHEN '事務所家賃' THEN 'other'
          WHEN '保険' THEN 'other'
          ELSE 'other'
        END,
        format('[%s] %s', rec.category, rec.title),
        generated_date,
        rec.monthly_amount,
        0,
        rec.monthly_amount,
        'posted',
        'not_required',
        rec.expense_scope,
        'posted',
        'member',
        claimant_membership_id,
        'unpaid',
        'unsubmitted',
        rec.id,
        rec.id,
        current_ym,
        rec.created_by
      )
      RETURNING id INTO transaction_id;

      INSERT INTO public.ledger_events (org_id, event_type, proposal_id, payload, actor)
      VALUES (
        rec.org_id,
        'recurring_expense.create',
        rec.proposal_id,
        jsonb_build_object(
          'accounting_transaction_id', transaction_id,
          'recurring_expense_id', rec.id,
          'generated_for_month', current_ym,
          'category', rec.category,
          'title', rec.title,
          'monthly_amount', rec.monthly_amount
        ),
        jsonb_build_object('type', 'system', 'id', 'recurring-expense-cron', 'name', 'Recurring Expense Cron')
      )
      RETURNING id INTO ledger_event_id;

      INSERT INTO public.ledger_transactions (org_id, event_id, transaction_date, description, currency)
      VALUES (
        rec.org_id,
        ledger_event_id,
        generated_date,
        format('定期立替: [%s] %s', rec.category, rec.title),
        'JPY'
      )
      RETURNING id INTO ledger_transaction_id;

      INSERT INTO public.ledger_entries (
        transaction_id,
        account_code,
        debit_amount,
        credit_amount,
        memo,
        display_label_snapshot,
        line_number
      )
      VALUES
        (ledger_transaction_id, debit_account_code, rec.monthly_amount, 0, rec.title, debit_label, 1),
        (ledger_transaction_id, credit_account_code, 0, rec.monthly_amount, rec.title, '未払金', 2);
    EXCEPTION
      WHEN unique_violation THEN
        CONTINUE;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_recurring_expenses_for_current_month() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_expenses_for_current_month() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('recurring_expense_generation');
EXCEPTION
  WHEN undefined_function OR invalid_parameter_value THEN
    NULL;
END;
$$;

SELECT cron.schedule(
  'recurring_expense_generation',
  '5 15 $ * *',
  $$ SELECT public.generate_recurring_expenses_for_current_month(); $$
);

COMMENT ON FUNCTION public.generate_recurring_expenses_for_current_month() IS
  'Generates posted member-fronted recurring expense transactions once per recurring_expense/month; idempotent via uq_at_recurring_month.';

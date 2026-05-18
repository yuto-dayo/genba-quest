-- PR-30: Month-start depreciation posting.
-- Supabase Cron uses pg_cron; do not write to cron.job directly.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.post_monthly_depreciation(p_scheduled_month text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_month text := COALESCE(p_scheduled_month, to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM'));
  rec record;
  v_debit_account_code text;
  v_credit_account_code text;
  v_ledger_event_id uuid;
  v_ledger_transaction_id uuid;
  v_posted_count integer := 0;
BEGIN
  IF v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'DEPRECIATION_MONTH_INVALID'
      USING ERRCODE = '22023';
  END IF;

  FOR rec IN
    SELECT
      schedule.id AS schedule_id,
      schedule.amount,
      schedule.scheduled_month,
      asset.id AS asset_id,
      asset.org_id,
      asset.title,
      asset.category,
      asset.classification,
      asset.proposal_id
    FROM public.depreciation_schedule AS schedule
    JOIN public.depreciable_assets AS asset
      ON asset.id = schedule.asset_id
    WHERE schedule.scheduled_month = v_month
      AND schedule.status = 'pending'
      AND asset.is_active = true
    ORDER BY asset.org_id, asset.id, schedule.scheduled_month
    FOR UPDATE OF schedule SKIP LOCKED
  LOOP
    SELECT mapping.tax_account_code
    INTO v_debit_account_code
    FROM public.tax_account_mappings AS mapping
    WHERE mapping.org_id = rec.org_id
      AND mapping.display_label = '減価償却費'
      AND mapping.effective_from <= (rec.scheduled_month || '-01')::date
      AND (mapping.effective_until IS NULL OR mapping.effective_until > (rec.scheduled_month || '-01')::date)
      AND 'depreciation.monthly' = ANY(mapping.applicable_proposal_types)
    ORDER BY mapping.effective_from DESC
    LIMIT 1;

    SELECT mapping.tax_account_code
    INTO v_credit_account_code
    FROM public.tax_account_mappings AS mapping
    WHERE mapping.org_id = rec.org_id
      AND mapping.display_label = '減価償却累計額'
      AND mapping.effective_from <= (rec.scheduled_month || '-01')::date
      AND (mapping.effective_until IS NULL OR mapping.effective_until > (rec.scheduled_month || '-01')::date)
      AND 'depreciation.monthly' = ANY(mapping.applicable_proposal_types)
    ORDER BY mapping.effective_from DESC
    LIMIT 1;

    IF v_debit_account_code IS NULL OR v_credit_account_code IS NULL THEN
      RAISE EXCEPTION 'DEPRECIATION_MAPPING_MISSING: org %, asset %', rec.org_id, rec.asset_id
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.ledger_events (org_id, event_type, proposal_id, payload, actor)
    VALUES (
      rec.org_id,
      'depreciation.monthly',
      rec.proposal_id,
      jsonb_build_object(
        'asset_id', rec.asset_id,
        'schedule_id', rec.schedule_id,
        'scheduled_month', rec.scheduled_month,
        'amount', rec.amount,
        'classification', rec.classification
      ),
      jsonb_build_object('type', 'system', 'id', 'depreciation-cron', 'name', 'Depreciation Cron')
    )
    RETURNING id INTO v_ledger_event_id;

    INSERT INTO public.ledger_transactions (org_id, event_id, transaction_date, description, currency)
    VALUES (
      rec.org_id,
      v_ledger_event_id,
      (rec.scheduled_month || '-01')::date,
      format('減価償却: %s', rec.title),
      'JPY'
    )
    RETURNING id INTO v_ledger_transaction_id;

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
      (v_ledger_transaction_id, v_debit_account_code, rec.amount, 0, rec.title, '減価償却費', 1),
      (v_ledger_transaction_id, v_credit_account_code, 0, rec.amount, rec.title, '減価償却累計額', 2);

    UPDATE public.depreciation_schedule
    SET
      status = 'posted',
      posted_at = now(),
      ledger_event_id = v_ledger_event_id
    WHERE id = rec.schedule_id
      AND status = 'pending';

    v_posted_count := v_posted_count + 1;
  END LOOP;

  RETURN v_posted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.post_monthly_depreciation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_monthly_depreciation(text) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('monthly_depreciation_posting');
EXCEPTION
  WHEN undefined_function OR invalid_parameter_value THEN
    NULL;
END;
$$;

SELECT cron.schedule(
  'monthly_depreciation_posting',
  '10 15 1 * *',
  $$ SELECT public.post_monthly_depreciation(); $$
);

COMMENT ON FUNCTION public.post_monthly_depreciation(text) IS
  'Posts PR-30 monthly depreciation journals for the scheduled month; idempotent by schedule status and UNIQUE(asset_id, scheduled_month).';

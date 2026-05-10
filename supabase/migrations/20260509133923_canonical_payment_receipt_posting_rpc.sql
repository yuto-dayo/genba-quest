-- P1 canonical no-PL-revenue posting for Money payment receipt events.
--
-- This keeps POST /payments separated from invoice allocation while recording
-- the balance-sheet movement in posting_groups + accounting_journal_*.

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_type_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_type_check
  CHECK (
    type = ANY (
      ARRAY[
        'expense.create',
        'expense.update',
        'expense.void',
        'income.create',
        'income.update',
        'income.reverse',
        'invoice.create',
        'invoice.send',
        'invoice.mark_paid',
        'payment.record',
        'payment.allocate',
        'reward.calculate',
        'reward.adjust',
        'reward.pool.adjust',
        'path.level.update',
        'skill.achieve',
        'skill.revoke',
        'evaluation.submit',
        'evaluation.finalize',
        'assignment.create',
        'assignment.update',
        'assignment.cancel',
        'leave.request',
        'communication.review',
        'communication.task',
        'task.revision.request',
        'site.create',
        'site.complete',
        'site.close.finalize',
        'site.close.reopen',
        'policy.update',
        'luqo.catalog.add',
        'luqo.star.achieve',
        'luqo.score.update',
        'luqo.reward.calculate'
      ]::text[]
    )
  );

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
  ('1120', '普通預金', 'asset', NULL, true, 120, 'Money v2.2 canonical payment bank account'),
  ('2160', '未消込入金', 'liability', NULL, true, 160, 'Money v2.2 unapplied customer cash account')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.rpc_record_accounting_payment_event_canonical(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_idempotency_key text,
  p_received_on date,
  p_amount numeric,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_payment_method text DEFAULT NULL::text,
  p_payment_account text DEFAULT NULL::text,
  p_external_reference text DEFAULT NULL::text,
  p_metadata_json jsonb DEFAULT '{}'::jsonb,
  p_actor_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_payment public.accounting_payments%ROWTYPE;
  v_proposal public.proposals%ROWTYPE;
  v_existing_execution record;
  v_proposal_id uuid;
  v_execution_id uuid;
  v_posting_group_id uuid;
  v_journal_entry_id uuid;
  v_cash_account_code text;
  v_cash_account_name text;
BEGIN
  PERFORM private.assert_rpc_active_membership(p_org_id, p_actor_user_id, p_membership_id);

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_MUST_BE_POSITIVE'
      USING ERRCODE = '23514';
  END IF;

  IF p_received_on IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_RECEIVED_ON_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF p_payment_account IS NOT NULL
     AND p_payment_account <> ALL (ARRAY['cash'::text, 'bank'::text]) THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_INVALID'
      USING ERRCODE = '23514';
  END IF;

  SELECT execution.*
  INTO v_existing_execution
  FROM public.proposal_executions AS execution
  WHERE execution.org_id = p_org_id
    AND execution.idempotency_key = 'accounting.payments.create:' || p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT payment.*
    INTO v_payment
    FROM public.accounting_payments AS payment
    JOIN public.posting_groups AS posting_group
      ON posting_group.org_id = payment.org_id
     AND posting_group.payment_id = payment.id
    WHERE payment.org_id = p_org_id
      AND posting_group.proposal_execution_id = v_existing_execution.id
    ORDER BY payment.created_at DESC
    LIMIT 1;

    SELECT proposal.*
    INTO v_proposal
    FROM public.proposals AS proposal
    WHERE proposal.org_id = p_org_id
      AND proposal.id = v_existing_execution.proposal_id;

    SELECT posting_group.id
    INTO v_posting_group_id
    FROM public.posting_groups AS posting_group
    WHERE posting_group.org_id = p_org_id
      AND posting_group.proposal_execution_id = v_existing_execution.id
    ORDER BY posting_group.posted_at DESC
    LIMIT 1;

    SELECT entry.id
    INTO v_journal_entry_id
    FROM public.accounting_journal_entries AS entry
    WHERE entry.org_id = p_org_id
      AND entry.posting_group_id = v_posting_group_id
    ORDER BY entry.created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'org_id', p_org_id,
      'payment', to_jsonb(v_payment),
      'proposal', jsonb_build_object(
        'id', v_proposal.id,
        'type', v_proposal.type,
        'status', 'posted_canonical_projection',
        'db_status', v_proposal.status,
        'lineage_mode', 'transition',
        'lifecycle_engine', 'money_transition',
        'full_proposal_lifecycle', false,
        'source_route', 'accounting.payments.create',
        'source_idempotency_key', p_idempotency_key
      ),
      'execution', to_jsonb(v_existing_execution),
      'posting_group_id', v_posting_group_id,
      'journal_entry_id', v_journal_entry_id,
      'posting', jsonb_build_object(
        'status', 'posted',
        'mode', 'payment_received_no_pl_revenue',
        'affects_pl', false,
        'affects_revenue', false,
        'affects_ar', true
      ),
      'projection', jsonb_build_object(
        'projection_source', 'canonical_posting_projection',
        'legacy_payment_id', v_payment.id,
        'proposal_id', v_proposal.id,
        'proposal_execution_id', v_existing_execution.id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id
      ),
      'rpc_membership_verified', true
    );
  END IF;

  v_cash_account_code := CASE WHEN p_payment_account = 'bank' THEN '1120' ELSE '1100' END;
  v_cash_account_name := CASE WHEN p_payment_account = 'bank' THEN '普通預金' ELSE '現金' END;

  INSERT INTO public.proposals (
    org_id,
    type,
    status,
    created_by,
    payload,
    description,
    policy_ref,
    approvals,
    required_approvals,
    executed_at,
    executed_by,
    idempotency_key
  )
  VALUES (
    p_org_id,
    'payment.record',
    'executed',
    jsonb_build_object('type', 'human', 'id', p_actor_user_id, 'name', p_actor_name),
    jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'transition_status', 'posted_canonical_projection',
      'source_route', 'accounting.payments.create',
      'source_idempotency_key', p_idempotency_key,
      'customer_id', p_customer_id,
      'received_on', p_received_on,
      'amount', p_amount,
      'payment_method', p_payment_method,
      'payment_account', p_payment_account,
      'external_reference', p_external_reference,
      'posting_mode', 'payment_received_no_pl_revenue',
      'unapplied_account_type', 'unapplied_cash'
    ),
    '入金記録: ' || p_received_on::text,
    'legacy_direct_transition',
    '[]'::jsonb,
    0,
    now(),
    jsonb_build_object('type', 'human', 'id', p_actor_user_id, 'name', p_actor_name),
    'accounting.payments.create:' || p_idempotency_key
  )
  RETURNING *
  INTO v_proposal;

  INSERT INTO public.proposal_executions (
    org_id,
    proposal_id,
    status,
    attempt_no,
    started_at,
    idempotency_key
  )
  VALUES (
    p_org_id,
    v_proposal.id,
    'running',
    1,
    now(),
    'accounting.payments.create:' || p_idempotency_key
  )
  RETURNING id
  INTO v_execution_id;

  INSERT INTO public.accounting_payments (
    org_id,
    customer_id,
    received_on,
    amount,
    unapplied_amount,
    currency,
    payment_method,
    payment_account,
    external_reference,
    status,
    created_by,
    metadata_json
  )
  VALUES (
    p_org_id,
    p_customer_id,
    p_received_on,
    p_amount,
    p_amount,
    'JPY',
    p_payment_method,
    p_payment_account,
    p_external_reference,
    'received',
    p_actor_user_id,
    COALESCE(p_metadata_json, '{}'::jsonb) || jsonb_build_object(
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.payments.create',
      'source_idempotency_key', p_idempotency_key,
      'posting_mode', 'payment_received_no_pl_revenue',
      'unapplied_account_type', 'unapplied_cash'
    )
  )
  RETURNING *
  INTO v_payment;

  INSERT INTO public.posting_groups (
    org_id,
    group_type,
    proposal_execution_id,
    payment_id,
    accounting_date,
    posted_at,
    currency,
    description,
    metadata_json
  )
  VALUES (
    p_org_id,
    'payment_receipt',
    v_execution_id,
    v_payment.id,
    p_received_on,
    now(),
    'JPY',
    'Canonical payment receipt posting: ' || v_payment.id::text,
    jsonb_build_object(
      'posting_mode', 'payment_received_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true
    )
  )
  RETURNING id
  INTO v_posting_group_id;

  INSERT INTO public.accounting_journal_entries (
    org_id,
    posting_group_id,
    entry_date,
    memo,
    created_by,
    source_type,
    source_id,
    metadata_json
  )
  VALUES (
    p_org_id,
    v_posting_group_id,
    p_received_on,
    '入金記録',
    p_actor_user_id,
    'payment_receipt',
    v_payment.id,
    jsonb_build_object('posting_mode', 'payment_received_no_pl_revenue')
  )
  RETURNING id
  INTO v_journal_entry_id;

  INSERT INTO public.accounting_journal_lines (
    org_id,
    entry_id,
    line_no,
    account_code,
    account_name,
    debit,
    credit,
    description,
    customer_id,
    dimension_json
  )
  VALUES
    (
      p_org_id,
      v_journal_entry_id,
      1,
      v_cash_account_code,
      v_cash_account_name,
      p_amount,
      0,
      '入金',
      p_customer_id,
      jsonb_build_object('payment_id', v_payment.id, 'payment_account', p_payment_account)
    ),
    (
      p_org_id,
      v_journal_entry_id,
      2,
      '2160',
      '未消込入金',
      0,
      p_amount,
      '未消込入金',
      p_customer_id,
      jsonb_build_object('payment_id', v_payment.id, 'unapplied_account_type', 'unapplied_cash')
    );

  PERFORM private.assert_accounting_journal_entry_balanced(v_journal_entry_id);

  UPDATE public.accounting_journal_entries
  SET posted_at = now()
  WHERE org_id = p_org_id
    AND id = v_journal_entry_id;

  UPDATE public.proposal_executions
  SET status = 'succeeded',
      finished_at = now(),
      result_json = jsonb_build_object(
        'payment_id', v_payment.id,
        'posting_group_id', v_posting_group_id,
        'journal_entry_id', v_journal_entry_id,
        'projection_source', 'canonical_posting_projection'
      )
  WHERE org_id = p_org_id
    AND id = v_execution_id
  RETURNING *
  INTO v_existing_execution;

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'payment', to_jsonb(v_payment),
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'type', v_proposal.type,
      'status', 'posted_canonical_projection',
      'db_status', v_proposal.status,
      'lineage_mode', 'transition',
      'lifecycle_engine', 'money_transition',
      'full_proposal_lifecycle', false,
      'source_route', 'accounting.payments.create',
      'source_idempotency_key', p_idempotency_key
    ),
    'execution', to_jsonb(v_existing_execution),
    'posting_group_id', v_posting_group_id,
    'journal_entry_id', v_journal_entry_id,
    'posting', jsonb_build_object(
      'status', 'posted',
      'mode', 'payment_received_no_pl_revenue',
      'affects_pl', false,
      'affects_revenue', false,
      'affects_ar', true
    ),
    'projection', jsonb_build_object(
      'projection_source', 'canonical_posting_projection',
      'legacy_payment_id', v_payment.id,
      'proposal_id', v_proposal.id,
      'proposal_execution_id', v_existing_execution.id,
      'posting_group_id', v_posting_group_id,
      'journal_entry_id', v_journal_entry_id
    ),
    'rpc_membership_verified', true
  );
EXCEPTION
  WHEN others THEN
    IF v_execution_id IS NOT NULL THEN
      UPDATE public.proposal_executions
      SET status = 'failed',
          finished_at = now(),
          error_code = SQLSTATE,
          error_message = SQLERRM
      WHERE org_id = p_org_id
        AND id = v_execution_id;
    END IF;

    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_record_accounting_payment_event_canonical(
  uuid,
  uuid,
  uuid,
  text,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_record_accounting_payment_event_canonical(
  uuid,
  uuid,
  uuid,
  text,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  jsonb,
  text
) TO service_role;

COMMENT ON FUNCTION public.rpc_record_accounting_payment_event_canonical(
  uuid,
  uuid,
  uuid,
  text,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  jsonb,
  text
) IS 'Creates transition payment.record lineage, proposal execution, payment receipt posting group, balanced no-PL-revenue journal, and payment projection metadata.';

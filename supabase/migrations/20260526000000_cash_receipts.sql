-- PR-20a: cash receipt reconciliation foundation.
-- TS Proposal handler is the only application entry point. The trigger below
-- only synchronizes the parent allocated_amount; it never posts ledger entries.

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_type_check;
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
        'invoice.member_issue',
        'invoice.member_mark_paid',
        'invoice.member_void',
        'payment.record',
        'payment.allocate',
        'cash_receipt.record',
        'reward.calculate',
        'reward.adjust',
        'reward.pool.adjust',
        'path.level.update',
        'level.objection',
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
  ('1160', '仮払源泉所得税', 'asset', NULL, true, 116, 'PR-20a cash receipt withholding tax receivable'),
  ('4910', '売上値引', 'expense', '4100', true, 491, 'PR-20a cash receipt discount / variance account'),
  ('5910', '雑損', 'expense', '5900', true, 591, 'PR-20a cash receipt unresolved variance account')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

WITH target_labels AS (
  SELECT *
  FROM (VALUES
    ('普通預金', '1010', '普通預金', 'asset'::text),
    ('売掛金', '1110', '売掛金', 'asset'::text),
    ('支払手数料', '5840', '支払手数料', 'expense'::text),
    ('振込手数料', '5840', '支払手数料', 'expense'::text),
    ('仮払源泉所得税', '1160', '仮払源泉所得税', 'asset'::text),
    ('売上値引', '4910', '売上値引', 'expense'::text),
    ('雑損', '5910', '雑損', 'expense'::text)
  ) AS label(display_label, tax_account_code, tax_account_name, category)
),
creator AS (
  SELECT DISTINCT ON (membership.org_id)
    membership.org_id,
    membership.user_id
  FROM public.org_memberships AS membership
  WHERE membership.status = 'active'
  ORDER BY membership.org_id, (membership.role = 'admin') DESC, membership.joined_at NULLS LAST, membership.created_at
),
active_existing AS (
  SELECT mapping.*
  FROM public.tax_account_mappings AS mapping
  JOIN target_labels AS label
    ON label.display_label = mapping.display_label
  WHERE mapping.effective_until IS NULL
)
UPDATE public.tax_account_mappings AS mapping
SET effective_until = '2026-05-18'::date
FROM active_existing
WHERE mapping.id = active_existing.id
  AND active_existing.effective_from < '2026-05-18'::date;

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
  label.display_label,
  label.tax_account_code,
  label.tax_account_name,
  label.category,
  ARRAY(
    SELECT DISTINCT proposal_type
    FROM unnest(
      COALESCE(previous.applicable_proposal_types, ARRAY[]::text[]) || ARRAY['payment_received']::text[]
    ) AS proposal_type
    ORDER BY proposal_type
  ),
  '2026-05-18'::date,
  creator.user_id
FROM public.organizations AS org
JOIN creator ON creator.org_id = org.id
CROSS JOIN (
  VALUES
    ('普通預金', '1010', '普通預金', 'asset'::text),
    ('売掛金', '1110', '売掛金', 'asset'::text),
    ('支払手数料', '5840', '支払手数料', 'expense'::text),
    ('振込手数料', '5840', '支払手数料', 'expense'::text),
    ('仮払源泉所得税', '1160', '仮払源泉所得税', 'asset'::text),
    ('売上値引', '4910', '売上値引', 'expense'::text),
    ('雑損', '5910', '雑損', 'expense'::text)
) AS label(display_label, tax_account_code, tax_account_name, category)
LEFT JOIN LATERAL (
  SELECT existing.applicable_proposal_types
  FROM public.tax_account_mappings AS existing
  WHERE existing.org_id = org.id
    AND existing.display_label = label.display_label
    AND existing.effective_until = '2026-05-18'::date
  ORDER BY existing.effective_from DESC
  LIMIT 1
) AS previous ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tax_account_mappings AS existing
  WHERE existing.org_id = org.id
    AND existing.display_label = label.display_label
    AND existing.effective_from = '2026-05-18'::date
);

CREATE TABLE public.cash_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id),
  ledger_event_id uuid REFERENCES public.ledger_events(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  received_date date NOT NULL,
  received_amount numeric(15,2) NOT NULL CHECK (received_amount > 0),
  allocated_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  variance_amount numeric(15,2) GENERATED ALWAYS AS (received_amount - allocated_amount) STORED,
  variance_reason text CHECK (variance_reason IN (
    'partial_payment',
    'overpayment',
    'fee_deduction',
    'withholding_tax',
    'tax_correction',
    'unknown'
  )),
  variance_memo text,
  bank_txn_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconciled','disputed')),
  snapshot_client_name text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (allocated_amount <= received_amount)
);

CREATE UNIQUE INDEX uq_cash_receipts_bank_ref
  ON public.cash_receipts (org_id, bank_txn_ref)
  WHERE bank_txn_ref IS NOT NULL;

CREATE UNIQUE INDEX uq_cash_receipts_proposal
  ON public.cash_receipts (proposal_id);

CREATE INDEX idx_cash_receipts_org_date
  ON public.cash_receipts (org_id, received_date DESC);

CREATE INDEX idx_cash_receipts_client
  ON public.cash_receipts (client_id, received_date DESC);

CREATE TABLE public.cash_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.cash_receipts(id) ON DELETE CASCADE,
  invoice_transaction_id uuid NOT NULL REFERENCES public.accounting_transactions(id),
  allocated_amount numeric(15,2) NOT NULL CHECK (allocated_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, invoice_transaction_id)
);

CREATE INDEX idx_alloc_invoice
  ON public.cash_receipt_allocations (invoice_transaction_id);

CREATE OR REPLACE FUNCTION public.sync_cash_receipt_allocated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_receipt_id uuid := COALESCE(NEW.receipt_id, OLD.receipt_id);
BEGIN
  UPDATE public.cash_receipts
  SET allocated_amount = (
    SELECT COALESCE(SUM(allocated_amount), 0)
    FROM public.cash_receipt_allocations
    WHERE receipt_id = v_receipt_id
  )
  WHERE id = v_receipt_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_alloc
  AFTER INSERT OR UPDATE OR DELETE ON public.cash_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION public.sync_cash_receipt_allocated();

ALTER TABLE public.cash_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY cr_select_org ON public.cash_receipts
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

ALTER TABLE public.cash_receipt_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cra_select_org ON public.cash_receipt_allocations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cash_receipts AS receipt
      WHERE receipt.id = receipt_id
        AND private.is_active_member(receipt.org_id)
    )
  );

GRANT SELECT ON public.cash_receipts TO authenticated;
GRANT SELECT ON public.cash_receipt_allocations TO authenticated;
GRANT ALL ON public.cash_receipts TO service_role;
GRANT ALL ON public.cash_receipt_allocations TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_execute_cash_receipt_record(
  p_org_id uuid,
  p_proposal_id uuid,
  p_executor jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_proposal public.proposals%ROWTYPE;
  v_client_name text;
  v_client_id uuid;
  v_received_date date;
  v_received_amount numeric(15,2);
  v_allocated_amount numeric(15,2) := 0;
  v_variance numeric(15,2);
  v_variance_reason text;
  v_variance_label text;
  v_receipt_id uuid;
  v_event_id uuid;
  v_transaction_id uuid;
  v_now timestamptz := now();
  v_allocation jsonb;
  v_invoice_transaction_id uuid;
  v_allocation_amount numeric(15,2);
  v_entries jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_mapping public.tax_account_mappings%ROWTYPE;
  v_line_number integer := 0;
  v_debit numeric(15,2);
  v_credit numeric(15,2);
  v_debit_cents bigint;
  v_credit_cents bigint;
  v_debit_total_cents bigint := 0;
  v_credit_total_cents bigint := 0;
  v_approval_count integer;
BEGIN
  SELECT *
  INTO v_proposal
  FROM public.proposals
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;

  IF v_proposal.status = 'executed' THEN
    RETURN to_jsonb(v_proposal);
  END IF;

  IF v_proposal.type <> 'cash_receipt.record' THEN
    RAISE EXCEPTION 'CASH_RECEIPT_PROPOSAL_TYPE_REQUIRED';
  END IF;

  IF v_proposal.status <> 'approved' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_APPROVED';
  END IF;

  IF v_proposal.required_approvals > 0 THEN
    SELECT count(*)::integer
    INTO v_approval_count
    FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
    WHERE elem->>'decision' = 'approve';

    IF v_approval_count < v_proposal.required_approvals THEN
      RAISE EXCEPTION 'INSUFFICIENT_APPROVALS';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_receipts AS receipt
    WHERE receipt.proposal_id = p_proposal_id
  ) THEN
    SELECT proposal.*
    INTO v_proposal
    FROM public.proposals AS proposal
    WHERE proposal.id = p_proposal_id
      AND proposal.org_id = p_org_id;
    RETURN to_jsonb(v_proposal);
  END IF;

  v_client_id := NULLIF(v_proposal.payload->>'client_id', '')::uuid;
  v_received_date := (v_proposal.payload->>'received_date')::date;
  v_received_amount := (v_proposal.payload->>'received_amount')::numeric(15,2);
  v_variance_reason := NULLIF(v_proposal.payload->>'variance_reason', '');

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_ID_REQUIRED';
  END IF;

  IF v_received_date IS NULL THEN
    RAISE EXCEPTION 'RECEIVED_DATE_REQUIRED';
  END IF;

  IF v_received_amount IS NULL OR v_received_amount <= 0 THEN
    RAISE EXCEPTION 'RECEIVED_AMOUNT_MUST_BE_POSITIVE';
  END IF;

  IF v_variance_reason IS NULL OR v_variance_reason NOT IN (
    'partial_payment',
    'overpayment',
    'fee_deduction',
    'withholding_tax',
    'tax_correction',
    'unknown'
  ) THEN
    RAISE EXCEPTION 'VARIANCE_REASON_INVALID';
  END IF;

  IF jsonb_typeof(v_proposal.payload->'allocations') <> 'array'
    OR jsonb_array_length(v_proposal.payload->'allocations') = 0
  THEN
    RAISE EXCEPTION 'ALLOCATIONS_REQUIRED';
  END IF;

  SELECT client.name
  INTO v_client_name
  FROM public.clients AS client
  WHERE client.id = v_client_id
    AND client.org_id = p_org_id
    AND client.deleted_at IS NULL;

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  INSERT INTO public.cash_receipts (
    org_id,
    proposal_id,
    client_id,
    received_date,
    received_amount,
    variance_reason,
    variance_memo,
    bank_txn_ref,
    snapshot_client_name,
    notes
  )
  VALUES (
    p_org_id,
    p_proposal_id,
    v_client_id,
    v_received_date,
    v_received_amount,
    v_variance_reason,
    NULLIF(v_proposal.payload->>'variance_memo', ''),
    NULLIF(v_proposal.payload->>'bank_txn_ref', ''),
    v_client_name,
    NULLIF(v_proposal.payload->>'notes', '')
  )
  RETURNING id INTO v_receipt_id;

  FOR v_allocation IN
    SELECT value
    FROM jsonb_array_elements(v_proposal.payload->'allocations')
  LOOP
    v_invoice_transaction_id := NULLIF(v_allocation->>'invoice_transaction_id', '')::uuid;
    v_allocation_amount := (v_allocation->>'allocated_amount')::numeric(15,2);

    IF v_invoice_transaction_id IS NULL THEN
      RAISE EXCEPTION 'INVOICE_TRANSACTION_ID_REQUIRED';
    END IF;

    IF v_allocation_amount IS NULL OR v_allocation_amount <= 0 THEN
      RAISE EXCEPTION 'ALLOCATION_AMOUNT_MUST_BE_POSITIVE';
    END IF;

    PERFORM 1
    FROM public.accounting_transactions AS tx
    WHERE tx.id = v_invoice_transaction_id
      AND tx.org_id = p_org_id
      AND tx.client_id = v_client_id
      AND tx.kind IN ('sale', 'invoice')
      AND tx.status <> 'voided';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVOICE_TRANSACTION_NOT_FOUND';
    END IF;

    INSERT INTO public.cash_receipt_allocations (
      receipt_id,
      invoice_transaction_id,
      allocated_amount
    )
    VALUES (
      v_receipt_id,
      v_invoice_transaction_id,
      v_allocation_amount
    );

    v_allocated_amount := v_allocated_amount + v_allocation_amount;
    v_entries := v_entries || jsonb_build_object(
      'display_label', '売掛金',
      'debit_amount', 0,
      'credit_amount', v_allocation_amount
    );
  END LOOP;

  IF v_allocated_amount > v_received_amount THEN
    RAISE EXCEPTION 'ALLOCATIONS_EXCEED_RECEIVED_AMOUNT';
  END IF;

  v_variance := v_received_amount - v_allocated_amount;
  v_entries := jsonb_build_array(jsonb_build_object(
    'display_label', '普通預金',
    'debit_amount', v_allocated_amount,
    'credit_amount', 0
  )) || v_entries;

  IF v_variance > 0 AND v_variance_reason <> 'partial_payment' THEN
    v_variance_label := CASE v_variance_reason
      WHEN 'fee_deduction' THEN '支払手数料'
      WHEN 'withholding_tax' THEN '仮払源泉所得税'
      WHEN 'overpayment' THEN '売上値引'
      WHEN 'tax_correction' THEN '売上値引'
      ELSE '雑損'
    END;

    IF v_variance_reason = 'unknown' THEN
      RAISE WARNING 'cash_receipt.record posted unknown variance for proposal %', p_proposal_id;
    END IF;

    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object(
        'display_label', v_variance_label,
        'debit_amount', v_variance,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'display_label', '売掛金',
        'debit_amount', 0,
        'credit_amount', v_variance
      )
    );
  END IF;

  INSERT INTO public.ledger_events (org_id, event_type, proposal_id, payload, actor)
  VALUES (
    p_org_id,
    'payment_received',
    p_proposal_id,
    jsonb_build_object(
      'receipt_id', v_receipt_id,
      'entries_count', jsonb_array_length(v_entries),
      'bank_txn_ref', NULLIF(v_proposal.payload->>'bank_txn_ref', '')
    ),
    p_executor
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.ledger_transactions (
    org_id,
    event_id,
    transaction_date,
    description,
    currency
  )
  VALUES (
    p_org_id,
    v_event_id,
    v_received_date,
    COALESCE(NULLIF(v_proposal.payload->>'description', ''), v_proposal.description),
    'JPY'
  )
  RETURNING id INTO v_transaction_id;

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(v_entries)
  LOOP
    v_line_number := v_line_number + 1;
    v_debit := COALESCE((v_entry->>'debit_amount')::numeric, 0);
    v_credit := COALESCE((v_entry->>'credit_amount')::numeric, 0);
    v_debit_cents := round(v_debit * 100)::bigint;
    v_credit_cents := round(v_credit * 100)::bigint;

    IF (v_debit_cents > 0 AND v_credit_cents > 0)
      OR (v_debit_cents <= 0 AND v_credit_cents <= 0)
    THEN
      RAISE EXCEPTION 'LEDGER_LINE_SHAPE_INVALID';
    END IF;

    SELECT mapping.*
    INTO v_mapping
    FROM public.tax_account_mappings AS mapping
    WHERE mapping.org_id = p_org_id
      AND mapping.display_label = v_entry->>'display_label'
      AND mapping.effective_from <= v_received_date
      AND (mapping.effective_until IS NULL OR mapping.effective_until > v_received_date)
    ORDER BY mapping.effective_from DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TAX_ACCOUNT_MAPPING_NOT_FOUND: %', v_entry->>'display_label';
    END IF;

    IF NOT ('payment_received' = ANY(v_mapping.applicable_proposal_types)) THEN
      RAISE EXCEPTION 'TAX_ACCOUNT_MAPPING_NOT_APPLICABLE: %', v_entry->>'display_label';
    END IF;

    v_debit_total_cents := v_debit_total_cents + v_debit_cents;
    v_credit_total_cents := v_credit_total_cents + v_credit_cents;

    INSERT INTO public.ledger_entries (
      transaction_id,
      account_code,
      debit_amount,
      credit_amount,
      display_label_snapshot,
      memo,
      line_number
    )
    VALUES (
      v_transaction_id,
      v_mapping.tax_account_code,
      v_debit,
      v_credit,
      v_entry->>'display_label',
      v_entry->>'display_label',
      v_line_number
    );
  END LOOP;

  IF v_debit_total_cents <> v_credit_total_cents THEN
    RAISE EXCEPTION 'LEDGER_IMBALANCED';
  END IF;

  UPDATE public.cash_receipts
  SET
    ledger_event_id = v_event_id,
    status = CASE
      WHEN v_variance_reason = 'partial_payment' AND v_variance > 0 THEN 'pending'
      ELSE 'reconciled'
    END
  WHERE id = v_receipt_id;

  UPDATE public.proposals
  SET
    status = 'executed',
    executed_at = v_now,
    executed_by = p_executor,
    result_event_id = v_event_id,
    updated_at = v_now
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  RETURNING * INTO v_proposal;

  RETURN to_jsonb(v_proposal);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_execute_cash_receipt_record(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_execute_cash_receipt_record(uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_approve_cash_receipt_proposal_atomic(
  p_org_id uuid,
  p_proposal_id uuid,
  p_approver jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_proposal public.proposals%ROWTYPE;
  v_approver_type text := p_approver->>'type';
  v_creator_type text;
  v_approval_count integer;
  v_new_approval jsonb;
  v_updated_approvals jsonb;
  v_is_fully_approved boolean;
  v_auto_executed boolean := false;
  v_now timestamptz := now();
BEGIN
  SELECT *
  INTO v_proposal
  FROM public.proposals
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;

  IF v_proposal.type <> 'cash_receipt.record' THEN
    RAISE EXCEPTION 'CASH_RECEIPT_PROPOSAL_TYPE_REQUIRED';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_IN_PENDING_STATE';
  END IF;

  v_creator_type := v_proposal.created_by->>'type';

  IF v_creator_type = 'ai' AND v_approver_type = 'ai' THEN
    RAISE EXCEPTION 'AI_SELF_APPROVAL_PROHIBITED';
  END IF;

  IF v_approver_type <> 'human' THEN
    RAISE EXCEPTION 'CASH_RECEIPT_APPROVER_MUST_BE_HUMAN';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_memberships AS membership
    WHERE membership.org_id = p_org_id
      AND membership.user_id = NULLIF(p_approver->>'id', '')::uuid
      AND membership.status = 'active'
      AND membership.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'APPROVER_NOT_ALLOWED_BY_POLICY';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
    WHERE elem->'actor'->>'id' = p_approver->>'id'
      AND elem->>'decision' = 'approve'
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED_BY_THIS_ACTOR';
  END IF;

  SELECT count(*)::integer
  INTO v_approval_count
  FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
  WHERE elem->>'decision' = 'approve';

  IF v_proposal.required_approvals > 0
    AND v_approval_count >= v_proposal.required_approvals
  THEN
    RAISE EXCEPTION 'APPROVAL_COUNT_ALREADY_MET';
  END IF;

  v_new_approval := jsonb_build_object(
    'actor', p_approver,
    'decision', 'approve',
    'reason', p_reason,
    'at', v_now::text
  );
  v_updated_approvals := COALESCE(v_proposal.approvals, '[]'::jsonb) || v_new_approval;
  v_approval_count := v_approval_count + 1;
  v_is_fully_approved := (v_approval_count >= v_proposal.required_approvals);

  IF v_is_fully_approved THEN
    UPDATE public.proposals
    SET status = 'approved',
        approvals = v_updated_approvals,
        updated_at = v_now
    WHERE id = p_proposal_id
      AND org_id = p_org_id
    RETURNING * INTO v_proposal;

    SELECT *
    INTO v_proposal
    FROM jsonb_populate_record(
      NULL::public.proposals,
      public.rpc_execute_cash_receipt_record(
        p_org_id,
        p_proposal_id,
        jsonb_build_object('type', 'system', 'id', 'system', 'name', 'System Auto-Execute')
      )
    );
    v_auto_executed := true;
  ELSE
    UPDATE public.proposals
    SET approvals = v_updated_approvals,
        updated_at = v_now
    WHERE id = p_proposal_id
      AND org_id = p_org_id
    RETURNING * INTO v_proposal;
  END IF;

  RETURN jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'is_fully_approved', v_is_fully_approved,
    'auto_executed', v_auto_executed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_approve_cash_receipt_proposal_atomic(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_approve_cash_receipt_proposal_atomic(uuid, uuid, jsonb, text) TO service_role;

INSERT INTO public.policies (
  org_id,
  name,
  description,
  proposal_type,
  conditions,
  required_approvers,
  required_count,
  auto_approve,
  ai_can_approve,
  priority,
  is_active
)
SELECT
  org.id,
  'cash_receipt_record_admin_approval',
  'cash_receipt.record requires one admin/finance approval.',
  'cash_receipt.record',
  '[]'::jsonb,
  '[{"type":"role","value":"admin"}]'::jsonb,
  1,
  false,
  false,
  120,
  true
FROM public.organizations AS org
WHERE NOT EXISTS (
  SELECT 1
  FROM public.policies AS policy
  WHERE policy.org_id = org.id
    AND policy.proposal_type = 'cash_receipt.record'
    AND policy.name = 'cash_receipt_record_admin_approval'
);

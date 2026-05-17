-- PR-29: Separate completed construction COGS from work-in-progress.
-- 建設業会計: 未完成現場の支出は 1230 未成工事支出金、完成時に 5420 完成工事原価へ振替。

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
  ('1230', '未成工事支出金', 'asset', '1200', true, 230, '未完成現場の累積支出金'),
  ('5420', '完成工事原価', 'expense', '5100', true, 420, '完成現場へ振り替えた工事原価')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.site_cost_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id),
  transferred_at timestamptz NOT NULL DEFAULT now(),
  accumulated_amount numeric(15,2) NOT NULL CHECK (accumulated_amount >= 0),
  from_account_code text NOT NULL DEFAULT '1230',
  to_account_code text NOT NULL DEFAULT '5420',
  proposal_id uuid NOT NULL REFERENCES public.proposals(id),
  ledger_event_id uuid NOT NULL REFERENCES public.ledger_events(id),
  ledger_transaction_id uuid REFERENCES public.ledger_transactions(id),
  accounting_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id)
);

CREATE INDEX IF NOT EXISTS idx_site_cost_transfers_org
  ON public.site_cost_transfers (org_id, transferred_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_cost_transfers_proposal
  ON public.site_cost_transfers (org_id, proposal_id);

ALTER TABLE public.site_cost_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Site Cost Transfers" ON public.site_cost_transfers;
CREATE POLICY "Read Site Cost Transfers"
  ON public.site_cost_transfers
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

REVOKE ALL ON TABLE public.site_cost_transfers FROM anon, authenticated;
GRANT SELECT ON TABLE public.site_cost_transfers TO authenticated;
GRANT ALL ON TABLE public.site_cost_transfers TO service_role;

CREATE OR REPLACE VIEW public.v_monthly_pl_components
WITH (security_invoker = true)
AS
SELECT
  tx.org_id,
  date_trunc('month', tx.recorded_date)::date AS month,
  COALESCE(SUM(
    CASE
      WHEN tx.kind IN ('sale', 'invoice')
       AND COALESCE(site.status, '') IN ('completed', 'closed')
        THEN tx.amount_total
      ELSE 0
    END
  ), 0)::numeric(15,2) AS sales,
  COALESCE(SUM(
    CASE
      WHEN tx.kind = 'expense'
       AND tx.site_id IS NOT NULL
       AND COALESCE(site.status, '') IN ('completed', 'closed')
        THEN tx.amount_total
      ELSE 0
    END
  ), 0)::numeric(15,2) AS completed_cogs,
  COALESCE(SUM(
    CASE
      WHEN tx.kind = 'expense'
       AND tx.site_id IS NOT NULL
       AND COALESCE(site.status, '') NOT IN ('completed', 'closed')
        THEN tx.amount_total
      ELSE 0
    END
  ), 0)::numeric(15,2) AS work_in_progress,
  COALESCE(SUM(
    CASE
      WHEN tx.kind = 'expense'
       AND tx.site_id IS NULL
        THEN tx.amount_total
      ELSE 0
    END
  ), 0)::numeric(15,2) AS overhead
FROM public.accounting_transactions AS tx
LEFT JOIN public.sites AS site
  ON site.id = tx.site_id
 AND site.org_id = tx.org_id
WHERE tx.status = 'posted'
GROUP BY tx.org_id, date_trunc('month', tx.recorded_date);

GRANT SELECT ON public.v_monthly_pl_components TO authenticated;
GRANT SELECT ON public.v_monthly_pl_components TO service_role;

CREATE OR REPLACE FUNCTION private.route_site_expense_journal_line_to_wip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.site_id IS NOT NULL
    AND NEW.debit > 0
    AND NEW.account_code IN ('1500', '5100', '5110', '5120', '5130', '5140', '5200', '5300', '5400', '5900')
  THEN
    NEW.account_code := '1230';
    NEW.account_name := '未成工事支出金';
    NEW.tax_rate := NULL;
    NEW.tax_type := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounting_journal_lines_site_expense_to_wip ON public.accounting_journal_lines;
CREATE TRIGGER accounting_journal_lines_site_expense_to_wip
  BEFORE INSERT ON public.accounting_journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION private.route_site_expense_journal_line_to_wip();

CREATE OR REPLACE FUNCTION private.snapshot_expense_site_status_at_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site_id uuid;
  v_site_status text;
BEGIN
  IF NEW.type <> 'expense.create'
    OR NEW.payload ? 'site_status_at_record'
  THEN
    RETURN NEW;
  END IF;

  v_site_id := COALESCE(
    NEW.site_id,
    NULLIF(NEW.payload->>'site_id', '')::uuid
  );

  IF v_site_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT site.status
  INTO v_site_status
  FROM public.sites AS site
  WHERE site.org_id = NEW.org_id
    AND site.id = v_site_id;

  IF v_site_status IS NOT NULL THEN
    NEW.payload := jsonb_set(
      COALESCE(NEW.payload, '{}'::jsonb),
      '{site_status_at_record}',
      to_jsonb(v_site_status),
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_expense_site_status_snapshot ON public.proposals;
CREATE TRIGGER proposals_expense_site_status_snapshot
  BEFORE INSERT ON public.proposals
  FOR EACH ROW
  EXECUTE FUNCTION private.snapshot_expense_site_status_at_record();

CREATE OR REPLACE FUNCTION private.create_site_cost_transfer_for_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site_id uuid;
  v_amount numeric(15,2);
  v_event_id uuid;
  v_ledger_transaction_id uuid;
  v_accounting_journal_entry_id uuid;
  v_actor_user_id uuid;
  v_transaction_date date;
  v_description text;
BEGIN
  IF NEW.type <> 'site.close.finalize'
    OR NEW.status <> 'executed'
    OR OLD.status = 'executed'
  THEN
    RETURN NEW;
  END IF;

  v_site_id := COALESCE(
    NEW.site_id,
    NULLIF(NEW.payload->>'site_id', '')::uuid
  );

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'SITE_COST_TRANSFER_SITE_ID_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.sites AS site
  WHERE site.org_id = NEW.org_id
    AND site.id = v_site_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND'
      USING ERRCODE = '02000';
  END IF;

  SELECT COALESCE(SUM(tx.amount_total), 0)::numeric(15,2)
  INTO v_amount
  FROM public.accounting_transactions AS tx
  WHERE tx.org_id = NEW.org_id
    AND tx.site_id = v_site_id
    AND tx.status = 'posted'
    AND tx.kind = 'expense';

  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_transaction_date := COALESCE(
    NULLIF(NEW.payload->>'closed_at', '')::date,
    NEW.executed_at::date,
    CURRENT_DATE
  );
  v_description := '完成工事原価振替: ' || COALESCE(NEW.description, v_site_id::text);

  INSERT INTO public.ledger_events (org_id, event_type, proposal_id, payload, actor)
  VALUES (
    NEW.org_id,
    'expense_recorded',
    NEW.id,
    jsonb_build_object(
      'kind', 'site_cost_transfer',
      'site_id', v_site_id,
      'amount_total', v_amount,
      'from_account_code', '1230',
      'to_account_code', '5420',
      'source_proposal_type', NEW.type
    ),
    COALESCE(NEW.executed_by, NEW.created_by)
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.ledger_transactions (org_id, event_id, transaction_date, description, currency)
  VALUES (NEW.org_id, v_event_id, v_transaction_date, v_description, 'JPY')
  RETURNING id INTO v_ledger_transaction_id;

  INSERT INTO public.ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
  VALUES
    (v_ledger_transaction_id, '5420', v_amount, 0, v_description, 1),
    (v_ledger_transaction_id, '1230', 0, v_amount, v_description, 2);

  v_actor_user_id := CASE
    WHEN COALESCE(NEW.executed_by->>'type', NEW.created_by->>'type') = 'human'
     AND COALESCE(NEW.executed_by->>'id', NEW.created_by->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN COALESCE(NEW.executed_by->>'id', NEW.created_by->>'id')::uuid
    WHEN NEW.created_by->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (NEW.created_by->>'id')::uuid
    ELSE NULL
  END;

  IF v_actor_user_id IS NOT NULL THEN
    INSERT INTO public.accounting_journal_entries (
      org_id,
      transaction_id,
      entry_date,
      memo,
      posted_at,
      created_by
    )
    VALUES (
      NEW.org_id,
      NULL,
      v_transaction_date,
      v_description,
      now(),
      v_actor_user_id
    )
    RETURNING id INTO v_accounting_journal_entry_id;

    INSERT INTO public.accounting_journal_lines (
      org_id,
      entry_id,
      line_no,
      account_code,
      account_name,
      debit,
      credit,
      description,
      site_id,
      dimension_json
    )
    VALUES
      (
        NEW.org_id,
        v_accounting_journal_entry_id,
        1,
        '5420',
        '完成工事原価',
        v_amount,
        0,
        v_description,
        v_site_id,
        jsonb_build_object('kind', 'site_cost_transfer', 'proposal_id', NEW.id)
      ),
      (
        NEW.org_id,
        v_accounting_journal_entry_id,
        2,
        '1230',
        '未成工事支出金',
        0,
        v_amount,
        v_description,
        v_site_id,
        jsonb_build_object('kind', 'site_cost_transfer', 'proposal_id', NEW.id)
      );
  END IF;

  INSERT INTO public.site_cost_transfers (
    org_id,
    site_id,
    accumulated_amount,
    from_account_code,
    to_account_code,
    proposal_id,
    ledger_event_id,
    ledger_transaction_id,
    accounting_journal_entry_id,
    notes
  )
  VALUES (
    NEW.org_id,
    v_site_id,
    v_amount,
    '1230',
    '5420',
    NEW.id,
    v_event_id,
    v_ledger_transaction_id,
    v_accounting_journal_entry_id,
    'site.close.finalize'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_site_cost_transfer_on_close ON public.proposals;
CREATE TRIGGER proposals_site_cost_transfer_on_close
  AFTER UPDATE OF status ON public.proposals
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.create_site_cost_transfer_for_close();

COMMENT ON TABLE public.site_cost_transfers
  IS '完成現場の未成工事支出金(1230)から完成工事原価(5420)への一度限りの振替ログ。';
COMMENT ON FUNCTION private.create_site_cost_transfer_for_close()
  IS 'Runs inside proposal execution transaction; creates Dr 5420 / Cr 1230 when site.close.finalize executes.';
COMMENT ON FUNCTION private.route_site_expense_journal_line_to_wip()
  IS 'Routes posted site expense/tax debit journal lines to 1230 so unfinished construction stays off PL until close.';
COMMENT ON FUNCTION private.snapshot_expense_site_status_at_record()
  IS 'Stores site_status_at_record in expense.create proposal payload for later construction accounting verification.';

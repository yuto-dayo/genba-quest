-- M-3: Create the expense_field_change_log table (append-only).
--
-- Records every change to an expense row at field granularity. Powers the
-- "番頭レス可視性" UX north star: anyone opening an expense detail view sees
-- exactly who/when changed each value, including AI inferences and system
-- automations.
--
-- Append-only enforcement: RLS allows INSERT/SELECT for org members but not
-- UPDATE or DELETE. The service_role bypasses RLS as usual; UPDATE/DELETE
-- there should still be avoided per 電子帳簿保存法 (records of corrections
-- must be preserved).
--
-- Related: docs/MONEY_EXPENSE_FLOW.md §2.4, §4, §7.2

CREATE TABLE IF NOT EXISTS public.expense_field_change_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  expense_id    uuid NOT NULL,
  field         text NOT NULL,
  old_value     jsonb,
  new_value     jsonb,
  changed_by    jsonb NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  source        text NOT NULL,
  reason        text,

  CONSTRAINT expense_field_change_log_source_check
    CHECK (source = ANY (ARRAY['manual', 'ai_inference', 'system_auto'])),

  CONSTRAINT expense_field_change_log_expense_fk
    FOREIGN KEY (expense_id)
    REFERENCES public.accounting_transactions (id)
    ON DELETE CASCADE,

  CONSTRAINT expense_field_change_log_changed_by_shape
    CHECK (
      jsonb_typeof(changed_by) = 'object'
      AND changed_by ? 'type'
      AND (changed_by ->> 'type') = ANY (ARRAY['human', 'ai', 'system', 'integration'])
    )
);

COMMENT ON TABLE public.expense_field_change_log
  IS 'Append-only field-level change history for expense rows. Source of truth for the audit trail surfaced in the expense detail view.';

CREATE INDEX IF NOT EXISTS expense_field_change_log_expense_idx
  ON public.expense_field_change_log (expense_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS expense_field_change_log_org_idx
  ON public.expense_field_change_log (org_id, changed_at DESC);

ALTER TABLE public.expense_field_change_log ENABLE ROW LEVEL SECURITY;

-- Members of the org can read history for their own org.
CREATE POLICY "expense_field_change_log_select"
  ON public.expense_field_change_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_memberships AS m
      WHERE m.user_id = auth.uid()
        AND m.org_id  = expense_field_change_log.org_id
        AND m.status  = 'active'
    )
  );

-- Members can insert; the route layer is responsible for setting org_id /
-- changed_by correctly. We additionally pin org membership in the policy.
CREATE POLICY "expense_field_change_log_insert"
  ON public.expense_field_change_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.org_memberships AS m
      WHERE m.user_id = auth.uid()
        AND m.org_id  = expense_field_change_log.org_id
        AND m.status  = 'active'
    )
  );

-- No UPDATE / DELETE policies. Append-only.
-- service_role bypasses RLS; do not introduce update/delete code paths.

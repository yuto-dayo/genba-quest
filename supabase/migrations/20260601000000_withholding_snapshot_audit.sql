-- PR-34: immutable withholding decision snapshots for reward/payout audit trails.

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*)
  INTO missing_count
  FROM public.ledger_events AS event
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(event.payload -> 'member_payouts', '[]'::jsonb)) AS payout(row)
  LEFT JOIN LATERAL (
    SELECT classification.id
    FROM public.member_tax_classifications AS classification
    WHERE classification.org_id = event.org_id
      AND classification.member_id = NULLIF(payout.row ->> 'member_id', '')::uuid
      AND classification.effective_from <= event.created_at::date
      AND (classification.effective_until IS NULL OR classification.effective_until > event.created_at::date)
    ORDER BY classification.effective_from DESC
    LIMIT 1
  ) AS active_classification ON true
  WHERE event.event_type = 'reward_calculated'
    AND NOT (event.payload ? 'tax_withholding_decision_snapshot')
    AND active_classification.id IS NULL;

  IF missing_count > 0 THEN
    RAISE WARNING 'PR-34 withholding snapshot backfill skipped % reward_calculated member rows without active member_tax_classifications', missing_count;
  END IF;
END;
$$;

WITH reward_member_rows AS (
  SELECT
    event.id AS event_id,
    payout.ordinality,
    payout.row AS payout_row,
    payout.row ->> 'member_id' AS member_id,
    classification.*
  FROM public.ledger_events AS event
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(event.payload -> 'member_payouts', '[]'::jsonb)) WITH ORDINALITY AS payout(row, ordinality)
  JOIN LATERAL (
    SELECT active.*
    FROM public.member_tax_classifications AS active
    WHERE active.org_id = event.org_id
      AND active.member_id = NULLIF(payout.row ->> 'member_id', '')::uuid
      AND active.effective_from <= event.created_at::date
      AND (active.effective_until IS NULL OR active.effective_until > event.created_at::date)
    ORDER BY active.effective_from DESC
    LIMIT 1
  ) AS classification ON true
  WHERE event.event_type = 'reward_calculated'
    AND NOT (event.payload ? 'tax_withholding_decision_snapshot')
),
reward_snapshots AS (
  SELECT
    event_id,
    ordinality,
    payout_row,
    member_id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'decided_at', decided_at,
        'decided_by', decided_by,
        'classification_id_used', id,
        'contract_type', contract_type,
        'tax_withholding_category', tax_withholding_category,
        'custom_withholding_rate', custom_withholding_rate,
        'classification_check_results', classification_check_results,
        'invoice_registration_status', invoice_registration_status,
        'invoice_registration_number', invoice_registration_number,
        'reasoning', format(
          '5項目チェック [%sYES/5]、%s 判定、%s、よって %s',
          (
            SELECT COUNT(*)
            FROM jsonb_each_text(classification_check_results) AS checks(key, value)
            WHERE checks.value = 'true'
          ),
          contract_type,
          CASE
            WHEN invoice_registration_status = 'registered'
              THEN format('適格請求書登録あり (%s)', COALESCE(invoice_registration_number, '番号未設定'))
            ELSE invoice_registration_status
          END,
          CASE
            WHEN tax_withholding_category = 'none'
              THEN '源泉徴収対象外 (所基通204関連、限定列挙非該当)'
            ELSE format('源泉徴収対象 (%s)', tax_withholding_category)
          END
        )
      )
    ) AS snapshot
  FROM reward_member_rows
),
reward_aggregates AS (
  SELECT
    event_id,
    jsonb_agg(payout_row || jsonb_build_object('tax_withholding_decision_snapshot', snapshot) ORDER BY ordinality) AS member_payouts,
    jsonb_agg(jsonb_build_object('member_id', member_id, 'snapshot', snapshot) ORDER BY ordinality) AS member_snapshots,
    COUNT(*) AS snapshot_count
  FROM reward_snapshots
  GROUP BY event_id
)
UPDATE public.ledger_events AS event
SET payload =
  jsonb_set(
    jsonb_set(
      event.payload,
      '{member_payouts}',
      reward_aggregates.member_payouts,
      true
    ),
    '{tax_withholding_decision_snapshots}',
    reward_aggregates.member_snapshots,
    true
  )
  || jsonb_build_object(
    'tax_withholding_decision_snapshot',
    CASE
      WHEN reward_aggregates.snapshot_count = 1 THEN reward_aggregates.member_snapshots -> 0 -> 'snapshot'
      ELSE jsonb_build_object('scope', 'multi_member', 'member_snapshots', reward_aggregates.member_snapshots)
    END
  )
FROM reward_aggregates
WHERE event.id = reward_aggregates.event_id;

ALTER TABLE public.ledger_events
  DROP CONSTRAINT IF EXISTS ledger_events_withholding_snapshot_required;

ALTER TABLE public.ledger_events
  ADD CONSTRAINT ledger_events_withholding_snapshot_required
  CHECK (
    event_type NOT IN (
      'reward_calculated',
      'reward_adjusted',
      'payout.executed',
      'reward.dispute_correction.reversal',
      'reward.dispute_correction.adjustment'
    )
    OR (
      payload ? 'tax_withholding_decision_snapshot'
      AND jsonb_typeof(payload -> 'tax_withholding_decision_snapshot') = 'object'
      AND (
        payload -> 'tax_withholding_decision_snapshot' ? 'classification_id_used'
        OR (
          payload -> 'tax_withholding_decision_snapshot' ->> 'scope' = 'multi_member'
          AND jsonb_typeof(payload -> 'tax_withholding_decision_snapshot' -> 'member_snapshots') = 'array'
        )
      )
    )
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_ledger_events_withholding_snapshot_classification
  ON public.ledger_events ((payload -> 'tax_withholding_decision_snapshot' ->> 'classification_id_used'))
  WHERE event_type IN (
    'reward_calculated',
    'reward_adjusted',
    'payout.executed',
    'reward.dispute_correction.reversal',
    'reward.dispute_correction.adjustment'
  );

CREATE OR REPLACE VIEW public.v_withholding_decisions_audit
WITH (security_invoker = true)
AS
WITH direct_snapshots AS (
  SELECT
    event.id AS event_id,
    event.event_type,
    event.org_id,
    event.created_at,
    event.proposal_id,
    COALESCE(
      event.payload ->> 'member_id',
      event.payload ->> 'reward_member_id',
      event.payload ->> 'target_member_id'
    ) AS member_id,
    COALESCE(
      event.payload ->> 'month',
      event.payload ->> 'target_month',
      event.payload ->> 'correction_month',
      left(event.created_at::text, 7)
    ) AS period_month,
    event.payload -> 'tax_withholding_decision_snapshot' AS snapshot
  FROM public.ledger_events AS event
  WHERE event.event_type IN (
      'reward_calculated',
      'reward_adjusted',
      'payout.executed',
      'reward.dispute_correction.reversal',
      'reward.dispute_correction.adjustment'
    )
    AND event.payload ? 'tax_withholding_decision_snapshot'
    AND event.payload -> 'tax_withholding_decision_snapshot' ? 'classification_id_used'
),
member_snapshots AS (
  SELECT
    event.id AS event_id,
    event.event_type,
    event.org_id,
    event.created_at,
    event.proposal_id,
    snapshot_row.row ->> 'member_id' AS member_id,
    COALESCE(
      event.payload ->> 'month',
      event.payload ->> 'target_month',
      event.payload ->> 'correction_month',
      left(event.created_at::text, 7)
    ) AS period_month,
    snapshot_row.row -> 'snapshot' AS snapshot
  FROM public.ledger_events AS event
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(
      event.payload -> 'tax_withholding_decision_snapshots',
      event.payload -> 'tax_withholding_decision_snapshot' -> 'member_snapshots',
      '[]'::jsonb
    )
  ) AS snapshot_row(row)
  WHERE event.event_type IN (
      'reward_calculated',
      'reward_adjusted',
      'payout.executed',
      'reward.dispute_correction.reversal',
      'reward.dispute_correction.adjustment'
    )
)
SELECT
  expanded.event_id,
  expanded.event_type,
  expanded.org_id,
  expanded.created_at,
  expanded.proposal_id,
  expanded.member_id,
  expanded.period_month,
  expanded.snapshot,
  expanded.snapshot ->> 'decided_by' AS decided_by,
  expanded.snapshot ->> 'classification_id_used' AS classification_id,
  expanded.snapshot ->> 'contract_type' AS contract_type,
  expanded.snapshot ->> 'tax_withholding_category' AS withholding_category,
  expanded.snapshot ->> 'invoice_registration_status' AS invoice_registration_status,
  expanded.snapshot ->> 'reasoning' AS reasoning
FROM (
  SELECT * FROM direct_snapshots
  UNION ALL
  SELECT * FROM member_snapshots
) AS expanded
WHERE expanded.snapshot ? 'classification_id_used';

GRANT SELECT ON public.v_withholding_decisions_audit TO authenticated;

COMMENT ON VIEW public.v_withholding_decisions_audit IS
  'PR-34 immutable source for tax withholding decisions captured in ledger event payloads. Uses security_invoker so ledger_events RLS remains effective.';

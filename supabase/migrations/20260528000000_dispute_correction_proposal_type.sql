-- PR-22: reward.dispute_correction Proposal type.
-- Past-month corrections are append-only: reversal event + adjustment event.

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
        'payout.scheduled',
        'payout.executed',
        'reward.calculate',
        'reward.adjust',
        'reward.dispute_correction',
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
        'profile.view_request',
        'member.classification.update',
        'recurring_expense.create',
        'recurring_expense.update',
        'recurring_expense.end',
        'luqo.catalog.add',
        'luqo.star.achieve',
        'luqo.score.update',
        'luqo.reward.calculate'
      ]::text[]
    )
  );

ALTER TABLE public.ledger_events DROP CONSTRAINT IF EXISTS ledger_events_event_type_check;
ALTER TABLE public.ledger_events
  ADD CONSTRAINT ledger_events_event_type_check
  CHECK (
    event_type = ANY (
      ARRAY[
        'expense_recorded',
        'expense_voided',
        'income_recorded',
        'invoice_issued',
        'invoice_sent',
        'payment_received',
        'reward_calculated',
        'reward_adjusted',
        'skill_achieved',
        'skill_revoked',
        'evaluation_finalized',
        'assignment.scheduled',
        'assignment.rescheduled',
        'assignment.cancelled',
        'leave.recorded',
        'communication.review_recorded',
        'communication.task_recorded',
        'task.revision_requested',
        'site.created',
        'internal_transfer',
        'reward.calculate',
        'reward.adjust',
        'reward.dispute_correction.reversal',
        'reward.dispute_correction.adjustment',
        'reward.pool.adjust',
        'payout.scheduled',
        'payout.executed',
        'expense.create',
        'invoice.create',
        'invoice.member_issue',
        'cash_receipt.record',
        'payment.record',
        'payment.allocate',
        'recurring_expense.create'
      ]::text[]
    )
  );

WITH event_types AS (
  SELECT ARRAY[
    'reward.dispute_correction.reversal',
    'reward.dispute_correction.adjustment'
  ]::text[] AS values
)
UPDATE public.tax_account_mappings AS mapping
SET applicable_proposal_types = (
  SELECT array_agg(DISTINCT value ORDER BY value)
  FROM unnest(mapping.applicable_proposal_types || event_types.values) AS value
)
FROM event_types
WHERE mapping.effective_until IS NULL
  AND mapping.display_label IN ('報酬の素', '手当', '立替戻し', '普通預金')
  AND NOT (event_types.values <@ mapping.applicable_proposal_types);

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
  is_active,
  approval_mode
)
SELECT
  org.id,
  'reward_dispute_correction_random_one',
  'Self-filed payout/reward dispute corrections require one random human reviewer and append reversal/adjustment ledger events.',
  'reward.dispute_correction',
  '[]'::jsonb,
  '[{"type":"any_member","count":1}]'::jsonb,
  1,
  false,
  false,
  142,
  true,
  'random_one'
FROM public.organizations AS org
WHERE NOT EXISTS (
  SELECT 1
  FROM public.policies AS existing
  WHERE existing.org_id = org.id
    AND existing.name = 'reward_dispute_correction_random_one'
    AND existing.proposal_type = 'reward.dispute_correction'
);

CREATE INDEX IF NOT EXISTS proposals_dispute_correction_query_idx
  ON public.proposals (
    org_id,
    status,
    ((payload ->> 'month')),
    ((payload ->> 'target_member_id')),
    ((payload ->> 'reward_member_id')),
    created_at DESC
  )
  WHERE type = 'reward.dispute_correction';

CREATE OR REPLACE VIEW public.v_dispute_corrections
WITH (security_invoker = true)
AS
SELECT
  p.id AS proposal_id,
  p.org_id,
  p.status,
  p.description,
  p.created_by,
  p.payload ->> 'month' AS month,
  p.payload ->> 'target_member_id' AS target_member_id,
  p.payload ->> 'reward_member_id' AS reward_member_id,
  p.payload ->> 'correction_kind' AS correction_kind,
  NULLIF(p.payload ->> 'from_amount', '')::numeric AS from_amount,
  NULLIF(p.payload ->> 'to_amount', '')::numeric AS to_amount,
  NULLIF(p.payload ->> 'delta_amount', '')::numeric AS delta_amount,
  p.payload ->> 'reason' AS reason,
  p.payload -> 'evidence_document_ids' AS evidence_document_ids,
  p.assigned_reviewer_id,
  p.assigned_at,
  p.result_event_id,
  p.created_at,
  p.executed_at
FROM public.proposals AS p
WHERE p.type = 'reward.dispute_correction';

GRANT SELECT ON public.v_dispute_corrections TO authenticated;

COMMENT ON VIEW public.v_dispute_corrections IS
  'Read model for reward.dispute_correction proposals. Uses security_invoker so proposal RLS remains effective.';

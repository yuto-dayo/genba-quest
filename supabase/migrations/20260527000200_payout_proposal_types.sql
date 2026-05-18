-- PR-21: payout.scheduled / payout.executed Proposal types and policies.

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
  ('2150', '預り金', 'liability', NULL, true, 215, 'PR-21 withholding payable for payout execution')
ON CONFLICT (code) DO NOTHING;

UPDATE public.tax_account_mappings
SET applicable_proposal_types = (
  SELECT array_agg(DISTINCT value ORDER BY value)
  FROM unnest(applicable_proposal_types || ARRAY['payout.executed']::text[]) AS value
)
WHERE display_label = '立替の持越し'
  AND NOT ('payout.executed' = ANY(applicable_proposal_types));

WITH creator AS (
  SELECT org.id AS org_id, membership.user_id
  FROM public.organizations AS org
  JOIN LATERAL (
    SELECT m.user_id
    FROM public.org_memberships AS m
    WHERE m.org_id = org.id
      AND m.status = 'active'
    ORDER BY (m.role = 'admin') DESC, m.joined_at NULLS LAST, m.created_at
    LIMIT 1
  ) AS membership ON true
)
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
  creator.org_id,
  '預り金',
  '2150',
  '預り金',
  'liability',
  ARRAY['payout.executed']::text[],
  '2026-01-01'::date,
  creator.user_id
FROM creator
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tax_account_mappings AS existing
  WHERE existing.org_id = creator.org_id
    AND existing.display_label = '預り金'
    AND existing.effective_until IS NULL
);

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
  'payout_scheduled_system_auto',
  'System-created payout.scheduled proposals execute immediately to persist N allocation rows.',
  'payout.scheduled',
  '[]'::jsonb,
  '[]'::jsonb,
  0,
  true,
  false,
  130,
  true,
  'random_one'
FROM public.organizations AS org
WHERE NOT EXISTS (
  SELECT 1
  FROM public.policies AS existing
  WHERE existing.org_id = org.id
    AND existing.name = 'payout_scheduled_system_auto'
    AND existing.proposal_type = 'payout.scheduled'
);

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
  'payout_executed_admin_approval',
  'payout.executed requires one admin approval and posts the payout ledger entry.',
  'payout.executed',
  '[]'::jsonb,
  '[{"type":"role","role":"admin","value":"admin","count":1}]'::jsonb,
  1,
  false,
  false,
  131,
  true,
  'random_one'
FROM public.organizations AS org
WHERE NOT EXISTS (
  SELECT 1
  FROM public.policies AS existing
  WHERE existing.org_id = org.id
    AND existing.name = 'payout_executed_admin_approval'
    AND existing.proposal_type = 'payout.executed'
);

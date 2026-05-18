-- PR-19: Proposal types and policy seeds for recurring_expenses.

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
        'reward.pool.adjust',
        'payout.scheduled',
        'payout.executed',
        'expense.create',
        'invoice.create',
        'invoice.member_issue',
        'cash_receipt.record',
        'payment.record',
        'payment.allocate',
        'recurring_expense.create',
        'recurring_expense.update',
        'recurring_expense.end'
      ]::text[]
    )
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
  policy.name,
  policy.description,
  policy.proposal_type,
  '[]'::jsonb,
  '[{"type":"role","role":"admin","value":"admin","count":1}]'::jsonb,
  1,
  false,
  false,
  85,
  true,
  'random_one'
FROM public.organizations AS org
CROSS JOIN (VALUES
  ('recurring_expense_create_admin_approval', '定期立替の登録は admin 1名承認。AI承認不可。', 'recurring_expense.create'),
  ('recurring_expense_update_admin_approval', '定期立替の変更は admin 1名承認。AI承認不可。', 'recurring_expense.update'),
  ('recurring_expense_end_admin_approval', '定期立替の終了は admin 1名承認。AI承認不可。', 'recurring_expense.end')
) AS policy(name, description, proposal_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.policies AS existing
  WHERE existing.org_id = org.id
    AND existing.proposal_type = policy.proposal_type
    AND existing.name = policy.name
);

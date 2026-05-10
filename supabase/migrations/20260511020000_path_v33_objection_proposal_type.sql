-- PATH V3.3 Phase 4: register the level.objection proposal type so peer-review
-- objections can be tracked alongside other governance proposals.
-- The objection content itself lives in level_objections (added in Phase 1).
-- The Proposal is a thin wrapper that references the objection_id in its payload.

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

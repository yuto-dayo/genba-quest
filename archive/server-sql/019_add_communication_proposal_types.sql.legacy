-- ============================================================
-- Add communication proposal types
-- ============================================================
-- 目的:
-- 1) Gmail本文由来の確認・タスク提案を Proposal として記録する
-- 2) 指示(再提案リクエスト)を Proposal として記録する
-- ============================================================

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_type_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_type_check
  CHECK (type IN (
    -- 経費・売上
    'expense.create',
    'expense.update',
    'expense.void',
    'income.create',
    'income.update',
    -- 請求
    'invoice.create',
    'invoice.send',
    'invoice.mark_paid',
    -- 報酬
    'reward.calculate',
    'reward.adjust',
    -- スキル・評価
    'skill.achieve',
    'skill.revoke',
    'evaluation.submit',
    'evaluation.finalize',
    -- アサイン
    'assignment.create',
    'assignment.update',
    'assignment.cancel',
    -- コミュニケーション
    'communication.review',
    'communication.task',
    'task.revision.request',
    -- 現場
    'site.create',
    'site.complete',
    -- ポリシー
    'policy.update'
  ));

COMMENT ON COLUMN public.proposals.type IS
  '提案種別（会計・現場・コミュニケーション含む）';

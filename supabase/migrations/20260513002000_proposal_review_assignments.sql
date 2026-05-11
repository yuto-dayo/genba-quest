-- 承認担当のランダム割当 + 全員承認モード基盤
-- ============================================================
-- 共謀防止のため、確認が必要な Proposal は資格者プールからランダム1人
-- (random_one) または全員 (all_members) に割り当てる仕組みの基盤。
-- このマイグレーションは構造のみ。assignment ロジックは ProposalAssignmentService、
-- 全員承認モードの集計ロジックは PR #4 で。

-- 1. proposals に割当カラム追加
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS assigned_reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS reassignment_count smallint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS proposals_assigned_reviewer_id_idx
  ON public.proposals (assigned_reviewer_id)
  WHERE assigned_reviewer_id IS NOT NULL AND status = 'pending';

COMMENT ON COLUMN public.proposals.assigned_reviewer_id IS
  'random_one モード時の現在の割当先。pending 中のみ有効、approved/rejected 後は NULL のまま参照';
COMMENT ON COLUMN public.proposals.assigned_at IS
  '割当日時。reassign 時は最新の割当日時に更新';
COMMENT ON COLUMN public.proposals.reassignment_count IS
  '再割当回数 (初期割当=0, 1回目の reassign で 1)';

-- 2. policies に承認モード追加
ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS approval_mode text NOT NULL DEFAULT 'random_one';

ALTER TABLE public.policies
  DROP CONSTRAINT IF EXISTS policies_approval_mode_check;
ALTER TABLE public.policies
  ADD CONSTRAINT policies_approval_mode_check
  CHECK (approval_mode IN ('random_one', 'all_members', 'majority'));

COMMENT ON COLUMN public.policies.approval_mode IS
  'random_one: 資格者プールから1人ランダム割当 / all_members: チーム全員承認必須 / majority: 過半数 (PR #4 以降)';

-- 3. proposal_review_assignments: 割当の監査履歴
CREATE TABLE IF NOT EXISTS public.proposal_review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  is_active boolean NOT NULL DEFAULT true,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposal_review_assignments_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('approved', 'rejected', 'reassigned', 'expired')),
  CONSTRAINT proposal_review_assignments_resolved_consistency_check
    CHECK (
      (resolved_at IS NULL AND resolution IS NULL AND is_active = true) OR
      (resolved_at IS NOT NULL AND resolution IS NOT NULL AND is_active = false)
    )
);

CREATE INDEX IF NOT EXISTS proposal_review_assignments_proposal_idx
  ON public.proposal_review_assignments (proposal_id);
CREATE INDEX IF NOT EXISTS proposal_review_assignments_assigned_to_active_idx
  ON public.proposal_review_assignments (assigned_to)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS proposal_review_assignments_org_id_idx
  ON public.proposal_review_assignments (org_id);

ALTER TABLE public.proposal_review_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read Proposal Review Assignments"
  ON public.proposal_review_assignments FOR SELECT TO authenticated
  USING (private.is_active_member(org_id));
-- INSERT/UPDATE/DELETE は service_role 経由のみ（履歴改変を防ぐ）

COMMENT ON TABLE public.proposal_review_assignments IS
  '承認担当割当の監査履歴。再割当も追跡可能 (resolution=reassigned で旧レコードを閉じ、新レコード追加)';
COMMENT ON COLUMN public.proposal_review_assignments.resolution IS
  'approved: 承認した / rejected: 却下した / reassigned: 別の人に回された / expired: 期限切れで自動再割当';
COMMENT ON COLUMN public.proposal_review_assignments.is_active IS
  '現在も生きている割当か。同一 proposal で is_active=true は最大1件 (random_one) または N件 (all_members)';

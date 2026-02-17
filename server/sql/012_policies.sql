-- ============================================================
-- GENBA QUEST - Policy System
-- ============================================================
-- DAO設計原則: 承認ルールはポリシーとして外部化
-- 参照: docs/PROPOSAL_SYSTEM.md, docs/DESIGN_PHILOSOPHY.md
-- ============================================================

-- ============================================================
-- 1. policies テーブル（承認ルール定義）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  -- ポリシー識別
  name text NOT NULL,
  description text,

  -- 対象Proposal種別（NULLの場合は全種別に適用）
  proposal_type text,

  -- 適用条件（JSONルール）
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 例: [{ "field": "payload.amount", "operator": "gt", "value": 30000 }]

  -- 承認要件
  required_approvers jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 例: [{ "type": "role", "value": "manager" }, { "type": "any_member" }]

  required_count integer NOT NULL DEFAULT 1,  -- 必要承認数
  auto_approve boolean NOT NULL DEFAULT false,  -- 自動承認フラグ

  -- AI承認可否
  ai_can_approve boolean NOT NULL DEFAULT false,

  -- 優先度（高い方が優先）
  priority integer NOT NULL DEFAULT 0,

  -- 有効フラグ
  is_active boolean NOT NULL DEFAULT true,

  -- タイムスタンプ
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS policies_org_type_idx
  ON policies (org_id, proposal_type, priority DESC);
CREATE INDEX IF NOT EXISTS policies_active_idx
  ON policies (is_active) WHERE is_active = true;

-- ============================================================
-- 2. RLS設定
-- ============================================================

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Policies" ON policies;
CREATE POLICY "Read Policies"
ON policies FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Manage Policies" ON policies;
CREATE POLICY "Manage Policies"
ON policies FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'manager')
  )
);

-- ============================================================
-- 3. トリガー
-- ============================================================

DROP TRIGGER IF EXISTS policies_set_updated_at ON public.policies;
CREATE TRIGGER policies_set_updated_at
BEFORE UPDATE ON public.policies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. デフォルトポリシー投入
-- ============================================================

-- 既存のポリシーを削除して再投入（べき等性）
DELETE FROM policies WHERE name LIKE 'default_%';

-- 経費: 5,000円以下は自動承認
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_expense_auto_approve',
  '5,000円以下の経費は自動承認',
  'expense.create',
  '[{"field": "payload.amount", "operator": "lte", "value": 5000}]'::jsonb,
  '[]'::jsonb,
  0,
  true,
  false,
  100
);

-- 経費: 5,001〜30,000円は1名承認（AI可）
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_expense_single_approval',
  '5,001〜30,000円の経費は1名承認（AI可）',
  'expense.create',
  '[{"field": "payload.amount", "operator": "gt", "value": 5000}, {"field": "payload.amount", "operator": "lte", "value": 30000}]'::jsonb,
  '[{"type": "any_member"}]'::jsonb,
  1,
  false,
  true,
  90
);

-- 経費: 30,000円超は2名承認（AI不可）
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_expense_double_approval',
  '30,000円超の経費は2名承認（AI不可）',
  'expense.create',
  '[{"field": "payload.amount", "operator": "gt", "value": 30000}]'::jsonb,
  '[{"type": "any_member"}, {"type": "any_member"}]'::jsonb,
  2,
  false,
  false,
  80
);

-- 売上: 自動承認
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_income_auto_approve',
  '売上登録は自動承認',
  'income.create',
  '[]'::jsonb,
  '[]'::jsonb,
  0,
  true,
  false,
  100
);

-- 報酬計算: 全員確認
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_reward_all_confirm',
  '報酬計算は全員確認が必要',
  'reward.calculate',
  '[]'::jsonb,
  '[{"type": "all_members"}]'::jsonb,
  0,  -- 0は「全員」を意味
  false,
  false,
  100
);

-- スキル達成: 熟練者承認
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_skill_expert_approval',
  'スキル達成は熟練者が承認',
  'skill.achieve',
  '[]'::jsonb,
  '[{"type": "role", "value": "expert"}]'::jsonb,
  1,
  false,
  false,
  100
);

-- AI提案アサイン: 人間承認必須
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_assignment_ai_proposed',
  'AI提案のアサインは人間承認必須',
  'assignment.create',
  '[{"field": "created_by.type", "operator": "eq", "value": "ai"}]'::jsonb,
  '[{"type": "any_member"}]'::jsonb,
  1,
  false,
  false,
  100
);

-- 人間作成アサイン: 自動承認
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_assignment_human_created',
  '人間作成のアサインは自動承認',
  'assignment.create',
  '[{"field": "created_by.type", "operator": "eq", "value": "human"}]'::jsonb,
  '[]'::jsonb,
  0,
  true,
  false,
  90
);

-- ポリシー変更: 全員合意
INSERT INTO policies (name, description, proposal_type, conditions, required_approvers, required_count, auto_approve, ai_can_approve, priority)
VALUES (
  'default_policy_update_consensus',
  'ポリシー変更は全員合意が必要',
  'policy.update',
  '[]'::jsonb,
  '[{"type": "all_members"}]'::jsonb,
  0,
  false,
  false,
  100
);

-- ============================================================
-- 5. コメント
-- ============================================================

COMMENT ON TABLE policies IS '承認ポリシー定義テーブル';
COMMENT ON COLUMN policies.conditions IS '適用条件: [{ field, operator, value }]';
COMMENT ON COLUMN policies.required_approvers IS '承認者要件: [{ type: role|specific|any_member|all_members|ai, value? }]';
COMMENT ON COLUMN policies.ai_can_approve IS 'AIが承認可能か（falseの場合、人間のみ承認可）';
COMMENT ON COLUMN policies.priority IS '優先度（高い方が優先適用）';

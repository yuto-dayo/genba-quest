-- ============================================================
-- GENBA QUEST - バッジシステム（シンプル3段階制）
-- ============================================================

-- バッジ状態 (ユーザーごと)
-- badges: { "cross": "gold", "floor": "silver", ... }
CREATE TABLE IF NOT EXISTS public.badge_states (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  badges jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

-- バッジ申請
CREATE TABLE IF NOT EXISTS public.badge_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid REFERENCES auth.users(id) NOT NULL,
  badge_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('bronze', 'silver', 'gold')),
  reason text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now()
);

-- バッジ申請投票
CREATE TABLE IF NOT EXISTS public.badge_application_votes (
  application_id uuid REFERENCES badge_applications(id) ON DELETE CASCADE,
  voter_id uuid REFERENCES auth.users(id),
  vote text NOT NULL CHECK (vote IN ('approve', 'reject')),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (application_id, voter_id)
);

-- ============================================================
-- バッジシステム RLS
-- ============================================================

ALTER TABLE badge_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge_application_votes ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除（存在する場合）
DROP POLICY IF EXISTS "Read Badge States" ON badge_states;
DROP POLICY IF EXISTS "Upsert Badge States" ON badge_states;
DROP POLICY IF EXISTS "Update Badge States" ON badge_states;
DROP POLICY IF EXISTS "Read Badge Applications" ON badge_applications;
DROP POLICY IF EXISTS "Insert Badge Applications" ON badge_applications;
DROP POLICY IF EXISTS "Update Badge Applications" ON badge_applications;
DROP POLICY IF EXISTS "Read Badge Votes" ON badge_application_votes;
DROP POLICY IF EXISTS "Insert Badge Votes" ON badge_application_votes;

-- Badge States: 全員読み取り可
CREATE POLICY "Read Badge States" ON badge_states FOR SELECT TO authenticated USING (true);
CREATE POLICY "Upsert Badge States" ON badge_states FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Update Badge States" ON badge_states FOR UPDATE TO authenticated USING (true);

-- Badge Applications: 全員読み取り・自分のみ作成可
CREATE POLICY "Read Badge Applications" ON badge_applications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Badge Applications" ON badge_applications FOR INSERT TO authenticated WITH CHECK (auth.uid() = applicant_id);
CREATE POLICY "Update Badge Applications" ON badge_applications FOR UPDATE TO authenticated USING (true);

-- Badge Votes: 全員読み取り・自分のみ投票可
CREATE POLICY "Read Badge Votes" ON badge_application_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Badge Votes" ON badge_application_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = voter_id);

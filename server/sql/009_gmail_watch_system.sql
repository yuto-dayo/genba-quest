-- ============================================================
-- GENBA QUEST - Gmail監視システム (Phase 0)
-- ============================================================

-- ------------------------------------------------------------
-- 1. personal_schedules - スケジュール照会用
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.personal_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('vacation', 'sick_leave', 'business_trip', 'training')),
  reason text,
  approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_schedules_user_date_idx
ON personal_schedules (user_id, start_date, end_date);

-- RLS設定
ALTER TABLE personal_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Own Schedules" ON personal_schedules;
DROP POLICY IF EXISTS "Insert Own Schedules" ON personal_schedules;
DROP POLICY IF EXISTS "Update Own Schedules" ON personal_schedules;

CREATE POLICY "Read Own Schedules"
ON personal_schedules FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Insert Own Schedules"
ON personal_schedules FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update Own Schedules"
ON personal_schedules FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. notifications - 通知システム
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'auto_quest',
    'approval_required',
    'approval_result',
    'schedule_conflict',
    'system_alert'
  )),
  title text NOT NULL,
  message text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_read_idx
ON notifications (user_id, read, created_at DESC);

-- RLS設定
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Own Notifications" ON notifications;
DROP POLICY IF EXISTS "Update Own Notifications" ON notifications;

CREATE POLICY "Read Own Notifications"
ON notifications FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Update Own Notifications"
ON notifications FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. system_config - システム設定（Gmail historyId等）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

-- RLS設定（管理者のみ）
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins Read Config" ON system_config;
DROP POLICY IF EXISTS "Admins Write Config" ON system_config;

CREATE POLICY "Admins Read Config"
ON system_config FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'manager')
  )
);

CREATE POLICY "Admins Write Config"
ON system_config FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- ------------------------------------------------------------
-- 4. feature_flags - 機能フラグ（段階的リリース）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text UNIQUE NOT NULL,
  enabled boolean DEFAULT false,
  description text,
  rollout_percentage integer DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  target_users uuid[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS設定（全員読み取り可、管理者のみ更新可）
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Feature Flags" ON feature_flags;
DROP POLICY IF EXISTS "Admins Write Feature Flags" ON feature_flags;

CREATE POLICY "Read Feature Flags"
ON feature_flags FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins Write Feature Flags"
ON feature_flags FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- ------------------------------------------------------------
-- 5. sites テーブル拡張（工期対応）
-- ------------------------------------------------------------
ALTER TABLE sites
ADD COLUMN IF NOT EXISTS start_date date,
ADD COLUMN IF NOT EXISTS end_date date,
ADD COLUMN IF NOT EXISTS estimated_man_hours numeric DEFAULT 0;

-- スケジュール検索用インデックス
CREATE INDEX IF NOT EXISTS sites_date_range_idx
ON sites (start_date, end_date)
WHERE status IN ('active', 'planned');

-- ------------------------------------------------------------
-- 6. 初期データ投入
-- ------------------------------------------------------------

-- システム設定の初期値
INSERT INTO system_config (key, value, description)
VALUES
  ('gmail_history_id', '0', 'Gmail API履歴ID（差分取得用）'),
  ('gmail_watch_expiration', '', 'Gmail Watch有効期限'),
  ('ocr_enabled', 'false', 'OCR機能有効化フラグ')
ON CONFLICT (key) DO NOTHING;

-- 機能フラグの初期値
INSERT INTO feature_flags (feature_key, enabled, description, rollout_percentage)
VALUES
  ('gmail_auto_quest', false, 'Gmail自動クエスト生成機能', 0),
  ('ocr_processing', false, 'OCR自動処理機能', 0),
  ('schedule_checker', false, 'スケジュール自動照会機能', 0),
  ('unified_approval', false, '統合承認ダッシュボード', 0)
ON CONFLICT (feature_key) DO NOTHING;

-- ------------------------------------------------------------
-- 7. Helper Functions
-- ------------------------------------------------------------

-- ユーザーのスケジュール競合チェック関数
CREATE OR REPLACE FUNCTION check_schedule_conflict(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  conflict_type text,
  conflict_id uuid,
  conflict_name text,
  conflict_start date,
  conflict_end date
) AS $$
BEGIN
  -- 現場アサインとの競合
  RETURN QUERY
  SELECT
    'site_assignment'::text,
    s.id,
    s.name,
    s.start_date,
    s.end_date
  FROM sites s
  WHERE p_user_id = ANY(s.assigned_users)
    AND s.status IN ('active', 'planned')
    AND s.start_date <= p_end_date
    AND s.end_date >= p_start_date;

  -- 個人スケジュールとの競合
  RETURN QUERY
  SELECT
    'personal_schedule'::text,
    ps.id,
    ps.type || ': ' || COALESCE(ps.reason, ''),
    ps.start_date,
    ps.end_date
  FROM personal_schedules ps
  WHERE ps.user_id = p_user_id
    AND ps.approved = true
    AND ps.start_date <= p_end_date
    AND ps.end_date >= p_start_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 機能フラグチェック関数
CREATE OR REPLACE FUNCTION is_feature_enabled(
  p_feature_key text,
  p_user_id uuid DEFAULT NULL
)
RETURNS boolean AS $$
DECLARE
  v_flag feature_flags%ROWTYPE;
BEGIN
  SELECT * INTO v_flag
  FROM feature_flags
  WHERE feature_key = p_feature_key;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 完全無効
  IF NOT v_flag.enabled THEN
    RETURN false;
  END IF;

  -- 特定ユーザー指定
  IF v_flag.target_users IS NOT NULL AND array_length(v_flag.target_users, 1) > 0 THEN
    RETURN p_user_id = ANY(v_flag.target_users);
  END IF;

  -- ロールアウト率によるランダム有効化
  IF v_flag.rollout_percentage = 100 THEN
    RETURN true;
  ELSIF v_flag.rollout_percentage = 0 THEN
    RETURN false;
  ELSE
    -- ユーザーIDのハッシュ値をベースに決定論的に判定
    RETURN (hashtext(p_user_id::text) % 100) < v_flag.rollout_percentage;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE personal_schedules IS '個人スケジュール（休暇・出張など）';
COMMENT ON TABLE notifications IS 'ユーザー通知';
COMMENT ON TABLE system_config IS 'システム設定（Gmail historyId等）';
COMMENT ON TABLE feature_flags IS '機能フラグ（段階的リリース）';
COMMENT ON FUNCTION check_schedule_conflict IS 'ユーザーのスケジュール競合をチェック';
COMMENT ON FUNCTION is_feature_enabled IS '機能フラグの有効状態をチェック';

-- ============================================================
-- profiles テーブルに role カラムを追加（存在しない場合）
-- ============================================================

-- role カラムを追加
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS role text DEFAULT 'member'
  CHECK (role IN ('member', 'leader', 'manager', 'admin'));

-- approval_limit カラムも追加（念のため）
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS approval_limit numeric DEFAULT 50000;

-- コメント
COMMENT ON COLUMN profiles.role IS 'ユーザーロール（member/leader/manager/admin）';
COMMENT ON COLUMN profiles.approval_limit IS '承認権限上限金額';

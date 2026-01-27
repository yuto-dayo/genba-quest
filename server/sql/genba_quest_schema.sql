-- ============================================================
-- GENBA QUEST - Supabase スキーマ定義
-- 既存のLUQOスキーマを拡張
-- ============================================================

-- 現場 (Sites / Dungeons)
CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  area_sqm numeric,
  work_types text[],
  estimated_hours numeric,
  actual_hours numeric DEFAULT 0,
  revenue numeric DEFAULT 0,
  status text DEFAULT 'active',
  client_id uuid REFERENCES clients(id),
  assigned_users uuid[],
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS sites_status_idx ON sites (status);
CREATE INDEX IF NOT EXISTS sites_client_idx ON sites (client_id);

-- スタミナ・休暇 (profiles拡張)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stamina integer DEFAULT 100;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS current_site_id uuid REFERENCES sites(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS holiday_days integer DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS holiday_target integer DEFAULT 120;

-- パーク定義
CREATE TABLE IF NOT EXISTS public.perk_definitions (
  id text PRIMARY KEY,
  category text NOT NULL,
  label text NOT NULL,
  percentage numeric NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz DEFAULT now()
);

-- パーク状態 (ユーザーごと)
CREATE TABLE IF NOT EXISTS public.perk_states (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  state jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

-- パーク申請
CREATE TABLE IF NOT EXISTS public.perk_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid REFERENCES auth.users(id) NOT NULL,
  perk_id text REFERENCES perk_definitions(id) NOT NULL,
  reason text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- パーク申請投票
CREATE TABLE IF NOT EXISTS public.perk_application_votes (
  application_id uuid REFERENCES perk_applications(id) ON DELETE CASCADE,
  voter_id uuid REFERENCES auth.users(id),
  vote text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (application_id, voter_id)
);

-- ============================================================
-- RLS設定
-- ============================================================

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE perk_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE perk_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE perk_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE perk_application_votes ENABLE ROW LEVEL SECURITY;

-- Sites: 全員読み取り可（チーム内共有）
CREATE POLICY "Read Sites" ON sites FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Sites" ON sites FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Update Sites" ON sites FOR UPDATE TO authenticated USING (true);

-- Perk Definitions: 全員読み取り可
CREATE POLICY "Read Perk Definitions" ON perk_definitions FOR SELECT TO authenticated USING (true);

-- Perk States: 全員読み取り可
CREATE POLICY "Read Perk States" ON perk_states FOR SELECT TO authenticated USING (true);

-- Perk Applications: 全員読み取り・自分のみ作成可
CREATE POLICY "Read Perk Applications" ON perk_applications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Perk Applications" ON perk_applications FOR INSERT TO authenticated WITH CHECK (auth.uid() = applicant_id);

-- Perk Votes: 全員読み取り・自分のみ投票可
CREATE POLICY "Read Perk Votes" ON perk_application_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Perk Votes" ON perk_application_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = voter_id);

-- ============================================================
-- 初期データ: パーク定義
-- ============================================================

-- クロス（壁紙）パーク
INSERT INTO perk_definitions (id, category, label, percentage, description) VALUES
  ('cross_basic', 'クロス', '基本施工', 0, '基本的なクロス貼り'),
  ('cross_ceiling', 'クロス', '天井貼り', 2, '天井クロスの施工'),
  ('cross_joint', 'クロス', 'ジョイント処理', 3, '突き付け/重ね切り'),
  ('cross_pattern', 'クロス', '柄合わせ', 3, 'リピート柄の正確な合わせ'),
  ('cross_speed_50', 'クロス', '50㎡/日', 5, '1日50㎡以上の施工'),
  ('cross_speed_75', 'クロス', '75㎡/日', 8, '1日75㎡以上の施工'),
  ('cross_speed_100', 'クロス', '100㎡/日', 12, '1日100㎡以上の施工'),
  ('cross_solo_3f', 'クロス', '3階建て単独', 10, '3階建てを一人で完全施工')
ON CONFLICT (id) DO NOTHING;

-- 床パーク
INSERT INTO perk_definitions (id, category, label, percentage, description) VALUES
  ('floor_basic', '床', '基本施工', 0, '基本的な床材施工'),
  ('floor_cf', '床', 'CF施工', 2, 'クッションフロア'),
  ('floor_tile', '床', 'タイル施工', 3, 'フロアタイル'),
  ('floor_pattern', '床', '柄合わせ', 3, '木目方向・リピート管理'),
  ('floor_stairs', '床', '階段施工', 5, '階段の床材施工')
ON CONFLICT (id) DO NOTHING;

-- ダイノック（化粧シート）パーク
INSERT INTO perk_definitions (id, category, label, percentage, description) VALUES
  ('dynoc_basic', 'ダイノック', '基本施工', 0, '基本的なダイノック貼り'),
  ('dynoc_door', 'ダイノック', 'ドア施工', 3, 'ドア面材の施工'),
  ('dynoc_curve', 'ダイノック', '曲面施工', 5, '曲面・R部への施工'),
  ('dynoc_elevator', 'ダイノック', 'エレベーター', 8, 'エレベーター内装')
ON CONFLICT (id) DO NOTHING;

-- 共通パーク
INSERT INTO perk_definitions (id, category, label, percentage, description) VALUES
  ('common_safety', '共通', '安全管理', 1, '安全・衛生管理'),
  ('common_cleanup', '共通', '清掃・養生', 1, '作業後の清掃と養生'),
  ('common_communication', '共通', '報連相', 2, '的確な報告・連絡・相談'),
  ('common_leadership', '共通', 'チームリード', 5, 'チームのまとめ役')
ON CONFLICT (id) DO NOTHING;

-- エクストラパーク
INSERT INTO perk_definitions (id, category, label, percentage, description) VALUES
  ('extra_night', 'エクストラ', '夜間作業', 3, '夜間・深夜作業対応'),
  ('extra_emergency', 'エクストラ', '緊急対応', 5, '緊急呼び出し対応'),
  ('extra_training', 'エクストラ', '後輩指導', 3, '新人・後輩への指導')
ON CONFLICT (id) DO NOTHING;

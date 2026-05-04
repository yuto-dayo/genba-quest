-- ============================================================
-- GENBA QUEST - コアテーブル
-- ============================================================

-- クライアント (Clients)
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  created_at timestamptz DEFAULT now()
);

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

-- プロフィール (Profiles - ユーザー拡張)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at timestamptz,
  username text UNIQUE,
  full_name text,
  avatar_url text,

  -- ゲーム要素
  stamina integer DEFAULT 100,
  current_site_id uuid REFERENCES sites(id),
  holiday_days integer DEFAULT 0,
  holiday_target integer DEFAULT 120,

  -- 承認権限（監査対応）
  approval_limit numeric DEFAULT 50000,
  role text DEFAULT 'member'
    CHECK (role IN ('member', 'leader', 'manager', 'admin')),

  CONSTRAINT username_length CHECK (char_length(username) >= 3)
);

-- ============================================================
-- コアテーブル RLS
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除（存在する場合）
DROP POLICY IF EXISTS "Read Profiles" ON profiles;
DROP POLICY IF EXISTS "Update Profiles" ON profiles;
DROP POLICY IF EXISTS "Read Clients" ON clients;
DROP POLICY IF EXISTS "Read Sites" ON sites;
DROP POLICY IF EXISTS "Insert Sites" ON sites;
DROP POLICY IF EXISTS "Update Sites" ON sites;

-- Profiles: 全員読み取り可・自分のみ更新可
CREATE POLICY "Read Profiles" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Update Profiles" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Clients: 全員読み取り可
CREATE POLICY "Read Clients" ON clients FOR SELECT TO authenticated USING (true);

-- Sites: 全員読み取り・作成・更新可
CREATE POLICY "Read Sites" ON sites FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert Sites" ON sites FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Update Sites" ON sites FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- GENBA QUEST - Monster System
-- 現場をモンスター化するゲーミフィケーションシステム
-- ============================================================

-- ============================================================
-- 1. Sites テーブルへのモンスター関連カラム追加
-- ============================================================

ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS monster_name text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS monster_image_url text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS monster_attributes text[];
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS deadline_date date;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS monster_archetype text;

CREATE INDEX IF NOT EXISTS sites_monster_archetype_idx ON sites (monster_archetype);

-- ============================================================
-- 2. Monster Archetypes - モンスターの種族定義
-- ============================================================

CREATE TABLE IF NOT EXISTS public.monster_archetypes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    name_ja text NOT NULL,
    base_prompt text NOT NULL,
    work_types text[] NOT NULL,
    default_attributes text[],
    rarity text DEFAULT 'common' CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
    created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 3. Monster Images - 生成済み画像のキャッシュ
-- ============================================================

CREATE TABLE IF NOT EXISTS public.monster_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    archetype_id uuid REFERENCES public.monster_archetypes(id),
    image_url text NOT NULL,
    storage_path text NOT NULL,
    prompt_used text,
    generation_cost numeric DEFAULT 0.12,
    created_at timestamptz DEFAULT now(),
    UNIQUE(site_id)
);

CREATE INDEX IF NOT EXISTS monster_images_site_idx ON monster_images (site_id);

-- ============================================================
-- 4. Battle Log - バトル（作業）履歴
-- ============================================================

CREATE TABLE IF NOT EXISTS public.battle_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    action_type text NOT NULL CHECK (action_type IN ('attack', 'strategy', 'heal')),
    hours_worked numeric DEFAULT 0,
    damage_dealt numeric DEFAULT 0,
    comment text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS battle_log_site_idx ON battle_log (site_id);
CREATE INDEX IF NOT EXISTS battle_log_user_idx ON battle_log (user_id);
CREATE INDEX IF NOT EXISTS battle_log_created_idx ON battle_log (created_at DESC);

-- ============================================================
-- 5. RLS Policies
-- ============================================================

ALTER TABLE public.monster_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monster_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_log ENABLE ROW LEVEL SECURITY;

-- Monster Archetypes: 全員読み取り可
DROP POLICY IF EXISTS "monster_archetypes_select" ON public.monster_archetypes;
CREATE POLICY "monster_archetypes_select" ON public.monster_archetypes
    FOR SELECT TO authenticated USING (true);

-- Monster Images: 全員読み取り可、認証済みユーザーは作成可
DROP POLICY IF EXISTS "monster_images_select" ON public.monster_images;
CREATE POLICY "monster_images_select" ON public.monster_images
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "monster_images_insert" ON public.monster_images;
CREATE POLICY "monster_images_insert" ON public.monster_images
    FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "monster_images_update" ON public.monster_images;
CREATE POLICY "monster_images_update" ON public.monster_images
    FOR UPDATE TO authenticated USING (true);

-- Battle Log: 全員読み取り可、自分のログのみ作成可
DROP POLICY IF EXISTS "battle_log_select" ON public.battle_log;
CREATE POLICY "battle_log_select" ON public.battle_log
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "battle_log_insert" ON public.battle_log;
CREATE POLICY "battle_log_insert" ON public.battle_log
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 6. Seed Data - モンスターアーキタイプ
-- ============================================================

INSERT INTO public.monster_archetypes (name, name_ja, base_prompt, work_types, default_attributes, rarity)
VALUES
    (
        'RUBBLE_GOLEM',
        '瓦礫ゴーレム',
        'A massive stone golem made of construction rubble and concrete debris, glowing red eyes, dust particles floating around, cracked stone armor, standing in a demolished building site, dark fantasy art style, dramatic lighting, 4K detailed, menacing pose',
        ARRAY['demolition', 'removal', '解体', '撤去', '斫り', '産廃'],
        ARRAY['HARD_ARMOR', 'DUST_ATTACK', 'HEAVY_STRIKE'],
        'common'
    ),
    (
        'INTERIOR_PHANTOM',
        '内装ファントム',
        'A ghostly spectral figure emerging from unfinished walls and ceiling tiles, translucent ethereal body with exposed wiring and cables flowing through it, glowing blue energy, floating above a half-renovated room, dark fantasy art style, dramatic lighting, 4K detailed',
        ARRAY['interior', 'finishing', 'renovation', '内装', '仕上げ', 'リフォーム', '床', 'クロス', 'ボード', '畳', 'カーペット', '壁修繕', 'クリーニング'],
        ARRAY['PHASE_SHIFT', 'WIRE_TRAP', 'CEILING_DROP'],
        'common'
    ),
    (
        'SCAFFOLD_SPIDER',
        '足場スパイダー',
        'A gigantic mechanical spider made of scaffolding pipes and metal joints, eight legs of steel tubes, multiple glowing yellow eyes, welding sparks flying, climbing on a building exterior, dark fantasy art style, dramatic lighting, 4K detailed',
        ARRAY['scaffolding', 'exterior', 'facade', '足場', '外壁', '外装', '養生'],
        ARRAY['WEB_BARRIER', 'HEIGHT_ADVANTAGE', 'METAL_STRIKE'],
        'rare'
    ),
    (
        'PAINT_SLIME',
        '塗装スライム',
        'A large amorphous creature made of dripping paint in multiple vibrant colors, iridescent surface reflecting rainbow hues, paint buckets and brushes embedded in its body, leaving colorful trails, dark fantasy art style, dramatic lighting, 4K detailed',
        ARRAY['painting', 'coating', 'finishing', '塗装', 'コーティング', '防水', 'シーリング'],
        ARRAY['COLOR_BLIND', 'STICKY_TRAP', 'TOXIC_FUMES'],
        'common'
    ),
    (
        'FOUNDATION_TITAN',
        '基礎タイタン',
        'An enormous titan emerging from the earth, body made of concrete foundations and rebar skeleton visible, dirt and rocks falling from its form, standing in an excavation pit, towering height, dark fantasy art style, dramatic lighting, 4K detailed',
        ARRAY['foundation', 'concrete', 'earthwork', 'excavation', '基礎', 'コンクリート', '土工', '左官', '杭工事'],
        ARRAY['EARTHQUAKE', 'IRON_GRIP', 'UNSTOPPABLE'],
        'epic'
    ),
    (
        'ELECTRICAL_WRAITH',
        '電気レイス',
        'A crackling wraith made of electrical wires and sparking conduits, lightning arcing from its spectral form, glowing circuit patterns on its body, floating above electrical panels, dark fantasy art style, dramatic lighting, 4K detailed',
        ARRAY['electrical', 'wiring', 'power', '電気', '配線', '電気工事', '通信', '防災'],
        ARRAY['SHOCK_WAVE', 'SHORT_CIRCUIT', 'POWER_SURGE'],
        'rare'
    ),
    (
        'PLUMBING_HYDRA',
        '配管ヒドラ',
        'A multi-headed serpent creature with three heads made of copper and PVC pipes, water spraying from joints and valves, coiled around bathroom fixtures, rusty scales of pipe fittings, dark fantasy art style, dramatic lighting, 4K detailed',
        ARRAY['plumbing', 'piping', 'water', '配管', '給排水', '水道', '衛生', '空調'],
        ARRAY['WATER_BLAST', 'FLOOD_ZONE', 'CORROSION'],
        'rare'
    ),
    (
        'GENERIC_CONSTRUCT',
        '工事コンストラクト',
        'A humanoid construct made of various construction materials including wood planks, metal beams, and concrete blocks, tools embedded in its body like a hammer hand and saw blade shoulder, hard hat head, standing on a construction site, dark fantasy art style, dramatic lighting, 4K detailed',
        ARRAY['general', 'other', 'mixed', '一般', 'その他', '複合'],
        ARRAY['ADAPT', 'TOOL_SWING', 'MATERIAL_SHIFT'],
        'common'
    )
ON CONFLICT (name) DO UPDATE SET
    name_ja = EXCLUDED.name_ja,
    base_prompt = EXCLUDED.base_prompt,
    work_types = EXCLUDED.work_types,
    default_attributes = EXCLUDED.default_attributes,
    rarity = EXCLUDED.rarity;

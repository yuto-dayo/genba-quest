-- ============================================================
-- GENBA QUEST - Bayesian Design Principles
-- ============================================================
-- Think Again × Thompson Sampling: 設計原則にBeta分布パラメータ(α,β)を持たせ、
-- Proposalの成功/失敗をベイズ更新で確信度に反映する「生きた設計文書」
-- 参照: docs/DESIGN_PHILOSOPHY.md
-- ============================================================

-- ============================================================
-- 1. design_principles テーブル（設計原則 + ベイズパラメータ）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.design_principles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  -- 原則の識別
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'core',           -- 3本柱（Proposal中心、Event志向Ledger、AI Policy従属）
    'policy',         -- 承認ルール・閾値
    'architecture',   -- 技術的設計判断
    'process'         -- 運用プロセス
  )),

  -- ベイズパラメータ（Beta分布）
  -- α = 成功観測数 + 事前, β = 失敗観測数 + 事前
  -- 確信度 = α / (α + β), 不確実性 = αβ / ((α+β)²(α+β+1))
  alpha numeric NOT NULL DEFAULT 1 CHECK (alpha > 0),
  beta numeric NOT NULL DEFAULT 1 CHECK (beta > 0),

  -- ライフサイクル
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active',         -- 現在有効な原則
    'under_review',   -- 確信度低下により再考中
    'superseded'      -- 新しい原則に置き換え済み
  )),
  superseded_by uuid REFERENCES public.design_principles(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(org_id, name)
);

-- ============================================================
-- 2. principle_observations テーブル（観測履歴 = 追記のみLedger）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.principle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principle_id uuid NOT NULL REFERENCES public.design_principles(id),
  proposal_id uuid REFERENCES public.proposals(id),

  -- 観測データ
  outcome boolean NOT NULL,       -- true=原則が機能した, false=問題が発生した
  reason text NOT NULL,           -- 判定理由（監査用）
  observed_by jsonb NOT NULL,     -- ActorRef: { type, id, name }

  -- ベイズ更新のスナップショット（べき等性のため）
  alpha_before numeric NOT NULL,
  beta_before numeric NOT NULL,
  alpha_after numeric NOT NULL,
  beta_after numeric NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_principle_observations_principle_id
  ON public.principle_observations(principle_id);
CREATE INDEX IF NOT EXISTS idx_principle_observations_proposal_id
  ON public.principle_observations(proposal_id);
CREATE INDEX IF NOT EXISTS idx_design_principles_status
  ON public.design_principles(status);

-- ============================================================
-- 3. RLS ポリシー
-- ============================================================

ALTER TABLE public.design_principles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.principle_observations ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーは参照可能
CREATE POLICY "design_principles_select" ON public.design_principles
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "principle_observations_select" ON public.principle_observations
  FOR SELECT TO authenticated
  USING (true);

-- 挿入・更新はservice_roleのみ（自動更新を強制）
CREATE POLICY "design_principles_insert" ON public.design_principles
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY "design_principles_update" ON public.design_principles
  FOR UPDATE TO service_role
  USING (true);

CREATE POLICY "principle_observations_insert" ON public.principle_observations
  FOR INSERT TO service_role
  WITH CHECK (true);

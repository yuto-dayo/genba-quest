-- ============================================================
-- GENBA QUEST - AI提案システム
-- ============================================================

-- AI提案テーブル
CREATE TABLE IF NOT EXISTS public.ai_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_type text NOT NULL CHECK (proposal_type IN (
    'auto_quest',        -- Gmail自動クエスト生成
    'schedule_optimize',  -- スケジュール最適化提案
    'cost_reduction',     -- コスト削減提案
    'risk_alert'          -- リスク警告
  )),

  title text NOT NULL,
  description text NOT NULL,

  -- AI生成データ
  proposal_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_provider text NOT NULL,  -- 'gemini', 'openai', 'anthropic', 'gmail_ocr'
  ai_model text NOT NULL,      -- モデル名
  ai_confidence numeric,       -- 信頼度 (0.0〜1.0)

  -- ステータス
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',    -- 承認待ち
    'approved',   -- 承認済み
    'rejected',   -- 却下
    'expired'     -- 期限切れ
  )),

  -- 承認情報
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_comment text,

  -- 有効期限
  expires_at timestamptz,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS ai_proposals_type_status_idx
  ON ai_proposals (proposal_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_proposals_expires_idx
  ON ai_proposals (expires_at)
  WHERE status = 'pending';

-- RLS設定
ALTER TABLE ai_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read AI Proposals" ON ai_proposals;
DROP POLICY IF EXISTS "Admins Manage AI Proposals" ON ai_proposals;

-- 全員読み取り可
CREATE POLICY "Read AI Proposals"
ON ai_proposals FOR SELECT
TO authenticated
USING (true);

-- 管理者のみ作成・更新可
CREATE POLICY "Admins Manage AI Proposals"
ON ai_proposals FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'manager')
  )
);

-- 更新トリガー
DROP TRIGGER IF EXISTS ai_proposals_set_updated_at ON public.ai_proposals;
CREATE TRIGGER ai_proposals_set_updated_at
BEFORE UPDATE ON public.ai_proposals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- コメント
COMMENT ON TABLE ai_proposals IS 'AI生成提案（自動クエスト生成など）';
COMMENT ON COLUMN ai_proposals.proposal_type IS '提案タイプ';
COMMENT ON COLUMN ai_proposals.proposal_data IS 'AI生成データ（JSON）';
COMMENT ON COLUMN ai_proposals.ai_confidence IS 'AI信頼度（0.0〜1.0）';

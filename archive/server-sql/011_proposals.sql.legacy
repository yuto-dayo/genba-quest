-- ============================================================
-- GENBA QUEST - Proposal & Ledger Events System
-- ============================================================
-- DAO設計原則: 全状態変更はProposal経由で記録し監査可能に
-- 参照: docs/PROPOSAL_SYSTEM.md, docs/DESIGN_PHILOSOPHY.md
-- ============================================================

-- ============================================================
-- 1. proposals テーブル（統一提案管理）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  -- Proposal種別（19タイプ）
  type text NOT NULL CHECK (type IN (
    -- 経費・売上
    'expense.create',
    'expense.update',
    'expense.void',
    'income.create',
    'income.update',
    -- 請求
    'invoice.create',
    'invoice.send',
    'invoice.mark_paid',
    -- 報酬
    'reward.calculate',
    'reward.adjust',
    -- スキル・評価
    'skill.achieve',
    'skill.revoke',
    'evaluation.submit',
    'evaluation.finalize',
    -- アサイン
    'assignment.create',
    'assignment.update',
    'assignment.cancel',
    -- 現場
    'site.create',
    'site.complete',
    -- ポリシー
    'policy.update'
  )),

  -- ライフサイクルステータス
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',      -- 下書き
    'proposed',   -- 提出済み・承認待ち
    'approved',   -- 承認済み
    'rejected',   -- 却下
    'executed'    -- 実行完了
  )),

  -- 作成者情報
  created_by jsonb NOT NULL,  -- { type: 'human'|'ai'|'system', id: uuid, name: string }

  -- Proposal内容
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,

  -- ポリシー参照
  policy_ref text,

  -- 承認情報
  approvals jsonb NOT NULL DEFAULT '[]'::jsonb,  -- Array of { actor, decision, reason, at }
  required_approvals integer NOT NULL DEFAULT 1,

  -- 実行結果
  executed_at timestamptz,
  executed_by jsonb,  -- ActorRef
  result_event_id uuid,  -- 生成されたLedgerEventのID

  -- 却下理由
  rejection_reason text,

  -- タイムスタンプ
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS proposals_org_status_idx
  ON proposals (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS proposals_type_status_idx
  ON proposals (type, status);
CREATE INDEX IF NOT EXISTS proposals_created_by_idx
  ON proposals ((created_by->>'id'));

-- ============================================================
-- 2. ledger_events テーブル（イベントソーシング）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ledger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  -- イベント種別
  event_type text NOT NULL CHECK (event_type IN (
    -- 経費系
    'expense_recorded',
    'expense_voided',
    -- 売上系
    'income_recorded',
    -- 請求系
    'invoice_issued',
    'invoice_sent',
    'payment_received',
    -- 報酬系
    'reward_calculated',
    'reward_adjusted',
    -- 内部振替
    'internal_transfer'
  )),

  -- 元のProposalへの参照
  proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL,

  -- イベントデータ
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 発生者
  actor jsonb NOT NULL,  -- ActorRef

  -- 不変性保証
  created_at timestamptz DEFAULT now() NOT NULL
  -- NOTE: updated_atは意図的になし（イベントは不変）
);

-- インデックス
CREATE INDEX IF NOT EXISTS ledger_events_org_type_idx
  ON ledger_events (org_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_events_proposal_idx
  ON ledger_events (proposal_id);

-- ============================================================
-- 3. ledger_transactions テーブル（仕訳ヘッダー）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  -- イベントへの参照
  event_id uuid NOT NULL REFERENCES ledger_events(id) ON DELETE CASCADE,

  -- 仕訳情報
  transaction_date date NOT NULL,
  description text NOT NULL,

  -- 通貨（将来の多通貨対応用）
  currency text NOT NULL DEFAULT 'JPY',

  -- タイムスタンプ
  created_at timestamptz DEFAULT now() NOT NULL
);

-- インデックス
CREATE INDEX IF NOT EXISTS ledger_transactions_event_idx
  ON ledger_transactions (event_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_date_idx
  ON ledger_transactions (org_id, transaction_date DESC);

-- ============================================================
-- 4. ledger_entries テーブル（仕訳明細行）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 仕訳ヘッダーへの参照
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,

  -- 勘定科目
  account_code text NOT NULL,  -- 将来的にマスタ参照に変更

  -- 借方・貸方（一方のみ値を持つ）
  debit_amount numeric(15, 2) NOT NULL DEFAULT 0,
  credit_amount numeric(15, 2) NOT NULL DEFAULT 0,

  -- 補助情報
  memo text,

  -- 行番号
  line_number integer NOT NULL DEFAULT 1,

  -- タイムスタンプ
  created_at timestamptz DEFAULT now() NOT NULL,

  -- 借方・貸方の片方のみ値を持つ制約
  CONSTRAINT ledger_entries_debit_credit_check
    CHECK (
      (debit_amount > 0 AND credit_amount = 0) OR
      (debit_amount = 0 AND credit_amount > 0)
    )
);

-- インデックス
CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx
  ON ledger_entries (transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
  ON ledger_entries (account_code);

-- ============================================================
-- 5. RLS設定
-- ============================================================

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

-- proposals RLS
DROP POLICY IF EXISTS "Read Proposals" ON proposals;
CREATE POLICY "Read Proposals"
ON proposals FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Create Proposals" ON proposals;
CREATE POLICY "Create Proposals"
ON proposals FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Update Proposals" ON proposals;
CREATE POLICY "Update Proposals"
ON proposals FOR UPDATE
TO authenticated
USING (true);

-- ledger_events RLS（読み取り専用）
DROP POLICY IF EXISTS "Read Ledger Events" ON ledger_events;
CREATE POLICY "Read Ledger Events"
ON ledger_events FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Create Ledger Events" ON ledger_events;
CREATE POLICY "Create Ledger Events"
ON ledger_events FOR INSERT
TO authenticated
WITH CHECK (true);

-- ledger_transactions RLS
DROP POLICY IF EXISTS "Read Ledger Transactions" ON ledger_transactions;
CREATE POLICY "Read Ledger Transactions"
ON ledger_transactions FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Create Ledger Transactions" ON ledger_transactions;
CREATE POLICY "Create Ledger Transactions"
ON ledger_transactions FOR INSERT
TO authenticated
WITH CHECK (true);

-- ledger_entries RLS
DROP POLICY IF EXISTS "Read Ledger Entries" ON ledger_entries;
CREATE POLICY "Read Ledger Entries"
ON ledger_entries FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Create Ledger Entries" ON ledger_entries;
CREATE POLICY "Create Ledger Entries"
ON ledger_entries FOR INSERT
TO authenticated
WITH CHECK (true);

-- ============================================================
-- 6. トリガー
-- ============================================================

-- proposals更新時タイムスタンプ
DROP TRIGGER IF EXISTS proposals_set_updated_at ON public.proposals;
CREATE TRIGGER proposals_set_updated_at
BEFORE UPDATE ON public.proposals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 7. バランスチェック関数
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
  total_debit numeric(15, 2);
  total_credit numeric(15, 2);
BEGIN
  -- 同一トランザクションの借方・貸方合計を取得
  SELECT
    COALESCE(SUM(debit_amount), 0),
    COALESCE(SUM(credit_amount), 0)
  INTO total_debit, total_credit
  FROM ledger_entries
  WHERE transaction_id = NEW.transaction_id;

  -- バランスチェック（借方 = 貸方）
  IF total_debit != total_credit THEN
    RAISE EXCEPTION 'JOURNAL_IMBALANCED: debit=%, credit=%', total_debit, total_credit;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- NOTE: このトリガーは各仕訳行挿入後にチェックするが、
--       複数行を一括挿入する場合はSTATEMENTトリガーの方が適切かもしれない。
--       運用しながら調整。

-- ============================================================
-- 8. コメント
-- ============================================================

COMMENT ON TABLE proposals IS 'DAO統一提案テーブル - 全状態変更はここを経由';
COMMENT ON COLUMN proposals.type IS '提案種別（19タイプ）';
COMMENT ON COLUMN proposals.status IS 'ライフサイクルステータス: draft→proposed→approved→executed / rejected';
COMMENT ON COLUMN proposals.created_by IS '作成者: { type: human|ai|system, id, name }';
COMMENT ON COLUMN proposals.approvals IS '承認履歴: [{ actor, decision, reason, at }]';

COMMENT ON TABLE ledger_events IS 'イベントソーシング用イベントテーブル - 不変';
COMMENT ON COLUMN ledger_events.event_type IS 'イベント種別';
COMMENT ON COLUMN ledger_events.proposal_id IS '元のProposalへの参照';

COMMENT ON TABLE ledger_transactions IS '仕訳ヘッダー - 1イベント:1仕訳';
COMMENT ON TABLE ledger_entries IS '仕訳明細行 - 借方・貸方の行';
COMMENT ON COLUMN ledger_entries.debit_amount IS '借方金額（貸方は0）';
COMMENT ON COLUMN ledger_entries.credit_amount IS '貸方金額（借方は0）';

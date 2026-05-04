-- ============================================================
-- Cleanup unused legacy functions (Phase 1: low risk)
-- ============================================================
-- 目的:
--   1) 現行ランタイム参照がない legacy 関数を整理する
--   2) テーブル・データは変更せず、非破壊で段階廃止を進める
--
-- 対象:
--   - public.rpc_assign_random_reviewer(uuid)
--   - public.check_schedule_conflict(uuid, date, date)
--   - public.is_feature_enabled(text, uuid)
--
-- 注意:
--   - 既存マイグレーション(000-020)は履歴として保持し、削除しない
--   - ai_proposals テーブル削除は別マイグレーションで段階的に実施する
-- ============================================================

DROP FUNCTION IF EXISTS public.rpc_assign_random_reviewer(uuid);

DROP FUNCTION IF EXISTS public.check_schedule_conflict(
  uuid,
  date,
  date
);

DROP FUNCTION IF EXISTS public.is_feature_enabled(
  text,
  uuid
);


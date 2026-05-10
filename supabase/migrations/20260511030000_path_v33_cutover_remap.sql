-- PATH V3.3 Phase 6 cutover: remap V3.2-era path_member_level_history rows
-- to the V3.3 scale per spec §9 mapping table:
--   V3.2 L1 (補助主体相当) → V3.3 L2
--   V3.2 L2 (標準相当)    → V3.3 L3
--   V3.2 L3 (中堅以上)    → V3.3 L4
--   V3.2 L4/L5            → 既に新スケールで有効、変更なし
--
-- "V3.2 row" は computed_score IS NULL で判定する。V3.3 の finalize は
-- aggregateMonthlyLevel 由来の score を必ず書き込むため、computed_score
-- NULL = V3.2 由来 (proposal `path.level.update` 経由 / 旧 simple flow)。
--
-- 注 (spec §9): 旧データ移行後は誰も L5 に居ない状態になるが、これは正
-- しい。L5 は V3.3 申告 + ピアレビューを経てのみ獲得できる。

BEGIN;

-- Audit trail: rows we are about to touch.
DO $$
DECLARE
  v_l1_count integer;
  v_l2_count integer;
  v_l3_count integer;
BEGIN
  SELECT count(*) INTO v_l1_count
    FROM public.path_member_level_history
    WHERE computed_score IS NULL AND level = 'L1';
  SELECT count(*) INTO v_l2_count
    FROM public.path_member_level_history
    WHERE computed_score IS NULL AND level = 'L2';
  SELECT count(*) INTO v_l3_count
    FROM public.path_member_level_history
    WHERE computed_score IS NULL AND level = 'L3';
  RAISE NOTICE 'V3.2 → V3.3 remap candidates: L1=% L2=% L3=%', v_l1_count, v_l2_count, v_l3_count;
END
$$;

UPDATE public.path_member_level_history
SET
  level = CASE level
    WHEN 'L1' THEN 'L2'
    WHEN 'L2' THEN 'L3'
    WHEN 'L3' THEN 'L4'
    ELSE level
  END,
  reason = COALESCE(reason, '') || ' [v33.cutover.remap]',
  evidence_snapshot =
    COALESCE(evidence_snapshot, '{}'::jsonb) ||
    jsonb_build_object(
      'v33_cutover_remap', jsonb_build_object(
        'original_level', level,
        'remapped_at', now()
      )
    )
WHERE computed_score IS NULL
  AND level IN ('L1', 'L2', 'L3')
  -- Idempotent guard: do not re-remap rows already touched by this migration.
  AND (evidence_snapshot -> 'v33_cutover_remap') IS NULL;

COMMIT;

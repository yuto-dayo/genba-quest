-- ============================================================
-- Site scheduling flexibility + expense misc/tax support
-- ============================================================

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS schedule_mode text NOT NULL DEFAULT 'continuous',
  ADD COLUMN IF NOT EXISTS working_weekdays integer[],
  ADD COLUMN IF NOT EXISTS custom_work_dates date[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sites'
      AND constraint_name = 'sites_schedule_mode_check'
  ) THEN
    ALTER TABLE public.sites
      ADD CONSTRAINT sites_schedule_mode_check
      CHECK (schedule_mode IN ('continuous', 'weekdays', 'custom'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.sites.schedule_mode IS '現場の施工スケジュールモード: continuous / weekdays / custom';
COMMENT ON COLUMN public.sites.working_weekdays IS '曜日施工モード時の施工曜日。0=Sun ... 6=Sat';
COMMENT ON COLUMN public.sites.custom_work_dates IS '個別日施工モード時の実施工日一覧';

ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS expense_item_code text,
  ADD COLUMN IF NOT EXISTS expense_item_other text;

COMMENT ON COLUMN public.accounting_transactions.expense_item_code IS '雑費などの頻出内訳コード';
COMMENT ON COLUMN public.accounting_transactions.expense_item_other IS 'その他選択時の自由記述';

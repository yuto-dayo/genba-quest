-- Canonical accounting reference data adopted from legacy server/sql/007.
-- Keep idempotent: this migration may run against databases that already have
-- the reference rows from pre-baseline history.

INSERT INTO public.tax_categories (
  code,
  name,
  rate,
  is_reduced,
  effective_from,
  effective_to,
  description
)
VALUES
  ('10_STANDARD', '標準税率', 0.10, false, '2019-10-01', NULL, '標準税率10%'),
  ('08_REDUCED', '軽減税率', 0.08, true, '2019-10-01', NULL, '飲食料品等'),
  ('00_EXEMPT', '非課税', 0.00, false, '1989-04-01', NULL, '土地、有価証券等'),
  ('00_TAXFREE', '不課税', 0.00, false, '1989-04-01', NULL, '給与、寄付等')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  rate = EXCLUDED.rate,
  is_reduced = EXCLUDED.is_reduced,
  effective_from = EXCLUDED.effective_from,
  effective_to = EXCLUDED.effective_to,
  description = EXCLUDED.description;

INSERT INTO public.account_master (
  code,
  name,
  category,
  parent_code,
  is_active,
  display_order,
  description
)
VALUES
  ('1100', '現金', 'asset', NULL, true, 100, NULL),
  ('1200', '売掛金', 'asset', NULL, true, 200, NULL),
  ('1500', '仮払消費税', 'asset', NULL, true, 500, NULL),
  ('2100', '買掛金', 'liability', NULL, true, 100, NULL),
  ('2500', '仮受消費税', 'liability', NULL, true, 500, NULL),
  ('4100', '売上高', 'revenue', NULL, true, 100, NULL),
  ('5100', '経費', 'expense', NULL, true, 100, NULL)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

INSERT INTO public.account_master (
  code,
  name,
  category,
  parent_code,
  is_active,
  display_order,
  description
)
VALUES
  ('5110', '材料費', 'expense', '5100', true, 110, NULL),
  ('5120', '工具備品費', 'expense', '5100', true, 120, NULL),
  ('5130', '交通費', 'expense', '5100', true, 130, NULL),
  ('5140', '会議費', 'expense', '5100', true, 140, NULL)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  parent_code = EXCLUDED.parent_code,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

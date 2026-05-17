-- PR-33 account_master supplement for tax_account_mappings seed.
-- Keep idempotent; do not rewrite existing org/account decisions here.

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
  ('1010', '普通預金', 'asset', NULL, true, 101, 'PR-33 tax mapping: bank account for payouts and receipts'),
  ('1110', '売掛金', 'asset', NULL, true, 111, 'PR-33 tax mapping: accounts receivable'),
  ('1140', '立替金', 'asset', NULL, true, 114, 'PR-33 tax mapping: temporary reimbursement receivable'),
  ('1150', '仮払消費税', 'asset', NULL, true, 115, 'PR-33 tax mapping: input consumption tax'),
  ('1230', '未成工事支出金', 'asset', NULL, true, 123, 'PR-33 tax mapping: construction in progress cost asset'),
  ('1340', '短期貸付金', 'asset', NULL, true, 134, 'PR-33 tax mapping: short-term member carry-forward receivable'),
  ('2110', '未払金', 'liability', NULL, true, 211, 'PR-33 tax mapping: accrued payable'),
  ('4110', '売上高', 'revenue', NULL, true, 411, 'PR-33 tax mapping: sales revenue'),
  ('5310', '車両費', 'expense', '5100', true, 531, 'PR-33 tax mapping: vehicle expense'),
  ('5320', '地代家賃', 'expense', '5100', true, 532, 'PR-33 tax mapping: rent expense'),
  ('5330', '通信費', 'expense', '5100', true, 533, 'PR-33 tax mapping: communication expense'),
  ('5340', '支払保険料', 'expense', '5100', true, 534, 'PR-33 tax mapping: insurance expense'),
  ('5410', '外注費', 'expense', '5100', true, 541, 'PR-33 tax mapping: subcontractor fee, avoids payroll-like allowance account wording'),
  ('5420', '完成工事原価', 'expense', '5100', true, 542, 'PR-33 tax mapping: completed construction cost'),
  ('5840', '支払手数料', 'expense', '5100', true, 584, 'PR-33 tax mapping: transfer/payment fee')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tax_account_mappings (
  org_id,
  display_label,
  tax_account_code,
  tax_account_name,
  category,
  applicable_proposal_types,
  effective_from,
  created_by
)
SELECT
  o.id,
  m.display_label,
  m.tax_account_code,
  m.tax_account_name,
  m.category,
  m.applicable_proposal_types::text[],
  '2026-01-01'::date,
  creator.user_id
FROM public.organizations o
JOIN LATERAL (
  SELECT membership.user_id
  FROM public.org_memberships AS membership
  WHERE membership.org_id = o.id
    AND membership.status = 'active'
  ORDER BY (membership.role = 'admin') DESC, membership.joined_at NULLS LAST, membership.created_at
  LIMIT 1
) AS creator ON true
CROSS JOIN (VALUES
  ('報酬の素',       '5410', '外注費',          'expense', ARRAY['reward.calculate','payout.executed']),
  ('手当',           '5410', '外注費',          'expense', ARRAY['reward.adjust']),
  ('立替戻し',       '1140', '立替金',          'asset',   ARRAY['expense.create','payout.executed']),
  ('立替の持越し',   '1340', '短期貸付金',      'asset',   ARRAY['payout.scheduled']),
  ('配るお金',       '5420', '完成工事原価',    'expense', ARRAY['reward.pool.adjust']),
  ('未成工事支出金', '1230', '未成工事支出金',  'asset',   ARRAY['expense.create']),
  ('振込手数料',     '5840', '支払手数料',      'expense', ARRAY['cash_receipt.record']),
  ('売上',           '4110', '売上高',          'income',  ARRAY['invoice.create','payment_received']),
  ('仮受消費税',     '2110', '仮受消費税',      'liability', ARRAY['invoice.create']),
  ('仮払消費税',     '1150', '仮払消費税',      'asset',   ARRAY['expense.create']),
  ('普通預金',       '1010', '普通預金',        'asset',   ARRAY['cash_receipt.record','payout.executed']),
  ('売掛金',         '1110', '売掛金',          'asset',   ARRAY['invoice.create']),
  ('未払金',         '2110', '未払金',          'liability', ARRAY['invoice.member_issue']),
  ('車両費',         '5310', '車両費',          'expense', ARRAY['recurring_expense.create']),
  ('地代家賃',       '5320', '地代家賃',        'expense', ARRAY['recurring_expense.create']),
  ('支払保険料',     '5340', '支払保険料',      'expense', ARRAY['recurring_expense.create']),
  ('通信費',         '5330', '通信費',          'expense', ARRAY['recurring_expense.create'])
) AS m(display_label, tax_account_code, tax_account_name, category, applicable_proposal_types)
ON CONFLICT (org_id, display_label, effective_from) DO NOTHING;

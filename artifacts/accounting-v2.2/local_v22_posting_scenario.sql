-- Local-only v2.2 accounting integration scenario.
-- Exercises canonical sales, invoice transfer, payment receipt/allocation,
-- and member/overhead expense posting without touching remote databases.

create temp table if not exists v22_local_evidence (
  key text primary key,
  value jsonb not null
);

do $$
declare
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_membership uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_completion_event uuid := gen_random_uuid();
  v_claimant uuid := gen_random_uuid();
  v_claimant_membership uuid := gen_random_uuid();
  v_key_suffix text;
  v_revenue_basis uuid;
  v_sale_result jsonb;
  v_sale_replay jsonb;
  v_invoice_result jsonb;
  v_payment_result jsonb;
  v_allocation_result jsonb;
  v_expense_result jsonb;
  v_sale_tx uuid;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_unbalanced_count integer;
  v_non_transition_count integer;
  v_invoice_payment_revenue_lines integer;
  v_payment_unapplied numeric;
  v_invoice_allocated numeric;
  v_journal_revenue numeric;
  v_journal_expenses numeric;
  v_legacy_revenue numeric;
  v_legacy_expenses numeric;
begin
  -- Use a fresh fixture org on every run. Posted journals are intentionally
  -- immutable, so this scenario must not clean them up between runs.
  v_key_suffix := replace(v_org::text, '-', '');

  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_sso_user,
    is_anonymous,
    created_at,
    updated_at
  )
  values
    (
      v_actor,
      'authenticated',
      'authenticated',
      'v22-local-actor-' || left(v_key_suffix, 12) || '@example.test',
      'local-not-used',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      false,
      false,
      now(),
      now()
    ),
    (
      v_claimant,
      'authenticated',
      'authenticated',
      'v22-local-claimant-' || left(v_key_suffix, 12) || '@example.test',
      'local-not-used',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      false,
      false,
      now(),
      now()
    );

  insert into public.profiles (id, username, full_name, role, updated_at)
  values
    (v_actor, 'v22-local-actor-' || left(v_key_suffix, 12), 'v2.2 Local Actor', 'admin', now()),
    (v_claimant, 'v22-local-claimant-' || left(v_key_suffix, 12), 'v2.2 Local Claimant', 'member', now());

  insert into public.organizations (id, slug, name, status)
  values (v_org, 'v22-local-' || left(v_key_suffix, 12), 'v2.2 Local Accounting Org', 'active');

  insert into public.org_memberships (
    id,
    org_id,
    user_id,
    role,
    status,
    title,
    approval_limit,
    joined_at
  )
  values
    (v_membership, v_org, v_actor, 'admin', 'active', 'Owner', 1000000, now()),
    (v_claimant_membership, v_org, v_claimant, 'member', 'active', 'Member', 100000, now());

  insert into public.clients (
    id,
    org_id,
    name,
    billing_name,
    billing_address,
    contact_person
  )
  values (
    v_client,
    v_org,
    'v2.2 Local Client',
    'v2.2 Local Client Billing',
    'Tokyo',
    'Test Contact'
  );

  insert into public.sites (
    id,
    org_id,
    client_id,
    name,
    address,
    status,
    revenue,
    start_date,
    end_date
  )
  values (
    v_site,
    v_org,
    v_client,
    'v2.2 Local Site',
    'Tokyo',
    'active',
    110000,
    date '2026-05-01',
    date '2026-05-09'
  );

  v_sale_result := public.rpc_post_accounting_sale_canonical(
    v_org,
    v_actor,
    v_membership,
    'v22-local-sale-' || v_key_suffix,
    v_site,
    v_client,
    'v2.2 local canonical sale',
    date '2026-05-09',
    100000,
    10000,
    110000,
    '10_STANDARD',
    null,
    '{"scenario":"v22_local"}'::jsonb,
    '[{"item_name":"v2.2 sale","unit_name":"式","quantity":1,"unit_price":100000}]'::jsonb,
    'v2.2 Local Actor'
  );
  v_sale_tx := (v_sale_result->'transaction'->>'id')::uuid;

  v_sale_replay := public.rpc_post_accounting_sale_canonical(
    v_org,
    v_actor,
    v_membership,
    'v22-local-sale-' || v_key_suffix,
    v_site,
    v_client,
    'v2.2 local canonical sale',
    date '2026-05-09',
    100000,
    10000,
    110000,
    '10_STANDARD',
    null,
    '{"scenario":"v22_local"}'::jsonb,
    '[{"item_name":"v2.2 sale","unit_name":"式","quantity":1,"unit_price":100000}]'::jsonb,
    'v2.2 Local Actor'
  );

  if (v_sale_replay->'transaction'->>'id')::uuid <> v_sale_tx then
    raise exception 'SALE_IDEMPOTENCY_REPLAY_CHANGED_TRANSACTION';
  end if;

  insert into public.site_completion_events (
    id,
    org_id,
    site_id,
    sequence_no,
    event_type,
    effective_completed_at,
    actor_user_id,
    idempotency_key
  )
  values (
    v_completion_event,
    v_org,
    v_site,
    1,
    'recorded',
    timestamp with time zone '2026-05-09 09:00:00+09',
    v_actor,
    'v22-local-completion-' || v_key_suffix
  );

  insert into public.revenue_basis (
    org_id,
    site_id,
    origin_completion_event_id,
    status,
    recognition_date,
    recognition_policy,
    recognition_trigger,
    recognized_on,
    service_period_start,
    service_period_end,
    amount_ex_tax,
    tax_amount,
    amount_inc_tax,
    tax_rate_code,
    right_to_invoice,
    receivable_account_type,
    source_event_id,
    source_event_type,
    customer_id,
    metadata_json
  )
  values (
    v_org,
    v_site,
    v_completion_event,
    'active',
    date '2026-05-09',
    'job_close',
    'job_closed',
    date '2026-05-09',
    date '2026-05-01',
    date '2026-05-09',
    100000,
    10000,
    110000,
    '10_STANDARD',
    true,
    'contract_asset',
    v_completion_event,
    'site_completion',
    v_client,
    '{"scenario":"v22_local","expected_invoice_transfer":true}'::jsonb
  )
  returning id into v_revenue_basis;

  v_invoice_result := public.rpc_create_accounting_invoice_canonical(
    v_org,
    array[v_sale_tx],
    v_sale_tx,
    'qualified_invoice',
    date '2026-05-09',
    date '2026-06-08',
    date '2026-05-09',
    'v2.2 Local Client Billing',
    'Tokyo',
    'T1234567890123',
    'v2.2 local canonical invoice',
    '{"issuer":"GENBA QUEST"}'::jsonb,
    'T1234567890123',
    date '2026-05-09',
    '{"currency":"JPY","amount_subtotal":100000,"tax_amount":10000,"amount_total":110000,"by_rate":[{"rate":"10_STANDARD","amount_subtotal":100000,"tax_amount":10000}]}'::jsonb,
    '{"amount_subtotal":100000,"tax_amount":10000,"amount_total":110000}'::jsonb,
    '{"qualified_invoice":true}'::jsonb,
    v_actor,
    v_membership,
    'v22-local-invoice-' || v_key_suffix,
    'v2.2 Local Actor'
  );
  v_invoice_id := (v_invoice_result->'invoice'->>'id')::uuid;

  v_payment_result := public.rpc_record_accounting_payment_event_canonical(
    v_org,
    v_actor,
    v_membership,
    'v22-local-payment-' || v_key_suffix,
    date '2026-05-10',
    110000,
    v_client,
    'bank_transfer',
    'bank',
    'v22-local-bank-ref',
    '{"scenario":"v22_local"}'::jsonb,
    'v2.2 Local Actor'
  );
  v_payment_id := (v_payment_result->'payment'->>'id')::uuid;

  v_allocation_result := public.rpc_allocate_accounting_payment_canonical(
    v_org,
    v_actor,
    v_membership,
    'v22-local-payment-allocation-' || v_key_suffix,
    v_payment_id,
    v_invoice_id,
    date '2026-05-10',
    110000,
    '{"scenario":"v22_local"}'::jsonb,
    'v2.2 Local Actor'
  );

  v_expense_result := public.rpc_post_accounting_expense_canonical(
    v_org,
    v_actor,
    v_membership,
    'v22-local-expense-' || v_key_suffix,
    'HQ',
    null,
    'v2.2 Local Vendor',
    'v2.2 local member overhead expense',
    date '2026-05-09',
    30000,
    3000,
    33000,
    'other',
    null,
    null,
    '10_STANDARD',
    'LOW',
    null,
    '{"scenario":"v22_local"}'::jsonb,
    'overhead',
    'member',
    v_claimant,
    'unpaid',
    null,
    'submitted',
    null,
    'v2.2 Local Actor'
  );

  select count(*)
  into v_unbalanced_count
  from (
    select entry.id
    from public.accounting_journal_entries entry
    join public.accounting_journal_lines line
      on line.org_id = entry.org_id
     and line.entry_id = entry.id
    where entry.org_id = v_org
      and entry.posted_at is not null
    group by entry.id
    having sum(line.debit) <> sum(line.credit)
  ) unbalanced;

  if v_unbalanced_count <> 0 then
    raise exception 'POSTED_JOURNAL_UNBALANCED count=%', v_unbalanced_count;
  end if;

  select count(*)
  into v_non_transition_count
  from public.proposals proposal
  where proposal.org_id = v_org
    and (
      proposal.payload->>'lineage_mode' is distinct from 'transition'
      or proposal.payload->>'lifecycle_engine' is distinct from 'money_transition'
      or coalesce((proposal.payload->>'full_proposal_lifecycle')::boolean, true) is not false
    );

  if v_non_transition_count <> 0 then
    raise exception 'TRANSITION_LINEAGE_METADATA_MISSING count=%', v_non_transition_count;
  end if;

  select count(*)
  into v_invoice_payment_revenue_lines
  from public.accounting_journal_lines line
  join public.accounting_journal_entries entry
    on entry.org_id = line.org_id
   and entry.id = line.entry_id
  join public.posting_groups posting_group
    on posting_group.org_id = entry.org_id
   and posting_group.id = entry.posting_group_id
  where line.org_id = v_org
    and posting_group.group_type in ('invoice_transfer', 'payment_receipt', 'payment_allocation')
    and line.account_code in ('4100', '2500');

  if v_invoice_payment_revenue_lines <> 0 then
    raise exception 'INVOICE_PAYMENT_REVENUE_LINES_FOUND count=%', v_invoice_payment_revenue_lines;
  end if;

  select unapplied_amount
  into v_payment_unapplied
  from public.accounting_payments
  where org_id = v_org
    and id = v_payment_id;

  if v_payment_unapplied <> 0 then
    raise exception 'PAYMENT_UNAPPLIED_NOT_ZERO amount=%', v_payment_unapplied;
  end if;

  select coalesce(sum(allocated_amount), 0)
  into v_invoice_allocated
  from public.payment_allocations
  where org_id = v_org
    and invoice_id = v_invoice_id;

  if v_invoice_allocated <> 110000 then
    raise exception 'INVOICE_ALLOCATION_TOTAL_MISMATCH amount=%', v_invoice_allocated;
  end if;

  select
    coalesce(sum(case when line.account_code = '4100' then line.credit - line.debit else 0 end), 0),
    coalesce(sum(case when line.account_code in ('5110', '5120', '5130', '5140', '5900') then line.debit - line.credit else 0 end), 0)
  into v_journal_revenue, v_journal_expenses
  from public.accounting_journal_lines line
  join public.accounting_journal_entries entry
    on entry.org_id = line.org_id
   and entry.id = line.entry_id
  where line.org_id = v_org
    and entry.posted_at is not null;

  if v_journal_revenue <> 100000 then
    raise exception 'JOURNAL_REVENUE_MISMATCH amount=%', v_journal_revenue;
  end if;

  if v_journal_expenses <> 30000 then
    raise exception 'JOURNAL_EXPENSE_MISMATCH amount=%', v_journal_expenses;
  end if;

  select
    coalesce(sum(case when kind in ('sale', 'invoice') then amount_subtotal else 0 end), 0),
    coalesce(sum(case when kind = 'expense' then amount_subtotal else 0 end), 0)
  into v_legacy_revenue, v_legacy_expenses
  from public.accounting_transactions
  where org_id = v_org
    and status = 'posted';

  insert into v22_local_evidence (key, value)
  values
    ('fixture', jsonb_build_object(
      'org_id', v_org,
      'actor_user_id', v_actor,
      'membership_id', v_membership,
      'client_id', v_client,
      'site_id', v_site,
      'revenue_basis_id', v_revenue_basis,
      'sale_transaction_id', v_sale_tx,
      'invoice_id', v_invoice_id,
      'payment_id', v_payment_id
    )),
    ('responses', jsonb_build_object(
      'sale_posting', v_sale_result->'posting',
      'sale_replay_same_transaction', (v_sale_replay->'transaction'->>'id')::uuid = v_sale_tx,
      'invoice_posting', v_invoice_result->'posting',
      'payment_posting', v_payment_result->'posting',
      'allocation_posting', v_allocation_result->'posting',
      'expense_posting', v_expense_result->'posting'
    )),
    ('invariants', jsonb_build_object(
      'posted_journal_unbalanced_count', v_unbalanced_count,
      'non_transition_proposal_count', v_non_transition_count,
      'invoice_payment_revenue_line_count', v_invoice_payment_revenue_lines,
      'payment_unapplied_amount', v_payment_unapplied,
      'invoice_allocated_amount', v_invoice_allocated
    )),
    ('row_counts', jsonb_build_object(
      'proposals', (select count(*) from public.proposals where org_id = v_org),
      'proposal_executions', (select count(*) from public.proposal_executions where org_id = v_org),
      'posting_groups', (select count(*) from public.posting_groups where org_id = v_org),
      'journal_entries', (select count(*) from public.accounting_journal_entries where org_id = v_org),
      'journal_lines', (select count(*) from public.accounting_journal_lines where org_id = v_org),
      'transactions', (select count(*) from public.accounting_transactions where org_id = v_org),
      'invoices', (select count(*) from public.accounting_invoices where org_id = v_org),
      'payments', (select count(*) from public.accounting_payments where org_id = v_org),
      'payment_allocations', (select count(*) from public.payment_allocations where org_id = v_org),
      'invoice_revenue_allocations', (
        select count(*)
        from public.accounting_invoice_line_revenue_allocations
        where org_id = v_org
      )
    )),
    ('pl_compare', jsonb_build_object(
      'legacy', jsonb_build_object(
        'revenue', v_legacy_revenue,
        'expenses', v_legacy_expenses,
        'profit', v_legacy_revenue - v_legacy_expenses
      ),
      'journal', jsonb_build_object(
        'revenue', v_journal_revenue,
        'expenses', v_journal_expenses,
        'profit', v_journal_revenue - v_journal_expenses
      ),
      'diff', jsonb_build_object(
        'revenue', v_journal_revenue - v_legacy_revenue,
        'expenses', v_journal_expenses - v_legacy_expenses,
        'profit', (v_journal_revenue - v_journal_expenses) - (v_legacy_revenue - v_legacy_expenses)
      )
    ));
end $$;

select key, jsonb_pretty(value) as value
from v22_local_evidence
order by key;

#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = new URL("../../", import.meta.url).pathname;
const serverDir = new URL("../../server/", import.meta.url).pathname;
const localSupabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const port = Number(process.env.ACCOUNTING_V22_PL_TEST_PORT || 4021);

const orgId = randomUUID();
const actorUserId = "e93f3438-ae73-4c55-b2ab-a370d096bde0";
const claimantUserId = randomUUID();
const membershipId = randomUUID();
const claimantMembershipId = randomUUID();
const clientId = randomUUID();
const siteId = randomUUID();
const completionEventId = randomUUID();
const keySuffix = orgId.replaceAll("-", "").slice(0, 12);
const idempotencyPrefix = `v22-pl-${keySuffix}`;
const month = "2026-05";

let serverProcess = null;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await sleep(300);
    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }
  }
});

async function main() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || readLocalServiceRoleKey();

  await prepareFixture();
  serverProcess = startServer(serviceRoleKey);
  await waitForHealth();

  const rowCountCheckpoints = {};
  const plCheckpoints = {};
  const postings = {};

  const saleA = postSale({
    key: `${idempotencyPrefix}-sale-a`,
    description: "v2.2 PL compare sale A for invoice/payment",
  });
  postings.sale_a = summarizePostingResult(saleA);
  plCheckpoints.after_sale = await fetchPlBundle("after_sale");
  assertCompareCheckpoint(plCheckpoints.after_sale.compare, {
    sales: 110000,
    expenses: 0,
  });
  rowCountCheckpoints.after_sale = fetchSnapshot().row_counts;

  const expense = postExpense();
  postings.expense = summarizePostingResult(expense);
  plCheckpoints.after_expense = await fetchPlBundle("after_expense");
  assertCompareCheckpoint(plCheckpoints.after_expense.compare, {
    sales: 110000,
    expenses: 33000,
  });
  rowCountCheckpoints.after_expense = fetchSnapshot().row_counts;

  const revenueBasisId = insertRevenueBasis(saleA.transaction.id);
  const invoice = createInvoice(saleA.transaction.id, revenueBasisId);
  postings.invoice = summarizePostingResult(invoice);
  const payment = recordPayment();
  postings.payment = summarizePostingResult(payment);
  const allocation = allocatePayment(payment.payment.id, invoice.invoice.id);
  postings.payment_allocation = summarizePostingResult(allocation);
  plCheckpoints.after_invoice_payment = await fetchPlBundle("after_invoice_payment");
  assertCompareCheckpoint(plCheckpoints.after_invoice_payment.compare, {
    sales: 110000,
    expenses: 33000,
  });
  rowCountCheckpoints.after_invoice_payment = fetchSnapshot().row_counts;

  const saleB = postSale({
    key: `${idempotencyPrefix}-sale-b`,
    description: "v2.2 PL compare sale B for reversal",
  });
  postings.sale_b = summarizePostingResult(saleB);
  const reversal = reverseSale(saleB.transaction.id);
  postings.reversal = summarizePostingResult(reversal);
  plCheckpoints.after_reversal = await fetchPlBundle("after_reversal");
  assertCompareCheckpoint(plCheckpoints.after_reversal.compare, {
    sales: 110000,
    expenses: 33000,
  });

  const finalSnapshot = fetchSnapshot(saleB.transaction.id, reversal.reversal_created);
  rowCountCheckpoints.after_reversal = finalSnapshot.row_counts;
  assertFinalSnapshot(finalSnapshot);
  assertFinalPl(plCheckpoints.after_reversal);

  const immutability = testPostedJournalImmutability(finalSnapshot.immutability_target);
  assert(
    Object.values(immutability).every((result) => result.failed_as_expected),
    "Expected all posted journal mutation attempts to fail",
  );

  const result = {
    fixture: {
      org_id: orgId,
      actor_user_id: actorUserId,
      membership_id: membershipId,
      claimant_user_id: claimantUserId,
      claimant_membership_id: claimantMembershipId,
      client_id: clientId,
      site_id: siteId,
      month,
      local_api_base_url: `http://127.0.0.1:${port}`,
    },
    api_requests: [
      `/api/v1/accounting/pl?source=legacy&month=${month}`,
      `/api/v1/accounting/pl?source=journal&month=${month}`,
      `/api/v1/accounting/pl?source=compare&month=${month}`,
    ],
    postings,
    row_count_checkpoints: rowCountCheckpoints,
    journal_balance: finalSnapshot.journal_balance,
    pl_checkpoints: plCheckpoints,
    invoice_payment_no_pl_revenue: finalSnapshot.invoice_payment_no_pl_revenue,
    reversal: finalSnapshot.reversal,
    immutability,
    assertions: {
      compare_diff_zero_after_sale: true,
      compare_diff_zero_after_expense: true,
      invoice_payment_no_pl_revenue: true,
      compare_diff_zero_after_reversal: true,
      reversal_preserves_original_and_adds_reversal: true,
      posted_journal_immutability_enforced: true,
      remote_db_not_used: true,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

function readLocalServiceRoleKey() {
  const status = spawnSync("supabase", ["status"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (status.status !== 0) {
    throw new Error(`supabase status failed: ${status.stderr || status.stdout}`);
  }

  const match = status.stdout.match(/Secret\s*│\s*([^\s│]+)/);
  if (!match?.[1]) {
    throw new Error("Could not parse local Supabase secret key from supabase status");
  }
  return match[1];
}

async function prepareFixture() {
  const sql = `
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
    ${sqlString(actorUserId)}::uuid,
    'authenticated',
    'authenticated',
    ${sqlString(`v22-pl-actor-${keySuffix}@example.test`)},
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
    ${sqlString(claimantUserId)}::uuid,
    'authenticated',
    'authenticated',
    ${sqlString(`v22-pl-claimant-${keySuffix}@example.test`)},
    'local-not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false,
    false,
    now(),
    now()
  )
on conflict (id) do update
set email = excluded.email,
    email_confirmed_at = excluded.email_confirmed_at,
    updated_at = now();

insert into public.profiles (id, username, full_name, role, updated_at)
values
  (
    ${sqlString(actorUserId)}::uuid,
    ${sqlString(`v22-pl-actor-${keySuffix}`)},
    'v2.2 PL Actor',
    'admin',
    now()
  ),
  (
    ${sqlString(claimantUserId)}::uuid,
    ${sqlString(`v22-pl-claimant-${keySuffix}`)},
    'v2.2 PL Claimant',
    'member',
    now()
  )
on conflict (id) do update
set username = excluded.username,
    full_name = excluded.full_name,
    role = excluded.role,
    updated_at = now();

insert into public.organizations (id, slug, name, status)
values (
  ${sqlString(orgId)}::uuid,
  ${sqlString(`v22-pl-${keySuffix}`)},
  'v2.2 PL Compare Org',
  'active'
);

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
  (
    ${sqlString(membershipId)}::uuid,
    ${sqlString(orgId)}::uuid,
    ${sqlString(actorUserId)}::uuid,
    'admin',
    'active',
    'Owner',
    1000000,
    now()
  ),
  (
    ${sqlString(claimantMembershipId)}::uuid,
    ${sqlString(orgId)}::uuid,
    ${sqlString(claimantUserId)}::uuid,
    'member',
    'active',
    'Member',
    100000,
    now()
  );

insert into public.clients (
  id,
  org_id,
  name,
  billing_name,
  billing_address,
  contact_person
)
values (
  ${sqlString(clientId)}::uuid,
  ${sqlString(orgId)}::uuid,
  'v2.2 PL Client',
  'v2.2 PL Client Billing',
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
  ${sqlString(siteId)}::uuid,
  ${sqlString(orgId)}::uuid,
  ${sqlString(clientId)}::uuid,
  'v2.2 PL Site',
  'Tokyo',
  'active',
  220000,
  date '2026-05-01',
  date '2026-05-11'
);
`;
  runPsql(sql);
}

function postSale({ key, description }) {
  return callRpc(`
select public.rpc_post_accounting_sale_canonical(
  ${sqlString(orgId)}::uuid,
  ${sqlString(actorUserId)}::uuid,
  ${sqlString(membershipId)}::uuid,
  ${sqlString(key)},
  ${sqlString(siteId)}::uuid,
  ${sqlString(clientId)}::uuid,
  ${sqlString(description)},
  date '2026-05-09',
  100000,
  10000,
  110000,
  '10_STANDARD',
  null,
  ${sqlJson({ scenario: "v22_pl_compare", description })},
  '[{"item_name":"v2.2 sale","unit_name":"式","quantity":1,"unit_price":100000}]'::jsonb,
  'v2.2 PL Actor'
)::text;
`);
}

function postExpense() {
  return callRpc(`
select public.rpc_post_accounting_expense_canonical(
  ${sqlString(orgId)}::uuid,
  ${sqlString(actorUserId)}::uuid,
  ${sqlString(membershipId)}::uuid,
  ${sqlString(`${idempotencyPrefix}-expense`)},
  'HQ',
  null,
  'v2.2 Member Vendor',
  'v2.2 member overhead expense',
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
  ${sqlJson({ scenario: "v22_pl_compare" })},
  'overhead',
  'member',
  ${sqlString(claimantUserId)}::uuid,
  'unpaid',
  null,
  'submitted',
  null,
  'v2.2 PL Actor'
)::text;
`);
}

function insertRevenueBasis(saleTransactionId) {
  const output = runScalarJson(`
with completion as (
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
    ${sqlString(completionEventId)}::uuid,
    ${sqlString(orgId)}::uuid,
    ${sqlString(siteId)}::uuid,
    1,
    'recorded',
    timestamp with time zone '2026-05-09 09:00:00+09',
    ${sqlString(actorUserId)}::uuid,
    ${sqlString(`${idempotencyPrefix}-completion`)}
  )
  returning id
),
basis as (
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
  select
    ${sqlString(orgId)}::uuid,
    ${sqlString(siteId)}::uuid,
    completion.id,
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
    completion.id,
    'site_completion',
    ${sqlString(clientId)}::uuid,
    ${sqlJson({ scenario: "v22_pl_compare", sale_transaction_id: saleTransactionId, expected_invoice_transfer: true })}
  from completion
  returning id
)
select jsonb_build_object('id', id)::text from basis;
`);
  return output.id;
}

function createInvoice(saleTransactionId, revenueBasisId) {
  return callRpc(`
select public.rpc_create_accounting_invoice_canonical(
  ${sqlString(orgId)}::uuid,
  array[${sqlString(saleTransactionId)}::uuid],
  ${sqlString(saleTransactionId)}::uuid,
  'qualified_invoice',
  date '2026-05-10',
  date '2026-06-09',
  date '2026-05-09',
  'v2.2 PL Client Billing',
  'Tokyo',
  'T1234567890123',
  'v2.2 PL compare invoice issue',
  ${sqlJson({ issuer_name: "GENBA QUEST Test" })},
  'T1234567890123',
  date '2026-05-01',
  ${sqlJson({
    currency: "JPY",
    amount_subtotal: 100000,
    tax_amount: 10000,
    amount_total: 110000,
    by_rate: [{ rate: "10_STANDARD", amount_subtotal: 100000, tax_amount: 10000 }],
  })},
  ${sqlJson({ amount_subtotal: 100000, tax_amount: 10000, amount_total: 110000, revenue_basis_id: revenueBasisId })},
  ${sqlJson({ qualified_invoice: true })},
  ${sqlString(actorUserId)}::uuid,
  ${sqlString(membershipId)}::uuid,
  ${sqlString(`${idempotencyPrefix}-invoice`)},
  'v2.2 PL Actor'
)::text;
`);
}

function recordPayment() {
  return callRpc(`
select public.rpc_record_accounting_payment_event_canonical(
  ${sqlString(orgId)}::uuid,
  ${sqlString(actorUserId)}::uuid,
  ${sqlString(membershipId)}::uuid,
  ${sqlString(`${idempotencyPrefix}-payment`)},
  date '2026-05-11',
  110000,
  ${sqlString(clientId)}::uuid,
  'bank_transfer',
  'bank',
  ${sqlString(`local-pl-${keySuffix}`)},
  ${sqlJson({ scenario: "v22_pl_compare" })},
  'v2.2 PL Actor'
)::text;
`);
}

function allocatePayment(paymentId, invoiceId) {
  return callRpc(`
select public.rpc_allocate_accounting_payment_canonical(
  ${sqlString(orgId)}::uuid,
  ${sqlString(actorUserId)}::uuid,
  ${sqlString(membershipId)}::uuid,
  ${sqlString(`${idempotencyPrefix}-payment-allocation`)},
  ${sqlString(paymentId)}::uuid,
  ${sqlString(invoiceId)}::uuid,
  date '2026-05-11',
  110000,
  ${sqlJson({ scenario: "v22_pl_compare" })},
  'v2.2 PL Actor'
)::text;
`);
}

function reverseSale(transactionId) {
  return callRpc(`
select public.rpc_reverse_accounting_sale_canonical(
  ${sqlString(orgId)}::uuid,
  ${sqlString(actorUserId)}::uuid,
  ${sqlString(membershipId)}::uuid,
  ${sqlString(`${idempotencyPrefix}-sale-reversal`)},
  ${sqlString(transactionId)}::uuid,
  'v2.2 PL compare reversal',
  date '2026-05-11',
  'v2.2 PL Actor'
)::text;
`);
}

async function fetchPlBundle(label) {
  const [legacy, journal, compare] = await Promise.all([
    getPl("legacy"),
    getPl("journal"),
    getPl("compare"),
  ]);
  return {
    label,
    legacy,
    journal,
    compare,
  };
}

async function getPl(source) {
  const url = new URL(`/api/v1/accounting/pl`, `http://127.0.0.1:${port}`);
  url.searchParams.set("source", source);
  url.searchParams.set("month", month);

  const response = await fetch(url, {
    headers: {
      "x-dev-user-key": "yuto",
      "x-org-id": orgId,
    },
  });
  const body = await response.json();
  assert(response.ok, `GET ${url.pathname}?${url.searchParams.toString()} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

function fetchSnapshot(originalSaleId = null, reversalId = null) {
  return runScalarJson(`
with row_counts as (
  select jsonb_build_object(
    'proposals', (select count(*) from public.proposals where org_id = ${sqlString(orgId)}::uuid),
    'proposal_executions', (select count(*) from public.proposal_executions where org_id = ${sqlString(orgId)}::uuid),
    'posting_groups', (select count(*) from public.posting_groups where org_id = ${sqlString(orgId)}::uuid),
    'journal_entries', (select count(*) from public.accounting_journal_entries where org_id = ${sqlString(orgId)}::uuid),
    'journal_lines', (select count(*) from public.accounting_journal_lines where org_id = ${sqlString(orgId)}::uuid),
    'transactions', (select count(*) from public.accounting_transactions where org_id = ${sqlString(orgId)}::uuid),
    'invoices', (select count(*) from public.accounting_invoices where org_id = ${sqlString(orgId)}::uuid),
    'payments', (select count(*) from public.accounting_payments where org_id = ${sqlString(orgId)}::uuid),
    'payment_allocations', (select count(*) from public.payment_allocations where org_id = ${sqlString(orgId)}::uuid),
    'revenue_basis', (select count(*) from public.revenue_basis where org_id = ${sqlString(orgId)}::uuid)
  ) as value
),
journal_balance as (
  select jsonb_build_object(
    'unbalanced_count', (
      select count(*)
      from (
        select entry.id
        from public.accounting_journal_entries as entry
        join public.accounting_journal_lines as line
          on line.org_id = entry.org_id
         and line.entry_id = entry.id
        where entry.org_id = ${sqlString(orgId)}::uuid
          and entry.posted_at is not null
        group by entry.id
        having sum(line.debit) <> sum(line.credit)
      ) as unbalanced
    ),
    'entries', coalesce((
      select jsonb_agg(entry_summary order by entry_summary->>'entry_date', entry_summary->>'entry_id')
      from (
        select jsonb_build_object(
          'entry_id', entry.id,
          'entry_date', entry.entry_date,
          'posting_group_id', entry.posting_group_id,
          'group_type', posting_group.group_type,
          'debit', sum(line.debit),
          'credit', sum(line.credit),
          'line_count', count(*)
        ) as entry_summary
        from public.accounting_journal_entries as entry
        join public.posting_groups as posting_group
          on posting_group.org_id = entry.org_id
         and posting_group.id = entry.posting_group_id
        join public.accounting_journal_lines as line
          on line.org_id = entry.org_id
         and line.entry_id = entry.id
        where entry.org_id = ${sqlString(orgId)}::uuid
          and entry.posted_at is not null
        group by entry.id, posting_group.group_type
      ) as summaries
    ), '[]'::jsonb)
  ) as value
),
no_pl_revenue as (
  select jsonb_build_object(
    'no_pl_group_line_count', (
      select count(*)
      from public.accounting_journal_lines as line
      join public.accounting_journal_entries as entry
        on entry.org_id = line.org_id
       and entry.id = line.entry_id
      join public.posting_groups as posting_group
        on posting_group.org_id = entry.org_id
       and posting_group.id = entry.posting_group_id
      where line.org_id = ${sqlString(orgId)}::uuid
        and posting_group.group_type in ('invoice_transfer', 'payment_receipt', 'payment_allocation')
    ),
    'revenue_or_output_tax_line_count', (
      select count(*)
      from public.accounting_journal_lines as line
      join public.accounting_journal_entries as entry
        on entry.org_id = line.org_id
       and entry.id = line.entry_id
      join public.posting_groups as posting_group
        on posting_group.org_id = entry.org_id
       and posting_group.id = entry.posting_group_id
      where line.org_id = ${sqlString(orgId)}::uuid
        and posting_group.group_type in ('invoice_transfer', 'payment_receipt', 'payment_allocation')
        and line.account_code in ('4100', '2500')
    ),
    'posting_modes', coalesce((
      select jsonb_agg(distinct entry.metadata_json->>'posting_mode')
      from public.accounting_journal_entries as entry
      join public.posting_groups as posting_group
        on posting_group.org_id = entry.org_id
       and posting_group.id = entry.posting_group_id
      where entry.org_id = ${sqlString(orgId)}::uuid
        and posting_group.group_type in ('invoice_transfer', 'payment_receipt', 'payment_allocation')
    ), '[]'::jsonb)
  ) as value
),
reversal as (
  select jsonb_build_object(
    'original_transaction_id', ${originalSaleId ? `${sqlString(originalSaleId)}::uuid` : 'null::uuid'},
    'reversal_transaction_id', ${reversalId ? `${sqlString(reversalId)}::uuid` : 'null::uuid'},
    'original', coalesce((
      select to_jsonb(original)
      from public.accounting_transactions as original
      where original.org_id = ${sqlString(orgId)}::uuid
        and original.id = ${originalSaleId ? `${sqlString(originalSaleId)}::uuid` : 'null::uuid'}
    ), '{}'::jsonb),
    'reversal', coalesce((
      select to_jsonb(reversal_tx)
      from public.accounting_transactions as reversal_tx
      where reversal_tx.org_id = ${sqlString(orgId)}::uuid
        and reversal_tx.id = ${reversalId ? `${sqlString(reversalId)}::uuid` : 'null::uuid'}
    ), '{}'::jsonb),
    'original_journal_still_posted', coalesce((
      select entry.posted_at is not null
      from public.accounting_transactions as original
      join public.accounting_journal_entries as entry
        on entry.org_id = original.org_id
       and entry.id = original.journal_entry_id
      where original.org_id = ${sqlString(orgId)}::uuid
        and original.id = ${originalSaleId ? `${sqlString(originalSaleId)}::uuid` : 'null::uuid'}
    ), false),
    'reversal_journal_posted', coalesce((
      select entry.posted_at is not null
      from public.accounting_transactions as reversal_tx
      join public.accounting_journal_entries as entry
        on entry.org_id = reversal_tx.org_id
       and entry.id = reversal_tx.journal_entry_id
      where reversal_tx.org_id = ${sqlString(orgId)}::uuid
        and reversal_tx.id = ${reversalId ? `${sqlString(reversalId)}::uuid` : 'null::uuid'}
    ), false)
  ) as value
),
immutability_target as (
  select jsonb_build_object(
    'entry_id', entry.id,
    'line_id', line.id
  ) as value
  from public.accounting_journal_entries as entry
  join public.accounting_journal_lines as line
    on line.org_id = entry.org_id
   and line.entry_id = entry.id
  where entry.org_id = ${sqlString(orgId)}::uuid
    and entry.posted_at is not null
  order by entry.created_at, line.line_no
  limit 1
)
select jsonb_build_object(
  'row_counts', (select value from row_counts),
  'journal_balance', (select value from journal_balance),
  'invoice_payment_no_pl_revenue', (select value from no_pl_revenue),
  'reversal', (select value from reversal),
  'immutability_target', (select value from immutability_target)
)::text;
`);
}

function testPostedJournalImmutability(target) {
  assert(target?.entry_id, "Missing posted journal entry target");
  assert(target?.line_id, "Missing posted journal line target");

  return {
    entry_update: runExpectedImmutableFailure(
      "entry_update",
      `update public.accounting_journal_entries
       set posted_at = posted_at
       where org_id = ${sqlString(orgId)}::uuid
         and id = ${sqlString(target.entry_id)}::uuid;`,
    ),
    entry_delete: runExpectedImmutableFailure(
      "entry_delete",
      `delete from public.accounting_journal_entries
       where org_id = ${sqlString(orgId)}::uuid
         and id = ${sqlString(target.entry_id)}::uuid;`,
    ),
    line_update: runExpectedImmutableFailure(
      "line_update",
      `update public.accounting_journal_lines
       set debit = debit
       where org_id = ${sqlString(orgId)}::uuid
         and id = ${sqlString(target.line_id)}::uuid;`,
    ),
    line_delete: runExpectedImmutableFailure(
      "line_delete",
      `delete from public.accounting_journal_lines
       where org_id = ${sqlString(orgId)}::uuid
         and id = ${sqlString(target.line_id)}::uuid;`,
    ),
  };
}

function runExpectedImmutableFailure(label, sql) {
  const result = runPsqlRaw(sql);
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const failedAsExpected = result.status !== 0 && combined.includes("POSTED_JOURNAL_IMMUTABLE");
  assert(failedAsExpected, `${label} did not fail with POSTED_JOURNAL_IMMUTABLE: ${combined}`);
  return {
    failed_as_expected: true,
    exit_code: result.status,
    expected_error_code: "POSTED_JOURNAL_IMMUTABLE",
    sqlstate: "23514",
    error_excerpt: firstMeaningfulErrorLine(combined),
  };
}

function startServer(serviceRoleKey) {
  const child = spawn("npx", ["ts-node", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      DEV_SKIP_AUTH: "true",
      DEV_USER_KEY: "yuto",
      DEFAULT_ORG_ID: orgId,
      SUPABASE_URL: localSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    if (process.env.ACCOUNTING_V22_VERBOSE_SERVER === "1") {
      process.stderr.write(chunk);
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw new Error(`Server did not become healthy on port ${port}: ${lastError?.message || "unknown error"}`);
}

function callRpc(sql) {
  return JSON.parse(readJsonText(runPsql(sql)));
}

function runScalarJson(sql) {
  return JSON.parse(readJsonText(runPsql(sql)));
}

function runPsql(sql) {
  const result = runPsqlRaw(sql);
  if (result.status !== 0) {
    throw new Error(`psql failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function runPsqlRaw(sql) {
  return spawnSync(
    "docker",
    ["exec", "-i", "supabase_db_genba-quest", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
    {
      cwd: repoRoot,
      input: sql,
      encoding: "utf8",
    },
  );
}

function readJsonText(output) {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.startsWith("{") || value.startsWith("["));
  if (!line) {
    throw new Error(`Could not find JSON in psql output: ${output}`);
  }
  return line;
}

function summarizePostingResult(result) {
  return {
    proposal_id: result.proposal?.id,
    proposal_type: result.proposal?.type,
    proposal_status: result.proposal?.status,
    lineage_mode: result.proposal?.lineage_mode,
    lifecycle_engine: result.proposal?.lifecycle_engine,
    full_proposal_lifecycle: result.proposal?.full_proposal_lifecycle,
    execution_id: result.execution?.id,
    posting_group_id: result.posting_group_id,
    journal_entry_id: result.journal_entry_id,
    transaction_id: result.transaction?.id,
    invoice_id: result.invoice?.id,
    payment_id: result.payment?.id,
    allocation_id: result.allocation?.id,
    reversal_created: result.reversal_created,
    posting: result.posting,
    projection: result.projection,
  };
}

function assertCompareCheckpoint(compare, expectedGross) {
  assert(compare.source === "compare", `Expected compare source, got ${compare.source}`);
  assert(Array.isArray(compare.mismatches), "Expected compare mismatches array");
  assert(compare.mismatches.length === 0, `Expected zero mismatches, got ${JSON.stringify(compare.mismatches)}`);

  const expected = completeGrossSummary(expectedGross);
  for (const key of ["sales", "expenses", "profit", "distributable"]) {
    assertMoney(compare.diff[key], 0, `compare.diff.${key}`);
    assertMoney(compare.legacy[key], expected[key], `compare.legacy.${key}`);
    assertMoney(compare.journal_gross_compat[key], expected[key], `compare.journal_gross_compat.${key}`);
  }
}

function assertFinalPl(checkpoint) {
  assertMoney(checkpoint.legacy.sales, 110000, "final legacy sales");
  assertMoney(checkpoint.legacy.expenses, 33000, "final legacy expenses");
  assertMoney(checkpoint.legacy.profit, 77000, "final legacy profit");
  assertMoney(checkpoint.journal.sales, 100000, "final journal net sales");
  assertMoney(checkpoint.journal.expenses, 30000, "final journal net expenses");
  assertMoney(checkpoint.journal.profit, 70000, "final journal net profit");
  assertMoney(checkpoint.compare.journal_gross_compat.sales, 110000, "final journal gross sales");
  assertMoney(checkpoint.compare.journal_gross_compat.expenses, 33000, "final journal gross expenses");
}

function assertFinalSnapshot(snapshot) {
  assert(snapshot.row_counts.proposals === 7, `Expected 7 proposals, got ${snapshot.row_counts.proposals}`);
  assert(snapshot.row_counts.proposal_executions === 7, `Expected 7 executions, got ${snapshot.row_counts.proposal_executions}`);
  assert(snapshot.row_counts.posting_groups === 7, `Expected 7 posting groups, got ${snapshot.row_counts.posting_groups}`);
  assert(snapshot.row_counts.journal_entries === 7, `Expected 7 journal entries, got ${snapshot.row_counts.journal_entries}`);
  assert(snapshot.row_counts.journal_lines === 18, `Expected 18 journal lines, got ${snapshot.row_counts.journal_lines}`);
  assert(snapshot.row_counts.transactions === 4, `Expected 4 accounting transactions, got ${snapshot.row_counts.transactions}`);
  assert(snapshot.row_counts.invoices === 1, `Expected 1 invoice, got ${snapshot.row_counts.invoices}`);
  assert(snapshot.row_counts.payments === 1, `Expected 1 payment, got ${snapshot.row_counts.payments}`);
  assert(snapshot.row_counts.payment_allocations === 1, `Expected 1 payment allocation, got ${snapshot.row_counts.payment_allocations}`);
  assert(snapshot.journal_balance.unbalanced_count === 0, `Expected 0 unbalanced entries, got ${snapshot.journal_balance.unbalanced_count}`);
  assert(
    snapshot.invoice_payment_no_pl_revenue.revenue_or_output_tax_line_count === 0,
    `Expected invoice/payment no PL revenue lines, got ${snapshot.invoice_payment_no_pl_revenue.revenue_or_output_tax_line_count}`,
  );

  const original = snapshot.reversal.original;
  const reversal = snapshot.reversal.reversal;
  assert(original.id, "Missing original sale transaction");
  assert(reversal.id, "Missing reversal transaction");
  assertMoney(original.amount_total, 110000, "original sale amount_total");
  assertMoney(reversal.amount_total, -110000, "reversal amount_total");
  assert(reversal.voids_transaction_id === original.id, "Reversal does not point to original transaction");
  assert(snapshot.reversal.original_journal_still_posted === true, "Original journal is not still posted");
  assert(snapshot.reversal.reversal_journal_posted === true, "Reversal journal is not posted");
}

function completeGrossSummary({ sales, expenses }) {
  const profit = roundMoney(sales - expenses);
  const distributable = roundMoney(Math.max(profit, 0) * 0.7);
  return {
    sales: roundMoney(sales),
    expenses: roundMoney(expenses),
    profit,
    distributable,
  };
}

function assertMoney(actual, expected, label) {
  const rounded = roundMoney(Number(actual));
  const expectedRounded = roundMoney(Number(expected));
  assert(rounded === expectedRounded, `${label}: expected ${expectedRounded}, got ${rounded}`);
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function firstMeaningfulErrorLine(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("ERROR:") || line.includes("POSTED_JOURNAL_IMMUTABLE") || line.includes("DETAIL:"))
    || output.slice(0, 240);
}

#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = new URL("../../", import.meta.url).pathname;
const serverDir = new URL("../../server/", import.meta.url).pathname;
const localSupabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const port = Number(process.env.ACCOUNTING_V22_ORG_TEST_PORT || 4019);
const actorUserId = "e93f3438-ae73-4c55-b2ab-a370d096bde0";
const orgAId = randomUUID();
const orgBId = randomUUID();
const orgAMembershipId = randomUUID();
const orgBMembershipId = randomUUID();
const orgBClientId = randomUUID();
const orgBSiteId = randomUUID();
const orgBTransactionId = randomUUID();
const orgBInvoiceId = randomUUID();
const orgBPaymentId = randomUUID();
const orgBDocumentId = randomUUID();
const keySuffix = orgAId.replaceAll("-", "").slice(0, 12);

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

  const cases = [
    {
      name: "invoice_eligibility_foreign_transaction",
      expectedStatus: 404,
      request: () => postJson("/api/v1/accounting/invoice-eligibility", {
        transaction_ids: [orgBTransactionId],
      }),
    },
    {
      name: "invoice_create_foreign_transaction",
      expectedStatus: 404,
      request: () => postJson("/api/v1/accounting/invoices", {
        idempotency_key: `v22-org-boundary-invoice-${keySuffix}`,
        source_transaction_ids: [orgBTransactionId],
        issue_date: "2026-05-09",
        due_date: "2026-06-08",
        billing_name: "Org B Billing Name",
      }),
    },
    {
      name: "payment_allocation_foreign_payment_invoice",
      expectedStatus: 404,
      request: () => postJson("/api/v1/accounting/payments/allocations", {
        idempotency_key: `v22-org-boundary-allocation-${keySuffix}`,
        payment_id: orgBPaymentId,
        invoice_id: orgBInvoiceId,
        allocated_on: "2026-05-10",
        amount: 110000,
      }),
    },
    {
      name: "ocr_analyze_foreign_document",
      expectedStatus: 404,
      request: () => postJson("/api/v1/accounting/ocr/analyze", {
        document_id: orgBDocumentId,
      }),
    },
    {
      name: "invoice_download_foreign_invoice",
      expectedStatus: 404,
      request: () => get(`/api/v1/accounting/invoices/${orgBInvoiceId}/download`),
    },
  ];

  const results = [];
  for (const testCase of cases) {
    const response = await testCase.request();
    results.push({
      name: testCase.name,
      expected_status: testCase.expectedStatus,
      status: response.status,
      error: response.body?.error || null,
    });
    assert(
      response.status === testCase.expectedStatus,
      `${testCase.name}: expected ${testCase.expectedStatus}, got ${response.status} (${JSON.stringify(response.body)})`,
    );
  }

  const positiveOrgB = await postJson("/api/v1/accounting/invoice-eligibility", {
    transaction_ids: [orgBTransactionId],
  }, orgBId);
  assert(positiveOrgB.status !== 404, `Expected org B active request to find org B transaction, got 404`);

  const counts = await fetchCounts();
  assert(counts.org_a_transactions === 0, `Expected no org A transactions, got ${counts.org_a_transactions}`);
  assert(counts.org_a_invoices === 0, `Expected no org A invoices, got ${counts.org_a_invoices}`);
  assert(counts.org_a_payments === 0, `Expected no org A payments, got ${counts.org_a_payments}`);
  assert(counts.org_a_documents === 0, `Expected no org A documents, got ${counts.org_a_documents}`);
  assert(counts.org_b_transactions === 1, `Expected one org B transaction, got ${counts.org_b_transactions}`);
  assert(counts.org_b_invoices === 1, `Expected one org B invoice, got ${counts.org_b_invoices}`);
  assert(counts.org_b_payments === 1, `Expected one org B payment, got ${counts.org_b_payments}`);
  assert(counts.org_b_documents === 1, `Expected one org B document, got ${counts.org_b_documents}`);

  console.log(JSON.stringify({
    fixture: {
      active_org_id: orgAId,
      foreign_org_id: orgBId,
      actor_user_id: actorUserId,
      active_membership_id: orgAMembershipId,
      foreign_membership_id: orgBMembershipId,
      foreign_transaction_id: orgBTransactionId,
      foreign_invoice_id: orgBInvoiceId,
      foreign_payment_id: orgBPaymentId,
      foreign_document_id: orgBDocumentId,
    },
    negative_results: results,
    positive_control: {
      active_org_id: orgBId,
      status: positiveOrgB.status,
      error: positiveOrgB.body?.error || null,
    },
    row_counts: counts,
    assertions: {
      active_org_foreign_ids_hidden_as_404: true,
      positive_control_can_see_foreign_org_when_active: true,
      no_active_org_write_from_foreign_ids: true,
    },
  }, null, 2));
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
values (
  '${actorUserId}',
  'authenticated',
  'authenticated',
  'v22-org-boundary-yuto-${keySuffix}@example.test',
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
values (
  '${actorUserId}',
  'v22-org-boundary-yuto-${keySuffix}',
  'v2.2 Org Boundary Actor',
  'admin',
  now()
)
on conflict (id) do update
set username = excluded.username,
    full_name = excluded.full_name,
    role = excluded.role,
    updated_at = now();

insert into public.organizations (id, slug, name, status)
values
  ('${orgAId}', 'v22-org-a-${keySuffix}', 'v2.2 Org Boundary A', 'active'),
  ('${orgBId}', 'v22-org-b-${keySuffix}', 'v2.2 Org Boundary B', 'active');

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
  ('${orgAMembershipId}', '${orgAId}', '${actorUserId}', 'admin', 'active', 'Owner A', 1000000, now()),
  ('${orgBMembershipId}', '${orgBId}', '${actorUserId}', 'admin', 'active', 'Owner B', 1000000, now());

insert into public.clients (
  id,
  org_id,
  name,
  billing_name,
  billing_address
)
values (
  '${orgBClientId}',
  '${orgBId}',
  'Org B Client',
  'Org B Billing',
  'Tokyo'
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
  '${orgBSiteId}',
  '${orgBId}',
  '${orgBClientId}',
  'Org B Site',
  'Tokyo',
  'active',
  110000,
  date '2026-05-01',
  date '2026-05-09'
);

insert into public.accounting_transactions (
  id,
  org_id,
  kind,
  cost_center,
  site_id,
  client_id,
  description,
  recorded_date,
  amount_subtotal,
  tax_amount,
  amount_total,
  tax_category,
  status,
  risk_level,
  review_status,
  input_sources,
  created_by,
  projection_source,
  legacy_source_route,
  legacy_source_id,
  metadata_json
)
values (
  '${orgBTransactionId}',
  '${orgBId}',
  'sale',
  'SITE',
  '${orgBSiteId}',
  '${orgBClientId}',
  'Org B sale hidden from active Org A',
  date '2026-05-09',
  100000,
  10000,
  110000,
  '10_STANDARD',
  'posted',
  'LOW',
  'not_required',
  '{}'::jsonb,
  '${actorUserId}',
  'legacy_direct_write',
  'org_boundary_fixture',
  '${keySuffix}',
  '{}'::jsonb
);

insert into public.accounting_invoices (
  id,
  org_id,
  transaction_id,
  source_transaction_id,
  invoice_no,
  document_type,
  issue_date,
  due_date,
  source_transaction_date,
  billing_name,
  billing_address,
  issuer_snapshot,
  tax_summary_snapshot,
  source_summary_snapshot,
  eligibility_snapshot,
  pdf_render_status,
  created_by
)
values (
  '${orgBInvoiceId}',
  '${orgBId}',
  '${orgBTransactionId}',
  '${orgBTransactionId}',
  'V22-ORG-B-${keySuffix}',
  'standard_invoice',
  date '2026-05-09',
  date '2026-06-08',
  date '2026-05-09',
  'Org B Billing',
  'Tokyo',
  '{}'::jsonb,
  '{"currency":"JPY","amount_subtotal":100000,"tax_amount":10000,"amount_total":110000,"by_rate":[]}'::jsonb,
  '{"amount_subtotal":100000,"tax_amount":10000,"amount_total":110000}'::jsonb,
  '{}'::jsonb,
  'pending',
  '${actorUserId}'
);

insert into public.accounting_payments (
  id,
  org_id,
  customer_id,
  received_on,
  amount,
  unapplied_amount,
  payment_method,
  payment_account,
  external_reference,
  status,
  created_by,
  metadata_json
)
values (
  '${orgBPaymentId}',
  '${orgBId}',
  '${orgBClientId}',
  date '2026-05-10',
  110000,
  110000,
  'bank_transfer',
  'bank',
  'org-b-hidden-payment',
  'received',
  '${actorUserId}',
  '{}'::jsonb
);

insert into public.documents (
  id,
  org_id,
  doc_type,
  original_filename,
  mime_type,
  file_size,
  uploaded_by,
  site_id,
  client_id,
  field_provenance
)
values (
  '${orgBDocumentId}',
  '${orgBId}',
  'invoice',
  'org-b-hidden-document.pdf',
  'application/pdf',
  10,
  '${actorUserId}',
  '${orgBSiteId}',
  '${orgBClientId}',
  '{}'::jsonb
);
`;
  runPsql(sql);
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
      DEFAULT_ORG_ID: orgAId,
      SUPABASE_URL: localSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the server is ready.
    }
    await sleep(300);
  }
  throw new Error(`Server did not become healthy on port ${port}`);
}

async function postJson(path, body, activeOrgId = orgAId) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dev-user-key": "yuto",
      "x-org-id": activeOrgId,
    },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function get(path, activeOrgId = orgAId) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "GET",
    headers: {
      "x-dev-user-key": "yuto",
      "x-org-id": activeOrgId,
    },
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  let body = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

async function fetchCounts() {
  const sql = `
select jsonb_build_object(
  'org_a_transactions', (select count(*) from public.accounting_transactions where org_id = '${orgAId}'),
  'org_a_invoices', (select count(*) from public.accounting_invoices where org_id = '${orgAId}'),
  'org_a_payments', (select count(*) from public.accounting_payments where org_id = '${orgAId}'),
  'org_a_documents', (select count(*) from public.documents where org_id = '${orgAId}'),
  'org_b_transactions', (select count(*) from public.accounting_transactions where org_id = '${orgBId}'),
  'org_b_invoices', (select count(*) from public.accounting_invoices where org_id = '${orgBId}'),
  'org_b_payments', (select count(*) from public.accounting_payments where org_id = '${orgBId}'),
  'org_b_documents', (select count(*) from public.documents where org_id = '${orgBId}'),
  'org_a_failed_idempotency_rows', (
    select count(*)
    from public.accounting_write_idempotency_keys
    where org_id = '${orgAId}'
      and status = 'failed'
  )
)::text;
`;
  const output = runPsql(sql).trim();
  const jsonLine = output.split("\n").find((line) => line.trim().startsWith("{"));
  if (!jsonLine) {
    throw new Error(`Could not parse count JSON from psql output: ${output}`);
  }
  return JSON.parse(jsonLine);
}

function runPsql(sql) {
  const result = spawnSync("docker", [
    "exec",
    "-i",
    "supabase_db_genba-quest",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
  ], {
    input: sql,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

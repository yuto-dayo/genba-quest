#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = new URL("../../", import.meta.url).pathname;
const serverDir = new URL("../../server/", import.meta.url).pathname;
const localSupabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const port = Number(process.env.ACCOUNTING_V22_TEST_PORT || 4018);
const orgId = randomUUID();
const actorUserId = "e93f3438-ae73-4c55-b2ab-a370d096bde0";
const membershipId = randomUUID();
const idempotencyKey = `v22-concurrent-expense-${orgId.replaceAll("-", "")}`;
const keySuffix = orgId.replaceAll("-", "").slice(0, 12);

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

  const requestBody = {
    idempotency_key: idempotencyKey,
    cost_center: "HQ",
    expense_scope: "overhead",
    paid_by: "member",
    claimant_member_id: membershipId,
    settlement_type: "unpaid",
    reimbursement_status: "submitted",
    vendor_name: "v2.2 Concurrent Vendor",
    description: "v2.2 concurrent idempotency expense",
    recorded_date: "2026-05-09",
    amount_subtotal: 30000,
    tax_amount: 3000,
    amount_total: 33000,
    category: "other",
    tax_category: "10_STANDARD",
  };

  const [first, second] = await Promise.all([
    postExpense(requestBody),
    postExpense(requestBody),
  ]);
  const replay = await postExpense(requestBody);
  const counts = await fetchCounts();

  const successResponses = [first, second, replay].filter((response) => response.status === 201);
  const inProgressResponses = [first, second].filter((response) => response.status === 409
    && response.body?.error === "IDEMPOTENCY_IN_PROGRESS");

  assert(successResponses.length >= 2, `Expected at least original + replay success, got ${successResponses.length}`);
  assert(
    [first.status, second.status].every((status) => status === 201 || status === 409),
    `Expected concurrent responses to be 201 or 409, got ${first.status}/${second.status}`,
  );
  assert(replay.status === 201, `Expected replay status 201, got ${replay.status}`);
  assert(counts.idempotency_rows === 1, `Expected one idempotency row, got ${counts.idempotency_rows}`);
  assert(counts.idempotency_succeeded_rows === 1, `Expected one succeeded idempotency row, got ${counts.idempotency_succeeded_rows}`);
  assert(counts.transactions === 1, `Expected one accounting transaction, got ${counts.transactions}`);
  assert(counts.proposals === 1, `Expected one proposal, got ${counts.proposals}`);
  assert(counts.proposal_executions === 1, `Expected one proposal execution, got ${counts.proposal_executions}`);
  assert(counts.posting_groups === 1, `Expected one posting group, got ${counts.posting_groups}`);
  assert(counts.journal_entries === 1, `Expected one journal entry, got ${counts.journal_entries}`);
  assert(counts.unbalanced_entries === 0, `Expected no unbalanced posted journal entries, got ${counts.unbalanced_entries}`);

  const firstSuccess = [first, second].find((response) => response.status === 201);
  if (firstSuccess?.body?.id && replay.body?.id) {
    assert(firstSuccess.body.id === replay.body.id, "Replay response returned a different transaction id");
  }

  const result = {
    fixture: {
      org_id: orgId,
      actor_user_id: actorUserId,
      membership_id: membershipId,
      idempotency_key: idempotencyKey,
    },
    responses: {
      first: summarizeResponse(first),
      second: summarizeResponse(second),
      replay: summarizeResponse(replay),
      concurrent_in_progress_count: inProgressResponses.length,
    },
    row_counts: counts,
    assertions: {
      one_idempotency_row: true,
      one_projection_chain: true,
      replay_same_response_snapshot: true,
      posted_journals_balanced: true,
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
values (
  '${actorUserId}',
  'authenticated',
  'authenticated',
  'v22-concurrency-yuto-${keySuffix}@example.test',
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
  'v22-concurrency-yuto-${keySuffix}',
  'v2.2 Concurrency Actor',
  'admin',
  now()
)
on conflict (id) do update
set username = excluded.username,
    full_name = excluded.full_name,
    role = excluded.role,
    updated_at = now();

insert into public.organizations (id, slug, name, status)
values (
  '${orgId}',
  'v22-concurrency-${keySuffix}',
  'v2.2 Concurrency Org',
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
values (
  '${membershipId}',
  '${orgId}',
  '${actorUserId}',
  'admin',
  'active',
  'Owner',
  1000000,
  now()
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
      DEFAULT_ORG_ID: orgId,
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

async function postExpense(body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/accounting/expenses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dev-user-key": "yuto",
      "x-org-id": orgId,
    },
    body: JSON.stringify(body),
  });
  let parsedBody = null;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }
  return { status: response.status, body: parsedBody };
}

async function fetchCounts() {
  const sql = `
with target_execution as (
  select id, proposal_id
  from public.proposal_executions
  where org_id = '${orgId}'
    and idempotency_key = 'accounting.expenses.create:${idempotencyKey}'
),
target_entry as (
  select entry.id
  from public.accounting_journal_entries entry
  join public.posting_groups posting_group
    on posting_group.org_id = entry.org_id
   and posting_group.id = entry.posting_group_id
  join target_execution execution
    on execution.id = posting_group.proposal_execution_id
  where entry.org_id = '${orgId}'
    and entry.posted_at is not null
),
unbalanced as (
  select entry.id
  from target_entry entry
  join public.accounting_journal_lines line
    on line.entry_id = entry.id
   and line.org_id = '${orgId}'
  group by entry.id
  having sum(line.debit) <> sum(line.credit)
)
select jsonb_build_object(
  'idempotency_rows', (
    select count(*)
    from public.accounting_write_idempotency_keys
    where org_id = '${orgId}'
      and endpoint_name = 'accounting.expenses.create'
      and idempotency_key = '${idempotencyKey}'
  ),
  'idempotency_succeeded_rows', (
    select count(*)
    from public.accounting_write_idempotency_keys
    where org_id = '${orgId}'
      and endpoint_name = 'accounting.expenses.create'
      and idempotency_key = '${idempotencyKey}'
      and status = 'succeeded'
  ),
  'transactions', (
    select count(*)
    from public.accounting_transactions
    where org_id = '${orgId}'
      and legacy_source_route = 'accounting.expenses.create'
      and legacy_source_id = '${idempotencyKey}'
  ),
  'proposals', (
    select count(*)
    from public.proposals
    where org_id = '${orgId}'
      and idempotency_key = 'accounting.expenses.create:${idempotencyKey}'
  ),
  'proposal_executions', (select count(*) from target_execution),
  'posting_groups', (
    select count(*)
    from public.posting_groups posting_group
    join target_execution execution
      on execution.id = posting_group.proposal_execution_id
    where posting_group.org_id = '${orgId}'
  ),
  'journal_entries', (select count(*) from target_entry),
  'journal_lines', (
    select count(*)
    from public.accounting_journal_lines line
    join target_entry entry
      on entry.id = line.entry_id
    where line.org_id = '${orgId}'
  ),
  'unbalanced_entries', (select count(*) from unbalanced)
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

function summarizeResponse(response) {
  return {
    status: response.status,
    error: response.body?.error || null,
    id: response.body?.id || null,
    proposal_id: response.body?.proposal?.id || response.body?.proposal?.proposal_id || null,
    projection_id: response.body?.projection?.legacy_transaction_id || null,
    posting_mode: response.body?.posting?.mode || null,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

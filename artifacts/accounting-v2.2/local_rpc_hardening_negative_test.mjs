#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const actorUserId = "e93f3438-ae73-4c55-b2ab-a370d096bde0";
const orgAId = randomUUID();
const orgBId = randomUUID();
const orgAMembershipId = randomUUID();
const orgBMembershipId = randomUUID();
const keySuffix = orgAId.replaceAll("-", "").slice(0, 12);

const protectedFunctions = [
  "complete_site_rpc(uuid,uuid,uuid,timestamp with time zone)",
  "complete_site_rpc(uuid,uuid,uuid,uuid,timestamp with time zone)",
  "reverse_site_completion_rpc(uuid,uuid,uuid,timestamp with time zone,text)",
  "reverse_site_completion_rpc(uuid,uuid,uuid,uuid,timestamp with time zone,text)",
  "rpc_allocate_accounting_payment(uuid,uuid,uuid,uuid,uuid,date,numeric,jsonb)",
  "rpc_allocate_accounting_payment_canonical(uuid,uuid,uuid,text,uuid,uuid,date,numeric,jsonb,text)",
  "rpc_create_accounting_invoice(uuid,uuid[],uuid,text,date,date,date,text,text,text,text,jsonb,text,date,jsonb,jsonb,jsonb,uuid)",
  "rpc_create_accounting_invoice(uuid,uuid[],uuid,text,date,date,date,text,text,text,text,jsonb,text,date,jsonb,jsonb,jsonb,uuid,uuid)",
  "rpc_create_accounting_invoice_canonical(uuid,uuid[],uuid,text,date,date,date,text,text,text,text,jsonb,text,date,jsonb,jsonb,jsonb,uuid,uuid,text,text)",
  "rpc_post_accounting_expense_canonical(uuid,uuid,uuid,text,text,uuid,text,text,date,numeric,numeric,numeric,text,text,text,text,text,uuid,jsonb,text,text,uuid,text,text,text,uuid,text)",
  "rpc_post_accounting_sale_canonical(uuid,uuid,uuid,text,uuid,uuid,text,date,numeric,numeric,numeric,text,uuid,jsonb,jsonb,text)",
  "rpc_record_accounting_payment_allocation(uuid,uuid,date,numeric,text,text,text,uuid,jsonb)",
  "rpc_record_accounting_payment_allocation(uuid,uuid,uuid,date,numeric,text,text,text,uuid,jsonb)",
  "rpc_record_accounting_payment_event(uuid,uuid,uuid,date,numeric,uuid,text,text,text,jsonb)",
  "rpc_record_accounting_payment_event_canonical(uuid,uuid,uuid,text,date,numeric,uuid,text,text,text,jsonb,text)",
  "rpc_reverse_accounting_sale_canonical(uuid,uuid,uuid,text,uuid,text,date,text)",
];

const fixedSearchPathFunctions = [
  "complete_site_rpc(uuid,uuid,uuid,uuid,timestamp with time zone)",
  "reverse_site_completion_rpc(uuid,uuid,uuid,uuid,timestamp with time zone,text)",
  "rpc_allocate_accounting_payment(uuid,uuid,uuid,uuid,uuid,date,numeric,jsonb)",
  "rpc_allocate_accounting_payment_canonical(uuid,uuid,uuid,text,uuid,uuid,date,numeric,jsonb,text)",
  "rpc_create_accounting_invoice(uuid,uuid[],uuid,text,date,date,date,text,text,text,text,jsonb,text,date,jsonb,jsonb,jsonb,uuid,uuid)",
  "rpc_create_accounting_invoice_canonical(uuid,uuid[],uuid,text,date,date,date,text,text,text,text,jsonb,text,date,jsonb,jsonb,jsonb,uuid,uuid,text,text)",
  "rpc_post_accounting_expense_canonical(uuid,uuid,uuid,text,text,uuid,text,text,date,numeric,numeric,numeric,text,text,text,text,text,uuid,jsonb,text,text,uuid,text,text,text,uuid,text)",
  "rpc_post_accounting_sale_canonical(uuid,uuid,uuid,text,uuid,uuid,text,date,numeric,numeric,numeric,text,uuid,jsonb,jsonb,text)",
  "rpc_record_accounting_payment_allocation(uuid,uuid,uuid,date,numeric,text,text,text,uuid,jsonb)",
  "rpc_record_accounting_payment_event(uuid,uuid,uuid,date,numeric,uuid,text,text,text,jsonb)",
  "rpc_record_accounting_payment_event_canonical(uuid,uuid,uuid,text,date,numeric,uuid,text,text,text,jsonb,text)",
  "rpc_reverse_accounting_sale_canonical(uuid,uuid,uuid,text,uuid,text,date,text)",
];

const directCallCases = [
  {
    name: "anon_canonical_sale_direct_execute",
    role: "anon",
    callSql: `select public.rpc_post_accounting_sale_canonical('${orgAId}'::uuid, '${actorUserId}'::uuid, '${orgAMembershipId}'::uuid, 'direct-${keySuffix}', null::uuid, null::uuid, 'direct call must fail', current_date, 100::numeric, 10::numeric, 110::numeric, '10_STANDARD', null::uuid, '{}'::jsonb, '[]'::jsonb, 'Actor');`,
  },
  {
    name: "authenticated_canonical_invoice_direct_execute",
    role: "authenticated",
    callSql: `select public.rpc_create_accounting_invoice_canonical('${orgAId}'::uuid, array[gen_random_uuid()], gen_random_uuid(), 'standard_invoice', current_date, current_date, current_date, 'Direct Call', null, null, null, '{}'::jsonb, null, null, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '${actorUserId}'::uuid, '${orgAMembershipId}'::uuid, 'direct-${keySuffix}', 'Actor');`,
  },
  {
    name: "anon_legacy_invoice_direct_execute",
    role: "anon",
    callSql: `select public.rpc_create_accounting_invoice('${orgAId}'::uuid, array[gen_random_uuid()], gen_random_uuid(), 'standard_invoice', current_date, current_date, current_date, 'Direct Call', null, null, null, '{}'::jsonb, null, null, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '${actorUserId}'::uuid);`,
  },
  {
    name: "authenticated_membership_wrapper_direct_execute",
    role: "authenticated",
    callSql: `select public.rpc_record_accounting_payment_event('${orgAId}'::uuid, '${actorUserId}'::uuid, '${orgAMembershipId}'::uuid, current_date, 100::numeric, null::uuid, 'bank_transfer', 'bank', null, '{}'::jsonb);`,
  },
];

const membershipMismatchCases = [
  {
    name: "service_role_complete_site_wrong_membership",
    callSql: `select public.complete_site_rpc('${orgAId}'::uuid, gen_random_uuid(), '${actorUserId}'::uuid, '${orgBMembershipId}'::uuid, now());`,
  },
  {
    name: "service_role_canonical_sale_wrong_membership",
    callSql: `select public.rpc_post_accounting_sale_canonical('${orgAId}'::uuid, '${actorUserId}'::uuid, '${orgBMembershipId}'::uuid, 'mismatch-sale-${keySuffix}', null::uuid, null::uuid, 'wrong membership must fail', current_date, 100::numeric, 10::numeric, 110::numeric, '10_STANDARD', null::uuid, '{}'::jsonb, '[]'::jsonb, 'Actor');`,
  },
  {
    name: "service_role_canonical_expense_wrong_membership",
    callSql: `select public.rpc_post_accounting_expense_canonical('${orgAId}'::uuid, '${actorUserId}'::uuid, '${orgBMembershipId}'::uuid, 'mismatch-expense-${keySuffix}', 'OVERHEAD', null::uuid, 'Vendor', 'wrong membership must fail', current_date, 100::numeric, 10::numeric, 110::numeric, 'OTHER', null, null, '10_STANDARD', 'LOW', null::uuid, '{}'::jsonb, 'overhead', 'org', null::uuid, 'paid', 'bank', null, null::uuid, 'Actor');`,
  },
  {
    name: "service_role_payment_event_wrong_membership",
    callSql: `select public.rpc_record_accounting_payment_event_canonical('${orgAId}'::uuid, '${actorUserId}'::uuid, '${orgBMembershipId}'::uuid, 'mismatch-payment-${keySuffix}', current_date, 100::numeric, null::uuid, 'bank_transfer', 'bank', null, '{}'::jsonb, 'Actor');`,
  },
  {
    name: "service_role_payment_allocation_wrong_membership",
    callSql: `select public.rpc_allocate_accounting_payment_canonical('${orgAId}'::uuid, '${actorUserId}'::uuid, '${orgBMembershipId}'::uuid, 'mismatch-allocation-${keySuffix}', gen_random_uuid(), gen_random_uuid(), current_date, 100::numeric, '{}'::jsonb, 'Actor');`,
  },
  {
    name: "service_role_invoice_wrong_membership",
    callSql: `select public.rpc_create_accounting_invoice_canonical('${orgAId}'::uuid, array[gen_random_uuid()], gen_random_uuid(), 'standard_invoice', current_date, current_date, current_date, 'Wrong Membership', null, null, null, '{}'::jsonb, null, null, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '${actorUserId}'::uuid, '${orgBMembershipId}'::uuid, 'mismatch-invoice-${keySuffix}', 'Actor');`,
  },
];

main();

function main() {
  prepareFixture();

  const matrix = fetchFunctionMatrix();
  assertProtectedPrivileges(matrix);
  assertFixedSearchPath(matrix);

  const directResults = directCallCases.map((testCase) => {
    const result = runRoleCall(testCase.role, testCase.callSql);
    const output = combinedOutput(result);
    const passed = result.status !== 0 && output.includes("permission denied for function");
    assert(passed, `${testCase.name}: expected permission denied, got status=${result.status} output=${output}`);
    return {
      name: testCase.name,
      role: testCase.role,
      expected: "permission denied for function",
      status: "failed_as_expected",
      evidence: firstErrorLine(output),
    };
  });

  const mismatchResults = membershipMismatchCases.map((testCase) => {
    const result = runRoleCall("service_role", testCase.callSql);
    const output = combinedOutput(result);
    const passed = result.status !== 0 && output.includes("RPC_MEMBERSHIP_REQUIRED");
    assert(passed, `${testCase.name}: expected RPC_MEMBERSHIP_REQUIRED, got status=${result.status} output=${output}`);
    return {
      name: testCase.name,
      role: "service_role",
      expected: "RPC_MEMBERSHIP_REQUIRED",
      status: "failed_as_expected",
      evidence: firstErrorLine(output),
    };
  });

  console.log(JSON.stringify({
    fixture: {
      active_org_id: orgAId,
      foreign_org_id: orgBId,
      actor_user_id: actorUserId,
      active_membership_id: orgAMembershipId,
      foreign_membership_id: orgBMembershipId,
    },
    privilege_summary: summarizePrivileges(matrix),
    search_path_summary: summarizeSearchPath(matrix),
    direct_rpc_results: directResults,
    service_role_membership_mismatch_results: mismatchResults,
    assertions: {
      public_anon_authenticated_execute_revoked: true,
      service_role_execute_granted: true,
      membership_aware_search_path_fixed: true,
      direct_rpc_calls_fail_for_anon_authenticated: true,
      service_role_calls_fail_on_membership_mismatch: true,
    },
  }, null, 2));
}

function prepareFixture() {
  runPsql(`
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
  'v22-rpc-hardening-${keySuffix}@example.test',
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
  'v22-rpc-hardening-${keySuffix}',
  'v2.2 RPC Hardening Actor',
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
  ('${orgAId}', 'v22-rpc-a-${keySuffix}', 'v2.2 RPC Hardening A', 'active'),
  ('${orgBId}', 'v22-rpc-b-${keySuffix}', 'v2.2 RPC Hardening B', 'active');

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
`);
}

function fetchFunctionMatrix() {
  const signatures = protectedFunctions.map((signature) => `'${signature}'`).join(",");
  const output = runPsql(`
select coalesce(jsonb_agg(row_data order by row_data->>'signature'), '[]'::jsonb)::text
from (
  select jsonb_build_object(
    'signature', p.oid::regprocedure::text,
    'security_definer', p.prosecdef,
    'search_path', coalesce(array_to_string(p.proconfig, ','), ''),
    'public_execute', has_function_privilege('public', p.oid, 'EXECUTE'),
    'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) as row_data
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid::regprocedure::text in (${signatures})
) rows;
`).trim();

  const jsonLine = output.split("\n").find((line) => line.trim().startsWith("["));
  if (!jsonLine) {
    throw new Error(`Could not parse function matrix: ${output}`);
  }
  const matrix = JSON.parse(jsonLine);
  assert(matrix.length === protectedFunctions.length, `Expected ${protectedFunctions.length} protected functions, got ${matrix.length}`);
  return matrix;
}

function assertProtectedPrivileges(matrix) {
  for (const row of matrix) {
    assert(row.security_definer === true, `${row.signature}: expected SECURITY DEFINER`);
    assert(row.public_execute === false, `${row.signature}: public still has execute`);
    assert(row.anon_execute === false, `${row.signature}: anon still has execute`);
    assert(row.authenticated_execute === false, `${row.signature}: authenticated still has execute`);
    assert(row.service_role_execute === true, `${row.signature}: service_role lacks execute`);
  }
}

function assertFixedSearchPath(matrix) {
  const bySignature = new Map(matrix.map((row) => [row.signature, row]));
  for (const signature of fixedSearchPathFunctions) {
    const row = bySignature.get(signature);
    assert(row, `${signature}: missing from function matrix`);
    assert(row.search_path === "search_path=pg_catalog", `${signature}: expected search_path=pg_catalog, got ${row.search_path}`);
  }
}

function summarizePrivileges(matrix) {
  return {
    checked_functions: matrix.length,
    public_execute_false: matrix.filter((row) => row.public_execute === false).length,
    anon_execute_false: matrix.filter((row) => row.anon_execute === false).length,
    authenticated_execute_false: matrix.filter((row) => row.authenticated_execute === false).length,
    service_role_execute_true: matrix.filter((row) => row.service_role_execute === true).length,
  };
}

function summarizeSearchPath(matrix) {
  return {
    fixed_membership_aware_or_canonical_functions: fixedSearchPathFunctions.length,
    pg_catalog_fixed: matrix.filter((row) => fixedSearchPathFunctions.includes(row.signature) && row.search_path === "search_path=pg_catalog").length,
    legacy_compatibility_functions_not_counted_as_fixed: matrix
      .filter((row) => !fixedSearchPathFunctions.includes(row.signature))
      .map((row) => ({ signature: row.signature, search_path: row.search_path })),
  };
}

function runRoleCall(role, callSql) {
  return runPsqlRaw(`
begin;
set local role ${role};
${callSql}
rollback;
`);
}

function runPsql(sql) {
  const result = runPsqlRaw(sql);
  if (result.status !== 0) {
    throw new Error(`psql failed: ${combinedOutput(result)}`);
  }
  return result.stdout;
}

function runPsqlRaw(sql) {
  return spawnSync("docker", [
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
}

function combinedOutput(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim();
}

function firstErrorLine(output) {
  return output.split("\n").map((line) => line.trim()).find((line) => line.startsWith("ERROR:")) || output.split("\n")[0] || "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

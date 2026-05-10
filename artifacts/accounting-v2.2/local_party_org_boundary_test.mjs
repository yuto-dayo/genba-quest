#!/usr/bin/env node
// v2.2 P0 follow-up: party/org boundary helpers + canonical RPC wiring evidence.
//
// Verifies:
//   1. private.assert_customer_belongs_to_org / assert_member_belongs_to_org
//      reject foreign IDs with CUSTOMER_NOT_IN_ORG / MEMBER_NOT_IN_ORG and are
//      no-ops for NULL.
//   2. The 3 affected canonical posting RPCs include the new assert call in
//      their function bodies (proves the wiring migration replaced the
//      definitions, not just added unused helpers).
//   3. Direct anon/authenticated EXECUTE on the new helpers is revoked.
//
// Run: node artifacts/accounting-v2.2/local_party_org_boundary_test.mjs

import { spawnSync } from "node:child_process";

const DB_CONTAINER = "supabase_db_genba-quest";

function psql(sql, { role } = {}) {
  const args = ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t"];
  const wrapped = role
    ? `set local role ${role};\n${sql}`
    : sql;
  const r = spawnSync("docker", [...args, "-c", wrapped], { encoding: "utf-8" });
  return { code: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  PASS ${label}${detail ? "  " + detail : ""}`);
    pass++;
  } else {
    console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`);
    fail++;
  }
}

console.log("[1] helper negative tests (foreign id rejected)");
{
  const r = psql(
    `select private.assert_customer_belongs_to_org('00000000-0000-0000-0000-000000000000'::uuid, '11111111-1111-1111-1111-111111111111'::uuid);`,
  );
  check(
    "foreign customer raises CUSTOMER_NOT_IN_ORG",
    r.code !== 0 && r.stderr.includes("CUSTOMER_NOT_IN_ORG"),
    r.stderr.split("\n")[0] || "",
  );
}
{
  const r = psql(
    `select private.assert_member_belongs_to_org('00000000-0000-0000-0000-000000000000'::uuid, '11111111-1111-1111-1111-111111111111'::uuid);`,
  );
  check(
    "foreign member raises MEMBER_NOT_IN_ORG",
    r.code !== 0 && r.stderr.includes("MEMBER_NOT_IN_ORG"),
    r.stderr.split("\n")[0] || "",
  );
}

console.log("[2] helper positive tests (NULL is no-op)");
{
  const r = psql(
    `select coalesce((select private.assert_customer_belongs_to_org(NULL, '11111111-1111-1111-1111-111111111111'::uuid))::text, 'void');`,
  );
  check("NULL customer_id is no-op", r.code === 0, r.stdout || r.stderr);
}
{
  const r = psql(
    `select coalesce((select private.assert_member_belongs_to_org(NULL, '11111111-1111-1111-1111-111111111111'::uuid))::text, 'void');`,
  );
  check("NULL member_id is no-op", r.code === 0, r.stdout || r.stderr);
}

console.log("[3] canonical RPC wiring (function bodies reference helpers)");
const wiringChecks = [
  ["rpc_post_accounting_expense_canonical", "assert_member_belongs_to_org"],
  ["rpc_record_accounting_payment_event_canonical", "assert_customer_belongs_to_org"],
  ["rpc_post_accounting_sale_canonical", "assert_customer_belongs_to_org"],
];
for (const [fn, helper] of wiringChecks) {
  const r = psql(
    `select case when prosrc like '%${helper}%' then 'wired' else 'missing' end from pg_proc where proname = '${fn}';`,
  );
  check(`${fn} body references ${helper}`, r.stdout.trim() === "wired", r.stdout || r.stderr);
}

console.log("[4] direct app-role EXECUTE on helpers is revoked");
const helpers = [
  "private.assert_customer_belongs_to_org(uuid,uuid)",
  "private.assert_member_belongs_to_org(uuid,uuid)",
];
for (const sig of helpers) {
  for (const role of ["anon", "authenticated"]) {
    const r = psql(`select has_function_privilege('${role}', '${sig}', 'EXECUTE');`);
    check(
      `${role} cannot EXECUTE ${sig.split("(")[0]}`,
      r.stdout.trim() === "f",
      r.stdout || r.stderr,
    );
  }
  const r = psql(`select has_function_privilege('service_role', '${sig}', 'EXECUTE');`);
  check(
    `service_role can EXECUTE ${sig.split("(")[0]}`,
    r.stdout.trim() === "t",
    r.stdout || r.stderr,
  );
}

console.log("");
console.log(`summary: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

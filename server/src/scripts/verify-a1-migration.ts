/**
 * A-1 migration verification helper.
 *
 * Checks:
 * 1) proposals.status に proposed が残っていない
 * 2) pending は挿入可能 / proposed は制約で拒否される
 * 3) atomic RPC (approve/reject/execute) が到達可能
 * 4) assignment.create の atomic 実行で site assignment が反映される
 *
 * Usage:
 *   npx ts-node src/scripts/verify-a1-migration.ts
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

type CheckStatus = "PASS" | "FAIL";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY の両方が必要です。");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function getErrorMessage(error: unknown): string {
  if (!error) return "unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

function makeProposal(id: string, orgId: string, status: "pending" | "proposed") {
  return {
    id,
    org_id: orgId,
    type: "expense.create",
    status,
    created_by: { type: "system", id: "a1-migration-verify", name: "A1 Migration Verify" },
    payload: { amount: 1000, category: "material", description: "A-1 migration check" },
    description: "A-1 migration verification row",
    required_approvals: 1,
    approvals: [],
  };
}

function pass(name: string, detail: string): CheckResult {
  return { name, status: "PASS", detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: "FAIL", detail };
}

async function checkProposedCount(): Promise<CheckResult> {
  const { count, error } = await supabase
    .from("proposals")
    .select("id", { count: "exact", head: true })
    .eq("status", "proposed");

  if (error) {
    return fail("proposed_count", `count query failed: ${getErrorMessage(error)}`);
  }

  if ((count ?? 0) > 0) {
    return fail("proposed_count", `proposed rows remain: ${count}`);
  }

  return pass("proposed_count", "no proposed rows");
}

async function checkPendingInsert(pendingId: string, orgId: string): Promise<CheckResult> {
  const { error } = await supabase
    .from("proposals")
    .insert(makeProposal(pendingId, orgId, "pending"));

  if (error) {
    return fail("pending_insert", `pending insert failed: ${getErrorMessage(error)}`);
  }

  return pass("pending_insert", "pending insert accepted");
}

async function checkProposedRejected(proposedId: string, orgId: string): Promise<CheckResult> {
  const { error } = await supabase
    .from("proposals")
    .insert(makeProposal(proposedId, orgId, "proposed"));

  if (!error) {
    return fail("proposed_rejection", "status=proposed insert unexpectedly succeeded");
  }

  const message = getErrorMessage(error);
  if (!/check constraint|violates|status/i.test(message)) {
    return fail("proposed_rejection", `unexpected error: ${message}`);
  }

  return pass("proposed_rejection", `rejected as expected (${message})`);
}

async function cleanupProposals(ids: string[], orgId: string): Promise<CheckResult> {
  const { error } = await supabase
    .from("proposals")
    .delete()
    .eq("org_id", orgId)
    .in("id", ids);

  if (error) {
    return fail("cleanup", `cleanup failed: ${getErrorMessage(error)}`);
  }

  return pass("cleanup", "temporary rows cleaned");
}

async function checkRpc(
  functionName: string,
  args: Record<string, unknown>,
  expectedErrors: string[],
): Promise<CheckResult> {
  const { error } = await supabase.rpc(functionName, args);

  if (!error) {
    return pass(functionName, "call succeeded (function exists)");
  }

  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  const functionMissing =
    code === "PGRST202" ||
    /Could not find the function|function .* does not exist/i.test(message);
  if (functionMissing) {
    return fail(functionName, `function missing: ${message}`);
  }

  if (expectedErrors.some((expected) => message.includes(expected))) {
    return pass(functionName, `reachable (${message})`);
  }

  return fail(functionName, `unexpected error: ${message}`);
}

async function checkAssignmentAtomicSideEffect(): Promise<CheckResult> {
  const orgId = randomUUID();
  const proposalId = randomUUID();
  const siteId = randomUUID();
  const workerId = randomUUID();
  const now = new Date().toISOString();
  const executor = { type: "system", id: "a1-migration-verify", name: "A1 Migration Verify" };

  try {
    const { error: siteInsertError } = await supabase
      .from("sites")
      .insert({
        id: siteId,
        name: "A-1 migration assignment check site",
        status: "active",
      });

    if (siteInsertError) {
      return fail("assignment_atomic_side_effect", `failed to insert site: ${getErrorMessage(siteInsertError)}`);
    }

    const { error: proposalInsertError } = await supabase
      .from("proposals")
      .insert({
        id: proposalId,
        org_id: orgId,
        type: "assignment.create",
        status: "approved",
        created_by: { type: "human", id: randomUUID(), name: "A1 Verify Creator" },
        payload: {
          site_id: siteId,
          worker_ids: [workerId],
          description: "A-1 assignment atomic side effect check",
        },
        description: "A-1 assignment atomic side effect check",
        required_approvals: 1,
        approvals: [
          {
            actor: { type: "human", id: randomUUID(), name: "A1 Verify Approver" },
            decision: "approve",
            reason: "A-1 verification",
            at: now,
          },
        ],
      });

    if (proposalInsertError) {
      return fail(
        "assignment_atomic_side_effect",
        `failed to insert assignment proposal: ${getErrorMessage(proposalInsertError)}`,
      );
    }

    const executeResult = await supabase.rpc("execute_proposal_atomic", {
      p_org_id: orgId,
      p_proposal_id: proposalId,
      p_executor: executor,
    });

    if (executeResult.error) {
      return fail(
        "assignment_atomic_side_effect",
        `execute_proposal_atomic failed: ${getErrorMessage(executeResult.error)}`,
      );
    }

    const { data: siteAfter, error: siteFetchError } = await supabase
      .from("sites")
      .select("assigned_users")
      .eq("id", siteId)
      .single();

    if (siteFetchError) {
      return fail(
        "assignment_atomic_side_effect",
        `failed to fetch updated site: ${getErrorMessage(siteFetchError)}`,
      );
    }

    const assignedUsers = Array.isArray(siteAfter?.assigned_users)
      ? siteAfter.assigned_users.filter((value: unknown): value is string => typeof value === "string")
      : [];

    if (!assignedUsers.includes(workerId)) {
      return fail(
        "assignment_atomic_side_effect",
        "worker id was not added to sites.assigned_users by execute_proposal_atomic (017_execute_atomic_assignment_side_effects.sql may be missing on this environment)",
      );
    }

    return pass(
      "assignment_atomic_side_effect",
      "assignment.create atomic execution updated sites.assigned_users",
    );
  } catch (error) {
    return fail("assignment_atomic_side_effect", `unexpected error: ${getErrorMessage(error)}`);
  } finally {
    await supabase
      .from("proposals")
      .delete()
      .eq("org_id", orgId)
      .eq("id", proposalId);
    await supabase
      .from("sites")
      .delete()
      .eq("id", siteId);
  }
}

async function main() {
  const results: CheckResult[] = [];
  const orgId = randomUUID();
  const pendingId = randomUUID();
  const proposedId = randomUUID();

  results.push(await checkProposedCount());
  results.push(await checkPendingInsert(pendingId, orgId));
  results.push(await checkProposedRejected(proposedId, orgId));
  results.push(await cleanupProposals([pendingId, proposedId], orgId));

  const actor = { type: "human", id: randomUUID(), name: "A1 Migration Verify" };
  const executor = { type: "system", id: "a1-migration-verify", name: "A1 Migration Verify" };

  results.push(
    await checkRpc(
      "approve_proposal_atomic",
      {
        p_org_id: randomUUID(),
        p_proposal_id: randomUUID(),
        p_approver: actor,
        p_reason: "A-1 migration verification",
      },
      ["PROPOSAL_NOT_FOUND"],
    ),
  );
  results.push(
    await checkRpc(
      "reject_proposal_atomic",
      {
        p_org_id: randomUUID(),
        p_proposal_id: randomUUID(),
        p_rejector: actor,
        p_reason: "A-1 migration verification",
      },
      ["PROPOSAL_NOT_FOUND"],
    ),
  );
  results.push(
    await checkRpc(
      "execute_proposal_atomic",
      {
        p_org_id: randomUUID(),
        p_proposal_id: randomUUID(),
        p_executor: executor,
      },
      ["PROPOSAL_NOT_FOUND"],
    ),
  );
  results.push(await checkAssignmentAtomicSideEffect());

  console.log("=== A-1 migration verification ===");
  for (const result of results) {
    console.log(`[${result.status}] ${result.name} - ${result.detail}`);
  }

  const failures = results.filter((result) => result.status === "FAIL");
  if (failures.length > 0) {
    console.error(`\nA-1 migration verification failed (${failures.length} checks).`);
    process.exit(1);
  }

  console.log("\nAll checks passed.");
}

main().catch((error) => {
  console.error("Unexpected failure:", getErrorMessage(error));
  process.exit(1);
});

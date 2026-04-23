/**
 * A-1 migration verification helper.
 *
 * Checks:
 * 1) proposals.status に proposed が残っていない
 * 2) pending は挿入可能 / proposed は制約で拒否される
 * 3) atomic RPC (approve/reject/execute) が到達可能
 * 4) assignment.create の atomic 実行で site assignment が反映される
 * 5) leave.request の atomic 実行で personal_schedules が承認反映される
 * 6) 021 で削除した legacy 関数が public schema に残存していない
 * 7) 023 の Drive/document 連携カラムと制約（null許容 + gmail添付ユニーク）が有効
 * 8) 055 の explicit event type patch が DB に適用され、assignment.update /
 *    assignment.cancel が internal_transfer ではなく assignment.* へ記録される
 *
 * Usage:
 *   npx ts-node src/scripts/verify-a1-migration.ts
 */

import "dotenv/config";
import { randomInt, randomUUID } from "crypto";
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

function isFunctionMissingError(error: unknown): boolean {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return (
    code === "PGRST202" ||
    /Could not find the function|function .* does not exist/i.test(message)
  );
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

  const message = getErrorMessage(error);
  const functionMissing = isFunctionMissingError(error);
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

function buildFutureDateRange(): { startDate: string; endDate: string } {
  const day = randomInt(1, 27);
  const nextDay = day + 1;

  return {
    startDate: `2099-11-${String(day).padStart(2, "0")}`,
    endDate: `2099-11-${String(nextDay).padStart(2, "0")}`,
  };
}

async function checkLeaveRequestAtomicSideEffect(): Promise<CheckResult> {
  const orgId = randomUUID();
  const proposalId = randomUUID();
  const reasonMarker = `A-1 leave atomic check ${randomUUID()}`;
  const { startDate, endDate } = buildFutureDateRange();
  const executor = { type: "system", id: "a1-migration-verify", name: "A1 Migration Verify" };
  let userId: string | null = null;

  try {
    const email = `a1-verify-leave-${randomUUID()}@example.com`;
    const password = `P@ssword-${randomUUID()}-Aa1`;
    const { data: userData, error: userCreateError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (userCreateError || !userData.user?.id) {
      return fail(
        "leave_request_atomic_side_effect",
        `failed to create auth user: ${getErrorMessage(userCreateError)}`,
      );
    }
    userId = userData.user.id;

    const now = new Date().toISOString();
    const { error: proposalInsertError } = await supabase
      .from("proposals")
      .insert({
        id: proposalId,
        org_id: orgId,
        type: "leave.request",
        status: "approved",
        created_by: { type: "human", id: userId, name: "A1 Verify Creator" },
        payload: {
          user_id: userId,
          start_date: startDate,
          end_date: endDate,
          leave_type: "vacation",
          reason: reasonMarker,
        },
        description: reasonMarker,
        required_approvals: 1,
        approvals: [
          {
            actor: { type: "human", id: userId, name: "A1 Verify Approver" },
            decision: "approve",
            reason: "A-1 verification",
            at: now,
          },
        ],
      });

    if (proposalInsertError) {
      return fail(
        "leave_request_atomic_side_effect",
        `failed to insert leave.request proposal: ${getErrorMessage(proposalInsertError)}`,
      );
    }

    const executeResult = await supabase.rpc("execute_proposal_atomic", {
      p_org_id: orgId,
      p_proposal_id: proposalId,
      p_executor: executor,
    });

    if (executeResult.error) {
      return fail(
        "leave_request_atomic_side_effect",
        `execute_proposal_atomic failed: ${getErrorMessage(executeResult.error)}`,
      );
    }

    const { data: scheduleAfter, error: scheduleFetchError } = await supabase
      .from("personal_schedules")
      .select("approved, type, start_date, end_date")
      .eq("user_id", userId)
      .eq("reason", reasonMarker)
      .single();

    if (scheduleFetchError || !scheduleAfter) {
      return fail(
        "leave_request_atomic_side_effect",
        `failed to fetch leave schedule: ${getErrorMessage(scheduleFetchError)}`,
      );
    }

    if (!scheduleAfter.approved) {
      return fail(
        "leave_request_atomic_side_effect",
        "personal_schedules row exists but approved is false after execute_proposal_atomic",
      );
    }

    if (
      scheduleAfter.type !== "vacation" ||
      scheduleAfter.start_date !== startDate ||
      scheduleAfter.end_date !== endDate
    ) {
      return fail(
        "leave_request_atomic_side_effect",
        "leave schedule row does not match expected type/date range",
      );
    }

    return pass(
      "leave_request_atomic_side_effect",
      "leave.request atomic execution inserted approved personal_schedules row",
    );
  } catch (error) {
    return fail("leave_request_atomic_side_effect", `unexpected error: ${getErrorMessage(error)}`);
  } finally {
    await supabase
      .from("personal_schedules")
      .delete()
      .eq("reason", reasonMarker);
    await supabase
      .from("proposals")
      .delete()
      .eq("org_id", orgId)
      .eq("id", proposalId);
    if (userId) {
      await supabase.auth.admin.deleteUser(userId);
    }
  }
}

async function checkExplicitEventType055(
  proposalType: "assignment.update" | "assignment.cancel",
  expectedEventType: "assignment.rescheduled" | "assignment.cancelled",
): Promise<CheckResult> {
  const orgId = randomUUID();
  const proposalId = randomUUID();
  const now = new Date().toISOString();

  const payload =
    proposalType === "assignment.update"
      ? {
          assignment_id: randomUUID(),
          user_id: randomUUID(),
          site_id: randomUUID(),
          date: "2099-12-01",
          previous_site_id: randomUUID(),
          previous_date: "2099-11-28",
          reason: "A-1 explicit event type verification",
        }
      : {
          assignment_id: randomUUID(),
          user_id: randomUUID(),
          site_id: randomUUID(),
          date: "2099-12-01",
          reason: "A-1 explicit event type verification",
        };

  try {
    const { error: proposalInsertError } = await supabase
      .from("proposals")
      .insert({
        id: proposalId,
        org_id: orgId,
        type: proposalType,
        status: "approved",
        created_by: { type: "human", id: randomUUID(), name: "A1 Verify Creator" },
        payload,
        description: `A-1 ${proposalType} explicit event type verification`,
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
        `${proposalType}_event_type_055`,
        `failed to insert ${proposalType} proposal: ${getErrorMessage(proposalInsertError)}`,
      );
    }

    const executeResult = await supabase.rpc("execute_proposal_atomic", {
      p_org_id: orgId,
      p_proposal_id: proposalId,
      p_executor: { type: "system", id: "a1-migration-verify", name: "A1 Migration Verify" },
    });

    if (executeResult.error) {
      return fail(
        `${proposalType}_event_type_055`,
        `execute_proposal_atomic failed: ${getErrorMessage(executeResult.error)}`,
      );
    }

    const { data: ledgerEvent, error: ledgerEventError } = await supabase
      .from("ledger_events")
      .select("event_type")
      .eq("org_id", orgId)
      .eq("proposal_id", proposalId)
      .single();

    if (ledgerEventError || !ledgerEvent?.event_type) {
      return fail(
        `${proposalType}_event_type_055`,
        `failed to fetch ledger event: ${getErrorMessage(ledgerEventError)}`,
      );
    }

    if (ledgerEvent.event_type !== expectedEventType) {
      return fail(
        `${proposalType}_event_type_055`,
        `expected ${expectedEventType} but got ${ledgerEvent.event_type} (055_execute_proposal_explicit_event_types.sql may be missing on this environment)`,
      );
    }

    const { count: transactionCount, error: transactionCountError } = await supabase
      .from("ledger_transactions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);

    if (transactionCountError) {
      return fail(
        `${proposalType}_event_type_055`,
        `failed to count ledger transactions: ${getErrorMessage(transactionCountError)}`,
      );
    }

    if ((transactionCount ?? 0) !== 0) {
      return fail(
        `${proposalType}_event_type_055`,
        `expected no ledger journal for side-effect-thin proposal but found ${transactionCount ?? 0}`,
      );
    }

    return pass(
      `${proposalType}_event_type_055`,
      `${proposalType} recorded as ${expectedEventType} without creating ledger journal`,
    );
  } catch (error) {
    return fail(
      `${proposalType}_event_type_055`,
      `unexpected error: ${getErrorMessage(error)}`,
    );
  } finally {
    await supabase
      .from("ledger_transactions")
      .delete()
      .eq("org_id", orgId);
    await supabase
      .from("ledger_events")
      .delete()
      .eq("org_id", orgId);
    await supabase
      .from("proposals")
      .delete()
      .eq("org_id", orgId)
      .eq("id", proposalId);
  }
}

async function checkLegacyFunctionsRemoved(): Promise<CheckResult> {
  const checks: Array<{ name: string; args: Record<string, unknown> }> = [
    {
      name: "rpc_assign_random_reviewer",
      args: { p_transaction_id: randomUUID() },
    },
    {
      name: "check_schedule_conflict",
      args: {
        p_user_id: randomUUID(),
        p_start_date: "2099-12-01",
        p_end_date: "2099-12-02",
      },
    },
    {
      name: "is_feature_enabled",
      args: {
        p_feature_key: "gmail_auto_quest",
        p_user_id: randomUUID(),
      },
    },
  ];

  const remainingFunctions: string[] = [];

  for (const check of checks) {
    const { error } = await supabase.rpc(check.name, check.args);

    if (!error) {
      remainingFunctions.push(check.name);
      continue;
    }

    if (!isFunctionMissingError(error)) {
      remainingFunctions.push(`${check.name}(${getErrorMessage(error)})`);
    }
  }

  if (remainingFunctions.length > 0) {
    return fail("legacy_functions_removed", `legacy functions still reachable: ${remainingFunctions.join(", ")}`);
  }

  return pass("legacy_functions_removed", "legacy functions are not reachable via RPC");
}

function buildPseudoSha256(seed: string): string {
  return seed.replace(/-/g, "").padEnd(64, "0").slice(0, 64);
}

async function checkDriveAttachmentSchema023(): Promise<CheckResult> {
  const messageId = `verify-023-msg-${randomUUID()}`;
  const attachmentId = `verify-023-att-${randomUUID()}`;
  const driveFileId = `verify-023-file-${randomUUID()}`;
  const driveFolderId = `verify-023-folder-${randomUUID()}`;
  let insertedId: string | null = null;

  const cleanup = async () => {
    await supabase
      .from("documents")
      .delete()
      .eq("gmail_message_id", messageId)
      .eq("gmail_attachment_id", attachmentId);
  };

  try {
    const { error: documentColumnError } = await supabase
      .from("documents")
      .select("id,gmail_message_id,gmail_attachment_id,drive_file_id,drive_file_url,drive_folder_id,ocr_text")
      .limit(1);

    if (documentColumnError) {
      return fail(
        "drive_attachment_schema_023",
        `documents drive columns are not accessible: ${getErrorMessage(documentColumnError)}`,
      );
    }

    const { error: proposalColumnError } = await supabase
      .from("proposals")
      .select("id,document_id,site_id")
      .limit(1);

    if (proposalColumnError) {
      return fail(
        "drive_attachment_schema_023",
        `proposals document/site columns are not accessible: ${getErrorMessage(proposalColumnError)}`,
      );
    }

    const { data: inserted, error: firstInsertError } = await supabase
      .from("documents")
      .insert({
        doc_type: "other",
        storage_path: null,
        uploaded_by: null,
        original_filename: "verify-023-source.pdf",
        mime_type: "application/pdf",
        file_size: 1234,
        sha256: buildPseudoSha256(randomUUID()),
        gmail_message_id: messageId,
        gmail_attachment_id: attachmentId,
        drive_file_id: driveFileId,
        drive_file_url: `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        drive_folder_id: driveFolderId,
      })
      .select("id,storage_path,uploaded_by")
      .single();

    if (firstInsertError || !inserted?.id) {
      return fail("drive_attachment_schema_023", `documents insert failed: ${getErrorMessage(firstInsertError)}`);
    }

    insertedId = inserted.id;

    if (inserted.storage_path !== null || inserted.uploaded_by !== null) {
      return fail(
        "drive_attachment_schema_023",
        "documents.storage_path / uploaded_by are expected nullable after 023 but non-null value was returned",
      );
    }

    const { error: duplicateInsertError } = await supabase
      .from("documents")
      .insert({
        doc_type: "other",
        storage_path: null,
        uploaded_by: null,
        original_filename: "verify-023-duplicate.pdf",
        mime_type: "application/pdf",
        file_size: 5678,
        sha256: buildPseudoSha256(randomUUID()),
        gmail_message_id: messageId,
        gmail_attachment_id: attachmentId,
        drive_file_id: `verify-023-file-${randomUUID()}`,
      });

    if (!duplicateInsertError) {
      return fail(
        "drive_attachment_schema_023",
        "duplicate gmail_message_id + gmail_attachment_id insert unexpectedly succeeded",
      );
    }

    const duplicateMessage = getErrorMessage(duplicateInsertError);
    if (!/duplicate key value|documents_gmail_attachment_unique_idx/i.test(duplicateMessage)) {
      return fail(
        "drive_attachment_schema_023",
        `unexpected duplicate insert error: ${duplicateMessage}`,
      );
    }

    return pass(
      "drive_attachment_schema_023",
      "023 columns reachable, nullable fields accepted, and gmail attachment unique index enforced",
    );
  } catch (error) {
    return fail("drive_attachment_schema_023", `unexpected error: ${getErrorMessage(error)}`);
  } finally {
    await cleanup();
    if (insertedId) {
      await supabase
        .from("documents")
        .delete()
        .eq("id", insertedId);
    }
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
  results.push(await checkLeaveRequestAtomicSideEffect());
  results.push(await checkExplicitEventType055("assignment.update", "assignment.rescheduled"));
  results.push(await checkExplicitEventType055("assignment.cancel", "assignment.cancelled"));
  results.push(await checkLegacyFunctionsRemoved());
  results.push(await checkDriveAttachmentSchema023());

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

/**
 * Verify manual Gmail webhook E2E evidence.
 *
 * Usage:
 *   npx ts-node src/scripts/verify-gmail-manual-e2e.ts \
 *     --org-id <org_uuid> \
 *     --approve-id <proposal_uuid> \
 *     --reject-id <proposal_uuid>
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type CheckStatus = "PASS" | "FAIL";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface ProposalRecord {
  id: string;
  org_id: string;
  status: string;
  rejection_reason: string | null;
  created_by: unknown;
  payload: unknown;
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }

    result[key] = value;
    i += 1;
  }

  return result;
}

function pass(name: string, detail: string): CheckResult {
  return { name, status: "PASS", detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: "FAIL", detail };
}

function printUsageAndExit(): never {
  console.error("Usage:");
  console.error("  npx ts-node src/scripts/verify-gmail-manual-e2e.ts \\");
  console.error("    --org-id <org_uuid> \\");
  console.error("    --approve-id <proposal_uuid> \\");
  console.error("    --reject-id <proposal_uuid>");
  process.exit(1);
}

function extractIntegrationMeta(payload: unknown): { source: string | null; externalId: string | null } {
  if (typeof payload !== "object" || payload === null) {
    return { source: null, externalId: null };
  }

  const integration = (payload as Record<string, unknown>)._integration;
  if (typeof integration !== "object" || integration === null) {
    return { source: null, externalId: null };
  }

  const sourceRaw = (integration as Record<string, unknown>).source;
  const externalIdRaw = (integration as Record<string, unknown>).external_id;

  return {
    source: typeof sourceRaw === "string" ? sourceRaw : null,
    externalId: typeof externalIdRaw === "string" ? externalIdRaw : null,
  };
}

function checkIntegrationOrigin(name: string, proposal: ProposalRecord): CheckResult {
  if (typeof proposal.created_by !== "object" || proposal.created_by === null) {
    return fail(name, "created_by is not an object");
  }

  const createdBy = proposal.created_by as Record<string, unknown>;
  const actorType = createdBy.type;
  const actorId = createdBy.id;
  if (actorType !== "integration" || actorId !== "integration:gmail") {
    return fail(name, `unexpected actor (${String(actorType)} / ${String(actorId)})`);
  }

  const integrationMeta = extractIntegrationMeta(proposal.payload);
  if (integrationMeta.source !== "gmail") {
    return fail(name, `unexpected _integration.source (${integrationMeta.source ?? "null"})`);
  }

  if (!integrationMeta.externalId) {
    return fail(name, "payload._integration.external_id is missing");
  }

  return pass(name, `source=gmail, external_id=${integrationMeta.externalId}`);
}

async function fetchProposal(
  supabase: any,
  orgId: string,
  proposalId: string,
): Promise<ProposalRecord> {
  const { data, error } = await supabase
    .from("proposals")
    .select("id, org_id, status, rejection_reason, created_by, payload")
    .eq("org_id", orgId)
    .eq("id", proposalId)
    .single();

  if (error) {
    throw new Error(`failed to fetch proposal ${proposalId}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`proposal not found: ${proposalId}`);
  }

  return data as ProposalRecord;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orgId = args["org-id"];
  const approveProposalId = args["approve-id"];
  const rejectProposalId = args["reject-id"];

  if (!orgId || !approveProposalId || !rejectProposalId) {
    printUsageAndExit();
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

  const checks: CheckResult[] = [];

  try {
    const approveProposal = await fetchProposal(supabase, orgId, approveProposalId);
    const rejectProposal = await fetchProposal(supabase, orgId, rejectProposalId);

    checks.push(
      checkIntegrationOrigin("approve_origin", approveProposal),
      checkIntegrationOrigin("reject_origin", rejectProposal),
    );

    if (approveProposal.status === "approved" || approveProposal.status === "executed") {
      checks.push(pass("approve_status", `status=${approveProposal.status}`));
    } else {
      checks.push(fail("approve_status", `expected approved/executed but got ${approveProposal.status}`));
    }

    if (rejectProposal.status === "rejected") {
      checks.push(pass("reject_status", "status=rejected"));
    } else {
      checks.push(fail("reject_status", `expected rejected but got ${rejectProposal.status}`));
    }

    if (typeof rejectProposal.rejection_reason === "string" && rejectProposal.rejection_reason.trim().length > 0) {
      checks.push(pass("reject_reason", rejectProposal.rejection_reason.trim()));
    } else {
      checks.push(fail("reject_reason", "rejection_reason is empty"));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(fail("fetch", message));
  }

  console.log("=== Gmail webhook manual E2E verification ===");
  console.log(`org_id=${orgId}`);
  console.log(`approve_id=${approveProposalId}`);
  console.log(`reject_id=${rejectProposalId}`);
  for (const check of checks) {
    console.log(`[${check.status}] ${check.name} - ${check.detail}`);
  }

  const failures = checks.filter((check) => check.status === "FAIL");
  if (failures.length > 0) {
    console.error(`\nVerification failed (${failures.length} check(s)).`);
    process.exit(1);
  }

  console.log("\nAll checks passed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Unexpected failure:", message);
  process.exit(1);
});

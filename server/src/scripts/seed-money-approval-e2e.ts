import "dotenv/config";
import { createHash } from "crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { getDevDefaultOrgId } from "../config/devAuthUsers";

const APPLY = process.argv.includes("--apply");
const CLEANUP = process.argv.includes("--cleanup");
const STATUS = process.argv.includes("--status");

const ORG_ID = process.env.MONEY_E2E_ORG_ID || process.env.DEFAULT_ORG_ID || process.env.PATH_DEV_ORG_ID || getDevDefaultOrgId();
const SEED_KEY = process.env.MONEY_E2E_SEED_KEY || "money-beta-mvp-e2e";
const PROPOSAL_ID = process.env.MONEY_E2E_PROPOSAL_ID || deterministicUuid(`${SEED_KEY}:${ORG_ID}`);

const fixtureActor = {
  type: "integration",
  id: "money-beta-mvp-e2e",
  name: "Money E2E Fixture",
};

function deterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20, 32).join("")}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildFixtureProposal() {
  return {
    id: PROPOSAL_ID,
    org_id: ORG_ID,
    type: "expense.create",
    status: "pending",
    created_by: fixtureActor,
    payload: {
      seed_key: SEED_KEY,
      source: "money_beta_mvp_e2e",
      amount: 12000,
      amount_total: 12000,
      vendor_name: "MVP検証 使い捨て取引先",
      category: "material",
      expense_account_code: "5110",
      recorded_date: today(),
      description: "Money承認E2E用の使い捨て経費",
      risk_level: "使い捨てfixture。承認/却下/実行の検証用",
    },
    description: "Money承認E2E: 使い捨て経費 ¥12,000",
    policy_ref: "beta_mvp_e2e",
    approvals: [],
    required_approvals: 1,
  };
}

async function cleanupFixture(): Promise<void> {
  const { error: eventDeleteError } = await supabaseAdmin
    .from("ledger_events")
    .delete()
    .eq("org_id", ORG_ID)
    .eq("proposal_id", PROPOSAL_ID);

  if (eventDeleteError) {
    throw new Error(`Failed to cleanup ledger_events: ${eventDeleteError.message}`);
  }

  const { error: proposalDeleteError } = await supabaseAdmin
    .from("proposals")
    .delete()
    .eq("org_id", ORG_ID)
    .eq("id", PROPOSAL_ID);

  if (proposalDeleteError) {
    throw new Error(`Failed to cleanup proposal: ${proposalDeleteError.message}`);
  }
}

async function insertFixture(): Promise<void> {
  await cleanupFixture();

  const { error } = await supabaseAdmin
    .from("proposals")
    .insert(buildFixtureProposal());

  if (error) {
    throw new Error(`Failed to insert fixture proposal: ${error.message}`);
  }
}

async function printStatus(): Promise<void> {
  const { data: proposal, error: proposalError } = await supabaseAdmin
    .from("proposals")
    .select("id,status,type,description,required_approvals,approvals,result_event_id,created_by,payload")
    .eq("org_id", ORG_ID)
    .eq("id", PROPOSAL_ID)
    .maybeSingle();

  if (proposalError) {
    throw new Error(`Failed to fetch fixture proposal: ${proposalError.message}`);
  }

  const { data: events, error: eventError } = await supabaseAdmin
    .from("ledger_events")
    .select("id,event_type")
    .eq("org_id", ORG_ID)
    .eq("proposal_id", PROPOSAL_ID);

  if (eventError) {
    throw new Error(`Failed to fetch ledger_events: ${eventError.message}`);
  }

  const eventIds = (events || []).map((event) => event.id);
  let transactionIds: string[] = [];
  if (eventIds.length > 0) {
    const { data: transactions, error: transactionError } = await supabaseAdmin
      .from("ledger_transactions")
      .select("id")
      .eq("org_id", ORG_ID)
      .in("event_id", eventIds);

    if (transactionError) {
      throw new Error(`Failed to fetch ledger_transactions: ${transactionError.message}`);
    }

    transactionIds = (transactions || []).map((transaction) => transaction.id);
  }

  let entryCount = 0;
  if (transactionIds.length > 0) {
    const { count, error: entryError } = await supabaseAdmin
      .from("ledger_entries")
      .select("id", { count: "exact", head: true })
      .in("transaction_id", transactionIds);

    if (entryError) {
      throw new Error(`Failed to count ledger_entries: ${entryError.message}`);
    }

    entryCount = count ?? 0;
  }

  console.log("[seed-money-approval-e2e] status", {
    org_id: ORG_ID,
    proposal_id: PROPOSAL_ID,
    proposal_status: proposal?.status ?? "missing",
    event_count: eventIds.length,
    transaction_count: transactionIds.length,
    entry_count: entryCount,
    money_url: `http://127.0.0.1:5173/money?proposal=${PROPOSAL_ID}`,
    today_url: `http://127.0.0.1:5173/?proposal=${PROPOSAL_ID}`,
  });
}

async function main(): Promise<void> {
  console.log("[seed-money-approval-e2e] target", {
    apply: APPLY,
    cleanup: CLEANUP,
    status: STATUS,
    org_id: ORG_ID,
    proposal_id: PROPOSAL_ID,
  });

  if (CLEANUP) {
    await cleanupFixture();
    console.log("[seed-money-approval-e2e] cleanup completed");
    return;
  }

  if (APPLY) {
    await insertFixture();
    console.log("[seed-money-approval-e2e] fixture inserted");
    await printStatus();
    return;
  }

  if (STATUS) {
    await printStatus();
    return;
  }

  console.log("[seed-money-approval-e2e] dry-run only. Use --apply, --status, or --cleanup.");
  console.log("[seed-money-approval-e2e] money URL:", `http://127.0.0.1:5173/money?proposal=${PROPOSAL_ID}`);
}

void main().catch((error) => {
  console.error("[seed-money-approval-e2e] failed:", error);
  process.exit(1);
});

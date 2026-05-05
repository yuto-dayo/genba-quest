import "dotenv/config";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { getDevDefaultOrgId } from "../config/devAuthUsers";
import {
  PATH_V31_DEFAULT_RULE_CONSTANTS,
  PATH_V31_RULE_VERSION,
} from "../lib/pathV31Config";
import { hashStableRecord } from "../services/PathPolicyBundleService";

const APPLY = process.argv.includes("--apply");
const MONTH = process.env.PATH_DEV_REWARD_MONTH || "2026-05";
const ORG_ID = process.env.DEFAULT_ORG_ID || process.env.PATH_DEV_ORG_ID || getDevDefaultOrgId();

const actor = {
  type: "system",
  id: "path-v31-dev-reward-seed",
  name: "PATH V3.1 Dev Reward Seed",
};

const memberIds = {
  yuto: "e93f3438-ae73-4c55-b2ab-a370d096bde0",
  jay: "22222222-2222-4222-8222-0000000000a2",
  teru: "33333333-3333-4333-8333-0000000000a3",
  daito: "44444444-4444-4444-8444-0000000000a4",
};

const siteAId = "90000000-0000-4000-8000-0000000000a1";
const siteBId = "90000000-0000-4000-8000-0000000000b2";
const proposalAId = "91000000-0000-4000-8000-0000000000a1";
const proposalBId = "91000000-0000-4000-8000-0000000000b2";
const closeAId = "92000000-0000-4000-8000-0000000000a1";
const closeBId = "92000000-0000-4000-8000-0000000000b2";

function iso(day: number): string {
  return `${MONTH}-${String(day).padStart(2, "0")}T00:00:00.000Z`;
}

const sites = [
  {
    id: siteAId,
    org_id: ORG_ID,
    name: "PATH検証 ランダムA",
    revenue: 1_500_000,
    status: "completed",
    completed_at: iso(10),
  },
  {
    id: siteBId,
    org_id: ORG_ID,
    name: "PATH検証 ランダムB",
    revenue: 1_800_000,
    status: "completed",
    completed_at: iso(20),
  },
];

const proposals = [
  {
    id: proposalAId,
    org_id: ORG_ID,
    type: "site.complete",
    status: "executed",
    site_id: siteAId,
    created_by: actor,
    executed_by: actor,
    executed_at: iso(10),
    description: `${MONTH} PATH検証 ランダムA 締め`,
    payload: {
      seed_key: "path-v31-dev-reward",
      calculation_system: "path_v31",
      month: MONTH,
      site_id: siteAId,
    },
    policy_ref: "dev_seed",
    approvals: [],
    required_approvals: 0,
  },
  {
    id: proposalBId,
    org_id: ORG_ID,
    type: "site.complete",
    status: "executed",
    site_id: siteBId,
    created_by: actor,
    executed_by: actor,
    executed_at: iso(20),
    description: `${MONTH} PATH検証 ランダムB 締め`,
    payload: {
      seed_key: "path-v31-dev-reward",
      calculation_system: "path_v31",
      month: MONTH,
      site_id: siteBId,
    },
    policy_ref: "dev_seed",
    approvals: [],
    required_approvals: 0,
  },
];

const rule = {
  org_id: ORG_ID,
  version: PATH_V31_RULE_VERSION,
  effective_from: `${MONTH}-01`,
  status: "active",
  fingerprint: hashStableRecord(PATH_V31_DEFAULT_RULE_CONSTANTS),
  constants_json: PATH_V31_DEFAULT_RULE_CONSTANTS as unknown as Record<string, unknown>,
  created_by: actor,
};

const siteCloses = [
  {
    id: closeAId,
    org_id: ORG_ID,
    site_id: siteAId,
    proposal_id: proposalAId,
    recognized_revenue: 1_500_000,
    material_cost: 400_000,
    external_cost: 100_000,
    direct_cost: 80_000,
    overhead_allocated: 20_000,
    known_rework_cost: 0,
    approved_adjustments: 0,
    distributable_profit: 900_000,
    difficulty_band: "S2",
    share_mode: "fixed_template",
    fixed_template_key: null,
    fixed_template_reason_code: "random_base_role_responsibility_demo",
    share_snapshot: [
      { member_id: memberIds.yuto, credited_units: 14, result_share: 0.46, role_type: "lead", result_eligible: true },
      { member_id: memberIds.jay, credited_units: 8, result_share: 0.18, role_type: "assist", result_eligible: true },
      { member_id: memberIds.teru, credited_units: 10, result_share: 0.27, role_type: "solo", result_eligible: true },
      { member_id: memberIds.daito, credited_units: 6, result_share: 0.09, role_type: "support", result_eligible: true },
    ],
    path_rule_version: PATH_V31_RULE_VERSION,
    path_rule_fingerprint: rule.fingerprint,
    calculation_snapshot: { seed_key: "path-v31-dev-reward", month: MONTH },
    closed_at: iso(10),
    closed_by: actor,
    status: "finalized",
  },
  {
    id: closeBId,
    org_id: ORG_ID,
    site_id: siteBId,
    proposal_id: proposalBId,
    recognized_revenue: 1_800_000,
    material_cost: 450_000,
    external_cost: 150_000,
    direct_cost: 70_000,
    overhead_allocated: 30_000,
    known_rework_cost: 0,
    approved_adjustments: 0,
    distributable_profit: 1_100_000,
    difficulty_band: "S3",
    share_mode: "fixed_template",
    fixed_template_key: null,
    fixed_template_reason_code: "random_base_role_responsibility_demo",
    share_snapshot: [
      { member_id: memberIds.yuto, credited_units: 5, result_share: 0.12, role_type: "assist", result_eligible: true },
      { member_id: memberIds.jay, credited_units: 13, result_share: 0.34, role_type: "lead", result_eligible: true },
      { member_id: memberIds.teru, credited_units: 7, result_share: 0.16, role_type: "assist", result_eligible: true },
      { member_id: memberIds.daito, credited_units: 15, result_share: 0.38, role_type: "solo", result_eligible: true },
    ],
    path_rule_version: PATH_V31_RULE_VERSION,
    path_rule_fingerprint: rule.fingerprint,
    calculation_snapshot: { seed_key: "path-v31-dev-reward", month: MONTH },
    closed_at: iso(20),
    closed_by: actor,
    status: "finalized",
  },
];

const dayLogs = siteCloses.flatMap((close, closeIndex) =>
  (close.share_snapshot as Array<{ member_id: string; credited_units: number; role_type: string }>).map((member, memberIndex) => ({
    id: `93000000-0000-4000-8000-0000000000${closeIndex}${memberIndex}`,
    org_id: ORG_ID,
    date: `${MONTH}-${String(10 + closeIndex).padStart(2, "0")}`,
    site_id: close.site_id,
    member_id: member.member_id,
    trade_families: ["wall_finish"],
    role_type: member.role_type,
    credited_unit: member.credited_units,
    memo: "path-v31-dev-reward",
    locked_by_site_close_id: close.id,
  })),
);

async function upsert(table: string, rows: Array<Record<string, unknown>>, onConflict = "id"): Promise<void> {
  const { error } = await supabaseAdmin.from(table).upsert(rows, { onConflict });
  if (error) {
    throw new Error(`Failed to upsert ${table}: ${error.message}`);
  }
}

async function main(): Promise<void> {
  console.log("[seed-path-v31-dev-reward] target", {
    apply: APPLY,
    org_id: ORG_ID,
    month: MONTH,
    sites: sites.map((site) => site.name),
    members: memberIds,
    expected_pool_amount: 2_000_000,
  });

  if (!APPLY) {
    console.log("[seed-path-v31-dev-reward] dry-run only. Re-run with --apply to write dev fixture data.");
    return;
  }

  await upsert("path_rule_versions", [rule], "org_id,version");
  await upsert("sites", sites);
  await upsert("proposals", proposals);
  await upsert("site_closes", siteCloses);
  await upsert("site_day_logs", dayLogs);

  console.log("[seed-path-v31-dev-reward] completed");
}

void main().catch((error) => {
  console.error("[seed-path-v31-dev-reward] failed:", error);
  process.exitCode = 1;
});

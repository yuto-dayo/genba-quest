import "dotenv/config";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { DeterministicPathReviewer } from "../services/DeterministicPathReviewer";
import { PathGovernedModuleService } from "../services/PathGovernedModuleService";
import { PathPolicyBundleService } from "../services/PathPolicyBundleService";
import { ActorRef } from "../services/PolicyEngine";
import { ProposalService } from "../services/ProposalService";

const ORG_ID = process.env.DEFAULT_ORG_ID || "00000000-0000-0000-0000-000000000001";
const TARGET_MONTH = process.env.PATH_VERTICAL_SLICE_MONTH || "2026-04";
const CORRECTION_MONTH = process.env.PATH_VERTICAL_SLICE_CORRECTION_MONTH || "2026-05";

async function main(): Promise<void> {
  const policyService = new PathPolicyBundleService(ORG_ID);
  const pathService = new PathGovernedModuleService(ORG_ID);
  const proposalService = new ProposalService(ORG_ID);
  const reviewer = new DeterministicPathReviewer();

  const guildMembers = await resolveGuildMembers();

  const actor: ActorRef = {
    type: "human" as const,
    id: guildMembers[0].id,
    name: guildMembers[0].name,
  };
  const approver: ActorRef = {
    type: "human",
    id: guildMembers[1].id,
    name: guildMembers[1].name,
  };

  const existingBundle = await findSingle(
    "policy_bundle_versions",
    "id, fingerprint, published_proposal_id",
    (query) => query.eq("org_id", ORG_ID).eq("effective_from", `${TARGET_MONTH}-01`),
  );

  if (!existingBundle) {
    const publishPayload = policyService.buildPublishPayload(
      {
        effective_from: `${TARGET_MONTH}-01`,
      },
      actor,
    );

    await createAndApproveProposal(
      proposalService,
      approver,
      {
        type: "policy.update",
        description: `${TARGET_MONTH} PATH policy publish`,
        payload: publishPayload,
        created_by: actor,
      },
      "seed publish PATH bundle",
    );
  }

  const monthlyInput = await pathService.upsertMonthlyCloseInput(
    {
      month: TARGET_MONTH,
      member_id: guildMembers[0].id,
      role_level: "L3",
      trade_family_observations: {
        wall_finish: "lead",
        floor_finish: "support",
      },
      aqr_input: {
        A: 2,
        R: 2,
        Q: 1,
      },
      selected_site_ids: ["44444444-4444-4444-8444-444444444444"],
      comment: "壁装主担当、床仕上は補助",
    },
    actor,
  );

  const evidence =
    (await findSingle(
      "path_evidence_records",
      "id, origin_event_id",
      (query) =>
        query
          .eq("org_id", ORG_ID)
          .eq("month", TARGET_MONTH)
          .eq("member_id", guildMembers[0].id)
          .eq("origin_event_id", "site-a-package-1"),
    )) ??
    (await pathService.recordEvidence(
      {
        month: TARGET_MONTH,
        member_id: guildMembers[0].id,
        trade_family: "wall_finish",
        evidence_class: "performance_evidence",
        origin_event_id: "site-a-package-1",
        source_type: "daily_report",
        source_ref: "report-2026-04-18",
        summary: "壁装の主担当を完了",
        metadata: { quality_result: "pass" },
      },
      actor,
    ));

  const [inputs, evidenceRecords] = await Promise.all([
    pathService.listMonthlyCloseInputs({
      month: TARGET_MONTH,
      member_id: guildMembers[0].id,
      limit: 1,
    }),
    pathService.listEvidence({
      month: TARGET_MONTH,
      member_id: guildMembers[0].id,
      limit: 50,
    }),
  ]);

  const monthlyForm = inputs[0];
  const tradeFamilies = Object.keys(monthlyForm?.trade_family_observations ?? {}) as Array<
    "wall_finish" | "floor_finish" | "substrate_preparation" | "decorative_sheet_or_film" | "common_site_operations"
  >;

  const reviewerA = reviewer.reviewA({
    month: TARGET_MONTH,
    member_id: guildMembers[0].id,
    trade_families: tradeFamilies,
    evidence: evidenceRecords,
    monthly_form_comment: monthlyForm?.comment,
  });

  await pathService.upsertAiAnnotation(
    {
      month: TARGET_MONTH,
      member_id: guildMembers[0].id,
      reviewer_kind: "A",
      adapter_key: "deterministic-fixture",
      annotation: reviewerA as unknown as Record<string, unknown>,
      supporting_evidence_ids: reviewerA.supporting_evidence_ids,
      challenged_evidence_ids: [],
    },
    {
      type: "ai",
      id: "path-reviewer-a",
      name: "PATH Reviewer A (deterministic)",
    },
  );

  const reviewerB = reviewer.reviewB({
    trade_families: tradeFamilies,
    evidence: evidenceRecords,
    reviewerA,
  });

  await pathService.upsertAiAnnotation(
    {
      month: TARGET_MONTH,
      member_id: guildMembers[0].id,
      reviewer_kind: "B",
      adapter_key: "deterministic-fixture",
      annotation: reviewerB as unknown as Record<string, unknown>,
      supporting_evidence_ids: [],
      challenged_evidence_ids: reviewerB.challenged_evidence_ids,
    },
    {
      type: "ai",
      id: "path-reviewer-b",
      name: "PATH Reviewer B (deterministic)",
    },
  );

  const existingMonthClose = await findSingle(
    "path_month_closes",
    "id, proposal_id",
    (query) =>
      query
        .eq("org_id", ORG_ID)
        .eq("month", TARGET_MONTH)
        .eq("member_id", guildMembers[0].id),
  );

  if (!existingMonthClose) {
    const monthClosePayload = await pathService.buildMonthlyCloseProposalPayload({
      month: TARGET_MONTH,
      member_id: guildMembers[0].id,
      current_role_level: "L3",
      A: 2,
      R: 2,
      Q: 1,
      neutral_flags: [],
      evidence_ids: [String(evidence.id)],
      credited_units: [
        {
          member_id: guildMembers[0].id,
          unit_type: "work_day",
          units: 22,
          source_id: `input:${monthlyInput.id}`,
          metadata: { source: "seed-path-vertical-slice" },
        },
      ],
      opportunity_audits: [
        {
          member_id: guildMembers[0].id,
          trade_family: "wall_finish",
          opportunity_status: "observed",
          eligible_but_unassigned_days: 0,
          opportunity_concentration_score: 0.1,
          promotion_blocked_by_opportunity: false,
          protected_challenge_count: 0,
          summary: { note: "seed month close" },
        },
      ],
      explanation: {
        reviewer_summary: "seeded month close path",
      },
    });

    await createAndApproveProposal(
      proposalService,
      approver,
      {
        type: "evaluation.finalize",
        description: `${TARGET_MONTH} PATH month close`,
        payload: monthClosePayload,
        created_by: actor,
      },
      "seed month close approval",
    );
  }

  const monthClose = await requireSingle(
    "path_month_closes",
    "id, proposal_id, policy_fingerprint, input_hash",
    (query) =>
      query
        .eq("org_id", ORG_ID)
        .eq("month", TARGET_MONTH)
        .eq("member_id", guildMembers[0].id),
  );

  const preview = await pathService.calculateRewardPreview({
    month: TARGET_MONTH,
    close_id: String(monthClose.id),
    pool: {
      recognized_revenue: 900000,
      direct_costs: 420000,
      overhead_allocated: 100000,
      rule_reserve: 30000,
      prior_period_adjustments: 10000,
    },
    members: [
      {
        member_id: guildMembers[0].id,
        name: guildMembers[0].name,
        role_level: "L3",
        credited_units: 20,
        A: 2,
        R: 2,
        Q: 1,
        package_contributions: [
          {
            package_id: "pkg-wall-1",
            trade_family: "wall_finish",
            std_hours: 18,
            difficulty_band: "S2",
            responsibility_share: 0.7,
            role_type: "lead",
            quality_result: "pass",
            rated_units: 12,
          },
        ],
      },
      {
        member_id: guildMembers[1].id,
        name: guildMembers[1].name,
        role_level: "L2",
        credited_units: 18,
        A: 1,
        R: 1,
        Q: 1,
        package_contributions: [
          {
            package_id: "pkg-floor-1",
            trade_family: "floor_finish",
            std_hours: 14,
            difficulty_band: "S1",
            responsibility_share: 0.8,
            role_type: "lead",
            quality_result: "pass",
            rated_units: 11,
          },
        ],
      },
      {
        member_id: guildMembers[2].id,
        name: guildMembers[2].name,
        role_level: "L1",
        credited_units: 16,
        A: 1,
        R: 1,
        Q: 2,
        package_contributions: [
          {
            package_id: "pkg-wall-1",
            trade_family: "wall_finish",
            std_hours: 18,
            difficulty_band: "S2",
            responsibility_share: 0.3,
            role_type: "support",
            quality_result: "minor_fix",
            rated_units: 6,
          },
        ],
      },
    ],
  });

  const existingRewardRun = await findSingle(
    "path_reward_runs",
    "id, proposal_id, run_type",
    (query) => query.eq("org_id", ORG_ID).eq("month", TARGET_MONTH).eq("run_type", "standard"),
  );

  if (!existingRewardRun) {
    const rewardPayload = pathService.buildRewardRunProposalPayload(preview, actor);
    await createAndApproveProposal(
      proposalService,
      approver,
      {
        type: "reward.calculate",
        description: `${TARGET_MONTH} PATH reward run`,
        payload: rewardPayload,
        created_by: actor,
      },
      "seed reward run approval",
    );
  }

  const rewardRun = await requireSingle(
    "path_reward_runs",
    "id, proposal_id, run_type, closed_profit, path_pool_amount",
    (query) => query.eq("org_id", ORG_ID).eq("month", TARGET_MONTH).eq("run_type", "standard"),
  );
  await ensureRewardRunProjection(
    pathService,
    proposalService,
    String(rewardRun.id),
    String(rewardRun.proposal_id),
    actor.id,
  );

  const existingReversal = await findSingle(
    "path_reward_runs",
    "id, proposal_id, run_type",
    (query) =>
      query
        .eq("org_id", ORG_ID)
        .eq("correction_of_reward_run_id", rewardRun.id)
        .eq("run_type", "reversal"),
  );

  if (!existingReversal) {
    const adjustmentPayload = await pathService.buildRewardAdjustmentProposalPayload(
      {
        reward_run_id: String(rewardRun.id),
        correction_month: CORRECTION_MONTH,
        mode: "reversal",
        reason_code: "seed_reversal_check",
        member_adjustments: [
          {
            member_id: guildMembers[0].id,
            amount: 15000,
            explanation: { reason: "seed reversal verification" },
          },
        ],
        note: "reward reversal for correction flow verification",
      },
      actor,
    );

    await createAndApproveProposal(
      proposalService,
      approver,
      {
        type: "reward.adjust",
        description: `${TARGET_MONTH} PATH reversal`,
        payload: adjustmentPayload,
        created_by: actor,
      },
      "seed reward reversal approval",
    );
  }

  const reversalRun = await requireSingle(
    "path_reward_runs",
    "id, proposal_id, run_type",
    (query) =>
      query
        .eq("org_id", ORG_ID)
        .eq("correction_of_reward_run_id", rewardRun.id)
        .eq("run_type", "reversal"),
  );
  await ensureRewardRunProjection(
    pathService,
    proposalService,
    String(reversalRun.id),
    String(reversalRun.proposal_id),
    actor.id,
  );

  const postings = await requireRows(
    "finance_payout_postings",
    "posting_kind, member_id, amount, target_month, correction_month, accounting_entry_id",
    (query) => query.eq("org_id", ORG_ID).order("posted_at", { ascending: false }),
  );

  console.log("[seed-path-vertical-slice] completed");
  console.log(
    JSON.stringify(
      {
        month: TARGET_MONTH,
        correction_month: CORRECTION_MONTH,
        month_close_id: monthClose.id,
        reward_run_id: rewardRun.id,
        preview_summary: {
          calculation_system: preview.calculation_system,
          closed_profit: preview.closed_profit,
          path_pool_amount: preview.path_pool_amount,
          member_count: preview.members.length,
        },
        payout_postings: postings,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[seed-path-vertical-slice] failed:", error);
  process.exitCode = 1;
});

async function createAndApproveProposal(
  proposalService: ProposalService,
  approver: ActorRef,
  input: {
    type: "policy.update" | "evaluation.finalize" | "reward.calculate" | "reward.adjust";
    description: string;
    payload: Record<string, unknown>;
    created_by: ActorRef;
  },
  reason: string,
): Promise<void> {
  const submitted = await proposalService.createAndSubmit(input);
  if (submitted.proposal.status === "executed") {
    return;
  }

  await proposalService.approve(submitted.proposal.id, approver, reason);
}

async function findSingle(
  table: string,
  columns: string,
  apply: (query: any) => any,
): Promise<Record<string, unknown> | null> {
  const query = apply(supabaseAdmin.from(table).select(columns));
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    throw new Error(`Failed to query ${table}: ${error.message}`);
  }
  return data ?? null;
}

async function requireSingle(
  table: string,
  columns: string,
  apply: (query: any) => any,
): Promise<Record<string, unknown>> {
  const row = await findSingle(table, columns, apply);
  if (!row) {
    throw new Error(`Expected one row in ${table} but found none`);
  }
  return row;
}

async function requireRows(
  table: string,
  columns: string,
  apply: (query: any) => any,
): Promise<Record<string, unknown>[]> {
  const query = apply(supabaseAdmin.from(table).select(columns));
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to query ${table}: ${error.message}`);
  }
  return data ?? [];
}

async function ensureRewardRunProjection(
  pathService: PathGovernedModuleService,
  proposalService: ProposalService,
  rewardRunId: string,
  proposalId: string,
  fallbackActorId: string,
): Promise<void> {
  const postings = await requireRows(
    "finance_payout_postings",
    "id",
    (query) => query.eq("org_id", ORG_ID).eq("reward_run_id", rewardRunId),
  );

  if (postings.length > 0) {
    return;
  }

  const proposal = await proposalService.getById(proposalId);
  if (!proposal) {
    throw new Error(`Failed to backfill reward run projection: proposal ${proposalId} not found`);
  }

  proposal.payload = {
    ...proposal.payload,
    journal_created_by: fallbackActorId,
  };

  await pathService.syncProjectionFromExecutedProposal(proposal);
}

async function resolveGuildMembers(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 3,
  });

  if (error) {
    throw new Error(`Failed to load auth users for seed: ${error.message}`);
  }

  const members = (data?.users ?? [])
    .map((user) => ({
      id: user.id,
      name:
        (typeof user.user_metadata?.name === "string" && user.user_metadata.name.length > 0
          ? user.user_metadata.name
          : typeof user.email === "string" && user.email.length > 0
            ? user.email
            : user.id),
    }))
    .filter((user) => user.id.length > 0);

  if (members.length < 2) {
    throw new Error("At least two auth users are required for seed-path-vertical-slice");
  }

  if (members.length === 2) {
    return [...members, members[1]];
  }

  return members;
}

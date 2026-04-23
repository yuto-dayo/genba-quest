import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import pathModuleRouter from "../../routes/pathModule";
import { ProposalService } from "../../services/ProposalService";
import { ActorRef } from "../../services/PolicyEngine";

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
};

type HandlerMethod = "get" | "post";

function createMockRes(): MockRes {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockRes;
  res.status.mockReturnValue(res);
  return res;
}

function getHandler(path: string, method: HandlerMethod) {
  const layer = (pathModuleRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method],
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function expectJson<T>(res: MockRes): T {
  const lastCall = res.json.mock.calls[res.json.mock.calls.length - 1];
  const payload = lastCall?.[0];
  if (!payload) {
    throw new Error("Expected JSON response payload");
  }
  return payload as T;
}

describeIntegration("path module route integration", () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const publishPolicyHandler = getHandler("/policy-bundles/proposals", "post");
  const createInputHandler = getHandler("/monthly-close-inputs", "post");
  const createEvidenceHandler = getHandler("/evidence", "post");
  const generateAiAnnotationHandler = getHandler("/ai-annotations/generate", "post");
  const createMonthCloseHandler = getHandler("/month-close-proposals", "post");
  const previewRewardRunHandler = getHandler("/reward-run/preview", "post");
  const createRewardRunHandler = getHandler("/reward-run/proposals", "post");
  const createRewardAdjustmentHandler = getHandler("/reward-adjustment-proposals", "post");
  const getMonthCloseSummaryHandler = getHandler("/month-close-summary", "get");
  const getRewardExplanationHandler = getHandler("/members/:memberId/reward-explanation", "get");

  let orgId: string;
  let creator: ActorRef;
  let approver: ActorRef;
  let memberB: { id: string; name: string };
  let proposalService: ProposalService;
  let availableUsers: Array<{ id: string; name: string }>;

  jest.setTimeout(60_000);

  beforeAll(async () => {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 3,
    });

    if (error) {
      throw new Error(`Failed to load integration auth users: ${error.message}`);
    }

    availableUsers = (data?.users ?? [])
      .map((user) => ({
        id: String(user.id),
        name:
          (typeof user.user_metadata?.name === "string" && user.user_metadata.name.length > 0
            ? user.user_metadata.name
            : typeof user.email === "string" && user.email.length > 0
              ? user.email
              : String(user.id)),
      }))
      .filter((row) => row.id.length > 0);

    if (availableUsers.length < 2) {
      throw new Error("At least two auth users are required for path module integration tests");
    }
  });

  beforeEach(() => {
    orgId = randomUUID();
    creator = {
      type: "human",
      id: availableUsers[0].id,
      name: availableUsers[0].name,
    };
    approver = {
      type: "human",
      id: availableUsers[1].id,
      name: availableUsers[1].name,
    };
    memberB = {
      id: availableUsers[2]?.id ?? availableUsers[1].id,
      name: availableUsers[2]?.name ?? `${availableUsers[1].name} B`,
    };
    proposalService = new ProposalService(orgId);
  });

  afterEach(async () => {
    if (!creator || !approver || !memberB) {
      return;
    }
    await cleanupOrgData(orgId, [creator.id, approver.id, memberB.id]);
  });

  it("executes PATH vertical slice from module routes into projections and journals", async () => {
    const selectedSiteId = randomUUID();
    const secondSiteId = randomUUID();
    await insertSites([
      { id: selectedSiteId, name: "渋谷マンション", revenue: "450000" },
      { id: secondSiteId, name: "代々木ビル", revenue: "320000" },
    ]);

    const policyRes = createMockRes();
    await publishPolicyHandler(
      buildReq({
        orgId,
        actor: creator,
        body: { effective_from: "2026-04-01" },
      }),
      policyRes,
    );

    expect(policyRes.status).toHaveBeenCalledWith(201);
    const policyResponse = expectJson<{
      proposal: { id: string; status: string };
      auto_approved: boolean;
      auto_executed: boolean;
      payload: Record<string, unknown>;
    }>(policyRes);
    expect(policyResponse.proposal.status).toBe("pending");
    expect(policyResponse.auto_executed).toBe(false);

    const approvedPolicy = await proposalService.approve(
      policyResponse.proposal.id,
      approver,
      "publish PATH v2.2 bundle",
    );
    expect(approvedPolicy.autoExecuted).toBe(true);
    expect(approvedPolicy.proposal.status).toBe("executed");

    const publishedBundle = await fetchSingleRow("policy_bundle_versions", "fingerprint, published_proposal_id");
    expect(publishedBundle.published_proposal_id).toBe(policyResponse.proposal.id);

    const inputRes = createMockRes();
    await createInputHandler(
      buildReq({
        orgId,
        actor: creator,
        body: {
          month: "2026-04",
          member_id: creator.id,
          role_level: "L3",
          trade_family_observations: {
            wall_finish: "lead",
            floor_finish: "support",
          },
          aqr_input: { A: 2, R: 2, Q: 1 },
          selected_site_ids: [selectedSiteId],
          comment: "integration input",
        },
      }),
      inputRes,
    );
    expect(inputRes.status).toHaveBeenCalledWith(201);
    const inputResponse = expectJson<{ input: { id: string } }>(inputRes);
    expect(inputResponse.input.id).toBeTruthy();

    const evidenceRes = createMockRes();
    await createEvidenceHandler(
      buildReq({
        orgId,
        actor: creator,
        body: {
          month: "2026-04",
          member_id: creator.id,
          trade_family: "wall_finish",
          evidence_class: "performance_evidence",
          origin_event_id: `integration-${randomUUID()}`,
          source_type: "daily_report",
          source_ref: "integration-report-2026-04",
          summary: "Wall finish lead contribution",
          metadata: { quality_result: "pass" },
        },
      }),
      evidenceRes,
    );
    expect(evidenceRes.status).toHaveBeenCalledWith(201);
    const evidenceResponse = expectJson<{ evidence: { id: string } }>(evidenceRes);
    expect(evidenceResponse.evidence.id).toBeTruthy();

    const aiARes = createMockRes();
    await generateAiAnnotationHandler(
      buildReq({
        orgId,
        actor: creator,
        body: {
          month: "2026-04",
          member_id: creator.id,
          reviewer_kind: "A",
        },
      }),
      aiARes,
    );
    expect(aiARes.status).toHaveBeenCalledWith(201);

    const aiBRes = createMockRes();
    await generateAiAnnotationHandler(
      buildReq({
        orgId,
        actor: creator,
        body: {
          month: "2026-04",
          member_id: creator.id,
          reviewer_kind: "B",
        },
      }),
      aiBRes,
    );
    expect(aiBRes.status).toHaveBeenCalledWith(201);

    const monthCloseRes = createMockRes();
    await createMonthCloseHandler(
      buildReq({
        orgId,
        actor: creator,
        body: {
          month: "2026-04",
          member_id: creator.id,
          current_role_level: "L3",
          A: 2,
          R: 2,
          Q: 1,
          selected_site_ids: [selectedSiteId],
          neutral_flags: [],
          evidence_ids: [evidenceResponse.evidence.id],
          credited_units: [
            {
              member_id: creator.id,
              unit_type: "work_day",
              units: 22,
              source_id: `input:${inputResponse.input.id}`,
              metadata: { source: "integration" },
            },
          ],
          opportunity_audits: [
            {
              member_id: creator.id,
              trade_family: "wall_finish",
              opportunity_status: "observed",
              eligible_but_unassigned_days: 0,
              opportunity_concentration_score: 0.1,
              promotion_blocked_by_opportunity: false,
              protected_challenge_count: 0,
              summary: { note: "integration opportunity check" },
            },
          ],
          explanation: {
            reviewer_summary: "integration month close",
          },
        },
      }),
      monthCloseRes,
    );
    expect(monthCloseRes.status).toHaveBeenCalledWith(201);
    const monthCloseResponse = expectJson<{
      proposal: { id: string; status: string };
      payload: { selected_site_ids?: string[] };
    }>(monthCloseRes);
    expect(monthCloseResponse.proposal.status).toBe("pending");
    expect(monthCloseResponse.payload.selected_site_ids).toEqual([selectedSiteId]);

    const approvedMonthClose = await proposalService.approve(
      monthCloseResponse.proposal.id,
      approver,
      "close April PATH period",
    );
    expect(approvedMonthClose.autoExecuted).toBe(true);
    expect(approvedMonthClose.proposal.status).toBe("executed");

    const summaryRes = createMockRes();
    await getMonthCloseSummaryHandler(
      buildReq({
        orgId,
        actor: creator,
        query: { month: "2026-04" },
      }),
      summaryRes,
    );
    const summaryResponse = expectJson<{
      month: string;
      closes: Array<{
        id: string;
        policy_fingerprint: string;
        input_hash: string;
        selected_site_ids?: string[];
      }>;
      reward_runs: Array<{ id: string }>;
    }>(summaryRes);
    expect(summaryResponse.month).toBe("2026-04");
    expect(summaryResponse.closes).toHaveLength(1);
    expect(summaryResponse.reward_runs).toHaveLength(0);
    expect(summaryResponse.closes[0]?.policy_fingerprint).toBeTruthy();
    expect(summaryResponse.closes[0]?.input_hash).toBeTruthy();
    expect(summaryResponse.closes[0]?.selected_site_ids).toEqual([selectedSiteId]);

    const canonicalMonthCloseId = await insertCanonicalMonthClose("2026-04");

    const monthCloseProposal = await fetchSingleRow(
      "proposals",
      "id, payload",
      "id",
      monthCloseResponse.proposal.id,
    );
    expect(monthCloseProposal.payload.selected_site_ids).toEqual([selectedSiteId]);

    const rewardRequest = {
      month: "2026-04",
      close_id: summaryResponse.closes[0].id,
      month_close_id: canonicalMonthCloseId,
      pool: {
        recognized_revenue: 900000,
        direct_costs: 420000,
        overhead_allocated: 100000,
        rule_reserve: 30000,
        prior_period_adjustments: 10000,
      },
      members: [
        {
          member_id: creator.id,
          name: creator.name,
          role_level: "L3",
          credited_units: 20,
          guaranteed_pay: 0,
          A: 2,
          R: 2,
          Q: 1,
          neutral_flags: [],
          package_contributions: [
            {
              package_id: "pkg-wall-1",
              trade_family: "wall_finish",
              std_hours: 18,
              difficulty_band: "S2",
              responsibility_share: 1,
              role_type: "lead",
              quality_result: "pass",
              rated_units: 12,
            },
          ],
        },
        {
          member_id: memberB.id,
          name: memberB.name,
          role_level: "L2",
          credited_units: 18,
          guaranteed_pay: 0,
          A: 1,
          R: 1,
          Q: 1,
          neutral_flags: [],
          package_contributions: [
            {
              package_id: "pkg-floor-1",
              trade_family: "floor_finish",
              std_hours: 14,
              difficulty_band: "S1",
              responsibility_share: 1,
              role_type: "lead",
              quality_result: "pass",
              rated_units: 11,
            },
          ],
        },
      ],
    };

    await insertWorkPackages([
      {
        packageKey: "pkg-wall-1",
        siteId: selectedSiteId,
        month: "2026-04",
        tradeFamily: "wall_finish",
        itemType: "wall_finish",
        estimatedStdHours: "18",
        difficultyBand: "S2",
      },
      {
        packageKey: "pkg-floor-1",
        siteId: secondSiteId,
        month: "2026-04",
        tradeFamily: "floor_finish",
        itemType: "floor_finish",
        estimatedStdHours: "14",
        difficultyBand: "S1",
      },
    ]);

    const rewardPreviewRes = createMockRes();
    await previewRewardRunHandler(
      buildReq({
        orgId,
        actor: creator,
        body: rewardRequest,
      }),
      rewardPreviewRes,
    );
    const rewardPreviewResponse = expectJson<{ preview: { calculation_system: string; members: unknown[] } }>(
      rewardPreviewRes,
    );
    expect(rewardPreviewResponse.preview.calculation_system).toBe("path_v22");
    expect(rewardPreviewResponse.preview.members).toHaveLength(2);

    const rewardProposalRes = createMockRes();
    await createRewardRunHandler(
      buildReq({
        orgId,
        actor: creator,
        body: rewardRequest,
      }),
      rewardProposalRes,
    );
    expect(rewardProposalRes.status).toHaveBeenCalledWith(201);
    const rewardProposalResponse = expectJson<{ proposal: { id: string; status: string } }>(rewardProposalRes);
    expect(rewardProposalResponse.proposal.status).toBe("pending");

    const approvedRewardRun = await proposalService.approve(
      rewardProposalResponse.proposal.id,
      approver,
      "approve April PATH reward run",
    );
    const executedRewardProposal = approvedRewardRun.autoExecuted
      ? approvedRewardRun.proposal
      : await proposalService.execute(rewardProposalResponse.proposal.id, approver);
    expect(executedRewardProposal.status).toBe("executed");

    const rewardRun = await fetchSingleRow(
      "path_reward_runs",
      "id, proposal_id, run_type, closed_profit, path_pool_amount",
      "proposal_id",
      rewardProposalResponse.proposal.id,
    );
    expect(rewardRun.run_type).toBe("standard");
    expect(Number(rewardRun.closed_profit)).toBeGreaterThan(0);
    expect(Number(rewardRun.path_pool_amount)).toBe(0);

    const payoutPostings = await fetchRows(
      "finance_payout_postings",
      "posting_kind, member_id, amount, accounting_entry_id, reward_run_id",
      "reward_run_id",
      rewardRun.id,
    );
    expect(payoutPostings).toHaveLength(2);
    expect(new Set(payoutPostings.map((row) => row.posting_kind))).toEqual(new Set(["payout"]));

    const payoutLines = await fetchJournalLines(String(payoutPostings[0].accounting_entry_id));
    expect(payoutLines).toHaveLength(2);
    expect(payoutLines[0]?.account_code).toBe("2130");
    expect(payoutLines[0]?.debit).toBeGreaterThan(0);
    expect(payoutLines[1]?.account_code).toBe("1100");
    expect(payoutLines[1]?.credit).toBeGreaterThan(0);

    const explanationRes = createMockRes();
    await getRewardExplanationHandler(
      buildReq({
        orgId,
        actor: creator,
        params: { memberId: creator.id },
        query: { month: "2026-04" },
      }),
      explanationRes,
    );
    const explanationResponse = expectJson<{
      explanation: {
        member_id: string;
        selected_site_ids?: string[];
        allocation_basis?: string;
        site_allocations?: Array<{
          site_id: string | null;
          site_name: string;
          site_selected: boolean;
          variable_amount_allocated: number;
        }>;
      } | null;
    }>(explanationRes);
    expect(explanationResponse.explanation?.member_id).toBe(creator.id);
    expect(explanationResponse.explanation?.selected_site_ids).toEqual([selectedSiteId]);
    expect(explanationResponse.explanation?.allocation_basis).toBe("package_points.variable_only");
    expect(explanationResponse.explanation?.site_allocations).toEqual([
      expect.objectContaining({
        site_id: selectedSiteId,
        site_name: "渋谷マンション",
        site_selected: true,
        package_ids: ["pkg-wall-1"],
      }),
    ]);
    expect(
      (explanationResponse.explanation?.site_allocations ?? []).reduce(
        (sum, row) => sum + Number(row.variable_amount_allocated || 0),
        0,
      ),
    ).toBeGreaterThan(0);

    const adjustmentRes = createMockRes();
    await createRewardAdjustmentHandler(
      buildReq({
        orgId,
        actor: creator,
        body: {
          reward_run_id: rewardRun.id,
          correction_month: "2026-05",
          mode: "reversal",
          reason_code: "integration_reversal",
          member_adjustments: [
            {
              member_id: creator.id,
              amount: 15000,
              explanation: { reason: "integration reversal check" },
            },
          ],
          note: "reverse one payout for correction flow",
        },
      }),
      adjustmentRes,
    );
    expect(adjustmentRes.status).toHaveBeenCalledWith(201);
    const adjustmentResponse = expectJson<{ proposal: { id: string; status: string } }>(adjustmentRes);
    expect(adjustmentResponse.proposal.status).toBe("pending");

    const approvedAdjustment = await proposalService.approve(
      adjustmentResponse.proposal.id,
      approver,
      "approve PATH reward reversal",
    );
    const executedAdjustmentProposal = approvedAdjustment.autoExecuted
      ? approvedAdjustment.proposal
      : await proposalService.execute(adjustmentResponse.proposal.id, approver);
    expect(executedAdjustmentProposal.status).toBe("executed");

    const reversalRun = await fetchSingleRow(
      "path_reward_runs",
      "id, proposal_id, run_type, correction_of_reward_run_id, target_month",
      "proposal_id",
      adjustmentResponse.proposal.id,
    );
    expect(reversalRun.run_type).toBe("reversal");
    expect(reversalRun.correction_of_reward_run_id).toBe(rewardRun.id);
    expect(reversalRun.target_month).toBe("2026-04");

    const allPostings = await fetchRows(
      "finance_payout_postings",
      "posting_kind, member_id, amount, accounting_entry_id, target_month, correction_month",
    );
    expect(allPostings.some((row) => row.posting_kind === "reversal")).toBe(true);

    const reversalPosting = allPostings.find((row) => row.posting_kind === "reversal");
    expect(reversalPosting?.target_month).toBe("2026-04");
    expect(reversalPosting?.correction_month).toBe("2026-05");

    const reversalLines = await fetchJournalLines(String(reversalPosting?.accounting_entry_id ?? ""));
    expect(reversalLines).toHaveLength(2);
    expect(reversalLines[0]?.account_code).toBe("1100");
    expect(reversalLines[0]?.debit).toBeGreaterThan(0);
    expect(reversalLines[1]?.account_code).toBe("2130");
    expect(reversalLines[1]?.credit).toBeGreaterThan(0);
  });

  function buildReq(input: {
    orgId: string;
    actor: ActorRef;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
  }) {
    return {
      body: input.body ?? {},
      query: input.query ?? {},
      params: input.params ?? {},
      userId: input.actor.id,
      userName: input.actor.name,
      orgId: input.orgId,
    } as any;
  }

  async function fetchSingleRow(
    table: string,
    columns: string,
    key = "org_id",
    value: string = orgId,
  ): Promise<Record<string, any>> {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq(key, value)
      .single();

    if (error) {
      throw new Error(`Failed to fetch single row from ${table}: ${error.message}`);
    }

    return data as Record<string, any>;
  }

  async function fetchRows(
    table: string,
    columns: string,
    key = "org_id",
    value: string = orgId,
  ): Promise<Array<Record<string, any>>> {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq(key, value);

    if (error) {
      throw new Error(`Failed to fetch rows from ${table}: ${error.message}`);
    }

    return (data ?? []) as Array<Record<string, any>>;
  }

  async function fetchJournalLines(entryId: string): Promise<Array<Record<string, any>>> {
    const { data, error } = await supabase
      .from("accounting_journal_lines")
      .select("account_code, debit, credit, line_no")
      .eq("entry_id", entryId)
      .order("line_no", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch journal lines: ${error.message}`);
    }

    return (data ?? []) as Array<Record<string, any>>;
  }

  async function cleanupOrgData(testOrgId: string, userIds: string[]): Promise<void> {
    const { data: proposalRows, error: proposalRowsError } = await supabase
      .from("proposals")
      .select("id")
      .eq("org_id", testOrgId);

    if (proposalRowsError) {
      throw new Error(`Failed to load proposals for cleanup: ${proposalRowsError.message}`);
    }

    const proposalIds = (proposalRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    for (const table of [
      "finance_payout_postings",
      "path_explanation_snapshots",
      "path_reward_runs",
      "path_work_package_assignments",
      "path_work_packages",
      "path_site_item_profit_snapshots",
      "path_credited_units",
      "path_opportunity_audits",
      "path_assignment_restrictions",
      "path_trade_endorsements",
      "path_month_closes",
      "path_ai_review_annotations",
      "path_evidence_records",
      "path_monthly_close_inputs",
      "governance_events",
      "policy_bundle_versions",
      "sites",
    ]) {
      const { error } = await supabase.from(table).delete().eq("org_id", testOrgId);
      if (error) {
        throw new Error(`Failed to cleanup ${table}: ${error.message}`);
      }
    }

    if (proposalIds.length > 0 && userIds.length > 0) {
      const { data: notifications, error: notificationsLoadError } = await supabase
        .from("notifications")
        .select("id, data, user_id")
        .in("user_id", Array.from(new Set(userIds)));

      if (notificationsLoadError) {
        throw new Error(`Failed to load notifications for cleanup: ${notificationsLoadError.message}`);
      }

      const notificationIds = (notifications ?? [])
        .filter((row) => {
          const data = row.data;
          if (!data || typeof data !== "object") {
            return false;
          }
          const proposalId = (data as Record<string, unknown>).proposal_id;
          return typeof proposalId === "string" && proposalIds.includes(proposalId);
        })
        .map((row) => row.id)
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      if (notificationIds.length > 0) {
        const { error: notificationsDeleteError } = await supabase
          .from("notifications")
          .delete()
          .in("id", notificationIds);
        if (notificationsDeleteError) {
          throw new Error(`Failed to cleanup notifications: ${notificationsDeleteError.message}`);
        }
      }
    }
  }

  async function insertCanonicalMonthClose(periodYm: string): Promise<string> {
    const canonicalMonthCloseId = randomUUID();
    const { error } = await supabase.from("month_closes").insert({
      id: canonicalMonthCloseId,
      org_id: orgId,
      period_ym: periodYm,
      status: "fixed",
      source_cutoff_at: `${periodYm}-30T23:59:59Z`,
      fixed_at: `${periodYm}-30T23:59:59Z`,
      fixed_by: {
        type: approver.type,
        id: approver.id,
        name: approver.name,
      },
      close_rule_version_id: randomUUID(),
    });

    if (error) {
      throw new Error(`Failed to insert canonical month close: ${error.message}`);
    }

    return canonicalMonthCloseId;
  }

  async function insertSites(
    sites: Array<{ id: string; name: string; revenue: string }>,
  ): Promise<void> {
    const { error } = await supabase.from("sites").insert(
      sites.map((site) => ({
        id: site.id,
        org_id: orgId,
        name: site.name,
        revenue: site.revenue,
        status: "active",
      })),
    );

    if (error) {
      throw new Error(`Failed to insert integration sites: ${error.message}`);
    }
  }

  async function insertWorkPackages(
    workPackages: Array<{
      packageKey: string;
      siteId: string;
      month: string;
      tradeFamily: string;
      itemType: string;
      estimatedStdHours: string;
      difficultyBand: string;
    }>,
  ): Promise<void> {
    const { error } = await supabase.from("path_work_packages").insert(
      workPackages.map((item) => ({
        org_id: orgId,
        month: item.month,
        package_key: item.packageKey,
        site_id: item.siteId,
        trade_family: item.tradeFamily,
        item_type: item.itemType,
        quantity: 1,
        estimated_std_hours: item.estimatedStdHours,
        difficulty_band: item.difficultyBand,
      })),
    );

    if (error) {
      throw new Error(`Failed to insert integration work packages: ${error.message}`);
    }
  }
});

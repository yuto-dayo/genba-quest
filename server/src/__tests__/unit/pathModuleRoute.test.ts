const mockCreateAndSubmit = jest.fn();
const mockPreviewRewardRunByMonthCloseId = jest.fn();
const mockPrepareRewardRunProposalByMonthCloseId = jest.fn();
const mockListDayLogs = jest.fn();
const mockUpsertDayLog = jest.fn();
const mockListSiteMemberRolePlans = jest.fn();
const mockUpsertSiteMemberRolePlan = jest.fn();
const mockListSiteMemberRewardInputs = jest.fn();
const mockUpsertSiteMemberRewardInput = jest.fn();
const mockBuildSiteCloseProposalPayload = jest.fn();
const mockPreviewV32MonthlyDistribution = jest.fn();
const mockBuildV32MonthlyDistributionProposalPayload = jest.fn();
const mockResolveActiveOrgMembership = jest.fn();
const mockGetRewardConfirmationSummary = jest.fn();
const mockAnswerRewardConfirmationQuestion = jest.fn();

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock("../../lib/orgAccess", () => ({
  resolveActiveOrgMembership: (...args: unknown[]) => mockResolveActiveOrgMembership(...args),
}));

jest.mock("../../services/ProposalService", () => ({
  ProposalService: jest.fn().mockImplementation(() => ({
    createAndSubmit: mockCreateAndSubmit,
  })),
}));

jest.mock("../../services/PathGovernedModuleService", () => ({
  PathGovernedModuleService: jest.fn().mockImplementation(() => ({
    previewRewardRunByMonthCloseId: mockPreviewRewardRunByMonthCloseId,
    prepareRewardRunProposalByMonthCloseId: mockPrepareRewardRunProposalByMonthCloseId,
    getRewardConfirmationSummary: mockGetRewardConfirmationSummary,
    answerRewardConfirmationQuestion: mockAnswerRewardConfirmationQuestion,
  })),
}));

jest.mock("../../services/PathV31Service", () => ({
  PathV31Service: jest.fn().mockImplementation(() => ({
    listDayLogs: mockListDayLogs,
    upsertDayLog: mockUpsertDayLog,
    listSiteMemberRolePlans: mockListSiteMemberRolePlans,
    upsertSiteMemberRolePlan: mockUpsertSiteMemberRolePlan,
    listSiteMemberRewardInputs: mockListSiteMemberRewardInputs,
    upsertSiteMemberRewardInput: mockUpsertSiteMemberRewardInput,
    buildSiteCloseProposalPayload: mockBuildSiteCloseProposalPayload,
  })),
}));

jest.mock("../../services/PathV32SimpleRewardService", () => ({
  PathV32SimpleRewardService: jest.fn().mockImplementation(() => ({
    previewMonthlyDistribution: mockPreviewV32MonthlyDistribution,
    buildMonthlyDistributionProposalPayload: mockBuildV32MonthlyDistributionProposalPayload,
  })),
}));

import pathModuleRouter from "../../routes/pathModule";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { createChain, setupMockFrom } from "../helpers/mockSupabase";

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
};

function createMockRes(): MockRes {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockRes;
  res.status.mockReturnValue(res);
  return res;
}

function getHandler(path: string, method: "get" | "post") {
  const layer = (pathModuleRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method],
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("pathModule router", () => {
  const rewardPreviewHandler = getHandler("/reward-run/preview", "post");
  const rewardProposalHandler = getHandler("/reward-run/proposals", "post");
  const dayLogsGetHandler = getHandler("/day-logs", "get");
  const dayLogsPostHandler = getHandler("/day-logs", "post");
  const rolePlansGetHandler = getHandler("/site-member-role-plans", "get");
  const rolePlansPostHandler = getHandler("/site-member-role-plans", "post");
  const rewardInputsGetHandler = getHandler("/site-member-reward-inputs", "get");
  const rewardInputsPostHandler = getHandler("/site-member-reward-inputs", "post");
  const siteClosesPostHandler = getHandler("/site-closes", "post");
  const monthlyV32PreviewHandler = getHandler("/monthly-distribution-v32/preview", "post");
  const monthlyV32ProposalHandler = getHandler("/monthly-distribution-v32/proposals", "post");
  const rewardConfirmationHandler = getHandler("/reward-confirmation", "get");
  const rewardConfirmationQaHandler = getHandler("/reward-confirmation/qa", "post");

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveActiveOrgMembership.mockResolvedValue({
      org_id: "00000000-0000-0000-0000-000000000001",
      user_id: "33333333-3333-4333-8333-333333333333",
      role: "admin",
      status: "active",
    });
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      policy_bundle_versions: createChain({ data: [], error: null }),
    });
    mockPreviewRewardRunByMonthCloseId.mockResolvedValue({
      preview: {
        calculation_system: "path_v22",
        calculation_version: "2.2.0",
        month: "2026-04",
        close_id: "close-1",
        month_close_id: "close-1",
        policy_bundle: {
          id: "44444444-4444-4444-8444-444444444444",
          bundle_key: "path_core_v22",
          version: "2.2.0",
          revision: 1,
          effective_from: "2026-04-01",
          fingerprint: "fp-1",
        },
        input_hash: "hash-1",
        closed_profit: 120000,
        path_pool_amount: 0,
        base_pool_amount: 102000,
        variable_pool_amount: 18000,
        guaranteed_total_amount: 0,
        members: [],
        explanation_snapshots: [],
      },
      preview_snapshot_id: "preview-1",
      reward_rule_version_id: "44444444-4444-4444-8444-444444444444",
      existing_reward_run: null,
    });
    mockPrepareRewardRunProposalByMonthCloseId.mockResolvedValue({
      preview: {
        calculation_system: "path_v22",
        calculation_version: "2.2.0",
        month: "2026-04",
        close_id: "close-1",
        month_close_id: "close-1",
        policy_bundle: {
          id: "44444444-4444-4444-8444-444444444444",
          bundle_key: "path_core_v22",
          version: "2.2.0",
          revision: 1,
          effective_from: "2026-04-01",
          fingerprint: "fp-1",
        },
        input_hash: "hash-1",
        closed_profit: 120000,
        path_pool_amount: 0,
        base_pool_amount: 102000,
        variable_pool_amount: 18000,
        guaranteed_total_amount: 0,
        members: [],
        explanation_snapshots: [],
      },
      preview_snapshot_id: "preview-1",
      reward_rule_version_id: "44444444-4444-4444-8444-444444444444",
      existing_reward_run: null,
      existing_proposal: null,
      payload: {
        calculation_system: "path_v22",
        month: "2026-04",
        month_close_id: "close-1",
        reward_rule_version_id: "44444444-4444-4444-8444-444444444444",
        journal_created_by: "33333333-3333-4333-8333-333333333333",
      },
      idempotency_key: "reward.calculate:close-1:44444444-4444-4444-8444-444444444444",
    });
    mockListDayLogs.mockResolvedValue([
      { id: "log-1", date: "2026-05-01", member_id: "member-1", site_id: "site-1" },
    ]);
    mockUpsertDayLog.mockResolvedValue({
      id: "log-1",
      date: "2026-05-01",
      member_id: "11111111-1111-4111-8111-111111111111",
      site_id: "site-1",
      trade_families: ["wall_finish"],
      role_type: "assist",
      credited_unit: 1,
      memo: "",
    });
    mockListSiteMemberRolePlans.mockResolvedValue([
      {
        id: "role-plan-1",
        site_id: "site-1",
        member_id: "33333333-3333-4333-8333-333333333333",
        role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
      },
    ]);
    mockUpsertSiteMemberRolePlan.mockResolvedValue({
      id: "role-plan-1",
      site_id: "site-1",
      member_id: "33333333-3333-4333-8333-333333333333",
      role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
      note: "",
    });
    mockListSiteMemberRewardInputs.mockResolvedValue([
      {
        id: "reward-input-1",
        site_id: "site-1",
        member_id: "33333333-3333-4333-8333-333333333333",
        participation_units: 1,
        responsibility_level: "member",
        role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
      },
    ]);
    mockUpsertSiteMemberRewardInput.mockResolvedValue({
      id: "reward-input-1",
      site_id: "site-1",
      member_id: "33333333-3333-4333-8333-333333333333",
      participation_units: 1,
      responsibility_level: "member",
      role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
      note: "",
    });
    mockBuildSiteCloseProposalPayload.mockResolvedValue({
      path_module_version: "v3.1",
      site_id: "site-1",
      included_day_log_ids: ["log-1"],
      difficulty_band: "S1",
      share_mode: "auto_points",
      share_snapshot: [],
      calculation_snapshot: { site_id: "site-1" },
    });
    mockPreviewV32MonthlyDistribution.mockResolvedValue({
      month: "2026-06",
      calculation_system: "path_v32_simple",
      path_rule_version: "3.2.0-simple",
      monthly_pool: 1000000,
      total_weight_num: 86000,
      active_member_count: 4,
      members: [],
      warnings: [],
      calculation_snapshot: { month: "2026-06" },
    });
    mockBuildV32MonthlyDistributionProposalPayload.mockResolvedValue({
      path_module_version: "v3.2-simple",
      calculation_system: "path_v32_simple",
      path_rule_version: "3.2.0-simple",
      month: "2026-06",
      month_close_id: "month-close-v32",
      reward_rule_version_id: "rule-v32",
      monthly_pool: 1000000,
      total_weight_num: 86000,
      member_payouts: [],
      calculation_snapshot: { month: "2026-06" },
      created_by_actor: {
        type: "human",
        id: "33333333-3333-4333-8333-333333333333",
        name: "管理者",
      },
      input_hash: "hash-v32",
    });
    mockGetRewardConfirmationSummary.mockResolvedValue({
      month: "2026-04",
      member_id: "member-1",
      status: "試算中",
      estimated_amount: 120000,
      delta_amount: null,
      delta_empty_state: "先月の比較データはまだありません",
      top_reasons: [],
      increase_reasons: [],
      decrease_reasons: [],
      explanation_cards: [],
      explanation_missing: false,
      explanation_missing_message: null,
      site_breakdown: [],
      corrections: {
        total_amount: 0,
        applied_amount: 0,
        count: 0,
        has_corrections: false,
        items: [],
      },
      evidence_refs: [],
      internal_controls: {
        can_manage: true,
        month: "2026-04",
      },
    });
    mockAnswerRewardConfirmationQuestion.mockResolvedValue({
      conclusion: "今月は比較データがありません。",
      amount_breakdown: [
        {
          label: "今月の見込み",
          amount: 160000,
          detail: "最低保証、成果反映、反映済み補正を合わせた金額です。",
          evidence_refs: [],
        },
      ],
      why_changed: ["先月の比較データがまだありません。"],
      adjustments: [],
      evidence_refs: [],
      next_action: null,
      confidence: "medium",
    });
  });

  it("GET /reward-confirmation returns aggregated summary", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      query: {
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
      },
    } as any;
    const res = createMockRes();

    await rewardConfirmationHandler(req, res);

    expect(mockGetRewardConfirmationSummary).toHaveBeenCalledWith(
      "2026-04",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          month: "2026-04",
          status: "試算中",
        }),
      }),
    );
  });

  it("POST /reward-confirmation/qa returns grounded answer", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      body: {
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        site_id: "site-1",
        question: "補正って何が入ってる？",
      },
    } as any;
    const res = createMockRes();

    await rewardConfirmationQaHandler(req, res);

    expect(mockAnswerRewardConfirmationQuestion).toHaveBeenCalledWith({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      site_id: "site-1",
      question: "補正って何が入ってる？",
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: expect.objectContaining({
          conclusion: "今月は比較データがありません。",
          amount_breakdown: expect.any(Array),
          why_changed: expect.any(Array),
        }),
      }),
    );
  });

  it("POST /reward-run/preview returns path_v22 preview", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      body: {
        month_close_id: "close-1",
      },
    } as any;
    const res = createMockRes();

    await rewardPreviewHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        preview: expect.objectContaining({
          calculation_system: "path_v22",
          month: "2026-04",
        }),
      }),
    );
  });

  it("POST /reward-run/preview requires org context", async () => {
    const req = {
      body: {
        month_close_id: "close-1",
      },
    } as any;
    const res = createMockRes();

    await rewardPreviewHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "ORG_CONTEXT_REQUIRED",
      code: "ORG_CONTEXT_REQUIRED",
      message: "ORG_CONTEXT_REQUIRED",
    });
  });

  it("POST /reward-run/proposals creates reward.calculate proposal with v2.2 payload", async () => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-1", type: "reward.calculate", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      orgId: "00000000-0000-0000-0000-000000000001",
      body: {
        month_close_id: "close-1",
      },
    } as any;
    const res = createMockRes();

    await rewardProposalHandler(req, res);

    expect(mockCreateAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "reward.calculate",
        description: "2026-04 PATH reward run",
        payload: expect.objectContaining({
          calculation_system: "path_v22",
          month_close_id: "close-1",
          journal_created_by: "33333333-3333-4333-8333-333333333333",
        }),
        idempotency_key:
          "reward.calculate:close-1:44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("POST /reward-run/proposals maps canonical reward guard errors to 409", async () => {
    mockCreateAndSubmit.mockRejectedValue(
      new Error(
        "Failed to execute proposal atomically: REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE",
      ),
    );

    const req = {
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      orgId: "00000000-0000-0000-0000-000000000001",
      body: {
        month_close_id: "close-1",
      },
    } as any;
    const res = createMockRes();

    await rewardProposalHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE",
      code: "REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE",
      message: "REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE",
    });
  });

  it("POST /monthly-distribution-v32/preview uses authenticated org context", async () => {
    const req = {
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      orgId: "00000000-0000-0000-0000-000000000001",
      body: {
        month: "2026-06",
      },
    } as any;
    const res = createMockRes();

    await monthlyV32PreviewHandler(req, res);

    expect(mockPreviewV32MonthlyDistribution).toHaveBeenCalledWith("2026-06");
    expect(res.json).toHaveBeenCalledWith({
      preview: expect.objectContaining({
        calculation_system: "path_v32_simple",
        month: "2026-06",
      }),
    });
  });

  it("POST /monthly-distribution-v32/proposals creates reward.calculate through ProposalService", async () => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-v32", type: "reward.calculate", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      orgId: "00000000-0000-0000-0000-000000000001",
      body: {
        month: "2026-06",
      },
    } as any;
    const res = createMockRes();

    await monthlyV32ProposalHandler(req, res);

    expect(mockBuildV32MonthlyDistributionProposalPayload).toHaveBeenCalledWith(
      "2026-06",
      {
        type: "human",
        id: "33333333-3333-4333-8333-333333333333",
        name: "管理者",
      },
    );
    expect(mockCreateAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "reward.calculate",
        description: "2026-06 PATH V3.2 Simple monthly distribution",
        payload: expect.objectContaining({
          calculation_system: "path_v32_simple",
          month_close_id: "month-close-v32",
          reward_rule_version_id: "rule-v32",
          created_by_actor: expect.objectContaining({ type: "human" }),
        }),
        created_by: {
          type: "human",
          id: "33333333-3333-4333-8333-333333333333",
          name: "管理者",
        },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      proposal: { id: "proposal-v32", type: "reward.calculate", status: "pending" },
      auto_approved: false,
      auto_executed: false,
      preview: { month: "2026-06" },
    });
  });

  it("GET /day-logs returns V3.1 day logs", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      query: {},
    } as any;
    const res = createMockRes();

    await dayLogsGetHandler(req, res);

    expect(mockListDayLogs).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      logs: [{ id: "log-1", date: "2026-05-01", member_id: "member-1", site_id: "site-1" }],
    });
  });

  it("POST /day-logs writes a V3.1 day log", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      body: {
        date: "2026-05-01",
        site_id: "site-1",
        member_id: "33333333-3333-4333-8333-333333333333",
        trade_families: ["wall_finish"],
        role_type: "assist",
        credited_unit: 1,
      },
    } as any;
    const res = createMockRes();

    await dayLogsPostHandler(req, res);

    expect(mockUpsertDayLog).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("POST /day-logs maps locked logs to 409 with a day-log code", async () => {
    mockUpsertDayLog.mockRejectedValue(new Error("DAY_LOG_LOCKED"));

    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      body: {
        date: "2026-05-01",
        site_id: "site-1",
        member_id: "33333333-3333-4333-8333-333333333333",
        trade_families: ["wall_finish"],
        role_type: "assist",
        credited_unit: 1,
      },
    } as any;
    const res = createMockRes();

    await dayLogsPostHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "DAY_LOG_LOCKED",
      code: "DAY_LOG_LOCKED",
      message: "DAY_LOG_LOCKED",
    });
  });

  it("POST /day-logs rejects other-member writes with 403", async () => {
    mockUpsertDayLog.mockRejectedValue(new Error("DAY_LOG_MEMBER_FORBIDDEN"));

    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      body: {
        date: "2026-05-01",
        site_id: "site-1",
        member_id: "11111111-1111-4111-8111-111111111111",
        trade_families: ["wall_finish"],
        role_type: "assist",
        credited_unit: 1,
      },
    } as any;
    const res = createMockRes();

    await dayLogsPostHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "DAY_LOG_MEMBER_FORBIDDEN",
      code: "DAY_LOG_MEMBER_FORBIDDEN",
      message: "DAY_LOG_MEMBER_FORBIDDEN",
    });
  });

  it("GET /site-member-role-plans returns V3.1 role plans", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      query: {
        member_id: "33333333-3333-4333-8333-333333333333",
        limit: "200",
      },
    } as any;
    const res = createMockRes();

    await rolePlansGetHandler(req, res);

    expect(mockListSiteMemberRolePlans).toHaveBeenCalledWith({
      site_id: undefined,
      member_id: "33333333-3333-4333-8333-333333333333",
      limit: 200,
    });
    expect(res.json).toHaveBeenCalledWith({
      plans: [
        expect.objectContaining({
          id: "role-plan-1",
          role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
        }),
      ],
    });
  });

  it("POST /site-member-role-plans writes a V3.1 role plan", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      body: {
        site_id: "11111111-1111-4111-8111-111111111111",
        member_id: "33333333-3333-4333-8333-333333333333",
        role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
        note: "",
      },
    } as any;
    const res = createMockRes();

    await rolePlansPostHandler(req, res);

    expect(mockUpsertSiteMemberRolePlan).toHaveBeenCalledWith(req.body, {
      type: "human",
      id: "33333333-3333-4333-8333-333333333333",
      name: "管理者",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      plan: expect.objectContaining({ id: "role-plan-1" }),
    });
  });

  it("GET /site-member-reward-inputs returns V3.1 reward inputs", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      query: {
        member_id: "33333333-3333-4333-8333-333333333333",
        limit: "200",
      },
    } as any;
    const res = createMockRes();

    await rewardInputsGetHandler(req, res);

    expect(mockListSiteMemberRewardInputs).toHaveBeenCalledWith({
      site_id: undefined,
      member_id: "33333333-3333-4333-8333-333333333333",
      limit: 200,
    });
    expect(res.json).toHaveBeenCalledWith({
      inputs: [
        expect.objectContaining({
          id: "reward-input-1",
          participation_units: 1,
          responsibility_level: "member",
        }),
      ],
    });
  });

  it("POST /site-member-reward-inputs writes a V3.1 reward input", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      body: {
        site_id: "11111111-1111-4111-8111-111111111111",
        member_id: "33333333-3333-4333-8333-333333333333",
        participation_units: 1,
        responsibility_level: "member",
        role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
        note: "",
      },
    } as any;
    const res = createMockRes();

    await rewardInputsPostHandler(req, res);

    expect(mockUpsertSiteMemberRewardInput).toHaveBeenCalledWith(req.body, {
      type: "human",
      id: "33333333-3333-4333-8333-333333333333",
      name: "管理者",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      input: expect.objectContaining({ id: "reward-input-1" }),
    });
  });

  it("POST /site-closes creates a site.close.finalize proposal", async () => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-v31-1", type: "site.close.finalize", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      body: {
        site_id: "site-1",
        included_day_log_ids: ["log-1"],
        recognized_revenue: 100000,
        material_cost: 10000,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
      },
    } as any;
    const res = createMockRes();

    await siteClosesPostHandler(req, res);

    expect(mockBuildSiteCloseProposalPayload).toHaveBeenCalled();
    expect(mockCreateAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "site.close.finalize",
        payload: expect.objectContaining({
          path_module_version: "v3.1",
          site_id: "site-1",
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("POST /site-closes requires admin membership", async () => {
    mockResolveActiveOrgMembership.mockRejectedValue(new Error("ORG_ROLE_REQUIRED"));

    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "一般ユーザー",
      body: {
        site_id: "site-1",
        included_day_log_ids: ["log-1"],
        recognized_revenue: 100000,
        material_cost: 10000,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
      },
    } as any;
    const res = createMockRes();

    await siteClosesPostHandler(req, res);

    expect(mockBuildSiteCloseProposalPayload).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "ORG_ROLE_REQUIRED",
      code: "ORG_ROLE_REQUIRED",
      message: "ORG_ROLE_REQUIRED",
    });
  });
});

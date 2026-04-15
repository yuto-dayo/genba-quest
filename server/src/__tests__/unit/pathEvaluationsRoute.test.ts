const mockListMonthlyForms = jest.fn();
const mockUpsertMonthlyForm = jest.fn();
const mockListAiReviews = jest.fn();
const mockUpsertAiReview = jest.fn();
const mockListConfirmations = jest.fn();
const mockUpsertConfirmation = jest.fn();
const mockListSkillProfiles = jest.fn();
const mockListFinalizations = jest.fn();
const mockListSkillCertifications = jest.fn();
const mockBuildFinalizeProposalPayload = jest.fn();
const mockBuildSkillCertificationProposalPayload = jest.fn();
const mockCreateAndSubmit = jest.fn();
const mockGenerateText = jest.fn();

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock("../../services/ProposalService", () => ({
  ProposalService: jest.fn().mockImplementation(() => ({
    createAndSubmit: mockCreateAndSubmit,
  })),
}));

jest.mock("../../services/aiClient", () => ({
  getAIProvider: jest.fn().mockImplementation(() => ({
    name: "gemini",
    generateText: mockGenerateText,
  })),
}));

jest.mock("../../services/PathEvaluationService", () => {
  const actual = jest.requireActual("../../services/PathEvaluationService");

  return {
    ...actual,
    PathEvaluationService: jest.fn().mockImplementation(() => ({
      listMonthlyForms: mockListMonthlyForms,
      upsertMonthlyForm: mockUpsertMonthlyForm,
      listAiReviews: mockListAiReviews,
      upsertAiReview: mockUpsertAiReview,
      listConfirmations: mockListConfirmations,
      upsertConfirmation: mockUpsertConfirmation,
      listSkillProfiles: mockListSkillProfiles,
      listFinalizations: mockListFinalizations,
      listSkillCertifications: mockListSkillCertifications,
      buildFinalizeProposalPayload: mockBuildFinalizeProposalPayload,
      buildSkillCertificationProposalPayload: mockBuildSkillCertificationProposalPayload,
    })),
  };
});

import pathEvaluationsRouter from "../../routes/pathEvaluations";
import { PathEvaluationService } from "../../services/PathEvaluationService";

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
  const layer = (pathEvaluationsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method],
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("pathEvaluations router", () => {
  const listFormsHandler = getHandler("/forms", "get");
  const createFormHandler = getHandler("/forms", "post");
  const listAiReviewsHandler = getHandler("/ai-reviews", "get");
  const createAiReviewHandler = getHandler("/ai-reviews", "post");
  const generateAiReviewHandler = getHandler("/ai-reviews/generate", "post");
  const listConfirmationsHandler = getHandler("/confirmations", "get");
  const createConfirmationHandler = getHandler("/confirmations", "post");
  const listProfilesHandler = getHandler("/profiles", "get");
  const listFinalizationsHandler = getHandler("/finalizations", "get");
  const listCertificationsHandler = getHandler("/certifications", "get");
  const createFinalizeProposalHandler = getHandler("/finalize-proposals", "post");
  const createSkillProposalHandler = getHandler("/skill-proposals", "post");
  const serviceCtor = PathEvaluationService as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /forms passes filters to service", async () => {
    mockListMonthlyForms.mockResolvedValue([{ id: "form-1" }]);
    const req = {
      orgId: "org-1",
      query: {
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        limit: "20",
      },
    } as any;
    const res = createMockRes();

    await listFormsHandler(req, res);

    expect(serviceCtor).toHaveBeenCalledWith("org-1");
    expect(mockListMonthlyForms).toHaveBeenCalledWith({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      limit: 20,
    });
    expect(res.json).toHaveBeenCalledWith({ forms: [{ id: "form-1" }] });
  });

  it("POST /forms returns 400 for validation errors", async () => {
    mockUpsertMonthlyForm.mockRejectedValue(new Error("INVALID_MONTH_FORMAT"));
    const req = { orgId: "org-1", body: {}, userId: "user-1", userName: "Tester" } as any;
    const res = createMockRes();

    await createFormHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "INVALID_MONTH_FORMAT" });
  });

  it("GET /ai-reviews parses boolean query", async () => {
    mockListAiReviews.mockResolvedValue([{ id: "review-1" }]);
    const req = {
      orgId: "org-1",
      query: {
        review_required_flag: "true",
      },
    } as any;
    const res = createMockRes();

    await listAiReviewsHandler(req, res);

    expect(mockListAiReviews).toHaveBeenCalledWith({
      month: undefined,
      member_id: undefined,
      review_required_flag: true,
      limit: undefined,
    });
    expect(res.json).toHaveBeenCalledWith({ reviews: [{ id: "review-1" }] });
  });

  it("POST /ai-reviews passes generated_by actor to service", async () => {
    mockUpsertAiReview.mockResolvedValue({ id: "review-1" });
    const req = {
      orgId: "org-1",
      userId: "11111111-1111-4111-8111-111111111111",
      userName: "管理者",
      body: {
        month: "2026-04",
      },
    } as any;
    const res = createMockRes();

    await createAiReviewHandler(req, res);

    expect(mockUpsertAiReview).toHaveBeenCalledWith(
      { month: "2026-04" },
      {
        type: "human",
        id: "11111111-1111-4111-8111-111111111111",
        name: "管理者",
      },
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ review: { id: "review-1" } });
  });

  it("POST /ai-reviews/generate builds and saves AI review with AI actor", async () => {
    mockListMonthlyForms.mockResolvedValue([
      {
        id: "form-1",
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        selected_big_skill_states: { cross_work: "conditional" },
      },
    ]);
    mockListSkillProfiles.mockResolvedValue([{ member_id: "11111111-1111-4111-8111-111111111111" }]);
    mockListConfirmations.mockResolvedValue([]);
    mockListSkillCertifications.mockResolvedValue([]);
    mockListAiReviews.mockResolvedValue([]);
    mockGenerateText.mockResolvedValue(`{
      "monthly_summary": "クロス施工は条件付きで進行。品質は追加確認が必要。",
      "candidate_states": { "cross_work": "conditional", "quality_stability": "unverified" },
      "candidate_skill_tags": ["cross_setup"],
      "profile_update_candidates": [{ "type": "big_skill", "key": "cross_work", "status": "conditional" }],
      "promotion_candidate_flag": false,
      "reasons": ["フォーム回答を要約"],
      "evidence_summary": ["クロス施工力を本人申告"],
      "unknown_points": ["品質安定の単独完了は未確認"],
      "review_required_flag": true
    }`);
    mockUpsertAiReview.mockResolvedValue({ id: "review-generated" });

    const req = {
      orgId: "org-1",
      body: {
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
      },
    } as any;
    const res = createMockRes();

    await generateAiReviewHandler(req, res);

    expect(mockListMonthlyForms).toHaveBeenCalledWith({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      limit: 1,
    });
    expect(mockGenerateText).toHaveBeenCalled();
    expect(mockUpsertAiReview).toHaveBeenCalledWith(
      expect.objectContaining({
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        candidate_skill_tags: ["cross_setup"],
        review_required_flag: true,
      }),
      {
        type: "ai",
        id: "path-review-ai:gemini",
        name: "PATH Review AI (gemini)",
      },
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      review: { id: "review-generated" },
      provider: "gemini",
    });
  });

  it("GET /confirmations passes filters to service", async () => {
    mockListConfirmations.mockResolvedValue([{ id: "confirmation-1" }]);
    const req = {
      orgId: "org-1",
      query: {
        month: "2026-04",
        target_type: "big_skill",
        limit: "10",
      },
    } as any;
    const res = createMockRes();

    await listConfirmationsHandler(req, res);

    expect(mockListConfirmations).toHaveBeenCalledWith({
      month: "2026-04",
      member_id: undefined,
      target_type: "big_skill",
      limit: 10,
    });
    expect(res.json).toHaveBeenCalledWith({ confirmations: [{ id: "confirmation-1" }] });
  });

  it("POST /confirmations forwards actor to service", async () => {
    mockUpsertConfirmation.mockResolvedValue({ id: "confirmation-1" });
    const req = {
      orgId: "org-1",
      userId: "11111111-1111-4111-8111-111111111111",
      userName: "管理者",
      body: {
        month: "2026-04",
      },
    } as any;
    const res = createMockRes();

    await createConfirmationHandler(req, res);

    expect(mockUpsertConfirmation).toHaveBeenCalledWith(
      { month: "2026-04" },
      {
        type: "human",
        id: "11111111-1111-4111-8111-111111111111",
        name: "管理者",
      },
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ confirmation: { id: "confirmation-1" } });
  });

  it("GET /profiles forwards filters to service", async () => {
    mockListSkillProfiles.mockResolvedValue([{ member_id: "member-1" }]);
    const req = {
      orgId: "org-1",
      query: {
        member_id: "11111111-1111-4111-8111-111111111111",
        current_level: "L2",
      },
    } as any;
    const res = createMockRes();

    await listProfilesHandler(req, res);

    expect(mockListSkillProfiles).toHaveBeenCalledWith({
      member_id: "11111111-1111-4111-8111-111111111111",
      current_level: "L2",
      limit: undefined,
    });
    expect(res.json).toHaveBeenCalledWith({ profiles: [{ member_id: "member-1" }] });
  });

  it("GET /finalizations forwards filters to service", async () => {
    mockListFinalizations.mockResolvedValue([{ member_id: "member-1", month: "2026-04" }]);
    const req = {
      orgId: "org-1",
      query: {
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        limit: "5",
      },
    } as any;
    const res = createMockRes();

    await listFinalizationsHandler(req, res);

    expect(mockListFinalizations).toHaveBeenCalledWith({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      limit: 5,
    });
    expect(res.json).toHaveBeenCalledWith({
      finalizations: [{ member_id: "member-1", month: "2026-04" }],
    });
  });

  it("GET /certifications parses review flag and status", async () => {
    mockListSkillCertifications.mockResolvedValue([{ id: "cert-1" }]);
    const req = {
      orgId: "org-1",
      query: {
        status: "verified",
        review_required_flag: "false",
      },
    } as any;
    const res = createMockRes();

    await listCertificationsHandler(req, res);

    expect(mockListSkillCertifications).toHaveBeenCalledWith({
      member_id: undefined,
      skill_key: undefined,
      status: "verified",
      review_required_flag: false,
      limit: undefined,
    });
    expect(res.json).toHaveBeenCalledWith({ certifications: [{ id: "cert-1" }] });
  });

  it("POST /finalize-proposals creates evaluation.finalize proposal", async () => {
    mockBuildFinalizeProposalPayload.mockReturnValue({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      work_days: 18,
      A: 2,
      R: 1,
      Q: 2,
    });
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-1", type: "evaluation.finalize", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      orgId: "org-1",
      userId: "11111111-1111-4111-8111-111111111111",
      userName: "管理者",
      body: {
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        work_days: 18,
        A: 2,
        R: 1,
        Q: 2,
      },
    } as any;
    const res = createMockRes();

    await createFinalizeProposalHandler(req, res);

    expect(mockBuildFinalizeProposalPayload).toHaveBeenCalledWith({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      work_days: 18,
      A: 2,
      R: 1,
      Q: 2,
    });
    expect(mockCreateAndSubmit).toHaveBeenCalledWith({
      type: "evaluation.finalize",
      payload: {
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        work_days: 18,
        A: 2,
        R: 1,
        Q: 2,
      },
      description: "2026-04 PATH評価確定",
      created_by: {
        type: "human",
        id: "11111111-1111-4111-8111-111111111111",
        name: "管理者",
      },
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("POST /skill-proposals creates skill.revoke proposal when action is revoke", async () => {
    mockBuildSkillCertificationProposalPayload.mockReturnValue({
      member_id: "11111111-1111-4111-8111-111111111111",
      skill_key: "joint_finish",
      status: "revoked",
    });
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-2", type: "skill.revoke", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      orgId: "org-1",
      userId: "11111111-1111-4111-8111-111111111111",
      userName: "管理者",
      body: {
        action: "revoke",
        skill_key: "joint_finish",
      },
    } as any;
    const res = createMockRes();

    await createSkillProposalHandler(req, res);

    expect(mockBuildSkillCertificationProposalPayload).toHaveBeenCalledWith({
      action: "revoke",
      skill_key: "joint_finish",
      status: "revoked",
    });
    expect(mockCreateAndSubmit).toHaveBeenCalledWith(expect.objectContaining({
      type: "skill.revoke",
      description: "joint_finish 認定取消",
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

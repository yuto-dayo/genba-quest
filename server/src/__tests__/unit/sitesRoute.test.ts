const mockCompleteSite = jest.fn();
const mockReverseSiteCompletion = jest.fn();
const mockCompleteWithCloseExecute = jest.fn();
const mockResolveActiveOrgMembership = jest.fn();

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock("../../lib/orgAccess", () => ({
  resolveActiveOrgMembership: (...args: unknown[]) => mockResolveActiveOrgMembership(...args),
}));

jest.mock("../../services/ClientDirectoryService", () => ({
  assertActiveClientForOrg: jest.fn(),
  assertRestorableClientForOrg: jest.fn(),
  listClientsForOrg: jest.fn(),
}));

jest.mock("../../services/BusinessCardOcrService", () => ({
  extractClientFromBusinessCard: jest.fn(),
  getBusinessCardDefaultProvider: jest.fn(() => "gemini"),
}));

jest.mock("../../services/SiteDraftTextService", () => ({
  extractSiteDraftFromText: jest.fn(),
}));

jest.mock("../../services/SiteCompletionService", () => ({
  SiteCompletionService: jest.fn().mockImplementation(() => ({
    completeSite: mockCompleteSite,
    reverseSiteCompletion: mockReverseSiteCompletion,
  })),
}));

jest.mock("../../services/SiteCompleteWithCloseService", () => ({
  SiteCompleteWithCloseService: jest.fn().mockImplementation(() => ({
    execute: mockCompleteWithCloseExecute,
  })),
}));

import sitesRouter from "../../routes/sites";
import { supabaseAdmin } from "../../lib/supabaseClient";
import { SiteCompletionService } from "../../services/SiteCompletionService";
import { createChain, setupMockFrom } from "../helpers/mockSupabase";

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
  send: jest.Mock;
};

function createMockRes(): MockRes {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  } as unknown as MockRes;
  res.status.mockReturnValue(res);
  return res;
}

function getPostHandler(path: string) {
  const layer = (sitesRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("sites router completion endpoints", () => {
  const completeWithCloseHandler = getPostHandler("/:id/complete-with-close");
  const completeHandler = getPostHandler("/:id/complete");
  const reverseHandler = getPostHandler("/:id/complete/reverse");
  const mockSiteCompletionServiceCtor = SiteCompletionService as unknown as jest.Mock;
  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveActiveOrgMembership.mockResolvedValue({
      org_id: "11111111-1111-4111-8111-111111111111",
      user_id: "user-1",
      role: "admin",
      status: "active",
    });
    setupMockFrom(mockFrom, {
      proposals: createChain({ data: [], error: null }),
      site_closes: createChain({ data: [], error: null }),
    });
  });

  it("POST /:id/complete-with-close delegates to SiteCompleteWithCloseService", async () => {
    mockResolveActiveOrgMembership.mockResolvedValue({
      org_id: "11111111-1111-4111-8111-111111111111",
      user_id: "user-1",
      role: "member",
      status: "active",
    });
    mockCompleteWithCloseExecute.mockResolvedValue({
      statusCode: 200,
      body: {
        site_id: "site-1",
        site_completion_event_id: "event-1",
        revenue_basis_id: "basis-1",
        income_proposal_id: "proposal-income-1",
        idempotent: false,
        site: {
          id: "site-1",
          status: "completed",
          close_phase: "completed_close_pending",
        },
        close_proposal: {
          id: "proposal-close-1",
          status: "pending",
          required_approvals: 1,
          created_at: "2026-04-18T09:30:00.000Z",
        },
        close_auto_approved: false,
        close_auto_executed: false,
        close_summary: {},
      },
    });

    const req = {
      params: { id: "site-1" },
      body: {
        client_request_id: "request-1",
        recognized_revenue: 98000,
        included_day_log_ids: ["11111111-1111-4111-8111-111111111111"],
        material_cost: 0,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
      },
      userId: "user-1",
      userName: "担当者",
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await completeWithCloseHandler(req, res);

    expect(mockCompleteWithCloseExecute).toHaveBeenCalledWith(
      "site-1",
      expect.objectContaining({
        client_request_id: "request-1",
        recognized_revenue: 98000,
      }),
      {
        type: "human",
        id: "user-1",
        name: "担当者",
      },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        close_proposal: expect.objectContaining({
          id: "proposal-close-1",
        }),
      }),
    );
  });

  it("POST /:id/complete delegates to SiteCompletionService", async () => {
    const result = {
      site_id: "site-1",
      site_completion_event_id: "event-1",
      revenue_basis_id: "basis-1",
      income_proposal_id: "proposal-1",
      idempotent: false,
      site: {
        id: "site-1",
        status: "completed",
        completed_at: "2026-04-18T09:30:00.000Z",
      },
    };
    mockCompleteSite.mockResolvedValue(result);

    const req = {
      params: { id: "site-1" },
      body: { effective_completed_at: "2026-04-18T09:30:00.000Z" },
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await completeHandler(req, res);

    expect(mockSiteCompletionServiceCtor).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(mockCompleteSite).toHaveBeenCalledWith({
      siteId: "site-1",
      actorUserId: "user-1",
      effectiveCompletedAt: "2026-04-18T09:30:00.000Z",
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: "site-1",
        site: expect.objectContaining({
          close_phase: "completed_unclosed",
        }),
      }),
    );
  });

  it("POST /:id/complete requires admin membership", async () => {
    mockResolveActiveOrgMembership.mockRejectedValue(new Error("ORG_ROLE_REQUIRED"));

    const req = {
      params: { id: "site-1" },
      body: {},
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await completeHandler(req, res);

    expect(mockCompleteSite).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "ORG_ROLE_REQUIRED",
    });
  });

  it("POST /:id/complete maps known business errors", async () => {
    mockCompleteSite.mockRejectedValue(new Error("SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME"));

    const req = {
      params: { id: "site-1" },
      body: {},
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await completeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME",
    });
  });

  it("POST /:id/complete rejects invalid effective_completed_at", async () => {
    const req = {
      params: { id: "site-1" },
      body: { effective_completed_at: "not-a-date" },
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await completeHandler(req, res);

    expect(mockCompleteSite).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "INVALID_EFFECTIVE_COMPLETED_AT",
    });
  });

  it("POST /:id/complete/reverse delegates to SiteCompletionService", async () => {
    const result = {
      site_id: "site-1",
      reversal_event_id: "event-2",
      revenue_basis_id: "basis-1",
      income_reverse_proposal_id: "proposal-2",
      reward_adjust_proposal_id: "proposal-3",
      idempotent: false,
      site: {
        id: "site-1",
        status: "completion_reversed",
        completed_at: null,
      },
    };
    mockReverseSiteCompletion.mockResolvedValue(result);

    const req = {
      params: { id: "site-1" },
      body: {
        effective_reversed_at: "2026-04-19T03:00:00.000Z",
        reason: "manual correction",
      },
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await reverseHandler(req, res);

    expect(mockReverseSiteCompletion).toHaveBeenCalledWith({
      siteId: "site-1",
      actorUserId: "user-1",
      effectiveReversedAt: "2026-04-19T03:00:00.000Z",
      reason: "manual correction",
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        site: expect.objectContaining({
          close_phase: "active",
        }),
      }),
    );
  });
});

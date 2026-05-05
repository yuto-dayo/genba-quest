import { createHash } from "crypto";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

const mockCreateAndSubmit = jest.fn();
const mockCompleteSite = jest.fn();
const mockReverseSiteCompletion = jest.fn();
const mockBuildSiteCloseProposalPayload = jest.fn();

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

jest.mock("../../services/SiteCompletionService", () => ({
  SiteCompletionService: jest.fn().mockImplementation(() => ({
    completeSite: mockCompleteSite,
    reverseSiteCompletion: mockReverseSiteCompletion,
  })),
}));

jest.mock("../../services/PathV31Service", () => ({
  PathV31Service: jest.fn().mockImplementation(() => ({
    buildSiteCloseProposalPayload: mockBuildSiteCloseProposalPayload,
  })),
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { SiteCompleteWithCloseService } from "../../services/SiteCompleteWithCloseService";

const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildPayloadHash(siteId: string, clientRequestId: string, dayLogId: string): string {
  return createHash("sha256")
    .update(
      stableStringify({
        site_id: siteId,
        client_request_id: clientRequestId,
        effective_completed_at: undefined,
        expected_site_updated_at: undefined,
        recognized_revenue: 98000,
        included_day_log_ids: [dayLogId],
        site_day_log_drafts: undefined,
        material_cost: 0,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
        fixed_template_key: null,
        fixed_template_reason_code: null,
        fixed_template_members: undefined,
        outcome_snapshots: undefined,
        closed_at: null,
      }),
    )
    .digest("hex");
}

describe("SiteCompleteWithCloseService", () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const siteId = "22222222-2222-4222-8222-222222222222";
  const dayLogId = "33333333-3333-4333-8333-333333333333";
  const supplementedDayLogId = "55555555-5555-4555-8555-555555555555";
  const actor = {
    type: "human" as const,
    id: "44444444-4444-4444-8444-444444444444",
    name: "担当者",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("replays a stored response for the same client_request_id and payload", async () => {
    const payloadHash = buildPayloadHash(siteId, "request-1", dayLogId);
    const existingAttemptChain = createChain({
      data: {
        id: "attempt-1",
        org_id: orgId,
        site_id: siteId,
        client_request_id: "request-1",
        payload_hash: payloadHash,
        phase: "completed",
        outcome: "succeeded",
        response_status: 200,
        response_json: {
          site_id: siteId,
          site_completion_event_id: "event-1",
          revenue_basis_id: "basis-1",
          income_proposal_id: "income-proposal-1",
          idempotent: false,
          site: {
            id: siteId,
            status: "completed",
            close_phase: "completed_close_pending",
          },
          close_proposal: {
            id: "close-proposal-1",
            status: "pending",
            required_approvals: 1,
            created_at: "2026-04-18T09:30:00.000Z",
          },
          close_auto_approved: false,
          close_auto_executed: false,
          close_summary: {},
        },
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [existingAttemptChain]);

    const service = new SiteCompleteWithCloseService(orgId);
    const result = await service.execute(
      siteId,
      {
        client_request_id: "request-1",
        recognized_revenue: 98000,
        included_day_log_ids: [dayLogId],
        material_cost: 0,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
      },
      actor,
    );

    expect(result).toEqual({
      statusCode: 200,
      body: expect.objectContaining({
        site_id: siteId,
        close_proposal: expect.objectContaining({
          id: "close-proposal-1",
        }),
      }),
    });
    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
    expect(mockCompleteSite).not.toHaveBeenCalled();
  });

  it("returns 409 for the same client_request_id with a different payload", async () => {
    const existingAttemptChain = createChain({
      data: {
        id: "attempt-1",
        org_id: orgId,
        site_id: siteId,
        client_request_id: "request-1",
        payload_hash: "different-hash",
        phase: "started",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [existingAttemptChain]);

    const service = new SiteCompleteWithCloseService(orgId);
    const result = await service.execute(
      siteId,
      {
        client_request_id: "request-1",
        recognized_revenue: 98000,
        included_day_log_ids: [dayLogId],
        material_cost: 0,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
      },
      actor,
    );

    expect(result).toEqual({
      statusCode: 409,
      body: {
        error: "SITE_COMPLETE_WITH_CLOSE_PAYLOAD_CONFLICT",
      },
    });
  });

  it("submits completion and close proposal successfully", async () => {
    mockCompleteSite.mockResolvedValue({
      site_id: siteId,
      site_completion_event_id: "event-1",
      revenue_basis_id: "basis-1",
      income_proposal_id: "income-proposal-1",
      idempotent: false,
      site: {
        id: siteId,
        org_id: orgId,
        status: "completed",
        completed_at: "2026-04-18T09:30:00.000Z",
      },
    });
    mockBuildSiteCloseProposalPayload.mockResolvedValue({
      path_module_version: "v3.1",
      site_id: siteId,
      included_day_log_ids: [dayLogId],
      recognized_revenue: 98000,
      distributable_profit: 88000,
      difficulty_band: "S1",
      share_mode: "auto_points",
      calculation_snapshot: { included_day_log_ids: [dayLogId] },
      closed_at: "2026-04-18T09:30:00.000Z",
    });
    mockCreateAndSubmit.mockResolvedValue({
      proposal: {
        id: "close-proposal-1",
        status: "pending",
        required_approvals: 1,
        created_at: "2026-04-18T09:30:00.000Z",
        executed_at: null,
        payload: {
          site_id: siteId,
          included_day_log_ids: [dayLogId],
          recognized_revenue: 98000,
          distributable_profit: 88000,
          difficulty_band: "S1",
          share_mode: "auto_points",
          calculation_snapshot: { included_day_log_ids: [dayLogId] },
          closed_at: "2026-04-18T09:30:00.000Z",
        },
      },
      autoApproved: false,
      autoExecuted: false,
    });

    setupMockFromSequence(mockFrom, [
      createChain({ data: null, error: null }),
      createChain({
        data: {
          id: "attempt-1",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-2",
          payload_hash: "hash-2",
          phase: "started",
        },
        error: null,
      }),
      createChain({ data: null, error: null }),
      createChain({
        data: {
          id: siteId,
          org_id: orgId,
          status: "active",
          revenue: 12000,
        },
        error: null,
      }),
      createChain({ data: [], error: null }),
      createChain({ data: [{ id: dayLogId }], error: null }),
      createChain({
        data: {
          id: "attempt-1",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-2",
          payload_hash: "hash-2",
          phase: "started",
          prior_site_revenue: 12000,
        },
        error: null,
      }),
      createChain({ data: null, error: null }),
      createChain({
        data: {
          id: "attempt-1",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-2",
          payload_hash: "hash-2",
          phase: "site_revenue_updated",
          prior_site_revenue: 12000,
        },
        error: null,
      }),
      createChain({
        data: {
          id: "attempt-1",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-2",
          payload_hash: "hash-2",
          phase: "site_completed",
          prior_site_revenue: 12000,
          site_completion_event_id: "event-1",
          revenue_basis_id: "basis-1",
          income_proposal_id: "income-proposal-1",
        },
        error: null,
      }),
      createChain({
        data: {
          id: "attempt-1",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-2",
          payload_hash: "hash-2",
          phase: "close_submitted",
          prior_site_revenue: 12000,
          site_completion_event_id: "event-1",
          revenue_basis_id: "basis-1",
          income_proposal_id: "income-proposal-1",
          close_proposal_id: "close-proposal-1",
        },
        error: null,
      }),
      createChain({
        data: {
          id: "attempt-1",
          response_status: 200,
        },
        error: null,
      }),
    ]);

    const service = new SiteCompleteWithCloseService(orgId);
    const result = await service.execute(
      siteId,
      {
        client_request_id: "request-2",
        recognized_revenue: 98000,
        included_day_log_ids: [dayLogId],
        material_cost: 0,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
      },
      actor,
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual(
      expect.objectContaining({
        site_id: siteId,
        close_auto_executed: false,
        close_proposal: expect.objectContaining({
          id: "close-proposal-1",
          status: "pending",
        }),
      }),
    );
    expect(mockCompleteSite).toHaveBeenCalledWith({
      siteId,
      actorUserId: actor.id,
      effectiveCompletedAt: undefined,
    });
    expect(mockCreateAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "site.close.finalize",
        idempotency_key: `site.close.finalize:${orgId}:${siteId}:request-2`,
      }),
    );
  });

  it("prefers existing unlocked site day logs before assignment supplementation", async () => {
    const eligibleLogsChain = createChain({
      data: [{ id: dayLogId }],
      error: null,
    });
    setupMockFromSequence(mockFrom, [eligibleLogsChain]);

    const service = new SiteCompleteWithCloseService(orgId);
    const result = await (service as any).supplementDayLogsForClose(
      {
        id: siteId,
        org_id: orgId,
        status: "active",
        completed_at: null,
        assigned_users: [actor.id],
      },
      {
        client_request_id: "request-supplement-1",
        recognized_revenue: 98000,
        included_day_log_ids: [],
        site_day_log_drafts: [
          {
            date: "2026-04-18",
            member_id: actor.id,
            role_type: "support",
            credited_unit: 1,
          },
        ],
      },
      actor,
    );

    expect(result).toEqual([dayLogId]);
    expect(eligibleLogsChain.insert).not.toHaveBeenCalled();
  });

  it("creates unlocked site day logs from completion drafts when no manual logs exist", async () => {
    const eligibleLogsChain = createChain({ data: [], error: null });
    const existingByNaturalKeyChain = createChain({ data: null, error: null });
    const insertChain = createChain({
      data: { id: supplementedDayLogId },
      error: null,
    });
    setupMockFromSequence(mockFrom, [eligibleLogsChain, existingByNaturalKeyChain, insertChain]);

    const service = new SiteCompleteWithCloseService(orgId);
    const result = await (service as any).supplementDayLogsForClose(
      {
        id: siteId,
        org_id: orgId,
        status: "active",
        completed_at: null,
        assigned_users: [actor.id],
      },
      {
        client_request_id: "request-supplement-2",
        recognized_revenue: 98000,
        included_day_log_ids: [],
        site_day_log_drafts: [
          {
            date: "2026-04-18",
            member_id: actor.id,
            role_type: "lead",
            credited_unit: 1.25,
            memo: "from modal",
          },
        ],
      },
      actor,
    );

    expect(result).toEqual([supplementedDayLogId]);
    expect(insertChain.insert).toHaveBeenCalledWith({
      org_id: orgId,
      date: "2026-04-18",
      site_id: siteId,
      member_id: actor.id,
      trade_families: [],
      role_type: "lead",
      credited_unit: 1.25,
      memo: "from modal",
    });
  });

  it("reverses completion and rolls revenue back when close submission fails without an existing proposal", async () => {
    mockCompleteSite.mockResolvedValue({
      site_id: siteId,
      site_completion_event_id: "event-2",
      revenue_basis_id: "basis-2",
      income_proposal_id: "income-proposal-2",
      idempotent: false,
      site: {
        id: siteId,
        org_id: orgId,
        status: "completed",
        completed_at: "2026-04-18T09:30:00.000Z",
      },
    });
    mockBuildSiteCloseProposalPayload.mockResolvedValue({
      path_module_version: "v3.1",
      site_id: siteId,
      included_day_log_ids: [dayLogId],
      recognized_revenue: 98000,
      calculation_snapshot: {},
      closed_at: "2026-04-18T09:30:00.000Z",
    });
    mockCreateAndSubmit.mockRejectedValue(new Error("SITE_CLOSE_ACTIVE_PROPOSAL_EXISTS"));
    mockReverseSiteCompletion.mockResolvedValue({
      site_id: siteId,
      reversal_event_id: "reversal-1",
      revenue_basis_id: "basis-2",
      income_reverse_proposal_id: "income-reverse-1",
      reward_adjust_proposal_id: null,
      idempotent: false,
      site: {
        id: siteId,
        org_id: orgId,
        status: "active",
        completed_at: null,
      },
    });

    const revenueRollbackChain = createChain({ data: null, error: null });

    setupMockFromSequence(mockFrom, [
      createChain({ data: null, error: null }),
      createChain({
        data: {
          id: "attempt-2",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-3",
          payload_hash: "hash-3",
          phase: "started",
        },
        error: null,
      }),
      createChain({ data: null, error: null }),
      createChain({
        data: {
          id: siteId,
          org_id: orgId,
          status: "active",
          revenue: 12000,
        },
        error: null,
      }),
      createChain({ data: [], error: null }),
      createChain({ data: [{ id: dayLogId }], error: null }),
      createChain({
        data: {
          id: "attempt-2",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-3",
          payload_hash: "hash-3",
          phase: "started",
          prior_site_revenue: 12000,
        },
        error: null,
      }),
      createChain({ data: null, error: null }),
      createChain({
        data: {
          id: "attempt-2",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-3",
          payload_hash: "hash-3",
          phase: "site_revenue_updated",
          prior_site_revenue: 12000,
        },
        error: null,
      }),
      createChain({
        data: {
          id: "attempt-2",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-3",
          payload_hash: "hash-3",
          phase: "site_completed",
          prior_site_revenue: 12000,
          site_completion_event_id: "event-2",
          revenue_basis_id: "basis-2",
          income_proposal_id: "income-proposal-2",
        },
        error: null,
      }),
      createChain({ data: null, error: null }),
      revenueRollbackChain,
      createChain({
        data: {
          id: "attempt-2",
          org_id: orgId,
          site_id: siteId,
          client_request_id: "request-3",
          payload_hash: "hash-3",
          phase: "reversed",
          prior_site_revenue: 12000,
          reversal_event_id: "reversal-1",
        },
        error: null,
      }),
      createChain({
        data: {
          id: "attempt-2",
          response_status: 409,
        },
        error: null,
      }),
    ]);

    const service = new SiteCompleteWithCloseService(orgId);
    const result = await service.execute(
      siteId,
      {
        client_request_id: "request-3",
        recognized_revenue: 98000,
        included_day_log_ids: [dayLogId],
        material_cost: 0,
        external_cost: 0,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
      },
      actor,
    );

    expect(result).toEqual({
      statusCode: 409,
      body: {
        error: "SITE_CLOSE_ACTIVE_PROPOSAL_EXISTS",
      },
    });
    expect(mockReverseSiteCompletion).toHaveBeenCalledWith({
      siteId,
      actorUserId: actor.id,
      reason: "complete_with_close_compensation",
    });
    expect(revenueRollbackChain.update).toHaveBeenCalledWith({
      revenue: 12000,
    });
  });
});

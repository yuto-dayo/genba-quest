import { createChain, setupMockFrom } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseClient";
import { SiteCompletionService } from "../../services/SiteCompletionService";

const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;
const mockRpc = (supabaseAdmin as unknown as { rpc: jest.Mock }).rpc;

describe("SiteCompletionService", () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const siteId = "22222222-2222-4222-8222-222222222222";
  const userId = "33333333-3333-4333-8333-333333333333";
  let service: SiteCompletionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SiteCompletionService(orgId);
  });

  it("completeSite calls complete_site_rpc and returns the refreshed site", async () => {
    const siteQuery = createChain({
      data: {
        id: siteId,
        org_id: orgId,
        status: "completed",
        completed_at: "2026-04-18T09:30:00.000Z",
      },
      error: null,
    });

    mockRpc.mockResolvedValue({
      data: {
        site_id: siteId,
        site_completion_event_id: "event-1",
        revenue_basis_id: "basis-1",
        income_proposal_id: "proposal-1",
        idempotent: false,
      },
      error: null,
    });
    mockFrom.mockReturnValue(siteQuery);

    const result = await service.completeSite({
      siteId,
      actorUserId: userId,
      effectiveCompletedAt: "2026-04-18T09:30:00.000Z",
    });

    expect(mockRpc).toHaveBeenCalledWith("complete_site_rpc", {
      p_org_id: orgId,
      p_site_id: siteId,
      p_actor_user_id: userId,
      p_membership_id: null,
      p_effective_completed_at: "2026-04-18T09:30:00.000Z",
    });
    expect(mockFrom).toHaveBeenCalledWith("sites");
    expect(siteQuery.select).toHaveBeenCalledWith("*");
    expect(siteQuery.eq).toHaveBeenCalledWith("id", siteId);
    expect(siteQuery.eq).toHaveBeenCalledWith("org_id", orgId);
    expect(siteQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(result).toEqual({
      site_id: siteId,
      site_completion_event_id: "event-1",
      revenue_basis_id: "basis-1",
      income_proposal_id: "proposal-1",
      idempotent: false,
      site: {
        id: siteId,
        org_id: orgId,
        status: "completed",
        completed_at: "2026-04-18T09:30:00.000Z",
      },
    });
  });

  it("completeSite creates site level draft notifications for assigned users on first completion", async () => {
    const otherUserId = "44444444-4444-4444-8444-444444444444";
    const siteQuery = createChain({
      data: {
        id: siteId,
        org_id: orgId,
        name: "A棟クロス",
        status: "completed",
        completed_at: "2026-04-18T09:30:00.000Z",
        assigned_users: [userId, otherUserId, userId],
      },
      error: null,
    });
    const notificationQuery = createChain({ data: null, error: null });

    mockRpc.mockResolvedValue({
      data: {
        site_id: siteId,
        site_completion_event_id: "event-1",
        revenue_basis_id: "basis-1",
        income_proposal_id: "proposal-1",
        idempotent: false,
      },
      error: null,
    });
    setupMockFrom(mockFrom, {
      sites: siteQuery,
      notifications: notificationQuery,
    });

    await service.completeSite({
      siteId,
      actorUserId: userId,
      effectiveCompletedAt: "2026-04-18T09:30:00.000Z",
    });

    expect(notificationQuery.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: userId,
        type: "system_alert",
        title: "現場完了: A棟クロス",
        data: expect.objectContaining({
          task_type: "site_level_draft",
          site_id: siteId,
          member_id: userId,
          completed_at: "2026-04-18T09:30:00.000Z",
        }),
      }),
      expect.objectContaining({
        user_id: otherUserId,
        data: expect.objectContaining({
          task_type: "site_level_draft",
          member_id: otherUserId,
        }),
      }),
    ]);
  });

  it("completeSite skips site level draft notifications on idempotent rerun", async () => {
    const siteQuery = createChain({
      data: {
        id: siteId,
        org_id: orgId,
        name: "A棟クロス",
        status: "completed",
        completed_at: "2026-04-18T09:30:00.000Z",
        assigned_users: [userId],
      },
      error: null,
    });
    const notificationQuery = createChain({ data: null, error: null });

    mockRpc.mockResolvedValue({
      data: {
        site_id: siteId,
        site_completion_event_id: "event-1",
        revenue_basis_id: "basis-1",
        income_proposal_id: "proposal-1",
        idempotent: true,
      },
      error: null,
    });
    setupMockFrom(mockFrom, {
      sites: siteQuery,
      notifications: notificationQuery,
    });

    await service.completeSite({
      siteId,
      actorUserId: userId,
    });

    expect(notificationQuery.insert).not.toHaveBeenCalled();
  });

  it("completeSite surfaces known RPC business errors", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME" },
    });

    await expect(
      service.completeSite({
        siteId,
        actorUserId: userId,
      })
    ).rejects.toThrow("SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME");
  });

  it("completeSite reports missing RPC function distinctly", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function public.complete_site_rpc" },
    });

    await expect(
      service.completeSite({
        siteId,
        actorUserId: userId,
      })
    ).rejects.toThrow("SITE_COMPLETION_RPC_NOT_AVAILABLE");
  });

  it("reverseSiteCompletion calls reverse_site_completion_rpc and returns the refreshed site", async () => {
    const siteQuery = createChain({
      data: {
        id: siteId,
        org_id: orgId,
        status: "completion_reversed",
        completed_at: null,
      },
      error: null,
    });

    mockRpc.mockResolvedValue({
      data: {
        site_id: siteId,
        reversal_event_id: "event-2",
        revenue_basis_id: "basis-1",
        income_reverse_proposal_id: "proposal-2",
        reward_adjust_proposal_id: "proposal-3",
        idempotent: false,
      },
      error: null,
    });
    mockFrom.mockReturnValue(siteQuery);

    const result = await service.reverseSiteCompletion({
      siteId,
      actorUserId: userId,
      effectiveReversedAt: "2026-04-19T03:00:00.000Z",
      reason: "manual correction",
    });

    expect(mockRpc).toHaveBeenCalledWith("reverse_site_completion_rpc", {
      p_org_id: orgId,
      p_site_id: siteId,
      p_actor_user_id: userId,
      p_membership_id: null,
      p_effective_reversed_at: "2026-04-19T03:00:00.000Z",
      p_reason: "manual correction",
    });
    expect(result).toEqual({
      site_id: siteId,
      reversal_event_id: "event-2",
      revenue_basis_id: "basis-1",
      income_reverse_proposal_id: "proposal-2",
      reward_adjust_proposal_id: "proposal-3",
      idempotent: false,
      site: {
        id: siteId,
        org_id: orgId,
        status: "completion_reversed",
        completed_at: null,
      },
    });
  });
});

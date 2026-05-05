jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import {
  PATH_V32_LEVEL_WEIGHT_MILLI,
  PATH_V32_SIMPLE_CALCULATION_SYSTEM,
  PathV32SimpleRewardService,
} from "../../services/PathV32SimpleRewardService";
import { createChain, setupMockFrom } from "../helpers/mockSupabase";

const mockFrom = supabaseAdmin.from as jest.Mock;

const orgId = "00000000-0000-0000-0000-000000000001";
const closeA = "11111111-1111-4111-8111-111111111111";
const closeB = "22222222-2222-4222-8222-222222222222";
const memberA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const memberC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const memberD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function juneDates(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `2026-06-${String(index + 1).padStart(2, "0")}`);
}

function workRows(memberId: string, count: number, siteCloseId = closeA) {
  return juneDates(count).map((workDate) => ({
    site_close_id: siteCloseId,
    member_id: memberId,
    work_date: workDate,
  }));
}

describe("PathV32SimpleRewardService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setupPreviewTables(extra?: { units?: Array<Record<string, unknown>>; proposals?: Array<Record<string, unknown>> }) {
    setupMockFrom(mockFrom, {
      site_closes: createChain({
        data: [
          {
            id: closeA,
            site_id: "33333333-3333-4333-8333-333333333333",
            closed_at: "2026-06-20T00:00:00.000Z",
            distributable_profit: 600_000,
            status: "finalized",
          },
          {
            id: closeB,
            site_id: "44444444-4444-4444-8444-444444444444",
            closed_at: "2026-06-25T00:00:00.000Z",
            distributable_profit: 400_000,
            status: "finalized",
          },
        ],
        error: null,
      }),
      org_memberships: createChain({
        data: [memberA, memberB, memberC, memberD].map((user_id) => ({ user_id, status: "active" })),
        error: null,
      }),
      profiles: createChain({
        data: [
          { id: memberA, full_name: "A", username: "a" },
          { id: memberB, full_name: "B", username: "b" },
          { id: memberC, full_name: "C", username: "c" },
          { id: memberD, full_name: "D", username: "d" },
        ],
        error: null,
      }),
      path_member_level_history: createChain({
        data: [
          { member_id: memberA, level: "L5", effective_month: "2026-06" },
          { member_id: memberB, level: "L3", effective_month: "2026-06" },
          { member_id: memberC, level: "L3", effective_month: "2026-06" },
          { member_id: memberD, level: "L2", effective_month: "2026-06" },
        ],
        error: null,
      }),
      member_skill_profiles: createChain({ data: [], error: null }),
      proposals: createChain({ data: extra?.proposals ?? [], error: null }),
      site_close_member_units: createChain({
        data:
          extra?.units ??
          [
            ...workRows(memberA, 20, closeA),
            { site_close_id: closeB, member_id: memberA, work_date: "2026-06-01" },
            ...workRows(memberB, 16, closeA),
            ...workRows(memberC, 20, closeB),
            ...workRows(memberD, 20, closeB),
          ],
        error: null,
      }),
      site_day_logs: createChain({ data: [], error: null }),
    });
  }

  it("distributes the monthly pool by non-linear level milli weight and unique work days", async () => {
    setupPreviewTables();

    const preview = await new PathV32SimpleRewardService(orgId).previewMonthlyDistribution("2026-06");

    expect(preview.calculation_system).toBe(PATH_V32_SIMPLE_CALCULATION_SYSTEM);
    expect(preview.monthly_pool).toBe(1_000_000);
    expect(preview.month_total_days).toBe(30);
    expect(preview.members.map((member) => member.monthly_weight_num)).toEqual([
      34_800,
      16_000,
      20_000,
      15_200,
    ]);
    expect(preview.members[0]).toEqual(
      expect.objectContaining({
        level: "L5",
        level_weight_milli: PATH_V32_LEVEL_WEIGHT_MILLI.L5,
        confirmed_work_days: 20,
        work_presence_bp: 6667,
      }),
    );
    expect(preview.members.reduce((sum, member) => sum + member.final_share_bp, 0)).toBe(10_000);
    expect(preview.members.reduce((sum, member) => sum + member.rounded_amount, 0)).toBe(1_000_000);
  });

  it("creates active member lines even when only some members worked", async () => {
    setupPreviewTables({
      units: [...workRows(memberA, 2), ...workRows(memberB, 1)],
    });

    const preview = await new PathV32SimpleRewardService(orgId).previewMonthlyDistribution("2026-06");

    expect(preview.members).toHaveLength(4);
    expect(preview.members.find((member) => member.member_id === memberC)).toEqual(
      expect.objectContaining({
        confirmed_work_days: 0,
        monthly_weight_num: 0,
        rounded_amount: 0,
      }),
    );
  });

  it("warns zero total weight instead of fixing an impossible pool", async () => {
    setupPreviewTables({ units: [] });

    const service = new PathV32SimpleRewardService(orgId);
    const preview = await service.previewMonthlyDistribution("2026-06");

    expect(preview.warnings).toContain("PATH_V32_ZERO_TOTAL_WEIGHT");
    await expect(
      service.buildMonthlyDistributionProposalPayload("2026-06", {
        type: "human",
        id: memberA,
        name: "A",
      }),
    ).rejects.toThrow("PATH_V32_ZERO_TOTAL_WEIGHT");
  });

  it("applies pool adjustments to the monthly pool and member corrections after distribution", async () => {
    setupPreviewTables({
      proposals: [
        {
          id: "proposal-pool",
          status: "approved",
          payload: {
            calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
            adjustment_kind: "pool",
            month: "2026-06",
            amount: 100_000,
          },
        },
        {
          id: "proposal-member",
          status: "approved",
          payload: {
            calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
            adjustment_kind: "member",
            target_month: "2026-06",
            member_id: memberA,
            amount: 20_000,
          },
        },
      ],
    });

    const preview = await new PathV32SimpleRewardService(orgId).previewMonthlyDistribution("2026-06");

    expect(preview.monthly_pool).toBe(1_100_000);
    expect(preview.members.reduce((sum, member) => sum + member.rounded_amount, 0)).toBe(1_100_000);
    expect(preview.members.find((member) => member.member_id === memberA)).toEqual(
      expect.objectContaining({
        member_correction_amount: 20_000,
      }),
    );
    expect(preview.members.reduce((sum, member) => sum + member.total_pay_amount, 0)).toBe(1_120_000);
  });
});

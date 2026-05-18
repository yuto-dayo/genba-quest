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
const canonicalMonthClose = "55555555-5555-4555-8555-555555555555";
const ruleVersion = "66666666-6666-4666-8666-666666666666";
const proposalExecution = "77777777-7777-4777-8777-777777777777";
const rewardRun = "88888888-8888-4888-8888-888888888888";
const revenueBasis = "99999999-9999-4999-8999-999999999999";
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

  function setupPreviewTables(extra?: {
    units?: Array<Record<string, unknown>>;
    proposals?: Array<Record<string, unknown>>;
    levelHistory?: Array<Record<string, unknown>>;
    skillProfiles?: Array<Record<string, unknown>>;
  }) {
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
        data: extra?.levelHistory ?? [
          { member_id: memberA, level: "L5", effective_month: "2026-06" },
          { member_id: memberB, level: "L3", effective_month: "2026-06" },
          { member_id: memberC, level: "L3", effective_month: "2026-06" },
          { member_id: memberD, level: "L2", effective_month: "2026-06" },
        ],
        error: null,
      }),
      member_skill_profiles: createChain({ data: extra?.skillProfiles ?? [], error: null }),
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

  it("sets unset member level to null with zero weight and warning", async () => {
    setupPreviewTables({
      levelHistory: [
        { member_id: memberA, level: "L5", effective_month: "2026-06" },
        { member_id: memberB, level: "L3", effective_month: "2026-06" },
        { member_id: memberD, level: "L2", effective_month: "2026-06" },
      ],
      units: [...workRows(memberA, 10), ...workRows(memberC, 10)],
    });

    const preview = await new PathV32SimpleRewardService(orgId).previewMonthlyDistribution("2026-06");
    const unsetMember = preview.members.find((member) => member.member_id === memberC);

    expect(preview.warnings).toContain("PATH_V32_MEMBER_LEVEL_UNSET");
    expect(unsetMember).toEqual(
      expect.objectContaining({
        level: null,
        level_source: "unset",
        level_weight_milli: 0,
        monthly_weight_num: 0,
        rounded_amount: 0,
      }),
    );
    expect(unsetMember?.calculation_snapshot).toEqual(
      expect.objectContaining({ level_source: "unset" }),
    );
  });

  it("uses history level before profile level", async () => {
    setupPreviewTables({
      levelHistory: [
        { member_id: memberA, level: "L4", effective_month: "2026-06" },
      ],
      skillProfiles: [
        { member_id: memberA, current_level: "L2" },
      ],
      units: workRows(memberA, 1),
    });

    const preview = await new PathV32SimpleRewardService(orgId).previewMonthlyDistribution("2026-06");

    expect(preview.members.find((member) => member.member_id === memberA)).toEqual(
      expect.objectContaining({
        level: "L4",
        level_source: "history",
        level_weight_milli: PATH_V32_LEVEL_WEIGHT_MILLI.L4,
      }),
    );
  });

  it("uses profile level when history is missing", async () => {
    setupPreviewTables({
      levelHistory: [],
      skillProfiles: [
        { member_id: memberA, current_level: "L2" },
      ],
      units: workRows(memberA, 1),
    });

    const preview = await new PathV32SimpleRewardService(orgId).previewMonthlyDistribution("2026-06");

    expect(preview.members.find((member) => member.member_id === memberA)).toEqual(
      expect.objectContaining({
        level: "L2",
        level_source: "profile",
        level_weight_milli: PATH_V32_LEVEL_WEIGHT_MILLI.L2,
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

  it("reuses an existing fixed canonical run when sync is retried", async () => {
    const proposalExecutions = createChain({ data: { id: proposalExecution }, error: null });
    const rewardRuns = createChain({ data: { id: rewardRun }, error: null });
    const monthlyDistributionCloses = createChain({
      data: { id: "10101010-1010-4010-8010-101010101010" },
      error: null,
    });
    const monthlyDistributionLines = createChain({ data: null, error: null });
    const rewardRunLines = createChain({ data: null, error: null });
    const revenueBasisRows = createChain({ data: { id: revenueBasis }, error: null });

    setupMockFrom(mockFrom, {
      proposal_executions: proposalExecutions,
      reward_runs: rewardRuns,
      monthly_distribution_closes: monthlyDistributionCloses,
      monthly_distribution_lines: monthlyDistributionLines,
      reward_run_lines: rewardRunLines,
      revenue_basis: revenueBasisRows,
    });

    await new PathV32SimpleRewardService(orgId).syncMonthlyDistributionFromExecutedProposal({
      id: "proposal-v32",
      org_id: orgId,
      type: "reward.calculate",
      status: "executed",
      created_by: { type: "human", id: memberA, name: "A" },
      executed_by: { type: "human", id: memberA, name: "A" },
      executed_at: "2026-06-30T00:00:00.000Z",
      approvals: [],
      required_approvals: 1,
      description: "2026-06 PATH V3.2 Simple monthly distribution",
      created_at: "2026-06-30T00:00:00.000Z",
      updated_at: "2026-06-30T00:00:00.000Z",
      payload: {
        month: "2026-06",
        month_close_id: canonicalMonthClose,
        reward_rule_version_id: ruleVersion,
        total_weight_num: 1000,
        monthly_pool: 100_000,
        site_profit_total: 100_000,
        pool_adjustment_total: 0,
        member_correction_total: 0,
        calculation_snapshot: {
          site_closes: [{ site_id: "33333333-3333-4333-8333-333333333333" }],
        },
        member_payouts: [
          {
            member_id: memberA,
            rounded_amount: 100_000,
            total_pay_amount: 100_000,
            member_correction_amount: 0,
          },
        ],
      },
    } as any);

    expect(rewardRuns.insert).not.toHaveBeenCalled();
    expect(rewardRunLines.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          reward_run_id: rewardRun,
          recipient_id: memberA,
          payout_amount: 100_000,
        }),
      ],
      { onConflict: "reward_run_id,recipient_id", ignoreDuplicates: true },
    );
  });
});

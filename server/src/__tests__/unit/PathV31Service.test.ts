jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { PathV31Service } from "../../services/PathV31Service";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

const mockFrom = supabaseAdmin.from as jest.Mock;

const pathRule = {
  id: "rule-v31",
  org_id: "00000000-0000-0000-0000-000000000001",
  version: "3.1.0",
  effective_from: "2026-05-01",
  status: "active",
  fingerprint: "fp-v31",
  constants_json: {
    FLOOR_RATE: 0.35,
    RESULT_RATE: 0.65,
    NONLINEAR_EXPONENT: 1.12,
    ROLE_COEFFICIENTS: {
      assist: 1,
      lead: 1.8,
      solo: 2.4,
      support: 0,
    },
  },
};

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function distributeByWeights(total: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) {
    return weights.map(() => 0);
  }

  let remaining = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return remaining;
    }
    const amount = Math.round((total * weight) / totalWeight);
    remaining -= amount;
    return amount;
  });
}

describe("PathV31Service day-log save", () => {
  const orgId = "00000000-0000-0000-0000-000000000001";
  const actor = {
    type: "human" as const,
    id: "33333333-3333-4333-8333-333333333333",
    name: "現場担当",
  };

  const baseInput: Parameters<PathV31Service["upsertDayLog"]>[0] = {
    date: "2026-05-01",
    site_id: "11111111-1111-4111-8111-111111111111",
    member_id: actor.id,
    trade_families: ["wall_finish"],
    role_type: "assist" as const,
    credited_unit: 1,
    memo: "initial",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function activeSiteChain() {
    return createChain({
      data: {
        id: baseInput.site_id,
        status: "active",
      },
      error: null,
    });
  }

  it("rejects writes for another member before touching the database", async () => {
    const service = new PathV31Service(orgId);

    await expect(
      service.upsertDayLog(
        {
          ...baseInput,
          member_id: "44444444-4444-4444-8444-444444444444",
        },
        actor,
      ),
    ).rejects.toThrow("DAY_LOG_MEMBER_FORBIDDEN");

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("updates an existing log by id", async () => {
    const service = new PathV31Service(orgId);
    const lookupChain = createChain({
      data: {
        id: "log-1",
        member_id: actor.id,
        locked_by_site_close_id: null,
      },
      error: null,
    });
    const updateChain = createChain({
      data: {
        id: "log-1",
        member_id: actor.id,
        site_id: baseInput.site_id,
        date: baseInput.date,
        credited_unit: 1.25,
        memo: "updated by id",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [activeSiteChain(), lookupChain, updateChain]);

    const result = await service.upsertDayLog(
      {
        ...baseInput,
        id: "log-1",
        credited_unit: 1.25,
        memo: "updated by id",
      },
      actor,
    );

    expect(lookupChain.eq).toHaveBeenCalledWith("id", "log-1");
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        credited_unit: 1.25,
        memo: "updated by id",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "log-1",
        credited_unit: 1.25,
      }),
    );
  });

  it("updates an existing log by natural key", async () => {
    const service = new PathV31Service(orgId);
    const lookupChain = createChain({
      data: {
        id: "log-2",
        member_id: actor.id,
        locked_by_site_close_id: null,
      },
      error: null,
    });
    const updateChain = createChain({
      data: {
        id: "log-2",
        member_id: actor.id,
        site_id: baseInput.site_id,
        date: baseInput.date,
        credited_unit: 1.5,
        memo: "natural-key update",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [activeSiteChain(), lookupChain, updateChain]);

    const result = await service.upsertDayLog(
      {
        ...baseInput,
        credited_unit: 1.5,
        memo: "natural-key update",
      },
      actor,
    );

    expect(lookupChain.eq).toHaveBeenCalledWith("date", baseInput.date);
    expect(lookupChain.eq).toHaveBeenCalledWith("site_id", baseInput.site_id);
    expect(lookupChain.eq).toHaveBeenCalledWith("member_id", actor.id);
    expect(updateChain.eq).toHaveBeenCalledWith("id", "log-2");
    expect(result).toEqual(
      expect.objectContaining({
        id: "log-2",
        credited_unit: 1.5,
      }),
    );
  });

  it("rejects locked day logs", async () => {
    const service = new PathV31Service(orgId);
    const lookupChain = createChain({
      data: {
        id: "log-3",
        member_id: actor.id,
        locked_by_site_close_id: "close-1",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [activeSiteChain(), lookupChain]);

    await expect(service.upsertDayLog(baseInput, actor)).rejects.toThrow("DAY_LOG_LOCKED");
  });

  it("recovers from a duplicate insert race by reloading and updating the natural-key row", async () => {
    const service = new PathV31Service(orgId);
    const initialLookupChain = createChain({ data: null, error: null });
    const insertChain = createChain({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });
    const racedLookupChain = createChain({
      data: {
        id: "log-4",
        member_id: actor.id,
        locked_by_site_close_id: null,
      },
      error: null,
    });
    const updateChain = createChain({
      data: {
        id: "log-4",
        member_id: actor.id,
        site_id: baseInput.site_id,
        date: baseInput.date,
        credited_unit: 1.75,
        memo: "race recovered",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [
      activeSiteChain(),
      initialLookupChain,
      insertChain,
      racedLookupChain,
      updateChain,
    ]);

    const result = await service.upsertDayLog(
      {
        ...baseInput,
        credited_unit: 1.75,
        memo: "race recovered",
      },
      actor,
    );

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: orgId,
        member_id: actor.id,
      }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith("id", "log-4");
    expect(result).toEqual(
      expect.objectContaining({
        id: "log-4",
        credited_unit: 1.75,
      }),
    );
  });

  it("rejects day-log writes after site completion", async () => {
    const service = new PathV31Service(orgId);
    const completedSiteChain = createChain({
      data: {
        id: baseInput.site_id,
        status: "completed",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [completedSiteChain]);

    await expect(service.upsertDayLog(baseInput, actor)).rejects.toThrow("SITE_COMPLETED_DAY_LOG_IMMUTABLE");
  });
});

describe("PathV31Service reward calculation", () => {
  const orgId = "00000000-0000-0000-0000-000000000001";
  const memberIds = {
    yuto: "e93f3438-ae73-4c55-b2ab-a370d096bde0",
    jay: "22222222-2222-4222-8222-0000000000a2",
    teru: "33333333-3333-4333-8333-0000000000a3",
    daito: "44444444-4444-4444-8444-0000000000a4",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("turns site revenue changes into distributable profit and auto result share", async () => {
    const service = new PathV31Service(orgId);
    const siteId = "11111111-1111-4111-8111-111111111111";
    const dayLogs = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        site_id: siteId,
        member_id: memberIds.yuto,
        role_type: "lead",
        credited_unit: 10,
        locked_by_site_close_id: null,
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        site_id: siteId,
        member_id: memberIds.jay,
        role_type: "assist",
        credited_unit: 10,
        locked_by_site_close_id: null,
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        site_id: siteId,
        member_id: memberIds.daito,
        role_type: "support",
        credited_unit: 10,
        locked_by_site_close_id: null,
      },
    ];
    setupMockFromSequence(mockFrom, [
      createChain({ data: [], error: null }),
      createChain({ data: pathRule, error: null }),
      createChain({ data: dayLogs, error: null }),
    ]);

    const preview = await service.previewSiteClose({
      site_id: siteId,
      included_day_log_ids: dayLogs.map((row) => row.id),
      recognized_revenue: 1_000_000,
      material_cost: 300_000,
      external_cost: 100_000,
      direct_cost: 80_000,
      overhead_allocated: 20_000,
      known_rework_cost: 10_000,
      approved_adjustments: 5_000,
      difficulty_band: "S2",
      share_mode: "auto_points",
      closed_at: "2026-05-20T00:00:00.000Z",
    });

    expect(preview.distributable_profit).toBe(495_000);
    expect(preview.calculation_snapshot).toEqual(
      expect.objectContaining({
        profit: expect.objectContaining({
          recognized_revenue: 1_000_000,
          material_cost: 300_000,
          distributable_profit: 495_000,
        }),
      }),
    );

    const shareSnapshot = preview.share_snapshot as Array<{ member_id: string; raw_points: number; result_share: number }>;
    expect(shareSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ member_id: memberIds.yuto, raw_points: 18, result_share: 0.6429 }),
        expect.objectContaining({ member_id: memberIds.jay, raw_points: 10, result_share: 0.3571 }),
        expect.objectContaining({ member_id: memberIds.daito, raw_points: 0, result_share: 0 }),
      ]),
    );
  });

  it("recalculates the four member rewards when a site's distributable profit changes", async () => {
    const service = new PathV31Service(orgId);
    const closeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const closeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const memberOrder = [memberIds.yuto, memberIds.jay, memberIds.teru, memberIds.daito];
    const makeSiteCloses = (siteBProfit: number) => [
      {
        id: closeA,
        site_id: "11111111-1111-4111-8111-111111111111",
        closed_at: "2026-05-10T00:00:00.000Z",
        status: "finalized",
        distributable_profit: 600_000,
        share_snapshot: [
          { member_id: memberIds.yuto, result_share: 0.5 },
          { member_id: memberIds.jay, result_share: 0.3 },
          { member_id: memberIds.teru, result_share: 0.2 },
        ],
      },
      {
        id: closeB,
        site_id: "22222222-2222-4222-8222-222222222222",
        closed_at: "2026-05-20T00:00:00.000Z",
        status: "finalized",
        distributable_profit: siteBProfit,
        share_snapshot: [
          { member_id: memberIds.yuto, result_share: 0.1 },
          { member_id: memberIds.jay, result_share: 0.2 },
          { member_id: memberIds.teru, result_share: 0.3 },
          { member_id: memberIds.daito, result_share: 0.4 },
        ],
      },
    ];
    const dayLogs = memberOrder.flatMap((memberId, index) => [
      {
        id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${index + 10}`,
        locked_by_site_close_id: closeA,
        member_id: memberId,
        credited_unit: 10,
      },
      {
        id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb${index + 10}`,
        locked_by_site_close_id: closeB,
        member_id: memberId,
        credited_unit: 10,
      },
    ]);
    const profiles = [
      { id: memberIds.yuto, full_name: "ユウト", username: "yuto" },
      { id: memberIds.jay, full_name: "ジェイ", username: "jay" },
      { id: memberIds.teru, full_name: "テル", username: "teru" },
      { id: memberIds.daito, full_name: "ダイト", username: "daito" },
    ];

    setupMockFromSequence(mockFrom, [
      createChain({ data: pathRule, error: null }),
      createChain({ data: makeSiteCloses(400_000), error: null }),
      createChain({ data: dayLogs, error: null }),
      createChain({ data: profiles, error: null }),
      createChain({ data: pathRule, error: null }),
      createChain({ data: makeSiteCloses(800_000), error: null }),
      createChain({ data: dayLogs, error: null }),
      createChain({ data: profiles, error: null }),
    ]);

    const basePreview = await service.previewMonthlyDistribution("2026-05");
    const raisedPreview = await service.previewMonthlyDistribution("2026-05");
    const expectedBaseRawWeights = [340_000, 260_000, 240_000, 160_000];
    const expectedRaisedRawWeights = [380_000, 340_000, 360_000, 320_000];
    const expectedBaseResultPay = distributeByWeights(
      650_000,
      expectedBaseRawWeights.map((weight) => round4(weight ** 1.12)),
    );
    const expectedRaisedResultPay = distributeByWeights(
      910_000,
      expectedRaisedRawWeights.map((weight) => round4(weight ** 1.12)),
    );

    expect(basePreview.pool_amount).toBe(1_000_000);
    expect(basePreview.calculation_snapshot).toEqual(
      expect.objectContaining({
        floor_pool_amount: 350_000,
        result_pool_amount: 650_000,
      }),
    );
    expect(basePreview.members.map((member) => member.raw_result_weight)).toEqual(expectedBaseRawWeights);
    expect(basePreview.members.map((member) => member.floor_pay)).toEqual([87_500, 87_500, 87_500, 87_500]);
    expect(basePreview.members.map((member) => member.result_pay)).toEqual(expectedBaseResultPay);
    expect(basePreview.members.map((member) => member.total_pay)).toEqual(
      expectedBaseResultPay.map((amount) => amount + 87_500),
    );

    expect(raisedPreview.pool_amount).toBe(1_400_000);
    expect(raisedPreview.calculation_snapshot).toEqual(
      expect.objectContaining({
        floor_pool_amount: 490_000,
        result_pool_amount: 910_000,
      }),
    );
    expect(raisedPreview.members.map((member) => member.raw_result_weight)).toEqual(expectedRaisedRawWeights);
    expect(raisedPreview.members.map((member) => member.floor_pay)).toEqual([122_500, 122_500, 122_500, 122_500]);
    expect(raisedPreview.members.map((member) => member.result_pay)).toEqual(expectedRaisedResultPay);
    expect(raisedPreview.members.find((member) => member.member_id === memberIds.daito)?.total_pay).toBeGreaterThan(
      basePreview.members.find((member) => member.member_id === memberIds.daito)?.total_pay ?? 0,
    );
    expect(raisedPreview.members.find((member) => member.member_id === memberIds.teru)?.total_pay).toBeGreaterThan(
      basePreview.members.find((member) => member.member_id === memberIds.teru)?.total_pay ?? 0,
    );
  });
});

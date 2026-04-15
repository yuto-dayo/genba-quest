jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import {
  BASE_POOL_RATE,
  LEVEL_COEFFICIENTS,
  PATH_REWARD_CALCULATION_SYSTEM,
  PATH_REWARD_CALCULATION_VERSION,
  PathRewardService,
  calculateProfitAmount,
} from "../../services/PathRewardService";

describe("PathRewardService", () => {
  const service = new PathRewardService("00000000-0000-0000-0000-000000000001");

  it("calculates PATH preview with fixed level and monthly coefficients", () => {
    const preview = service.calculatePreview({
      month: "2026-04",
      profit_inputs: {
        sales: 100000,
        outsourcing_cost: 10000,
        materials_cost: 5000,
        parking_cost: 0,
        transport_cost: 0,
        other_direct_cost: 5000,
        common_cost: 10000,
        reserve_amount: 5000,
      },
      members: [
        {
          member_id: "11111111-1111-4111-8111-111111111111",
          name: "田中",
          work_days: 20,
          level: "L2",
          A: 1,
          R: 1,
          Q: 1,
        },
        {
          member_id: "22222222-2222-4222-8222-222222222222",
          name: "山田",
          work_days: 10,
          level: "L1",
          A: 2,
          R: 2,
          Q: 2,
        },
      ],
    });

    expect(preview.calculation_system).toBe(PATH_REWARD_CALCULATION_SYSTEM);
    expect(preview.calculation_version).toBe(PATH_REWARD_CALCULATION_VERSION);
    expect(preview.profit_amount).toBe(65000);
    expect(preview.base_pool_amount).toBe(Math.round(65000 * BASE_POOL_RATE));
    expect(preview.variable_pool_amount).toBe(9750);
    expect(preview.total_amount).toBe(65000);
    expect(preview.members).toEqual([
      expect.objectContaining({
        member_id: "11111111-1111-4111-8111-111111111111",
        level_coefficient: LEVEL_COEFFICIENTS.L2,
        monthly_point_total: 3,
        monthly_coefficient: 1.0,
        base_reward: 38772,
        variable_reward: 4643,
        total_reward: 43415,
      }),
      expect.objectContaining({
        member_id: "22222222-2222-4222-8222-222222222222",
        level_coefficient: LEVEL_COEFFICIENTS.L1,
        monthly_point_total: 6,
        monthly_coefficient: 1.1,
        base_reward: 16478,
        variable_reward: 5107,
        total_reward: 21585,
      }),
    ]);
  });

  it("builds canonical reward.calculate proposal payload", () => {
    const preview = service.calculatePreview({
      month: "2026-04",
      profit_inputs: {
        sales: 50000,
        outsourcing_cost: 5000,
        materials_cost: 0,
        parking_cost: 0,
        transport_cost: 0,
        other_direct_cost: 0,
        common_cost: 0,
        reserve_amount: 0,
      },
      members: [
        {
          member_id: "11111111-1111-4111-8111-111111111111",
          name: "田中",
          work_days: 10,
          level: "L2",
          A: 1,
          R: 1,
          Q: 1,
        },
      ],
    });

    const payload = service.buildProposalPayload(preview);

    expect(payload).toEqual(expect.objectContaining({
      calculation_system: PATH_REWARD_CALCULATION_SYSTEM,
      calculation_version: PATH_REWARD_CALCULATION_VERSION,
      month: "2026-04",
      amount_total: 45000,
      total_amount: 45000,
      currency: "JPY",
    }));
    expect(Array.isArray(payload.members)).toBe(true);
  });

  it("rejects non-positive profit months", () => {
    expect(() =>
      service.calculatePreview({
        month: "2026-04",
        profit_inputs: {
          sales: 1000,
          outsourcing_cost: 2000,
          materials_cost: 0,
          parking_cost: 0,
          transport_cost: 0,
          other_direct_cost: 0,
          common_cost: 0,
          reserve_amount: 0,
        },
        members: [
          {
            member_id: "11111111-1111-4111-8111-111111111111",
            name: "田中",
            work_days: 1,
            level: "L1",
            A: 0,
            R: 0,
            Q: 0,
          },
        ],
      }),
    ).toThrow("NON_POSITIVE_PROFIT_AMOUNT");
  });

  it("exports raw profit calculation helper", () => {
    expect(calculateProfitAmount({
      sales: 100,
      outsourcing_cost: 10,
      materials_cost: 20,
      parking_cost: 5,
      transport_cost: 5,
      other_direct_cost: 10,
      common_cost: 10,
      reserve_amount: 5,
    })).toBe(35);
  });
});
